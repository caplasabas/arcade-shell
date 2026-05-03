create table if not exists public.accounting_daily_closures (
  business_date date primary key,
  timezone text not null default 'Asia/Manila',
  closed_at timestamptz not null default now(),
  total_devices integer not null default 0,
  total_balance numeric not null default 0,
  total_coins_in numeric not null default 0,
  total_hopper_in numeric not null default 0,
  total_hopper_out numeric not null default 0,
  total_bet numeric not null default 0,
  total_win numeric not null default 0,
  total_withdraw numeric not null default 0,
  total_spins bigint not null default 0,
  total_house_take numeric not null default 0,
  total_arcade_amount numeric not null default 0,
  transferred_device_balance numeric not null default 0,
  transferred_happy_pool numeric not null default 0,
  transferred_jackpot_pool numeric not null default 0,
  carried_happy_pool_reserved numeric not null default 0,
  carried_jackpot_pool_reserved numeric not null default 0,
  house_take_after_close numeric not null default 0,
  rtp_percent numeric not null default 0,
  house_edge_percent numeric not null default 0,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.accounting_daily_device_closures (
  business_date date not null,
  device_id text not null references public.devices(device_id) on delete cascade,
  device_name text,
  deployment_mode text,
  balance numeric not null default 0,
  coins_in_total numeric not null default 0,
  hopper_in_total numeric not null default 0,
  hopper_out_total numeric not null default 0,
  hopper_balance numeric not null default 0,
  bet_total numeric not null default 0,
  win_total numeric not null default 0,
  withdraw_total numeric not null default 0,
  spins_total bigint not null default 0,
  house_take_total numeric not null default 0,
  arcade_total numeric not null default 0,
  arcade_credit integer not null default 0,
  arcade_time_ms bigint not null default 0,
  transferred_balance_to_house_take numeric not null default 0,
  house_take_after_close numeric not null default 0,
  closed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  primary key (business_date, device_id)
);

create index if not exists idx_accounting_daily_device_closures_date
  on public.accounting_daily_device_closures (business_date desc, device_id);

create or replace function public.close_accounting_day(
  p_ref_ts timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_date date := ((coalesce(p_ref_ts, now()) at time zone 'Asia/Manila'))::date;
  v_now timestamptz := coalesce(p_ref_ts, now());
  v_existing public.accounting_daily_closures%rowtype;
  v_device_rows integer := 0;
  v_total_devices integer := 0;
  v_total_balance numeric := 0;
  v_total_coins_in numeric := 0;
  v_total_hopper_in numeric := 0;
  v_total_hopper_out numeric := 0;
  v_total_bet numeric := 0;
  v_total_win numeric := 0;
  v_total_withdraw numeric := 0;
  v_total_spins bigint := 0;
  v_total_house_take numeric := 0;
  v_total_arcade_amount numeric := 0;
  v_transferred_device_balance numeric := 0;
  v_transferred_happy_pool numeric := 0;
  v_transferred_jackpot_pool numeric := 0;
  v_carried_happy_pool_reserved numeric := 0;
  v_carried_jackpot_pool_reserved numeric := 0;
  v_house_take_after_close numeric := 0;
  v_rtp_percent numeric := 0;
  v_house_edge_percent numeric := 0;
  v_runtime public.casino_runtime%rowtype;
  v_has_open_happy boolean := false;
  v_has_open_jackpot boolean := false;
begin
  if not pg_try_advisory_xact_lock(hashtext('public.close_accounting_day'), hashtext(v_business_date::text)) then
    return jsonb_build_object('closed', false, 'reason', 'already_running');
  end if;

  select *
  into v_existing
  from public.accounting_daily_closures c
  where c.business_date = v_business_date;

  if found then
    return jsonb_build_object(
      'closed', false,
      'reason', 'already_closed',
      'business_date', v_business_date,
      'closed_at', v_existing.closed_at
    );
  end if;

  insert into public.accounting_daily_device_closures (
    business_date,
    device_id,
    device_name,
    deployment_mode,
    balance,
    coins_in_total,
    hopper_in_total,
    hopper_out_total,
    hopper_balance,
    bet_total,
    win_total,
    withdraw_total,
    spins_total,
    house_take_total,
    arcade_total,
    arcade_credit,
    arcade_time_ms,
    transferred_balance_to_house_take,
    house_take_after_close,
    closed_at,
    metadata
  )
  select
    v_business_date,
    d.device_id,
    d.name,
    d.deployment_mode,
    coalesce(t.eligible_balance, 0::numeric) as balance,
    coalesce(t.eligible_coins_in_total, 0::numeric) as coins_in_total,
    coalesce(t.eligible_hopper_in_total, 0::numeric) as hopper_in_total,
    coalesce(t.eligible_hopper_out_total, 0::numeric) as hopper_out_total,
    coalesce(t.eligible_hopper_balance, 0::numeric) as hopper_balance,
    coalesce(t.eligible_bet_total, 0::numeric) as bet_total,
    coalesce(t.eligible_win_total, 0::numeric) as win_total,
    coalesce(t.eligible_withdraw_total, 0::numeric) as withdraw_total,
    coalesce(t.eligible_spins_total, 0::bigint) as spins_total,
    coalesce(t.eligible_house_take_total, 0::numeric) as house_take_total,
    coalesce(t.eligible_arcade_total, 0::numeric) as arcade_total,
    coalesce(t.eligible_arcade_credit, 0)::integer as arcade_credit,
    coalesce(t.eligible_arcade_time_ms, 0)::bigint as arcade_time_ms,
    coalesce(t.eligible_balance, 0::numeric) as transferred_balance_to_house_take,
    coalesce(t.eligible_house_take_total, 0::numeric) + coalesce(t.eligible_balance, 0::numeric) as house_take_after_close,
    v_now,
    jsonb_build_object(
      'eligible_snapshot', true,
      'source_view', 'device_accounting_totals'
    )
  from public.devices d
  left join public.device_accounting_totals t on t.device_id = d.device_id
  where trim(coalesce(d.device_id, '')) <> '';

  get diagnostics v_device_rows = row_count;

  select
    count(*)::integer,
    coalesce(sum(c.balance), 0::numeric),
    coalesce(sum(c.coins_in_total), 0::numeric),
    coalesce(sum(c.hopper_in_total), 0::numeric),
    coalesce(sum(c.hopper_out_total), 0::numeric),
    coalesce(sum(c.bet_total), 0::numeric),
    coalesce(sum(c.win_total), 0::numeric),
    coalesce(sum(c.withdraw_total), 0::numeric),
    coalesce(sum(c.spins_total), 0::bigint),
    coalesce(sum(c.house_take_total), 0::numeric),
    coalesce(sum(c.arcade_total), 0::numeric),
    coalesce(sum(c.transferred_balance_to_house_take), 0::numeric)
  into
    v_total_devices,
    v_total_balance,
    v_total_coins_in,
    v_total_hopper_in,
    v_total_hopper_out,
    v_total_bet,
    v_total_win,
    v_total_withdraw,
    v_total_spins,
    v_total_house_take,
    v_total_arcade_amount,
    v_transferred_device_balance
  from public.accounting_daily_device_closures c
  where c.business_date = v_business_date;

  select *
  into v_runtime
  from public.casino_runtime r
  where r.id = true
  limit 1;

  select
    coalesce(sum(p.amount_remaining), 0::numeric),
    exists(select 1 from public.happy_hour_pots p where p.status in ('queued', 'active'))
  into v_carried_happy_pool_reserved, v_has_open_happy
  from public.happy_hour_pots p
  where p.status in ('queued', 'active');

  select
    coalesce(sum(p.amount_remaining), 0::numeric),
    exists(select 1 from public.jackpot_pots p where p.status in ('queued', 'processing'))
  into v_carried_jackpot_pool_reserved, v_has_open_jackpot
  from public.jackpot_pots p
  where p.status in ('queued', 'processing');

  v_transferred_happy_pool :=
    greatest(coalesce(v_runtime.happy_hour_prize_balance, 0::numeric) - v_carried_happy_pool_reserved, 0::numeric);
  v_transferred_jackpot_pool :=
    greatest(coalesce(v_runtime.jackpot_pool_balance, 0::numeric) - v_carried_jackpot_pool_reserved, 0::numeric);

  v_house_take_after_close :=
    v_total_house_take + v_transferred_device_balance + v_transferred_happy_pool + v_transferred_jackpot_pool;

  v_rtp_percent :=
    case when v_total_bet > 0 then round((v_total_win / nullif(v_total_bet, 0::numeric)) * 100.0, 4) else 0::numeric end;
  v_house_edge_percent :=
    case when v_total_bet > 0 then round((v_house_take_after_close / nullif(v_total_bet, 0::numeric)) * 100.0, 4) else 0::numeric end;

  insert into public.accounting_daily_closures (
    business_date,
    timezone,
    closed_at,
    total_devices,
    total_balance,
    total_coins_in,
    total_hopper_in,
    total_hopper_out,
    total_bet,
    total_win,
    total_withdraw,
    total_spins,
    total_house_take,
    total_arcade_amount,
    transferred_device_balance,
    transferred_happy_pool,
    transferred_jackpot_pool,
    carried_happy_pool_reserved,
    carried_jackpot_pool_reserved,
    house_take_after_close,
    rtp_percent,
    house_edge_percent,
    metadata
  )
  values (
    v_business_date,
    'Asia/Manila',
    v_now,
    v_total_devices,
    v_total_balance,
    v_total_coins_in,
    v_total_hopper_in,
    v_total_hopper_out,
    v_total_bet,
    v_total_win,
    v_total_withdraw,
    v_total_spins,
    v_total_house_take,
    v_total_arcade_amount,
    v_transferred_device_balance,
    v_transferred_happy_pool,
    v_transferred_jackpot_pool,
    v_carried_happy_pool_reserved,
    v_carried_jackpot_pool_reserved,
    v_house_take_after_close,
    v_rtp_percent,
    v_house_edge_percent,
    jsonb_build_object(
      'device_rows', v_device_rows,
      'eligible_snapshot', true,
      'runtime_prize_pool_balance', coalesce(v_runtime.prize_pool_balance, 0::numeric),
      'runtime_happy_hour_prize_balance', coalesce(v_runtime.happy_hour_prize_balance, 0::numeric),
      'runtime_jackpot_pool_balance', coalesce(v_runtime.jackpot_pool_balance, 0::numeric)
    )
  );

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
    arcade_credit_updated_at = v_now,
    arcade_time_ms = 0,
    arcade_time_updated_at = v_now,
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
    updated_at = v_now
  where true;

  if to_regclass('public.arcade_metrics') is not null then
    update public.arcade_metrics
    set arcade_balance = 0,
        updated_at = v_now
    where id = 1;
  end if;

  update public.casino_runtime
  set
    active_mode = case
      when v_has_open_happy then active_mode
      else 'BASE'
    end,
    manual_happy_enabled = manual_happy_enabled,
    auto_happy_enabled = auto_happy_enabled,
    happy_hour_prize_balance = v_carried_happy_pool_reserved,
    jackpot_pool_balance = v_carried_jackpot_pool_reserved,
    happy_pool_spin_counter = case when v_has_open_happy then happy_pool_spin_counter else 0 end,
    jackpot_pool_spin_counter = case when v_has_open_jackpot then jackpot_pool_spin_counter else 0 end,
    happy_pool_goal_anchor_at = case when v_has_open_happy then happy_pool_goal_anchor_at else v_now end,
    jackpot_pool_goal_anchor_at = case when v_has_open_jackpot then jackpot_pool_goal_anchor_at else v_now end,
    updated_at = v_now
  where id = true;

  delete from public.jackpot_payout_queue where completed_at is not null;
  delete from public.happy_hour_pots where status = 'completed';
  delete from public.jackpot_pots where status = 'completed';

  truncate table public.device_metric_events restart identity;
  truncate table public.device_arcade_events restart identity;
  truncate table public.device_daily_stats;

  if to_regclass('public.device_game_sessions') is not null then
    execute 'truncate table public.device_game_sessions restart identity cascade';
  end if;

  if to_regclass('public.over_cap_win_events') is not null then
    execute 'truncate table public.over_cap_win_events restart identity cascade';
  end if;

  if to_regclass('public.device_spin_event_dedup') is not null then
    execute 'truncate table public.device_spin_event_dedup restart identity cascade';
  end if;

  perform public.recompute_casino_mode();

  return jsonb_build_object(
    'closed', true,
    'business_date', v_business_date,
    'closed_at', v_now,
    'total_devices', v_total_devices,
    'transferred_device_balance', v_transferred_device_balance,
    'transferred_happy_pool', v_transferred_happy_pool,
    'transferred_jackpot_pool', v_transferred_jackpot_pool,
    'house_take_after_close', v_house_take_after_close
  );
end;
$$;

do $$
declare
  v_job_id bigint;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and to_regclass('cron.job') is not null then
    select jobid into v_job_id
    from cron.job
    where jobname = 'daily-accounting-closeout-manila'
    limit 1;

    if v_job_id is not null then
      perform cron.unschedule(v_job_id);
    end if;

    perform cron.schedule(
      'daily-accounting-closeout-manila',
      '59 15 * * *',
      'select public.close_accounting_day(now());'
    );
  end if;
end
$$;

grant all on table public.accounting_daily_closures to anon;
grant all on table public.accounting_daily_closures to authenticated;
grant all on table public.accounting_daily_closures to service_role;

grant all on table public.accounting_daily_device_closures to anon;
grant all on table public.accounting_daily_device_closures to authenticated;
grant all on table public.accounting_daily_device_closures to service_role;

grant all on function public.close_accounting_day(timestamptz) to anon;
grant all on function public.close_accounting_day(timestamptz) to authenticated;
grant all on function public.close_accounting_day(timestamptz) to service_role;
