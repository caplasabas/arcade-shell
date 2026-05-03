create or replace function public.reset_device_maintenance_runtime(
  p_device_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device_id text := trim(coalesce(p_device_id, ''));
  v_device public.devices%rowtype;
  v_deleted_metric_events integer := 0;
  v_deleted_arcade_events integer := 0;
  v_deleted_daily_rows integer := 0;
begin
  if v_device_id = '' then
    raise exception 'p_device_id is required';
  end if;

  select *
  into v_device
  from public.devices d
  where d.device_id = v_device_id
  for update;

  if not found then
    raise exception 'device not found: %', v_device_id;
  end if;

  if coalesce(v_device.deployment_mode, 'online') <> 'maintenance' then
    raise exception 'reset is only allowed for maintenance devices';
  end if;

  delete from public.device_metric_events e
  where e.device_id = v_device_id
    and coalesce(e.deployment_mode, 'online') = 'maintenance';
  get diagnostics v_deleted_metric_events = row_count;

  if to_regclass('public.device_arcade_events') is not null then
    delete from public.device_arcade_events e
    where e.device_id = v_device_id
      and coalesce(e.deployment_mode, 'online') = 'maintenance';
    get diagnostics v_deleted_arcade_events = row_count;
  end if;

  delete from public.device_daily_stats s
  where s.device_id = v_device_id;
  get diagnostics v_deleted_daily_rows = row_count;

  -- Rebuild per-day rollups from the remaining event history.
  if to_regclass('public.device_metric_events') is not null then
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
      included_prize_pool_paid_amount
    )
    select
      (e.event_ts at time zone 'Asia/Manila')::date as stat_date,
      e.device_id,
      coalesce(sum(case when e.event_type = 'coins_in' then e.amount else 0 end), 0::numeric),
      coalesce(sum(case when e.event_type = 'hopper_in' then e.amount else 0 end), 0::numeric),
      coalesce(sum(case when e.event_type = 'hopper_out' then e.amount else 0 end), 0::numeric),
      coalesce(sum(case when e.event_type = 'bet' then e.amount else 0 end), 0::numeric),
      coalesce(sum(case when e.event_type = 'win' then e.amount else 0 end), 0::numeric),
      coalesce(sum(case when e.event_type = 'bet' then greatest(e.amount, 0) else 0 end), 0::numeric) * 0 + coalesce(sum(case when e.event_type = 'house_take' then e.amount else 0 end), 0::numeric),
      coalesce(sum(case when e.event_type = 'jackpot_contrib' then e.amount else 0 end), 0::numeric),
      coalesce(sum(case when e.event_type = 'jackpot_win' then e.amount else 0 end), 0::numeric),
      coalesce(sum(case when e.event_type = 'withdrawal' then e.amount else 0 end), 0::numeric),
      coalesce(sum(
        case
          when e.event_type in ('coins_in', 'win', 'hopper_in') then e.amount
          when e.event_type in ('bet', 'withdrawal', 'hopper_out') then -e.amount
          else 0
        end
      ), 0::numeric),
      count(*)::bigint,
      coalesce(sum(case when e.event_type = 'bet' then 1 else 0 end), 0)::bigint,
      coalesce(sum(case when e.event_type = 'prize_pool_contrib' then e.amount else 0 end), 0::numeric),
      coalesce(sum(case when e.event_type = 'prize_pool_paid' then e.amount else 0 end), 0::numeric),
      coalesce(sum(case when e.counts_toward_global and e.event_type = 'coins_in' then e.amount else 0 end), 0::numeric),
      coalesce(sum(case when e.counts_toward_global and e.event_type = 'hopper_in' then e.amount else 0 end), 0::numeric),
      coalesce(sum(case when e.counts_toward_global and e.event_type = 'hopper_out' then e.amount else 0 end), 0::numeric),
      coalesce(sum(case when e.counts_toward_global and e.event_type = 'bet' then e.amount else 0 end), 0::numeric),
      coalesce(sum(case when e.counts_toward_global and e.event_type = 'win' then e.amount else 0 end), 0::numeric),
      coalesce(sum(case when e.counts_toward_global and e.event_type = 'house_take' then e.amount else 0 end), 0::numeric),
      coalesce(sum(case when e.counts_toward_global and e.event_type = 'jackpot_contrib' then e.amount else 0 end), 0::numeric),
      coalesce(sum(case when e.counts_toward_global and e.event_type = 'jackpot_win' then e.amount else 0 end), 0::numeric),
      coalesce(sum(case when e.counts_toward_global and e.event_type = 'withdrawal' then e.amount else 0 end), 0::numeric),
      coalesce(sum(
        case
          when e.counts_toward_global and e.event_type in ('coins_in', 'win', 'hopper_in') then e.amount
          when e.counts_toward_global and e.event_type in ('bet', 'withdrawal', 'hopper_out') then -e.amount
          else 0
        end
      ), 0::numeric),
      coalesce(sum(case when e.counts_toward_global then 1 else 0 end), 0)::bigint,
      coalesce(sum(case when e.counts_toward_global and e.event_type = 'bet' then 1 else 0 end), 0)::bigint,
      coalesce(sum(case when e.counts_toward_global and e.event_type = 'prize_pool_contrib' then e.amount else 0 end), 0::numeric),
      coalesce(sum(case when e.counts_toward_global and e.event_type = 'prize_pool_paid' then e.amount else 0 end), 0::numeric)
    from public.device_metric_events e
    where e.device_id = v_device_id
    group by (e.event_ts at time zone 'Asia/Manila')::date, e.device_id;
  end if;

  update public.devices d
  set
    balance = coalesce(t.eligible_balance, 0::numeric),
    coins_in_total = coalesce(t.eligible_coins_in_total, 0::numeric),
    hopper_balance = coalesce(t.eligible_hopper_balance, 0::numeric),
    hopper_in_total = coalesce(t.eligible_hopper_in_total, 0::numeric),
    hopper_out_total = coalesce(t.eligible_hopper_out_total, 0::numeric),
    bet_total = coalesce(t.eligible_bet_total, 0::numeric),
    win_total = coalesce(t.eligible_win_total, 0::numeric),
    withdraw_total = coalesce(t.eligible_withdraw_total, 0::numeric),
    spins_total = coalesce(t.eligible_spins_total, 0::bigint),
    prize_pool_contrib_total = coalesce(t.eligible_prize_pool_contrib_total, 0::numeric),
    prize_pool_paid_total = coalesce(t.eligible_prize_pool_paid_total, 0::numeric),
    house_take_total = coalesce(t.eligible_house_take_total, 0::numeric),
    jackpot_contrib_total = coalesce(t.eligible_jackpot_contrib_total, 0::numeric),
    jackpot_win_total = coalesce(t.eligible_jackpot_win_total, 0::numeric),
    arcade_total = coalesce(t.eligible_arcade_total, 0::numeric),
    arcade_credit = coalesce(t.eligible_arcade_credit, 0),
    arcade_time_ms = coalesce(t.eligible_arcade_time_ms, 0),
    current_game_id = null,
    current_game_name = null,
    current_game_type = null,
    device_status = 'idle',
    active_session_id = null,
    session_started_at = null,
    session_last_heartbeat = null,
    session_ended_at = null,
    runtime_mode = null,
    is_free_game = false,
    free_spins_left = 0,
    pending_free_spins = 0,
    show_free_spin_intro = false,
    current_spin_id = 0,
    session_metadata = '{}'::jsonb,
    updated_at = now()
  from public.device_accounting_totals t
  where d.device_id = v_device_id
    and t.device_id = d.device_id;

  return jsonb_build_object(
    'ok', true,
    'device_id', v_device_id,
    'deleted_metric_events', v_deleted_metric_events,
    'deleted_arcade_events', v_deleted_arcade_events,
    'deleted_daily_rows', v_deleted_daily_rows,
    'archived_closeouts_untouched', true
  );
