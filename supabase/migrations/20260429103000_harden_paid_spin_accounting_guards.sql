create or replace function public.start_device_game_session(
  p_device_id text,
  p_game_id text,
  p_game_name text default null,
  p_runtime_mode text default null,
  p_state jsonb default '{}'::jsonb
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id bigint;
  v_game_type text := nullif(trim(coalesce(p_state->>'gameType', '')), '');
  v_current_spin_id bigint := 0;
begin
  if p_device_id is null or trim(p_device_id) = '' then
    raise exception 'p_device_id is required';
  end if;

  if p_game_id is null or trim(p_game_id) = '' then
    raise exception 'p_game_id is required';
  end if;

  if p_state ? 'spinId' then
    begin
      v_current_spin_id := greatest(0, coalesce((p_state->>'spinId')::bigint, 0));
    exception when others then
      v_current_spin_id := 0;
    end;
  end if;

  insert into public.devices (device_id)
  values (p_device_id)
  on conflict (device_id) do nothing;

  update public.device_game_sessions
  set
    status = 'ended',
    ended_at = now(),
    updated_at = now()
  where device_id = p_device_id and status = 'active';

  insert into public.device_game_sessions (
    device_id,
    game_id,
    game_name,
    status,
    started_at,
    last_heartbeat,
    last_state,
    updated_at
  )
  values (
    p_device_id,
    p_game_id,
    p_game_name,
    'active',
    now(),
    now(),
    coalesce(p_state, '{}'::jsonb),
    now()
  )
  returning id into v_session_id;

  update public.devices
  set
    current_game_id = p_game_id,
    current_game_name = p_game_name,
    current_game_type = case
      when v_game_type in ('arcade', 'casino') then v_game_type
      else current_game_type
    end,
    device_status = 'playing',
    active_session_id = v_session_id,
    session_started_at = now(),
    session_last_heartbeat = now(),
    session_ended_at = null,
    runtime_mode = coalesce(p_runtime_mode, runtime_mode),
    current_spin_id = v_current_spin_id,
    session_metadata = coalesce(p_state, '{}'::jsonb),
    last_seen_at = now(),
    last_activity_at = now(),
    updated_at = now()
  where device_id = p_device_id;

  return v_session_id;
end;
$$;


create or replace function public.update_device_game_state(
  p_device_id text,
  p_session_id bigint default null,
  p_state jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_runtime_mode text;
  v_is_free_game boolean;
  v_free_spins_left integer;
  v_pending_free_spins integer;
  v_show_intro boolean;
  v_current_spin_id bigint;
  v_game_type text := nullif(trim(coalesce(p_state->>'gameType', '')), '');
  v_mark_active boolean := coalesce((p_state->>'markActive')::boolean, true);
begin
  if p_device_id is null or trim(p_device_id) = '' then
    raise exception 'p_device_id is required';
  end if;

  v_runtime_mode := nullif(trim(coalesce(p_state->>'runtimeMode', '')), '');
  v_is_free_game := case when p_state ? 'isFreeGame' then coalesce((p_state->>'isFreeGame')::boolean, false) else null end;
  v_free_spins_left := case when p_state ? 'freeSpinsLeft' then greatest(0, coalesce((p_state->>'freeSpinsLeft')::integer, 0)) else null end;
  v_pending_free_spins := case when p_state ? 'pendingFreeSpins' then greatest(0, coalesce((p_state->>'pendingFreeSpins')::integer, 0)) else null end;
  v_show_intro := case when p_state ? 'showFreeSpinIntro' then coalesce((p_state->>'showFreeSpinIntro')::boolean, false) else null end;
  v_current_spin_id := case when p_state ? 'spinId' then greatest(0, coalesce((p_state->>'spinId')::bigint, 0)) else null end;

  update public.devices
  set
    device_status = 'playing',
    active_session_id = coalesce(p_session_id, active_session_id),
    session_last_heartbeat = now(),
    runtime_mode = coalesce(v_runtime_mode, runtime_mode),
    current_game_type = case
      when v_game_type in ('arcade', 'casino') then v_game_type
      else current_game_type
    end,
    is_free_game = coalesce(v_is_free_game, is_free_game),
    free_spins_left = coalesce(v_free_spins_left, free_spins_left),
    pending_free_spins = coalesce(v_pending_free_spins, pending_free_spins),
    show_free_spin_intro = coalesce(v_show_intro, show_free_spin_intro),
    current_spin_id = case
      when v_current_spin_id is null then current_spin_id
      else greatest(coalesce(current_spin_id, 0), v_current_spin_id)
    end,
    session_metadata = coalesce(p_state, '{}'::jsonb),
    last_seen_at = now(),
    last_activity_at = case when v_mark_active then now() else last_activity_at end,
    updated_at = now()
  where device_id = p_device_id;

  if p_session_id is not null then
    update public.device_game_sessions
    set
      last_heartbeat = now(),
      last_state = coalesce(p_state, '{}'::jsonb),
      updated_at = now()
    where id = p_session_id;
  end if;
end;
$$;


create or replace function public.apply_metric_event(
  p_device_id text,
  p_event_type text,
  p_amount numeric,
  p_event_ts timestamp with time zone default now(),
  p_metadata jsonb default '{}'::jsonb,
  p_write_ledger boolean default true
) returns void
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
  v_after_house numeric := 0;
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_max_win_cap numeric := null;
  v_normal_win_cap numeric := null;
  v_total_win_cap numeric := null;
  v_over_cap_amount numeric := 0;
  v_spin_key text := nullif(trim(coalesce(p_metadata->>'spinKey', '')), '');
  v_guard_funding_source text := 'runtime_pool';
  v_guarded_from_spin boolean := false;
  v_dedup_inserted_count integer := 0;
  v_deployment_mode text := 'online';
  v_effective_device_status text := 'offline';
  v_counts_toward_global boolean := false;
  v_spin_is_free_game boolean := false;
  v_device_happy_override public.device_happy_hour_overrides%rowtype;
  v_device_happy_override_active boolean := false;
  v_device_happy_override_cap numeric := 0;
  v_base_win_amount numeric := 0;
  v_override_win_amount numeric := 0;
  v_spin_id bigint := null;
  v_device_balance numeric := 0;
  v_device_current_spin_id bigint := 0;
begin
  if p_device_id is null or trim(p_device_id) = '' then
    raise exception 'p_device_id is required';
  end if;

  if v_amt = 0 and v_event not in ('spin') then
    return;
  end if;

  insert into public.devices (device_id)
  values (p_device_id)
  on conflict (device_id) do nothing;

  select
    coalesce(nullif(trim(d.deployment_mode), ''), 'online'),
    public.resolve_device_presence_status(d.device_status, d.last_seen_at, v_event_ts),
    public.should_count_device_activity(d.deployment_mode, d.device_status, d.last_seen_at, v_event_ts),
    greatest(coalesce(d.balance, 0), 0),
    greatest(coalesce(d.current_spin_id, 0), 0)
  into v_deployment_mode, v_effective_device_status, v_counts_toward_global, v_device_balance, v_device_current_spin_id
  from public.devices d
  where d.device_id = p_device_id
  for update;

  if v_metadata ? 'isFreeGame' then
    begin
      v_spin_is_free_game := coalesce((v_metadata->>'isFreeGame')::boolean, false);
    exception when others then
      v_spin_is_free_game := false;
    end;
  end if;

  if v_metadata ? 'spinId' then
    begin
      v_spin_id := greatest(0, coalesce((v_metadata->>'spinId')::bigint, 0));
    exception when others then
      v_spin_id := null;
    end;
  end if;

  if v_event = 'bet' and v_amt > v_device_balance + 0.0001 then
    return;
  end if;

  if v_event = 'spin' and not coalesce(v_spin_is_free_game, false) then
    if v_amt <= 0 then
      return;
    end if;

    if v_amt > v_device_balance + 0.0001 then
      return;
    end if;

    if v_spin_id is not null and v_spin_id > 0 and v_spin_id <= v_device_current_spin_id then
      return;
    end if;
  end if;

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
    if coalesce(v_metadata->>'source', '') <> 'coin_acceptor' then
      return;
    end if;

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

    if p_write_ledger then
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

  select *
  into v_device_happy_override
  from public.device_happy_hour_overrides o
  where o.device_id = p_device_id
    and o.status = 'active'
    and o.amount_remaining > 0
  order by o.created_at desc, o.id desc
  limit 1
  for update;

  v_device_happy_override_active :=
    found
    and greatest(coalesce(v_device_happy_override.amount_remaining, 0), 0) > 0
    and v_runtime.active_mode <> 'HAPPY';

  v_device_happy_override_cap := case
    when v_device_happy_override_active then greatest(coalesce(v_device_happy_override.amount_remaining, 0), 0)
    else 0
  end;

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
  elsif v_event = 'spin' then
    v_spins := 1;
    v_last_bet_at := v_event_ts;

    if not coalesce(v_spin_is_free_game, false) then
      v_bet := v_amt;
      v_balance_delta := -v_amt;
      v_last_bet_amount := v_bet;

      v_profile_id := case
        when v_runtime.active_mode = 'HAPPY' or v_device_happy_override_active then v_runtime.happy_profile_id
        else v_runtime.base_profile_id
      end;

      select
        coalesce(house_pct, 0),
        coalesce(pool_pct, 0)
      into v_profile_house_pct, v_profile_jackpot_pct
      from public.rtp_profiles
      where id = v_profile_id;

      v_house_pct := greatest(v_profile_house_pct, 0);
      v_jackpot_pct := greatest(v_profile_jackpot_pct, 0);
      v_jackpot_pct := least(v_jackpot_pct, greatest(100 - v_house_pct, 0));
      v_happy_pct := greatest(100 - v_house_pct - v_jackpot_pct, 0);

      v_house_target := v_bet * v_house_pct / 100.0;
      v_jackpot_target := v_bet * v_jackpot_pct / 100.0;

      v_house_take := greatest(v_house_target, 0);
      v_after_house := v_bet - v_house_take;
      v_jackpot_contrib := greatest(least(v_jackpot_target, v_after_house), 0);
      v_pool_contrib := greatest(v_after_house - v_jackpot_contrib, 0);

      if v_runtime.active_mode = 'HAPPY' then
        v_guard_funding_source := 'happy_prize_pool';
      elsif v_device_happy_override_active then
        v_guard_funding_source := 'device_happy_override';
      else
        v_guard_funding_source := 'base_prize_pool';
      end if;

      if v_metadata ? 'totalWin' then
        begin
          v_spin_win_hint := greatest(coalesce((v_metadata->>'totalWin')::numeric, 0), 0);
        exception when others then
          v_spin_win_hint := 0;
        end;
      end if;

      if v_runtime.active_mode = 'HAPPY' then
        v_normal_win_cap := greatest(coalesce(v_runtime.happy_hour_prize_balance, 0), 0);
      elsif v_device_happy_override_active then
        v_normal_win_cap := 0;
      else
        v_normal_win_cap := greatest(coalesce(v_runtime.prize_pool_balance, 0), 0) + v_pool_contrib;
      end if;

      v_total_win_cap := greatest(coalesce(v_normal_win_cap, 0), 0) + greatest(coalesce(v_device_happy_override_cap, 0), 0);

      if v_max_win_cap is not null then
        v_total_win_cap := least(v_total_win_cap, v_max_win_cap);
      end if;

      v_normal_win_cap := greatest(coalesce(v_normal_win_cap, 0), 0);
      v_total_win_cap := greatest(coalesce(v_total_win_cap, 0), 0);
      v_effective_spin_win_hint := least(v_spin_win_hint, v_total_win_cap);

      v_metadata := v_metadata || jsonb_build_object(
        'requestedTotalWin', v_spin_win_hint,
        'effectiveTotalWinHint', v_effective_spin_win_hint,
        'normalWinFundingCap', v_normal_win_cap,
        'happyOverrideFundingCap', v_device_happy_override_cap,
        'totalWinFundingCap', v_total_win_cap,
        'deviceHappyOverrideActive', v_device_happy_override_active,
        'deviceHappyOverrideId', case when v_device_happy_override_active then v_device_happy_override.id else null end,
        'winFundingSource', v_guard_funding_source,
        'overCapWinHint', v_spin_win_hint > v_effective_spin_win_hint + 0.0001
      );
    end if;

    if v_counts_toward_global then
      update public.casino_runtime
      set
        prize_pool_balance = greatest(0, prize_pool_balance + v_pool_contrib),
        jackpot_pool_balance = greatest(0, jackpot_pool_balance + v_jackpot_contrib),
        happy_pool_spin_counter = happy_pool_spin_counter + v_spins,
        jackpot_pool_spin_counter = jackpot_pool_spin_counter + v_spins,
        updated_at = now()
      where id = true
      returning * into v_runtime;

      perform public.process_pool_goal_queues(v_event_ts);
      perform public.trigger_jackpot_payout_if_ready(v_event_ts);

      v_jackpot_paid := public.process_device_jackpot_payout(
        p_device_id,
        v_event_ts,
        v_spin_is_free_game
      );

      if v_jackpot_paid > 0 then
        v_win := v_win + v_jackpot_paid;
        v_balance_delta := v_balance_delta + v_jackpot_paid;
        v_metadata := v_metadata || jsonb_build_object(
          'jackpotPayout', v_jackpot_paid,
          'jackpotCampaignPayout', true
        );
      end if;
    else
      v_jackpot_paid := public.process_device_jackpot_payout(
        p_device_id,
        v_event_ts,
        v_spin_is_free_game
      );

      if v_jackpot_paid > 0 then
        v_win := v_win + v_jackpot_paid;
        v_balance_delta := v_balance_delta + v_jackpot_paid;
        v_metadata := v_metadata || jsonb_build_object(
          'jackpotPayout', v_jackpot_paid,
          'jackpotCampaignPayout', true,
          'excludedFromGlobal', true
        );
      end if;
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
      if v_spin_key is not null then
        begin
          select
            greatest(coalesce((e.metadata->>'totalWinFundingCap')::numeric, 0), 0),
            coalesce(e.metadata->>'winFundingSource', 'runtime_pool')
          into v_total_win_cap, v_guard_funding_source
          from public.device_metric_events e
          where e.device_id = p_device_id
            and e.event_type = 'spin'
            and coalesce(e.metadata->>'spinKey', '') = v_spin_key
          order by e.event_ts desc, e.id desc
          limit 1;

          v_guarded_from_spin := v_total_win_cap is not null;
        exception when others then
          v_total_win_cap := null;
          v_guarded_from_spin := false;
        end;
      end if;

      if v_total_win_cap is null then
        if v_runtime.active_mode = 'HAPPY' then
          v_normal_win_cap := greatest(coalesce(v_runtime.happy_hour_prize_balance, 0), 0);
          v_guard_funding_source := 'happy_prize_pool';
        elsif v_device_happy_override_active then
          v_normal_win_cap := 0;
          v_guard_funding_source := 'device_happy_override';
        else
          v_normal_win_cap := greatest(coalesce(v_runtime.prize_pool_balance, 0), 0);
          v_guard_funding_source := 'base_prize_pool';
        end if;

        v_total_win_cap := greatest(coalesce(v_normal_win_cap, 0), 0) + greatest(coalesce(v_device_happy_override_cap, 0), 0);
      end if;

      if v_max_win_cap is not null then
        v_total_win_cap := least(greatest(coalesce(v_total_win_cap, 0), 0), v_max_win_cap);
      end if;

      v_normal_win_cap := greatest(coalesce(v_normal_win_cap, 0), 0);
      v_total_win_cap := greatest(coalesce(v_total_win_cap, 0), 0);
      v_win := least(v_requested_win, v_total_win_cap);
      v_over_cap_amount := greatest(v_requested_win - v_win, 0);

      if v_over_cap_amount > 0.0001 then
        v_metadata := v_metadata || jsonb_build_object(
          'requestedWin', v_requested_win,
          'acceptedWin', v_win,
          'overCapWinAdjusted', true
        );
      else
        v_metadata := v_metadata || jsonb_build_object(
          'requestedWin', v_requested_win,
          'acceptedWin', v_win,
          'overCapWinAdjusted', false
        );
      end if;

      v_balance_delta := v_win;

      if v_win > 0 then
        if v_device_happy_override_active then
          v_base_win_amount := least(v_win, v_normal_win_cap);
          v_override_win_amount := greatest(v_win - v_base_win_amount, 0);
        else
          v_base_win_amount := v_win;
          v_override_win_amount := 0;
        end if;

        v_pool_paid := v_base_win_amount;

        if v_base_win_amount > 0 then
          if v_runtime.active_mode = 'HAPPY' then
            update public.casino_runtime
            set
              happy_hour_prize_balance = greatest(0, happy_hour_prize_balance - v_base_win_amount),
              updated_at = now()
            where id = true
            returning * into v_runtime;

            if v_runtime.active_happy_pot_id is not null then
              update public.happy_hour_pots
              set amount_remaining = greatest(amount_remaining - v_base_win_amount, 0)
              where id = v_runtime.active_happy_pot_id;
            end if;
          else
            update public.casino_runtime
            set
              prize_pool_balance = greatest(0, prize_pool_balance - v_base_win_amount),
              updated_at = now()
            where id = true
            returning * into v_runtime;
          end if;
        end if;

        if v_override_win_amount > 0 and v_device_happy_override_active then
          update public.device_happy_hour_overrides
          set
            amount_remaining = greatest(0, amount_remaining - v_override_win_amount),
            status = case
              when greatest(0, amount_remaining - v_override_win_amount) <= 0 then 'completed'
              else status
            end,
            completed_at = case
              when greatest(0, amount_remaining - v_override_win_amount) <= 0 then coalesce(completed_at, v_event_ts)
              else completed_at
            end,
            updated_at = now()
          where id = v_device_happy_override.id
          returning * into v_device_happy_override;

          insert into public.device_happy_hour_override_wins (
            override_id,
            device_id,
            spin_key,
            event_ts,
            runtime_mode,
            requested_amount,
            accepted_amount,
            normal_win_cap_amount,
            override_paid_amount,
            override_remaining_after,
            metadata
          )
          values (
            v_device_happy_override.id,
            p_device_id,
            v_spin_key,
            v_event_ts,
            v_runtime.active_mode,
            v_requested_win,
            v_win,
            v_normal_win_cap,
            v_override_win_amount,
            greatest(coalesce(v_device_happy_override.amount_remaining, 0), 0),
            v_metadata || jsonb_build_object(
              'deviceHappyOverrideId', v_device_happy_override.id,
              'baseWinAmount', v_base_win_amount,
              'overrideWinAmount', v_override_win_amount
            )
          );
        end if;

        v_metadata := v_metadata || jsonb_build_object(
          'baseWinAmount', v_base_win_amount,
          'overrideWinAmount', v_override_win_amount,
          'deviceHappyOverrideApplied', v_override_win_amount > 0.0001,
          'deviceHappyOverrideId', case when v_override_win_amount > 0.0001 then v_device_happy_override.id else null end,
          'deviceHappyOverrideRemainingAfter', case
            when v_override_win_amount > 0.0001 then greatest(coalesce(v_device_happy_override.amount_remaining, 0), 0)
            else null
          end
        );
      end if;
    end if;
  else
    raise exception 'unsupported metric event type: %', p_event_type;
  end if;

  if v_event in ('spin', 'win') and v_counts_toward_global then
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
    current_spin_id = case
      when v_event = 'spin' and v_spin_id is not null and v_spin_id > 0
        then greatest(coalesce(current_spin_id, 0), v_spin_id)
      else current_spin_id
    end,
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

  if p_write_ledger then
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
      case
        when v_event = 'win' then v_win
        when v_event = 'spin' then v_amt
        when v_event = 'coins_in' then v_coins_in
        when v_event = 'hopper_in' then v_hopper_in
        when v_event = 'withdrawal' then v_withdraw
        when v_event = 'bet' then v_bet
        else v_amt
      end,
      v_metadata,
      v_deployment_mode,
      v_effective_device_status,
      v_counts_toward_global
    );

    if v_event = 'spin' and v_jackpot_paid > 0 then
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
        'win',
        v_jackpot_paid,
        v_metadata || jsonb_build_object(
          'acceptedWin', v_jackpot_paid,
          'requestedWin', v_jackpot_paid,
          'jackpotCampaignPayout', true,
          'ledgerSource', 'jackpot_spin_mirror'
        ),
        v_deployment_mode,
        v_effective_device_status,
        v_counts_toward_global
      );
    end if;
  end if;
end;
$$;
