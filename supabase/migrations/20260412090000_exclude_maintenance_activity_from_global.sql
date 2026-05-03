create or replace function public.resolve_device_presence_status(
  p_device_status text,
  p_last_seen_at timestamptz,
  p_ref_ts timestamptz default now()
)
returns text
language sql
stable
as $$
  select case
    when p_last_seen_at is null
      or p_last_seen_at < coalesce(p_ref_ts, now()) - interval '90 seconds'
      then 'offline'::text
    else coalesce(nullif(trim(p_device_status), ''), 'offline')
  end;
$$;

create or replace function public.should_count_device_activity(
  p_deployment_mode text,
  p_device_status text,
  p_last_seen_at timestamptz,
  p_ref_ts timestamptz default now()
)
returns boolean
language sql
stable
as $$
  select coalesce(nullif(trim(p_deployment_mode), ''), 'online') = 'online'
    and public.resolve_device_presence_status(
      p_device_status,
      p_last_seen_at,
      coalesce(p_ref_ts, now())
    ) <> 'offline';
$$;

alter table public.device_metric_events
  add column if not exists deployment_mode text not null default 'online',
  add column if not exists device_status text not null default 'offline',
  add column if not exists counts_toward_global boolean not null default true;

alter table public.device_daily_stats
  add column if not exists included_coins_in_amount numeric not null default 0,
  add column if not exists included_hopper_in_amount numeric not null default 0,
  add column if not exists included_hopper_out_amount numeric not null default 0,
  add column if not exists included_bet_amount numeric not null default 0,
  add column if not exists included_win_amount numeric not null default 0,
  add column if not exists included_withdrawal_amount numeric not null default 0,
  add column if not exists included_balance_change numeric not null default 0,
  add column if not exists included_event_count bigint not null default 0,
  add column if not exists included_spins_count bigint not null default 0,
  add column if not exists included_prize_pool_contrib_amount numeric not null default 0,
  add column if not exists included_prize_pool_paid_amount numeric not null default 0,
  add column if not exists included_house_take_amount numeric not null default 0,
  add column if not exists included_jackpot_contrib_amount numeric not null default 0,
  add column if not exists included_jackpot_win_amount numeric not null default 0;

update public.device_metric_events
set
  deployment_mode = coalesce(nullif(trim(deployment_mode), ''), 'online'),
  device_status = coalesce(nullif(trim(device_status), ''), 'offline'),
  counts_toward_global = coalesce(counts_toward_global, true)
where true;

update public.device_daily_stats
set
  included_coins_in_amount = coalesce(included_coins_in_amount, coins_in_amount, 0),
  included_hopper_in_amount = coalesce(included_hopper_in_amount, hopper_in_amount, 0),
  included_hopper_out_amount = coalesce(included_hopper_out_amount, hopper_out_amount, 0),
  included_bet_amount = coalesce(included_bet_amount, bet_amount, 0),
  included_win_amount = coalesce(included_win_amount, win_amount, 0),
  included_withdrawal_amount = coalesce(included_withdrawal_amount, withdrawal_amount, 0),
  included_balance_change = coalesce(included_balance_change, balance_change, 0),
  included_event_count = coalesce(included_event_count, event_count, 0),
  included_spins_count = coalesce(included_spins_count, spins_count, 0),
  included_prize_pool_contrib_amount = coalesce(included_prize_pool_contrib_amount, prize_pool_contrib_amount, 0),
  included_prize_pool_paid_amount = coalesce(included_prize_pool_paid_amount, prize_pool_paid_amount, 0),
  included_house_take_amount = coalesce(included_house_take_amount, house_take_amount, 0),
  included_jackpot_contrib_amount = coalesce(included_jackpot_contrib_amount, jackpot_contrib_amount, 0),
  included_jackpot_win_amount = coalesce(included_jackpot_win_amount, jackpot_win_amount, 0)
where true;

