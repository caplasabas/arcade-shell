-- Promote staging fixes that are present in schema_staging.sql but missing from schema.sql.
-- This migration intentionally targets the concrete prod-safe function fixes instead of
-- replaying the entire schema snapshot diff.

CREATE OR REPLACE FUNCTION "public"."apply_metric_event"("p_device_id" "text", "p_event_type" "text", "p_amount" numeric, "p_event_ts" timestamp with time zone DEFAULT "now"(), "p_metadata" "jsonb" DEFAULT '{}'::"jsonb", "p_write_ledger" boolean DEFAULT true) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
  v_over_cap_amount numeric := 0;
  v_spin_key text := nullif(trim(coalesce(p_metadata->>'spinKey', '')), '');
  v_guard_funding_source text := 'runtime_pool';
  v_guarded_from_spin boolean := false;
  v_dedup_inserted_count integer := 0;
  v_deployment_mode text := 'online';
  v_effective_device_status text := 'offline';
  v_counts_toward_global boolean := false;
  v_spin_is_free_game boolean := false;
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
    public.should_count_device_activity(d.deployment_mode, d.device_status, d.last_seen_at, v_event_ts)
  into v_deployment_mode, v_effective_device_status, v_counts_toward_global
  from public.devices d
  where d.device_id = p_device_id;

  if v_metadata ? 'isFreeGame' then
    begin
      v_spin_is_free_game := coalesce((v_metadata->>'isFreeGame')::boolean, false);
    exception when others then
      v_spin_is_free_game := false;
    end;
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
        when v_runtime.active_mode = 'HAPPY' then v_runtime.happy_profile_id
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
      else
        v_normal_win_cap := greatest(coalesce(v_runtime.prize_pool_balance, 0), 0) + v_pool_contrib;
      end if;

      if v_max_win_cap is not null then
        v_normal_win_cap := least(v_normal_win_cap, v_max_win_cap);
      end if;

      v_normal_win_cap := greatest(coalesce(v_normal_win_cap, 0), 0);
      v_effective_spin_win_hint := least(v_spin_win_hint, v_normal_win_cap);

      v_metadata := v_metadata || jsonb_build_object(
        'requestedTotalWin', v_spin_win_hint,
        'effectiveTotalWinHint', v_effective_spin_win_hint,
        'normalWinFundingCap', v_normal_win_cap,
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
            greatest(coalesce((e.metadata->>'normalWinFundingCap')::numeric, 0), 0),
            coalesce(e.metadata->>'winFundingSource', 'runtime_pool')
          into v_normal_win_cap, v_guard_funding_source
          from public.device_metric_events e
          where e.device_id = p_device_id
            and e.event_type = 'spin'
            and coalesce(e.metadata->>'spinKey', '') = v_spin_key
          order by e.event_ts desc, e.id desc
          limit 1;

          v_guarded_from_spin := v_normal_win_cap is not null;
        exception when others then
          v_normal_win_cap := null;
          v_guarded_from_spin := false;
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
      else
        v_pool_paid := v_win;

        update public.casino_runtime
        set
          prize_pool_balance = greatest(0, prize_pool_balance - v_pool_paid),
          updated_at = now()
        where id = true
        returning * into v_runtime;
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


ALTER FUNCTION "public"."apply_metric_event"("p_device_id" "text", "p_event_type" "text", "p_amount" numeric, "p_event_ts" timestamp with time zone, "p_metadata" "jsonb", "p_write_ledger" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."process_device_jackpot_payout"("p_device_id" "text", "p_event_ts" timestamp with time zone DEFAULT "now"()) RETURNS numeric
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_row public.jackpot_payout_queue;
  v_plan_step public.jackpot_payout_plan_steps;
  v_runtime public.casino_runtime;
  v_variance numeric := 0;
  v_base_chunk numeric := 0;
  v_jitter numeric := 0;
  v_payout numeric := 0;
  v_next_spins_until_start integer := 0;
  v_cap_total numeric := null;
  v_cap_remaining numeric := null;
  v_paid_so_far numeric := 0;
  v_overflow numeric := 0;
  v_is_dev_test boolean := false;
  v_curve text := 'center';
  v_total_steps integer := 10;
  v_steps_left integer := 1;
  v_current_step integer := 1;
  v_weight_current numeric := 1;
  v_weight_remaining_sum numeric := 1;
  v_authentic_delivery boolean := false;
  v_used_plan_step boolean := false;
  v_device_is_free_game boolean := false;
begin
  if p_device_id is null or trim(p_device_id) = '' then
    return 0;
  end if;

  perform public.finalize_device_jackpot_payouts(p_device_id, coalesce(p_event_ts, now()));

  select *
    into v_row
  from public.jackpot_payout_queue
  where device_id = p_device_id
    and completed_at is null
  order by created_at asc, id asc
  limit 1
  for update skip locked;

  if not found then
    return 0;
  end if;

  if coalesce(v_row.spins_until_start, 0) > 0 then
    v_next_spins_until_start := greatest(coalesce(v_row.spins_until_start, 0) - 1, 0);

    update public.jackpot_payout_queue
    set
      spins_until_start = v_next_spins_until_start,
      updated_at = now()
    where id = v_row.id;

    if v_next_spins_until_start > 0 then
      return 0;
    end if;
  end if;

  select coalesce(d.is_free_game, false)
    into v_device_is_free_game
  from public.devices d
  where d.device_id = p_device_id;

  if not coalesce(v_device_is_free_game, false) then
    return 0;
  end if;

  select *
    into v_runtime
  from public.casino_runtime
  where id = true
  for update;

  v_variance := greatest(coalesce(v_runtime.jackpot_win_variance, 0), 0);
  v_curve := lower(coalesce(v_runtime.jackpot_payout_curve, 'center'));
  v_authentic_delivery :=
    lower(coalesce(v_runtime.jackpot_delivery_mode, 'TARGET_FIRST')) = 'authentic_paytable';

  if v_curve not in ('flat', 'front', 'center', 'back') then
    v_curve := 'center';
  end if;

  if v_row.jackpot_pot_id is not null then
    select coalesce(jp.goal_snapshot ->> 'source', '') = 'dev_test'
      into v_is_dev_test
    from public.jackpot_pots jp
    where jp.id = v_row.jackpot_pot_id;
  end if;

  if coalesce(v_runtime.max_win_enabled, true) and not coalesce(v_is_dev_test, false) then
    select public.compute_max_win_cap(d.last_bet_amount)
      into v_cap_total
    from public.devices d
    where d.device_id = p_device_id;

    select coalesce(sum(q.target_amount - q.remaining_amount), 0)
      into v_paid_so_far
    from public.jackpot_payout_queue q
    where q.campaign_id = v_row.campaign_id
      and q.device_id = p_device_id;

    if v_cap_total is null then
      v_cap_remaining := null;
    else
      v_cap_remaining := greatest(v_cap_total - coalesce(v_paid_so_far, 0), 0);
    end if;
  end if;

  v_total_steps := greatest(coalesce(v_row.payouts_left, 1), 1);
  v_steps_left := greatest(coalesce(v_row.payouts_left, 1), 1);
  v_current_step := 1;

  if coalesce(v_row.payouts_left, 1) <= 1 or coalesce(v_row.remaining_amount, 0) <= 0 then
    v_payout := greatest(coalesce(v_row.remaining_amount, 0), 0);
  end if;

  if v_payout <= 0 then
    v_base_chunk := round(
      greatest(coalesce(v_row.remaining_amount, 0), 0) / greatest(coalesce(v_row.payouts_left, 1), 1),
      4
    );

    if v_authentic_delivery then
      select *
        into v_plan_step
      from public.jackpot_payout_plan_steps
      where queue_id = v_row.id
        and consumed_at is null
      order by step_index asc
      limit 1
      for update skip locked;

      if found then
        v_payout := round(greatest(coalesce(v_plan_step.expected_amount, 0), 0), 4);
        v_used_plan_step := true;
      end if;
    end if;

    if not v_used_plan_step then
      if v_curve = 'flat' then
        v_payout := v_base_chunk;
      elsif v_curve = 'front' then
        v_payout := v_base_chunk * v_weight_current;
      elsif v_curve = 'back' then
        v_payout := v_base_chunk * v_weight_remaining_sum;
      else
        if v_current_step <= v_total_steps / 2 then
          v_payout := v_base_chunk * (1 + (v_current_step::numeric / v_total_steps));
        else
          v_payout := v_base_chunk * (2 - (v_current_step::numeric / v_total_steps));
        end if;
      end if;
    end if;

    if v_curve <> 'flat' then
      v_weight_current := v_weight_current - (v_weight_current / greatest(v_steps_left, 1));
      v_weight_remaining_sum := v_weight_remaining_sum - v_weight_current;
    end if;
  end if;

  if v_cap_remaining is not null then
    v_overflow := greatest(v_payout - v_cap_remaining, 0);
    v_payout := least(v_payout, greatest(v_cap_remaining, 0));
  end if;

  if v_payout <= 0 then
    return 0;
  end if;

  if v_variance > 0 and v_authentic_delivery then
    v_jitter := round((random() - 0.5) * 2 * v_variance * v_payout / 100.0, 4);
    v_payout := greatest(v_payout + v_jitter, 0);
  end if;

  v_payout := round(v_payout, 4);
  v_payout := least(v_payout, greatest(coalesce(v_row.remaining_amount, 0), 0));

  if v_payout <= 0 then
    return 0;
  end if;

  update public.devices
  set
    balance = balance + v_payout,
    jackpot_win_total = jackpot_win_total + v_payout,
    updated_at = now()
  where device_id = p_device_id;

  update public.jackpot_payout_queue
  set
    remaining_amount = greatest(coalesce(remaining_amount, 0) - v_payout, 0),
    payouts_left = greatest(coalesce(payouts_left, 1) - 1, 0),
    updated_at = now(),
    completed_at = case
      when greatest(coalesce(remaining_amount, 0) - v_payout, 0) <= 0
        or greatest(coalesce(payouts_left, 1) - 1, 0) <= 0
      then now()
      else completed_at
    end
  where id = v_row.id;

  if v_authentic_delivery and v_used_plan_step then
    update public.jackpot_payout_plan_steps
    set consumed_at = now()
    where id = v_plan_step.id;
  end if;

  update public.jackpot_pots
  set amount_remaining = greatest(amount_remaining - v_payout, 0)
  where id = v_row.jackpot_pot_id;

  if v_overflow > 0.0001 then
    update public.jackpot_pots
    set amount_remaining = amount_remaining + v_overflow
    where id = v_row.jackpot_pot_id;

    update public.jackpot_payout_queue
    set remaining_amount = remaining_amount + v_overflow
    where id = v_row.id;
  end if;

  return v_payout;
end;
$$;


ALTER FUNCTION "public"."process_device_jackpot_payout"("p_device_id" "text", "p_event_ts" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."process_device_jackpot_payout"("p_device_id" "text", "p_event_ts" timestamp with time zone DEFAULT "now"(), "p_is_free_game" boolean DEFAULT NULL::boolean) RETURNS numeric
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_row public.jackpot_payout_queue;
  v_plan_step public.jackpot_payout_plan_steps;
  v_runtime public.casino_runtime;
  v_variance numeric := 0;
  v_base_chunk numeric := 0;
  v_jitter numeric := 0;
  v_payout numeric := 0;
  v_next_spins_until_start integer := 0;
  v_cap_total numeric := null;
  v_cap_remaining numeric := null;
  v_paid_so_far numeric := 0;
  v_overflow numeric := 0;
  v_is_dev_test boolean := false;
  v_curve text := 'center';
  v_total_steps integer := 10;
  v_steps_left integer := 1;
  v_current_step integer := 1;
  v_weight_current numeric := 1;
  v_weight_remaining_sum numeric := 1;
  v_authentic_delivery boolean := false;
  v_used_plan_step boolean := false;
  v_device_is_free_game boolean := false;
begin
  if p_device_id is null or trim(p_device_id) = '' then
    return 0;
  end if;

  perform public.finalize_device_jackpot_payouts(p_device_id, coalesce(p_event_ts, now()));

  select *
    into v_row
  from public.jackpot_payout_queue
  where device_id = p_device_id
    and completed_at is null
  order by created_at asc, id asc
  limit 1
  for update skip locked;

  if not found then
    return 0;
  end if;

  if coalesce(v_row.spins_until_start, 0) > 0 then
    v_next_spins_until_start := greatest(coalesce(v_row.spins_until_start, 0) - 1, 0);

    update public.jackpot_payout_queue
    set
      spins_until_start = v_next_spins_until_start,
      updated_at = now()
    where id = v_row.id;

    if v_next_spins_until_start > 0 then
      return 0;
    end if;
  end if;

  if p_is_free_game is not null then
    v_device_is_free_game := coalesce(p_is_free_game, false);
  else
    select coalesce(d.is_free_game, false)
      into v_device_is_free_game
    from public.devices d
    where d.device_id = p_device_id;
  end if;

  if not coalesce(v_device_is_free_game, false) then
    return 0;
  end if;

  select *
    into v_runtime
  from public.casino_runtime
  where id = true
  for update;

  v_variance := greatest(coalesce(v_runtime.jackpot_win_variance, 0), 0);
  v_curve := lower(coalesce(v_runtime.jackpot_payout_curve, 'center'));
  v_authentic_delivery :=
    lower(coalesce(v_runtime.jackpot_delivery_mode, 'TARGET_FIRST')) = 'authentic_paytable';

  if v_curve not in ('flat', 'front', 'center', 'back') then
    v_curve := 'center';
  end if;

  if v_row.jackpot_pot_id is not null then
    select coalesce(jp.goal_snapshot ->> 'source', '') = 'dev_test'
      into v_is_dev_test
    from public.jackpot_pots jp
    where jp.id = v_row.jackpot_pot_id;
  end if;

  if coalesce(v_runtime.max_win_enabled, true)
     and not coalesce(v_is_dev_test, false)
     and not coalesce(v_device_is_free_game, false) then
    select public.compute_max_win_cap(d.last_bet_amount)
      into v_cap_total
    from public.devices d
    where d.device_id = p_device_id;

    select coalesce(sum(q.target_amount - q.remaining_amount), 0)
      into v_paid_so_far
    from public.jackpot_payout_queue q
    where q.campaign_id = v_row.campaign_id
      and q.device_id = p_device_id;

    if v_cap_total is null then
      v_cap_remaining := null;
    else
      v_cap_remaining := greatest(v_cap_total - coalesce(v_paid_so_far, 0), 0);
    end if;
  end if;

  if coalesce(v_row.payouts_left, 1) <= 1 or coalesce(v_row.remaining_amount, 0) <= 0 then
    v_payout := greatest(coalesce(v_row.remaining_amount, 0), 0);
  end if;

  if v_payout <= 0 then
    v_base_chunk := round(greatest(v_row.remaining_amount, 0) / greatest(v_row.payouts_left, 1), 4);

    if v_authentic_delivery then
      select *
        into v_plan_step
      from public.jackpot_payout_plan_steps
      where queue_id = v_row.id
        and consumed_at is null
      order by step_index asc
      limit 1
      for update skip locked;

      if found then
        v_payout := round(greatest(coalesce(v_plan_step.expected_amount, 0), 0), 4);
        v_used_plan_step := true;
      end if;
    end if;

    if not v_used_plan_step then
      if v_curve = 'flat' then
        v_payout := v_base_chunk;
      elsif v_curve = 'front' then
        v_payout := v_base_chunk * v_weight_current;
      elsif v_curve = 'back' then
        v_payout := v_base_chunk * v_weight_remaining_sum;
      else
        if v_current_step <= v_total_steps / 2 then
          v_payout := v_base_chunk * (1 + (v_current_step::numeric / v_total_steps));
        else
          v_payout := v_base_chunk * (2 - (v_current_step::numeric / v_total_steps));
        end if;
      end if;
    end if;

    if v_curve <> 'flat' then
      v_weight_current := v_weight_current - (v_weight_current / greatest(v_steps_left, 1));
      v_weight_remaining_sum := v_weight_remaining_sum - v_weight_current;
    end if;
  end if;

  if v_cap_remaining is not null then
    v_overflow := greatest(v_payout - v_cap_remaining, 0);
    v_payout := least(v_payout, greatest(v_cap_remaining, 0));
  end if;

  if v_payout <= 0 then
    if v_used_plan_step then
      update public.jackpot_payout_plan_steps
      set consumed_at = now()
      where id = v_plan_step.id;

      update public.jackpot_payout_queue
      set
        payouts_left = greatest(payouts_left - 1, 0),
        updated_at = now()
      where id = v_row.id;
    end if;

    return 0;
  end if;

  if v_variance > 0 and v_authentic_delivery then
    v_jitter := round((random()::numeric * v_variance * v_payout / 100.0), 4);
    v_payout := greatest(v_payout - v_jitter, 0);
  end if;

  v_payout := round(v_payout, 4);

  update public.devices
  set
    balance = balance + v_payout,
    jackpot_win_total = jackpot_win_total + v_payout,
    updated_at = now()
  where device_id = p_device_id;

  update public.jackpot_payout_queue
  set
    remaining_amount = greatest(remaining_amount - v_payout, 0),
    payouts_left = greatest(payouts_left - 1, 0),
    updated_at = now()
  where id = v_row.id;

  if v_used_plan_step then
    update public.jackpot_payout_plan_steps
    set consumed_at = now()
    where id = v_plan_step.id;
  end if;

  update public.jackpot_pots
  set amount_remaining = greatest(amount_remaining - v_payout, 0)
  where id = v_row.jackpot_pot_id;

  if v_overflow > 0.0001 then
    update public.jackpot_pots
    set amount_remaining = amount_remaining + v_overflow
    where id = v_row.jackpot_pot_id;

    update public.jackpot_payout_queue
    set remaining_amount = remaining_amount + v_overflow
    where id = v_row.id;
  end if;

  return v_payout;
end;
$$;


ALTER FUNCTION "public"."process_device_jackpot_payout"("p_device_id" "text", "p_event_ts" timestamp with time zone, "p_is_free_game" boolean) OWNER TO "postgres";

GRANT ALL ON FUNCTION "public"."process_device_jackpot_payout"("p_device_id" "text", "p_event_ts" timestamp with time zone, "p_is_free_game" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."process_device_jackpot_payout"("p_device_id" "text", "p_event_ts" timestamp with time zone, "p_is_free_game" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."process_device_jackpot_payout"("p_device_id" "text", "p_event_ts" timestamp with time zone, "p_is_free_game" boolean) TO "service_role";
