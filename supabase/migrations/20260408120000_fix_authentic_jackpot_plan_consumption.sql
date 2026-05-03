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
  v_unallocated numeric := 0;
  v_device_is_free_game boolean := false;
  v_is_dev_test boolean := false;
  v_curve text := 'center';
  v_total_steps integer := 10;
  v_steps_left integer := 1;
  v_current_step integer := 1;
  v_weight_current numeric := 1;
  v_weight_remaining_sum numeric := 1;
  v_weight_step integer := 1;
  v_authentic_delivery boolean := false;
  v_used_plan_step boolean := false;
begin
  if p_device_id is null or trim(p_device_id) = '' then
    return 0;
  end if;

  perform public.finalize_device_jackpot_payouts(p_device_id, coalesce(p_event_ts, now()));

  select * into v_row
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

  select * into v_runtime
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

  if v_authentic_delivery then
    select *
      into v_plan_step
    from public.jackpot_payout_plan_steps s
    where s.queue_id = v_row.id
      and s.device_id = p_device_id
      and s.campaign_id = v_row.campaign_id
      and s.consumed_at is null
    order by s.step_index asc, s.id asc
    limit 1
    for update skip locked;

    if found then
      select count(*)
        into v_steps_left
      from public.jackpot_payout_plan_steps s
      where s.queue_id = v_row.id
        and s.device_id = p_device_id
        and s.campaign_id = v_row.campaign_id
        and s.consumed_at is null;

      v_steps_left := greatest(coalesce(v_steps_left, 0), 1);
      v_payout := round(greatest(coalesce(v_plan_step.expected_amount, 0), 0), 4);
      v_used_plan_step := true;
    end if;
  end if;

  if not v_used_plan_step then
    v_steps_left := greatest(coalesce(v_row.payouts_left, 1), 1);

    if v_steps_left <= 1 or coalesce(v_row.remaining_amount, 0) <= 0 then
      v_payout := greatest(coalesce(v_row.remaining_amount, 0), 0);
    else
      v_current_step := greatest(1, least(v_total_steps - v_steps_left + 1, v_total_steps));
      v_weight_current := public.jackpot_curve_weight(v_current_step, v_total_steps, v_curve);
      v_weight_remaining_sum := 0;

      for v_weight_step in v_current_step..v_total_steps loop
        v_weight_remaining_sum := v_weight_remaining_sum
          + public.jackpot_curve_weight(v_weight_step, v_total_steps, v_curve);
      end loop;

      v_base_chunk := v_row.remaining_amount * v_weight_current / greatest(v_weight_remaining_sum, 0.0001);
      v_jitter := (random() * 2 - 1) * least(v_variance, greatest(v_base_chunk * 0.6, 0));
      v_payout := round(v_base_chunk + v_jitter, 4);
      v_payout := greatest(0, least(v_row.remaining_amount, v_payout));

      if v_payout <= 0 then
        v_payout := least(v_row.remaining_amount, round(v_base_chunk, 4));
      end if;
    end if;
  end if;

  if v_cap_remaining is not null then
    v_payout := least(v_payout, v_cap_remaining);
  end if;

  if v_payout <= 0
    and not (v_cap_remaining is not null and v_cap_remaining < v_row.remaining_amount) then
    return 0;
  end if;

  if v_cap_remaining is not null and v_cap_remaining < v_row.remaining_amount then
    v_overflow := greatest(v_row.remaining_amount - v_payout, 0);

    update public.jackpot_payout_queue
    set
      remaining_amount = 0,
      payouts_left = case
        when v_used_plan_step then greatest(v_steps_left - 1, 0)
        else 0
      end,
      updated_at = now(),
      payout_ready_at = case
        when v_payout > 0 then coalesce(p_event_ts, now())
        else payout_ready_at
      end,
      completed_at = case
        when v_payout > 0 then completed_at
        else coalesce(p_event_ts, now())
      end
    where id = v_row.id;

    if v_used_plan_step then
      update public.jackpot_payout_plan_steps
      set consumed_at = coalesce(p_event_ts, now())
      where id = v_plan_step.id;
    end if;

    if v_overflow > 0 then
      v_unallocated := public.redistribute_jackpot_overflow(
        p_campaign_id := v_row.campaign_id,
        p_jackpot_pot_id := v_row.jackpot_pot_id,
        p_amount := v_overflow,
        p_exclude_device := p_device_id,
        p_event_ts := coalesce(p_event_ts, now())
      );

      if v_unallocated > 0 and v_row.jackpot_pot_id is not null then
        update public.jackpot_pots
        set amount_remaining = greatest(amount_remaining - v_unallocated, 0)
        where id = v_row.jackpot_pot_id;

        insert into public.jackpot_pots (
          amount_total,
          amount_remaining,
          status,
          goal_mode,
          goal_snapshot,
          created_at
        )
        values (
          v_unallocated,
          v_unallocated,
          'queued',
          'amount',
          jsonb_build_object('reason', 'max_win_overflow_no_device', 'sourceCampaign', v_row.campaign_id),
          coalesce(p_event_ts, now())
        );
      end if;
    end if;
  else
    update public.jackpot_payout_queue
    set
      remaining_amount = greatest(remaining_amount - v_payout, 0),
      payouts_left = case
        when v_used_plan_step then greatest(v_steps_left - 1, 0)
        when remaining_amount - v_payout <= 0.0001 then 0
        else greatest(payouts_left - 1, 0)
      end,
      updated_at = now(),
      payout_ready_at = case
        when v_used_plan_step and v_steps_left - 1 <= 0 then coalesce(p_event_ts, now())
        when remaining_amount - v_payout <= 0.0001 or payouts_left - 1 <= 0 then coalesce(p_event_ts, now())
        else payout_ready_at
      end
    where id = v_row.id;

    if v_used_plan_step then
      update public.jackpot_payout_plan_steps
      set consumed_at = coalesce(p_event_ts, now())
      where id = v_plan_step.id;
    end if;
  end if;

  if v_row.jackpot_pot_id is not null then
    update public.jackpot_pots
    set
      amount_remaining = greatest(amount_remaining - v_payout, 0)
    where id = v_row.jackpot_pot_id;
  end if;

  return greatest(v_payout, 0);
end;
$$;

ALTER FUNCTION "public"."process_device_jackpot_payout"("p_device_id" "text", "p_event_ts" timestamp with time zone) OWNER TO "postgres";