create index if not exists idx_device_metric_events_global_time
  on public.device_metric_events (counts_toward_global, event_ts desc);

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
  v_event_ts timestamptz := coalesce(p_event_ts, now());
  v_date date := coalesce((v_event_ts at time zone 'utc')::date, (now() at time zone 'utc')::date);
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
  v_deployment_mode text := 'online';
  v_effective_device_status text := 'offline';
  v_counts_toward_global boolean := false;
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

  select
    coalesce(nullif(trim(d.deployment_mode), ''), 'online'),
    public.resolve_device_presence_status(d.device_status, d.last_seen_at, v_event_ts),
    public.should_count_device_activity(d.deployment_mode, d.device_status, d.last_seen_at, v_event_ts)
    into v_deployment_mode, v_effective_device_status, v_counts_toward_global
  from public.devices d
  where d.device_id = p_device_id;

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
      v_event_ts,
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
      included_coins_in_amount,
      included_hopper_in_amount,
      included_hopper_out_amount,
      included_bet_amount,
      included_win_amount,
      included_house_take_amount,
      included_jackpot_contrib_amount,
      included_jackpot_win_amount,
      included_withdrawal_amount,
      included_balance_change,
      included_event_count,
      included_spins_count,
      included_prize_pool_contrib_amount,
      included_prize_pool_paid_amount,
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
      case when v_counts_toward_global then v_coins_in else 0 end,
      case when v_counts_toward_global then v_hopper_in else 0 end,
      case when v_counts_toward_global then v_hopper_out else 0 end,
      0,
      0,
      0,
      0,
      0,
      case when v_counts_toward_global then v_withdraw else 0 end,
      case when v_counts_toward_global then v_balance_delta else 0 end,
      case when v_counts_toward_global then 1 else 0 end,
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
      included_coins_in_amount = device_daily_stats.included_coins_in_amount + excluded.included_coins_in_amount,
      included_hopper_in_amount = device_daily_stats.included_hopper_in_amount + excluded.included_hopper_in_amount,
      included_hopper_out_amount = device_daily_stats.included_hopper_out_amount + excluded.included_hopper_out_amount,
      included_withdrawal_amount = device_daily_stats.included_withdrawal_amount + excluded.included_withdrawal_amount,
      included_balance_change = device_daily_stats.included_balance_change + excluded.included_balance_change,
      included_event_count = device_daily_stats.included_event_count + excluded.included_event_count,
      updated_at = now();

    insert into public.device_metric_events (
      event_ts,
      device_id,
      event_type,
      amount,
      metadata,
      deployment_mode,
      device_status,
      counts_toward_global
    )
    values (
      v_event_ts,
      p_device_id,
      v_event,
      v_amt,
      v_metadata,
      v_deployment_mode,
      v_effective_device_status,
      v_counts_toward_global
    );

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
    v_last_bet_at := v_event_ts;

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

    if v_counts_toward_global then
      update public.casino_runtime
      set
        prize_pool_balance = greatest(0, prize_pool_balance + v_pool_contrib),
        jackpot_pool_balance = greatest(0, jackpot_pool_balance + v_jackpot_contrib),
        updated_at = now()
      where id = true
      returning * into v_runtime;

      perform public.process_pool_goal_queues(v_event_ts);
      perform public.trigger_jackpot_payout_if_ready(v_event_ts);
    end if;
  elsif v_event = 'win' then
    v_requested_win := v_amt;

    if not v_counts_toward_global then
      v_win := v_requested_win;
      v_pool_paid := v_requested_win;
      v_balance_delta := v_requested_win;
      v_metadata := v_metadata || jsonb_build_object(
        'requestedWin', v_requested_win,
        'acceptedWin', v_requested_win,
        'excludedFromGlobal', true
      );
    else
      v_win := v_requested_win;

      if v_spin_key is not null then
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
          v_event_ts,
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
    end if;
  elsif v_event = 'spin' then
    v_spins := greatest(floor(v_amt), 0);

    if v_counts_toward_global then
      update public.casino_runtime
      set
        happy_pool_spin_counter = happy_pool_spin_counter + v_spins,
        jackpot_pool_spin_counter = jackpot_pool_spin_counter + v_spins,
        updated_at = now()
      where id = true;

      perform public.process_pool_goal_queues(v_event_ts);
      perform public.trigger_jackpot_payout_if_ready(v_event_ts);

      v_jackpot_paid := public.process_device_jackpot_payout(p_device_id, v_event_ts);

      if v_jackpot_paid > 0 then
        v_win := v_win + v_jackpot_paid;
        v_balance_delta := v_balance_delta + v_jackpot_paid;
        v_metadata := v_metadata || jsonb_build_object(
          'jackpotPayout', v_jackpot_paid,
          'jackpotCampaignPayout', true
        );
      end if;
    end if;
  else
    raise exception 'unsupported metric event type: %', p_event_type;
  end if;

  if v_event <> 'bet' and v_counts_toward_global then
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
    included_coins_in_amount,
    included_hopper_in_amount,
    included_hopper_out_amount,
    included_bet_amount,
    included_win_amount,
    included_house_take_amount,
    included_jackpot_contrib_amount,
    included_jackpot_win_amount,
    included_withdrawal_amount,
    included_balance_change,
    included_event_count,
    included_spins_count,
    included_prize_pool_contrib_amount,
    included_prize_pool_paid_amount,
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
    case when v_counts_toward_global then v_coins_in else 0 end,
    case when v_counts_toward_global then v_hopper_in else 0 end,
    case when v_counts_toward_global then v_hopper_out else 0 end,
    case when v_counts_toward_global then v_bet else 0 end,
    case when v_counts_toward_global then v_win else 0 end,
    case when v_counts_toward_global then v_house_take else 0 end,
    case when v_counts_toward_global then v_jackpot_contrib else 0 end,
    case when v_counts_toward_global then v_jackpot_paid else 0 end,
    case when v_counts_toward_global then v_withdraw else 0 end,
    case when v_counts_toward_global then v_balance_delta else 0 end,
    case when v_counts_toward_global then 1 else 0 end,
    case when v_counts_toward_global then v_spins else 0 end,
    case when v_counts_toward_global then v_pool_contrib else 0 end,
    case when v_counts_toward_global then v_pool_paid else 0 end,
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
    included_coins_in_amount = device_daily_stats.included_coins_in_amount + excluded.included_coins_in_amount,
    included_hopper_in_amount = device_daily_stats.included_hopper_in_amount + excluded.included_hopper_in_amount,
    included_hopper_out_amount = device_daily_stats.included_hopper_out_amount + excluded.included_hopper_out_amount,
    included_bet_amount = device_daily_stats.included_bet_amount + excluded.included_bet_amount,
    included_win_amount = device_daily_stats.included_win_amount + excluded.included_win_amount,
    included_house_take_amount = device_daily_stats.included_house_take_amount + excluded.included_house_take_amount,
    included_jackpot_contrib_amount = device_daily_stats.included_jackpot_contrib_amount + excluded.included_jackpot_contrib_amount,
    included_jackpot_win_amount = device_daily_stats.included_jackpot_win_amount + excluded.included_jackpot_win_amount,
    included_withdrawal_amount = device_daily_stats.included_withdrawal_amount + excluded.included_withdrawal_amount,
    included_balance_change = device_daily_stats.included_balance_change + excluded.included_balance_change,
    included_event_count = device_daily_stats.included_event_count + excluded.included_event_count,
    included_spins_count = device_daily_stats.included_spins_count + excluded.included_spins_count,
    included_prize_pool_contrib_amount = device_daily_stats.included_prize_pool_contrib_amount + excluded.included_prize_pool_contrib_amount,
    included_prize_pool_paid_amount = device_daily_stats.included_prize_pool_paid_amount + excluded.included_prize_pool_paid_amount,
    updated_at = now();

  insert into public.device_metric_events (
    event_ts,
    device_id,
    event_type,
    amount,
    metadata,
    deployment_mode,
    device_status,
    counts_toward_global
  )
  values (
    v_event_ts,
    p_device_id,
    v_event,
    v_amt,
    v_metadata,
    v_deployment_mode,
    v_effective_device_status,
    v_counts_toward_global
  );
