create index if not exists idx_device_metric_events_bet_spin_key
on public.device_metric_events (
  device_id,
  ((metadata->>'spinKey')),
  event_ts desc,
  id desc
)
where event_type = 'bet';

create or replace function public.apply_metric_event(
  p_device_id text,
  p_event_type text,
  p_amount numeric,
  p_event_ts timestamptz default now(),
  p_metadata jsonb default '{}'::jsonb,
  p_write_ledger boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date date := coalesce((p_event_ts at time zone 'utc')::date, (now() at time zone 'utc')::date);
  v_event text := lower(trim(coalesce(p_event_type, '')));
  v_amt numeric := greatest(coalesce(p_amount, 0), 0);
  v_balance_delta numeric := 0;
  v_coins_in numeric := 0;
  v_hopper_in numeric := 0;
  v_hopper_out numeric := 0;
  v_bet numeric := 0;
  v_win numeric := 0;
  v_withdraw numeric := 0;
  v_spins bigint := 0;
  v_house_take numeric := 0;
  v_pool_contrib numeric := 0;
  v_pool_paid numeric := 0;
  v_jackpot_contrib numeric := 0;
  v_jackpot_paid numeric := 0;
  v_spin_win_hint numeric := 0;
  v_effective_spin_win_hint numeric := 0;
  v_requested_win numeric := 0;
  v_last_bet_amount numeric := null;
  v_last_bet_at timestamptz := null;
  v_runtime public.casino_runtime;
  v_profile_id text;
  v_profile_house_pct numeric := 0;
  v_profile_jackpot_pct numeric := 0;
  v_house_pct numeric := 0;
  v_jackpot_pct numeric := 0;
  v_happy_pct numeric := 0;
  v_house_target numeric := 0;
  v_jackpot_target numeric := 0;
  v_after_win numeric := 0;
  v_after_house numeric := 0;
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_max_win_cap numeric := null;
  v_normal_win_cap numeric := null;
  v_over_cap_amount numeric := 0;
  v_spin_key text := nullif(trim(coalesce(p_metadata->>'spinKey', '')), '');
  v_guard_funding_source text := 'runtime_pool';
  v_guarded_from_bet boolean := false;
  v_dedup_inserted_count integer := 0;
begin
  if p_device_id is null or trim(p_device_id) = '' then
    raise exception 'p_device_id is required';
  end if;

  if v_amt = 0 then
    return;
  end if;

  insert into public.devices (device_id)
  values (p_device_id)
  on conflict (device_id) do nothing;

  if v_spin_key is not null and v_event in ('bet', 'win', 'spin') then
    insert into public.device_spin_event_dedup (
      device_id,
      spin_key,
      event_type,
      event_ts,
      amount,
      metadata
    )
    values (
      p_device_id,
      v_spin_key,
      v_event,
      coalesce(p_event_ts, now()),
      v_amt,
      v_metadata
    )
    on conflict (device_id, spin_key, event_type) do nothing;

    get diagnostics v_dedup_inserted_count = row_count;

    if v_dedup_inserted_count = 0 then
      return;
    end if;
  end if;

  if v_event = 'coins_in' then
    v_coins_in := v_amt;
    v_balance_delta := v_amt;
  elsif v_event = 'hopper_in' then
    v_hopper_in := v_amt;
  elsif v_event = 'withdrawal' then
    v_hopper_out := v_amt;
    v_withdraw := v_amt;
    v_balance_delta := -v_amt;
  end if;

  if v_event in ('coins_in', 'hopper_in', 'withdrawal') then
    update public.devices
    set
      balance = greatest(0, balance + v_balance_delta),
      coins_in_total = coins_in_total + v_coins_in,
      hopper_balance = greatest(0, hopper_balance + v_hopper_in - v_hopper_out),
      hopper_in_total = hopper_in_total + v_hopper_in,
      hopper_out_total = hopper_out_total + v_hopper_out,
      withdraw_total = withdraw_total + v_withdraw,
      updated_at = now()
    where device_id = p_device_id;

    insert into public.device_daily_stats (
      stat_date,
      device_id,
      coins_in_amount,
      hopper_in_amount,
      hopper_out_amount,
      bet_amount,
      win_amount,
      house_take_amount,
      jackpot_contrib_amount,
      jackpot_win_amount,
      withdrawal_amount,
      balance_change,
      event_count,
      spins_count,
      prize_pool_contrib_amount,
      prize_pool_paid_amount,
      updated_at
    )
    values (
      v_date,
      p_device_id,
      v_coins_in,
      v_hopper_in,
      v_hopper_out,
      0,
      0,
      0,
      0,
      0,
      v_withdraw,
      v_balance_delta,
      1,
      0,
      0,
      0,
      now()
    )
    on conflict (stat_date, device_id) do update
    set
      coins_in_amount = device_daily_stats.coins_in_amount + excluded.coins_in_amount,
      hopper_in_amount = device_daily_stats.hopper_in_amount + excluded.hopper_in_amount,
      hopper_out_amount = device_daily_stats.hopper_out_amount + excluded.hopper_out_amount,
      withdrawal_amount = device_daily_stats.withdrawal_amount + excluded.withdrawal_amount,
      balance_change = device_daily_stats.balance_change + excluded.balance_change,
      event_count = device_daily_stats.event_count + 1,
      updated_at = now();

    if p_write_ledger then
      insert into public.device_metric_events (event_ts, device_id, event_type, amount, metadata)
      values (coalesce(p_event_ts, now()), p_device_id, v_event, v_amt, v_metadata);
    end if;

    return;
  end if;

  insert into public.casino_runtime (id, base_profile_id, happy_profile_id)
  values (true, 'base_slow', 'happy_slow')
  on conflict (id) do nothing;

  select * into v_runtime
  from public.casino_runtime
  where id = true
  for update;

  if coalesce(v_runtime.max_win_enabled, true) then
    select public.compute_max_win_cap(d.last_bet_amount)
      into v_max_win_cap
    from public.devices d
    where d.device_id = p_device_id;
  end if;

  if v_event = 'bet' then
    v_bet := v_amt;
    v_balance_delta := -v_amt;
    v_last_bet_amount := v_bet;
    v_last_bet_at := coalesce(p_event_ts, now());

    v_profile_id := case
      when v_runtime.active_mode = 'HAPPY' then v_runtime.happy_profile_id
      else v_runtime.base_profile_id
    end;

    select
      coalesce(house_pct, 0),
      coalesce(pool_pct, 0)
      into v_profile_house_pct, v_profile_jackpot_pct
    from public.rtp_profiles
    where id = v_profile_id;

    if v_metadata ? 'totalWin' then
      begin
        v_spin_win_hint := greatest(coalesce((v_metadata->>'totalWin')::numeric, 0), 0);
      exception when others then
        v_spin_win_hint := 0;
      end;
    end if;

    v_house_pct := greatest(v_profile_house_pct, 0);
    v_jackpot_pct := greatest(v_profile_jackpot_pct, 0);
    v_jackpot_pct := least(v_jackpot_pct, greatest(100 - v_house_pct, 0));
    v_happy_pct := greatest(100 - v_house_pct - v_jackpot_pct, 0);

    v_house_target := v_bet * v_house_pct / 100.0;
    v_jackpot_target := v_bet * v_jackpot_pct / 100.0;

    if v_runtime.active_mode = 'HAPPY' then
      v_normal_win_cap := greatest(coalesce(v_runtime.happy_hour_prize_balance, 0), 0);
      v_guard_funding_source := 'happy_prize_pool';
    else
      v_normal_win_cap := greatest(coalesce(v_runtime.prize_pool_balance, 0), 0)
        + greatest(v_bet - v_house_target, 0);
      v_guard_funding_source := 'base_spin_budget';
    end if;

    if v_max_win_cap is not null then
      v_normal_win_cap := least(v_normal_win_cap, v_max_win_cap);
    end if;

    v_normal_win_cap := greatest(coalesce(v_normal_win_cap, 0), 0);
    v_effective_spin_win_hint := least(v_spin_win_hint, v_normal_win_cap);
    v_after_win := v_bet - v_effective_spin_win_hint;

    v_house_take := greatest(v_house_target, 0);
    v_after_house := v_after_win - v_house_take;
    v_jackpot_contrib := greatest(least(v_jackpot_target, v_after_house), 0);
    v_pool_contrib := v_after_house - v_jackpot_contrib;
    v_metadata := v_metadata || jsonb_build_object(
      'requestedTotalWin', v_spin_win_hint,
      'effectiveTotalWinHint', v_effective_spin_win_hint,
      'normalWinFundingCap', v_normal_win_cap,
      'winFundingSource', v_guard_funding_source,
      'overCapWinHint', v_spin_win_hint > v_effective_spin_win_hint + 0.0001
    );

    update public.casino_runtime
    set
      prize_pool_balance = greatest(0, prize_pool_balance + v_pool_contrib),
      jackpot_pool_balance = greatest(0, jackpot_pool_balance + v_jackpot_contrib),
      updated_at = now()
    where id = true
    returning * into v_runtime;

    perform public.process_pool_goal_queues(coalesce(p_event_ts, now()));
    perform public.trigger_jackpot_payout_if_ready(coalesce(p_event_ts, now()));
  elsif v_event = 'win' then
    v_requested_win := v_amt;
    v_win := v_requested_win;

    if p_write_ledger and v_spin_key is not null then
      begin
        select
          greatest(coalesce((e.metadata->>'normalWinFundingCap')::numeric, 0), 0),
          coalesce(e.metadata->>'winFundingSource', 'bet_guard')
          into v_normal_win_cap, v_guard_funding_source
        from public.device_metric_events e
        where e.device_id = p_device_id
          and e.event_type = 'bet'
          and coalesce(e.metadata->>'spinKey', '') = v_spin_key
        order by e.event_ts desc, e.id desc
        limit 1;

        v_guarded_from_bet := v_normal_win_cap is not null;
      exception when others then
        v_normal_win_cap := null;
        v_guarded_from_bet := false;
      end;
    end if;

    if v_normal_win_cap is null then
      if v_runtime.active_mode = 'HAPPY' then
        v_normal_win_cap := greatest(coalesce(v_runtime.happy_hour_prize_balance, 0), 0);
        v_guard_funding_source := 'happy_prize_pool';
      else
        v_normal_win_cap := greatest(coalesce(v_runtime.prize_pool_balance, 0), 0);
        v_guard_funding_source := 'base_prize_pool';
      end if;
    end if;

    if v_max_win_cap is not null then
      v_normal_win_cap := least(greatest(coalesce(v_normal_win_cap, 0), 0), v_max_win_cap);
    end if;

    v_normal_win_cap := greatest(coalesce(v_normal_win_cap, 0), 0);
    v_win := least(v_requested_win, v_normal_win_cap);
    v_over_cap_amount := greatest(v_requested_win - v_win, 0);

    if v_over_cap_amount > 0.0001 then
      insert into public.over_cap_win_events (
        device_id,
        spin_key,
        event_ts,
        runtime_mode,
        funding_source,
        requested_amount,
        accepted_amount,
        funding_cap_amount,
        over_amount,
        metadata
      )
      values (
        p_device_id,
        v_spin_key,
        coalesce(p_event_ts, now()),
        v_runtime.active_mode,
        v_guard_funding_source,
        v_requested_win,
        v_win,
        v_normal_win_cap,
        v_over_cap_amount,
        v_metadata
      );
    end if;

    v_metadata := v_metadata || jsonb_build_object(
      'requestedWin', v_requested_win,
      'acceptedWin', v_win,
      'normalWinFundingCap', v_normal_win_cap,
      'winFundingSource', v_guard_funding_source,
      'overCapWinAdjusted', v_over_cap_amount > 0.0001
    );

    v_balance_delta := v_win;

    if v_runtime.active_mode = 'HAPPY' then
      v_pool_paid := v_win;

      update public.casino_runtime
      set
        happy_hour_prize_balance = greatest(0, happy_hour_prize_balance - v_pool_paid),
        updated_at = now()
      where id = true
      returning * into v_runtime;

      if v_runtime.active_happy_pot_id is not null then
        update public.happy_hour_pots
        set amount_remaining = greatest(amount_remaining - v_pool_paid, 0)
        where id = v_runtime.active_happy_pot_id;
      end if;
    elsif not v_guarded_from_bet then
      v_pool_paid := v_win;

      update public.casino_runtime
      set
        prize_pool_balance = greatest(0, prize_pool_balance - v_pool_paid),
        updated_at = now()
      where id = true
      returning * into v_runtime;
    end if;
  elsif v_event = 'spin' then
    v_spins := greatest(floor(v_amt), 0);

    update public.casino_runtime
    set
      happy_pool_spin_counter = happy_pool_spin_counter + v_spins,
      jackpot_pool_spin_counter = jackpot_pool_spin_counter + v_spins,
      updated_at = now()
    where id = true;

    perform public.process_pool_goal_queues(coalesce(p_event_ts, now()));
    perform public.trigger_jackpot_payout_if_ready(coalesce(p_event_ts, now()));

    v_jackpot_paid := public.process_device_jackpot_payout(p_device_id, coalesce(p_event_ts, now()));

    if v_jackpot_paid > 0 then
      v_win := v_win + v_jackpot_paid;
      v_balance_delta := v_balance_delta + v_jackpot_paid;
      v_metadata := v_metadata || jsonb_build_object(
        'jackpotPayout', v_jackpot_paid,
        'jackpotCampaignPayout', true
      );
    end if;
  else
    raise exception 'unsupported metric event type: %', p_event_type;
  end if;

  if v_event <> 'bet' then
    perform public.recompute_casino_mode();
  end if;

  update public.devices
  set
    balance = greatest(0, balance + v_balance_delta),
    coins_in_total = coins_in_total + v_coins_in,
    hopper_balance = greatest(0, hopper_balance + v_hopper_in - v_hopper_out),
    hopper_in_total = hopper_in_total + v_hopper_in,
    hopper_out_total = hopper_out_total + v_hopper_out,
    bet_total = bet_total + v_bet,
    win_total = win_total + v_win,
    house_take_total = house_take_total + v_house_take,
    jackpot_contrib_total = jackpot_contrib_total + v_jackpot_contrib,
    jackpot_win_total = jackpot_win_total + v_jackpot_paid,
    last_bet_amount = coalesce(v_last_bet_amount, last_bet_amount),
    last_bet_at = coalesce(v_last_bet_at, last_bet_at),
    withdraw_total = withdraw_total + v_withdraw,
    spins_total = spins_total + v_spins,
    prize_pool_contrib_total = prize_pool_contrib_total + v_pool_contrib,
    prize_pool_paid_total = prize_pool_paid_total + v_pool_paid,
    updated_at = now()
  where device_id = p_device_id;

  insert into public.device_daily_stats (
    stat_date,
    device_id,
    coins_in_amount,
    hopper_in_amount,
    hopper_out_amount,
    bet_amount,
    win_amount,
    house_take_amount,
    jackpot_contrib_amount,
    jackpot_win_amount,
    withdrawal_amount,
    balance_change,
    event_count,
    spins_count,
    prize_pool_contrib_amount,
    prize_pool_paid_amount,
    updated_at
  )
  values (
    v_date,
    p_device_id,
    v_coins_in,
    v_hopper_in,
    v_hopper_out,
    v_bet,
    v_win,
    v_house_take,
    v_jackpot_contrib,
    v_jackpot_paid,
    v_withdraw,
    v_balance_delta,
    1,
    v_spins,
    v_pool_contrib,
    v_pool_paid,
    now()
  )
  on conflict (stat_date, device_id) do update
  set
    coins_in_amount = device_daily_stats.coins_in_amount + excluded.coins_in_amount,
    hopper_in_amount = device_daily_stats.hopper_in_amount + excluded.hopper_in_amount,
    hopper_out_amount = device_daily_stats.hopper_out_amount + excluded.hopper_out_amount,
    bet_amount = device_daily_stats.bet_amount + excluded.bet_amount,
    win_amount = device_daily_stats.win_amount + excluded.win_amount,
    house_take_amount = device_daily_stats.house_take_amount + excluded.house_take_amount,
    jackpot_contrib_amount = device_daily_stats.jackpot_contrib_amount + excluded.jackpot_contrib_amount,
    jackpot_win_amount = device_daily_stats.jackpot_win_amount + excluded.jackpot_win_amount,
    withdrawal_amount = device_daily_stats.withdrawal_amount + excluded.withdrawal_amount,
    balance_change = device_daily_stats.balance_change + excluded.balance_change,
    event_count = device_daily_stats.event_count + 1,
    spins_count = device_daily_stats.spins_count + excluded.spins_count,
    prize_pool_contrib_amount = device_daily_stats.prize_pool_contrib_amount + excluded.prize_pool_contrib_amount,
    prize_pool_paid_amount = device_daily_stats.prize_pool_paid_amount + excluded.prize_pool_paid_amount,
    updated_at = now();

  if p_write_ledger then
    insert into public.device_metric_events (event_ts, device_id, event_type, amount, metadata)
    values (coalesce(p_event_ts, now()), p_device_id, v_event, v_amt, v_metadata);
  end if;
end;
$$;