end;
$$;

create or replace function public.enqueue_device_admin_command(
  p_device_id text,
  p_command text,
  p_reason text default null,
  p_requested_by text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device_id text := trim(coalesce(p_device_id, ''));
  v_command text := lower(trim(coalesce(p_command, '')));
  v_row public.device_admin_commands;
  v_device public.devices%rowtype;
begin
  if v_device_id = '' then
    raise exception 'p_device_id is required';
  end if;

  if v_command not in ('restart', 'shutdown', 'reset') then
    raise exception 'Unsupported command: %', v_command;
  end if;

  select *
  into v_device
  from public.devices d
  where d.device_id = v_device_id;

  if not found then
    raise exception 'device not found: %', v_device_id;
  end if;

  if v_command = 'reset' and coalesce(v_device.deployment_mode, 'online') <> 'maintenance' then
    raise exception 'reset is only allowed when device is in maintenance mode';
  end if;

  select * into v_row
  from public.device_admin_commands c
  where c.device_id = v_device_id
    and c.command = v_command
    and c.status in ('queued', 'processing')
  order by c.id desc
  limit 1;

  if found then
    return jsonb_build_object(
      'ok', true,
      'deduped', true,
      'id', v_row.id,
      'device_id', v_row.device_id,
      'command', v_row.command,
      'status', v_row.status
    );
  end if;

  insert into public.device_admin_commands (
    device_id,
    command,
    status,
    reason,
    requested_by,
    requested_at,
    created_at,
    updated_at
  )
  values (
    v_device_id,
    v_command,
    'queued',
    nullif(trim(coalesce(p_reason, '')), ''),
    nullif(trim(coalesce(p_requested_by, '')), ''),
    now(),
    now(),
    now()
  )
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'deduped', false,
    'id', v_row.id,
    'device_id', v_row.device_id,
    'command', v_row.command,
    'status', v_row.status
  );
end;
$$;

grant all on function public.reset_device_maintenance_runtime(text) to anon;
grant all on function public.reset_device_maintenance_runtime(text) to authenticated;
grant all on function public.reset_device_maintenance_runtime(text) to service_role;