end;
$$;

drop function if exists public.consume_arcade_life(
  text,
  text,
  text,
  numeric,
  text,
  timestamptz,
  jsonb
);

create or replace function public.consume_arcade_life(
  p_device_id text,
  p_game_id text default null,
  p_player text default 'p1',
  p_amount numeric default 1,
  p_reason text default 'start',
  p_event_ts timestamptz default now(),
  p_metadata jsonb default '{}'::jsonb
)
returns table(ok boolean, balance numeric, amount_charged numeric, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount numeric := greatest(coalesce(p_amount, 0), 0);
  v_balance numeric := 0;
  v_rows integer := 0;
  v_event_ts timestamptz := coalesce(p_event_ts, now());
  v_date date := coalesce((v_event_ts at time zone 'utc')::date, (now() at time zone 'utc')::date);
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
    'source', 'arcade_life',
    'game_id', coalesce(p_game_id, ''),
    'player', coalesce(p_player, ''),
    'reason', coalesce(p_reason, 'start'),
    'amount', v_amount
  );
  v_deployment_mode text := 'online';
  v_effective_device_status text := 'offline';
  v_counts_toward_global boolean := false;
begin
  if p_device_id is null or trim(p_device_id) = '' then
    return query select false, 0::numeric, 0::numeric, 'missing_device_id'::text;
    return;
  end if;

  if v_amount <= 0 then
    select d.balance into v_balance
    from public.devices d
    where d.device_id = p_device_id;

    return query select false, coalesce(v_balance, 0)::numeric, 0::numeric, 'invalid_amount'::text;
    return;
  end if;

  insert into public.devices (device_id)
  values (p_device_id)
  on conflict (device_id) do nothing;

  select
    coalesce(nullif(trim(d.deployment_mode), ''), 'online'),
    public.resolve_device_presence_status(d.device_status, d.last_seen_at, v_event_ts),
    public.should_count_device_activity(d.deployment_mode, d.device_status, d.last_seen_at, v_event_ts)
    into v_deployment_mode, v_effective_device_status, v_counts_toward_global
  from public.devices d
  where d.device_id = p_device_id;

  if exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'devices'
      and c.column_name = 'bet_total'
  ) then
    execute
      'update public.devices
       set balance = balance - $1,
           bet_total = coalesce(bet_total, 0) + $1,
           updated_at = now()
       where device_id = $2
         and balance >= $1
       returning balance'
    into v_balance
    using v_amount, p_device_id;
    get diagnostics v_rows = row_count;
  else
    update public.devices
    set balance = balance - v_amount,
        updated_at = now()
    where device_id = p_device_id
      and balance >= v_amount
    returning devices.balance into v_balance;
    get diagnostics v_rows = row_count;
  end if;

  if coalesce(v_rows, 0) = 0 then
    select d.balance into v_balance
    from public.devices d
    where d.device_id = p_device_id;

    return query select false, coalesce(v_balance, 0)::numeric, 0::numeric, 'insufficient_balance'::text;
    return;
  end if;

  if to_regclass('public.device_daily_stats') is not null then
    insert into public.device_daily_stats (
      stat_date,
      device_id,
      bet_amount,
      balance_change,
      event_count,
      included_bet_amount,
      included_balance_change,
      included_event_count,
      updated_at
    )
    values (
      v_date,
      p_device_id,
      v_amount,
      -v_amount,
      1,
      case when v_counts_toward_global then v_amount else 0 end,
      case when v_counts_toward_global then -v_amount else 0 end,
      case when v_counts_toward_global then 1 else 0 end,
      now()
    )
    on conflict (stat_date, device_id) do update
    set
      bet_amount = public.device_daily_stats.bet_amount + excluded.bet_amount,
      balance_change = public.device_daily_stats.balance_change + excluded.balance_change,
      event_count = public.device_daily_stats.event_count + 1,
      included_bet_amount = public.device_daily_stats.included_bet_amount + excluded.included_bet_amount,
      included_balance_change = public.device_daily_stats.included_balance_change + excluded.included_balance_change,
      included_event_count = public.device_daily_stats.included_event_count + excluded.included_event_count,
      updated_at = now();
  end if;

  if to_regclass('public.device_metric_events') is not null then
    insert into public.device_metric_events (
      event_ts,
      device_id,
      event_type,
      amount,
      metadata,
      deployment_mode,
      device_status,
      counts_toward_global
    )
    values (
      v_event_ts,
      p_device_id,
      'bet',
      v_amount,
      v_meta,
      v_deployment_mode,
      v_effective_device_status,
      v_counts_toward_global
    );
  end if;

  return query select true, v_balance, v_amount, 'charged'::text;
