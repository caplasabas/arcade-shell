create or replace function public.demo_reset_runtime_metrics(p_keep_device_ids text[] default array[]::text[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_device_count integer := 0;
  v_command_count integer := 0;
  v_cabinet_game_count integer := 0;
begin
  select count(*)::int
  into v_device_count
  from public.devices d
  where trim(coalesce(d.device_id, '')) <> '';

  truncate table public.device_metric_events restart identity;
  truncate table public.device_daily_stats;

  if to_regclass('public.jackpot_payout_plan_steps') is not null then
    execute 'truncate table public.jackpot_payout_plan_steps restart identity cascade';
  end if;

  if to_regclass('public.jackpot_payout_queue') is not null then
    execute 'truncate table public.jackpot_payout_queue restart identity cascade';
  end if;

  if to_regclass('public.happy_hour_pots') is not null then
    execute 'truncate table public.happy_hour_pots restart identity cascade';
  end if;

  if to_regclass('public.jackpot_pots') is not null then
    execute 'truncate table public.jackpot_pots restart identity cascade';
  end if;

  if to_regclass('public.device_game_sessions') is not null then
    execute 'truncate table public.device_game_sessions restart identity cascade';
  end if;

  if to_regclass('public.device_admin_ledger_entries') is not null then
    execute 'truncate table public.device_admin_ledger_entries restart identity cascade';
  end if;

  if to_regclass('public.device_admin_commands') is not null then
    execute 'truncate table public.device_admin_commands restart identity cascade';
  end if;

  if to_regclass('public.ledger_entries') is not null then
    execute 'truncate table public.ledger_entries restart identity cascade';
  end if;

  if to_regclass('public.ledger_events') is not null then
    execute 'truncate table public.ledger_events restart identity cascade';
  end if;

  if to_regclass('public.over_cap_win_events') is not null then
    execute 'truncate table public.over_cap_win_events restart identity cascade';
  end if;

  if to_regclass('public.device_spin_event_dedup') is not null then
    execute 'truncate table public.device_spin_event_dedup restart identity cascade';
  end if;

  if to_regclass('public.cabinet_games') is not null then
    truncate table public.cabinet_games;

    insert into public.cabinet_games (
      device_id,
      game_id,
      installed,
      installed_version
    )
    select
      d.device_id,
      g.id,
      case
        when g.type = 'casino' and g.enabled = false then false
        else true
      end as installed,
      null as installed_version
    from public.devices d
    cross join public.games g
    where trim(coalesce(d.device_id, '')) <> '';

    get diagnostics v_cabinet_game_count = row_count;
  end if;

  update public.devices
  set
    balance = 0,
    coins_in_total = 0,
    hopper_balance = 0,
    hopper_in_total = 0,
    hopper_out_total = 0,
    bet_total = 0,
    win_total = 0,
    withdraw_total = 0,
    spins_total = 0,
    prize_pool_contrib_total = 0,
    prize_pool_paid_total = 0,
    arcade_credit = 0,
    arcade_credit_updated_at = now(),
    arcade_time_ms = 0,
    arcade_time_updated_at = now(),
    arcade_session_started_at = null,
    arcade_time_last_deducted_at = null,
    arcade_total = 0,
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
    house_take_total = 0,
    last_bet_amount = 0,
    last_bet_at = null,
    jackpot_contrib_total = 0,
    jackpot_win_total = 0,
    last_seen_at = null,
    last_activity_at = null,
    updated_at = now()
  where true;

  update public.casino_runtime
  set
    active_mode = 'BASE',
    manual_happy_enabled = false,
    auto_happy_enabled = true,
    prize_pool_balance = 0,
    happy_hour_prize_balance = 0,
    jackpot_pool_balance = 0,
    jackpot_pending_payout = false,
    last_jackpot_triggered_at = null,
    active_happy_pot_id = null,
    active_jackpot_pot_id = null,
    happy_pool_spin_counter = 0,
    jackpot_pool_spin_counter = 0,
    happy_pool_goal_anchor_at = now(),
    jackpot_pool_goal_anchor_at = now(),
    updated_at = now()
  where id = true;

  perform public.recompute_casino_mode();

  if to_regclass('public.device_admin_commands') is not null then
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
    select
      d.device_id,
      'reset',
      'queued',
      'demo_reset_runtime_metrics',
      'dashboard',
      now(),
      now(),
      now()
    from public.devices d
    where trim(coalesce(d.device_id, '')) <> '';

    get diagnostics v_command_count = row_count;
  end if;

  return jsonb_build_object(
    'ok', true,
    'devices_reset', v_device_count,
    'devices_preserved', v_device_count,
    'cabinet_games_seeded', v_cabinet_game_count,
    'reset_commands_queued', v_command_count
  );
end;
$$;