end;
$$;

create or replace view public.global_daily_stats as
select
  s.stat_date,
  coalesce(sum(s.included_coins_in_amount), 0::numeric) as total_coins_in,
  coalesce(sum(s.included_hopper_in_amount), 0::numeric) as total_hopper_in,
  coalesce(sum(s.included_hopper_out_amount), 0::numeric) as total_hopper_out,
  coalesce(sum(s.included_bet_amount), 0::numeric) as total_bet_amount,
  coalesce(sum(s.included_win_amount), 0::numeric) as total_win_amount,
  coalesce(sum(s.included_withdrawal_amount), 0::numeric) as total_withdraw_amount,
  coalesce(sum(s.included_balance_change), 0::numeric) as total_balance_change,
  coalesce(sum(s.included_event_count), 0::numeric)::bigint as event_count
from public.device_daily_stats s
group by s.stat_date
order by s.stat_date desc;

create or replace view public.global_stats_live as
with totals as (
  select
    coalesce(sum(s.included_balance_change), 0::numeric) as total_balance,
    coalesce(sum(s.included_coins_in_amount), 0::numeric) as total_coins_in,
    coalesce(sum(s.included_hopper_in_amount - s.included_hopper_out_amount), 0::numeric) as total_hopper,
    coalesce(sum(s.included_bet_amount), 0::numeric) as total_bet_amount,
    coalesce(sum(s.included_win_amount), 0::numeric) as total_win_amount,
    coalesce(sum(s.included_withdrawal_amount), 0::numeric) as total_withdraw_amount,
    coalesce(sum(s.included_spins_count), 0::numeric)::bigint as total_spins,
    coalesce(sum(s.included_house_take_amount), 0::numeric) as total_house_take,
    coalesce(sum(s.included_jackpot_contrib_amount), 0::numeric) as total_jackpot_contrib,
    coalesce(sum(s.included_jackpot_win_amount), 0::numeric) as total_jackpot_win
  from public.device_daily_stats s
), eligible_devices as (
  select count(*) as device_count
  from public.devices d
  where public.should_count_device_activity(d.deployment_mode, d.device_status, d.last_seen_at, now())
), runtime as (
  select
    coalesce(r.prize_pool_balance, 0::numeric) as prize_pool_balance,
    coalesce(r.happy_hour_prize_balance, 0::numeric) as happy_hour_prize_balance,
    coalesce(r.jackpot_pool_balance, 0::numeric) as jackpot_pool_balance
  from public.casino_runtime r
  where r.id = true
  limit 1
), liabilities as (
  select
    coalesce((select sum(hp.amount_remaining) from public.happy_hour_pots hp where hp.status = 'queued'), 0::numeric) as happy_queued_amount,
    coalesce((select sum(jp.amount_remaining) from public.jackpot_pots jp where jp.status = 'queued'), 0::numeric) as jackpot_queued_amount,
    coalesce((select sum(jp.amount_remaining) from public.jackpot_pots jp where jp.status = 'processing'), 0::numeric) as jackpot_processing_amount
), arcade as (
  select
    coalesce((select am_1.arcade_balance from public.arcade_metrics am_1 where am_1.id = 1 limit 1), 0::numeric) as total_arcade_amount
)
select
  t.total_balance,
  t.total_coins_in,
  t.total_hopper,
  t.total_bet_amount,
  t.total_win_amount,
  t.total_withdraw_amount,
  t.total_spins,
  case
    when t.total_bet_amount > 0::numeric then round(((t.total_win_amount / nullif(t.total_bet_amount, 0::numeric)) * 100.0), 4)
    else 0::numeric
  end as global_rtp_percent,
  ed.device_count,
  now() as generated_at,
  t.total_house_take,
  case
    when t.total_bet_amount > 0::numeric then round(((t.total_house_take / nullif(t.total_bet_amount, 0::numeric)) * 100.0), 4)
    else 0::numeric
  end as global_house_edge_percent,
  t.total_jackpot_contrib,
  t.total_jackpot_win,
  ((((((((t.total_coins_in - t.total_withdraw_amount) - t.total_balance) - coalesce(rt.prize_pool_balance, 0::numeric)) - coalesce(rt.happy_hour_prize_balance, 0::numeric)) - coalesce(rt.jackpot_pool_balance, 0::numeric)) - coalesce(lb.happy_queued_amount, 0::numeric)) - coalesce(lb.jackpot_queued_amount, 0::numeric)) - coalesce(lb.jackpot_processing_amount, 0::numeric)) as total_house_net,
  case
    when t.total_coins_in > 0::numeric then round(((((((((t.total_coins_in - t.total_withdraw_amount) - t.total_balance) - coalesce(rt.prize_pool_balance, 0::numeric)) - coalesce(rt.happy_hour_prize_balance, 0::numeric)) - coalesce(rt.jackpot_pool_balance, 0::numeric)) - coalesce(lb.happy_queued_amount, 0::numeric)) - coalesce(lb.jackpot_queued_amount, 0::numeric)) - coalesce(lb.jackpot_processing_amount, 0::numeric)) / nullif(t.total_coins_in, 0::numeric) * 100.0, 4)
    else 0::numeric
  end as global_house_net_percent,
  coalesce(am.total_arcade_amount, 0::numeric) as total_arcade_amount
from totals t
cross join eligible_devices ed
left join runtime rt on true
left join liabilities lb on true
left join arcade am on true;

create or replace function public.redistribute_jackpot_overflow(
  p_campaign_id uuid,
  p_jackpot_pot_id bigint,
  p_amount numeric,
  p_exclude_device text default null,
  p_event_ts timestamptz default now()
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining numeric := greatest(coalesce(p_amount, 0), 0);
  v_runtime public.casino_runtime;
  v_device_id text;
  v_room numeric := 0;
  v_allocate numeric := 0;
  v_tried text[] := '{}';
  v_paid_so_far numeric := 0;
  v_device_cap numeric := null;
begin
  if v_remaining <= 0 then
    return 0;
  end if;

  select * into v_runtime
  from public.casino_runtime
  where id = true
  for update;

  loop
    exit when v_remaining <= 0;

    select d.device_id
      into v_device_id
    from public.devices d
    where d.device_status = 'playing'
      and public.should_count_device_activity(d.deployment_mode, d.device_status, d.last_seen_at, coalesce(p_event_ts, now()))
      and (p_exclude_device is null or d.device_id <> p_exclude_device)
      and not (d.device_id = any(v_tried))
    order by random()
    limit 1;

    if v_device_id is null then
      exit;
    end if;

    v_tried := array_append(v_tried, v_device_id);

    if coalesce(v_runtime.max_win_enabled, true) then
      select coalesce(sum(q.target_amount - q.remaining_amount), 0)
        into v_paid_so_far
      from public.jackpot_payout_queue q
      where q.campaign_id = p_campaign_id
        and q.device_id = v_device_id;

      select public.compute_max_win_cap(d.last_bet_amount)
        into v_device_cap
      from public.devices d
      where d.device_id = v_device_id;

      if v_device_cap is null then
        v_room := 0;
      else
        v_room := greatest(v_device_cap - v_paid_so_far, 0);
      end if;
    else
      v_room := v_remaining;
    end if;

    if coalesce(v_room, 0) <= 0 then
      continue;
    end if;

    v_allocate := least(v_remaining, v_room);

    insert into public.jackpot_payout_queue (
      campaign_id,
      jackpot_pot_id,
      device_id,
      target_amount,
      remaining_amount,
      spins_until_start,
      payouts_left,
      created_at,
      updated_at
    )
    values (
      p_campaign_id,
      p_jackpot_pot_id,
      v_device_id,
      v_allocate,
      v_allocate,
      0,
      1,
      coalesce(p_event_ts, now()),
      now()
    );

    v_remaining := greatest(v_remaining - v_allocate, 0);
  end loop;

  return v_remaining;
end;
$$;

create or replace function public.trigger_jackpot_payout_if_ready(p_event_ts timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_runtime public.casino_runtime;
  v_pot public.jackpot_pots;
  v_pool numeric := 0;
  v_min_winners integer := 1;
  v_max_winners integer := 1;
  v_requested integer := 1;
  v_count integer := 0;
  v_share numeric := 0;
  v_remaining numeric := 0;
  v_overflow numeric := 0;
  v_assigned_total numeric := 0;
  v_actual_winners integer := 0;
  v_campaign_id uuid := gen_random_uuid();
  v_device_ids text[] := '{}';
  v_target_device_ids text[] := '{}';
  v_overflow_candidate_ids text[] := '{}';
  v_awarded_device_ids text[] := '{}';
  v_device_id text;
  v_delay integer := 0;
  v_delay_min integer := 0;
  v_delay_max integer := 0;
  v_winner_index integer := 0;
  v_planned numeric := 0;
  v_device_cap numeric := null;
  v_allocate numeric := 0;
  v_allow_variance_over_cap boolean := false;
  v_variance_over_cap_limit numeric := 200;
  v_absorb_queue_id bigint := null;
begin
  select * into v_runtime
  from public.casino_runtime
  where id = true
  for update;

  if not found then
    return jsonb_build_object('triggered', false, 'reason', 'runtime_missing');
  end if;

  if coalesce(v_runtime.jackpot_pending_payout, false) then
    return jsonb_build_object('triggered', false, 'reason', 'pending_campaign');
  end if;

  v_allow_variance_over_cap :=
    lower(coalesce(v_runtime.jackpot_delivery_mode, 'TARGET_FIRST')) = 'authentic_paytable';

  select * into v_pot
  from public.jackpot_pots
  where status = 'queued'
  order by created_at asc, id asc
  limit 1
  for update skip locked;

  if not found then
    return jsonb_build_object('triggered', false, 'reason', 'no_queued_pot');
  end if;

  v_pool := greatest(coalesce(v_pot.amount_remaining, 0), 0);
  if v_pool <= 0 then
    update public.jackpot_pots
    set
      status = 'completed',
      amount_remaining = 0,
      completed_at = now()
    where id = v_pot.id;

    return jsonb_build_object('triggered', false, 'reason', 'empty_queued_pot');
  end if;

  select coalesce(array_agg(t.device_id), '{}'::text[]), count(*)
    into v_device_ids, v_count
  from (
    select d.device_id
    from public.devices d
    where d.device_status = 'playing'
      and public.should_count_device_activity(d.deployment_mode, d.device_status, d.last_seen_at, coalesce(p_event_ts, now()))
    order by random()
  ) t;

  if coalesce(v_count, 0) <= 0 then
    return jsonb_build_object('triggered', false, 'reason', 'no_eligible_devices');
  end if;

  v_delay_min := greatest(coalesce(v_runtime.jackpot_delay_min_spins, 2), 0);
  v_delay_max := greatest(coalesce(v_runtime.jackpot_delay_max_spins, v_delay_min), v_delay_min);

  v_min_winners := greatest(coalesce(v_runtime.jackpot_min_winners, 1), 1);
  v_max_winners := greatest(coalesce(v_runtime.jackpot_max_winners, v_min_winners), v_min_winners);
  v_requested := floor(random() * (v_max_winners - v_min_winners + 1))::integer + v_min_winners;
  v_requested := least(v_requested, v_count);

  if v_requested <= 0 then
    return jsonb_build_object('triggered', false, 'reason', 'winner_count_zero');
  end if;

  select coalesce(array_agg(t.device_id), '{}'::text[])
    into v_target_device_ids
  from (
    select device_id
    from unnest(v_device_ids) as d(device_id)
    limit v_requested
  ) t;

  if coalesce(array_length(v_target_device_ids, 1), 0) <= 0 then
    return jsonb_build_object('triggered', false, 'reason', 'winner_selection_failed');
  end if;

  v_share := round(v_pool / greatest(v_requested, 1), 4);
  v_remaining := v_pool;

  v_winner_index := 0;
  foreach v_device_id in array v_target_device_ids loop
    v_winner_index := v_winner_index + 1;
    v_planned := case
      when v_winner_index < v_requested then v_share
      else greatest(v_remaining, 0)
    end;

    if coalesce(v_runtime.max_win_enabled, true) then
      select coalesce(public.compute_max_win_cap(d.last_bet_amount), 3000)
        into v_device_cap
      from public.devices d
      where d.device_id = v_device_id;

      v_allocate := least(v_planned, greatest(coalesce(v_device_cap, 0), 0));
    else
      v_allocate := v_planned;
    end if;

    if coalesce(v_allocate, 0) <= 0 then
      continue;
    end if;

    v_delay := floor(random() * (v_delay_max - v_delay_min + 1))::integer + v_delay_min;

    insert into public.jackpot_payout_queue (
      campaign_id,
      jackpot_pot_id,
      device_id,
      target_amount,
      remaining_amount,
      spins_until_start,
      payouts_left,
      created_at,
      updated_at
    )
    values (
      v_campaign_id,
      v_pot.id,
      v_device_id,
      v_allocate,
      v_allocate,
      v_delay,
      10,
      coalesce(p_event_ts, now()),
      now()
    );

    v_remaining := greatest(v_remaining - v_allocate, 0);
    v_assigned_total := v_assigned_total + v_allocate;
    v_awarded_device_ids := array_append(v_awarded_device_ids, v_device_id);
    v_actual_winners := v_actual_winners + 1;
  end loop;

  if v_remaining > 0.0001 then
    select coalesce(array_agg(t.device_id), '{}'::text[])
      into v_overflow_candidate_ids
    from (
      select d.device_id
      from unnest(v_device_ids) as d(device_id)
      where not (d.device_id = any(v_awarded_device_ids))
      order by random()
    ) t;

    foreach v_device_id in array v_overflow_candidate_ids loop
      exit when v_remaining <= 0.0001;

      if coalesce(v_runtime.max_win_enabled, true) then
        select coalesce(public.compute_max_win_cap(d.last_bet_amount), 3000)
          into v_device_cap
        from public.devices d
        where d.device_id = v_device_id;

        v_allocate := least(v_remaining, greatest(coalesce(v_device_cap, 0), 0));
      else
        v_allocate := v_remaining;
      end if;

      if coalesce(v_allocate, 0) <= 0 then
        continue;
      end if;

      v_delay := floor(random() * (v_delay_max - v_delay_min + 1))::integer + v_delay_min;

      insert into public.jackpot_payout_queue (
        campaign_id,
        jackpot_pot_id,
        device_id,
        target_amount,
        remaining_amount,
        spins_until_start,
        payouts_left,
        created_at,
        updated_at
      )
      values (
        v_campaign_id,
        v_pot.id,
        v_device_id,
        v_allocate,
        v_allocate,
        v_delay,
        10,
        coalesce(p_event_ts, now()),
        now()
      );

      v_awarded_device_ids := array_append(v_awarded_device_ids, v_device_id);
      v_actual_winners := v_actual_winners + 1;
      v_assigned_total := v_assigned_total + v_allocate;
      v_remaining := greatest(v_remaining - v_allocate, 0);
    end loop;
  end if;

  if v_remaining > 0.0001
    and v_allow_variance_over_cap
    and v_remaining <= v_variance_over_cap_limit
    and v_actual_winners > 0 then
    select q.id
      into v_absorb_queue_id
    from public.jackpot_payout_queue q
    where q.campaign_id = v_campaign_id
      and q.jackpot_pot_id = v_pot.id
      and q.completed_at is null
    order by q.target_amount desc, q.created_at asc, q.id asc
    limit 1
    for update skip locked;

    if found then
      update public.jackpot_payout_queue
      set
        target_amount = target_amount + v_remaining,
        remaining_amount = remaining_amount + v_remaining,
        updated_at = now()
      where id = v_absorb_queue_id;

      v_assigned_total := v_assigned_total + v_remaining;
      v_remaining := 0;
    end if;
  end if;

  if v_actual_winners <= 0 or v_assigned_total <= 0 then
    return jsonb_build_object('triggered', false, 'reason', 'no_eligible_devices_for_cap');
  end if;

  v_overflow := greatest(v_remaining, 0);
  if v_overflow > 0.0001 then
    update public.jackpot_pots
    set
      amount_total = greatest(amount_total - v_overflow, 0),
      amount_remaining = greatest(amount_remaining - v_overflow, 0)
    where id = v_pot.id;

    insert into public.jackpot_pots (
      amount_total,
      amount_remaining,
      status,
      goal_mode,
      goal_snapshot,
      created_at
    )
    values (
      v_overflow,
      v_overflow,
      'queued',
      'amount',
      jsonb_build_object(
        'reason', 'trigger_cap_overflow',
        'sourcePotId', v_pot.id,
        'sourceCampaign', v_campaign_id,
        'createdAt', coalesce(p_event_ts, now())
      ),
      coalesce(p_event_ts, now())
    );
  end if;

  update public.jackpot_pots
  set
    status = 'processing',
    campaign_id = v_campaign_id,
    activated_at = coalesce(activated_at, coalesce(p_event_ts, now()))
  where id = v_pot.id;

  update public.casino_runtime
  set
    jackpot_pending_payout = true,
    active_jackpot_pot_id = v_pot.id,
    last_jackpot_triggered_at = coalesce(p_event_ts, now()),
    updated_at = now()
  where id = true;

  return jsonb_build_object(
    'triggered', true,
    'campaign_id', v_campaign_id,
    'pot_id', v_pot.id,
    'winners', v_actual_winners,
    'winner_device_ids', v_awarded_device_ids,
    'amount', v_assigned_total,
    'overflow_requeued', v_overflow
  );
end;
$$;
