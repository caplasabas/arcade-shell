alter table public.devices
  add column if not exists deployment_mode text not null default 'online',
  add column if not exists current_game_type text,
  add column if not exists last_seen_at timestamptz,
  add column if not exists last_activity_at timestamptz;

alter table public.devices
  drop constraint if exists devices_deployment_mode_check;

alter table public.devices
  add constraint devices_deployment_mode_check
  check (deployment_mode = any (array['online'::text, 'maintenance'::text]));

alter table public.devices
  drop constraint if exists devices_current_game_type_check;

alter table public.devices
  add constraint devices_current_game_type_check
  check (
    current_game_type is null
    or current_game_type = any (array['arcade'::text, 'casino'::text])
  );

alter table public.devices
  alter column device_status set default 'offline';

update public.devices
set
  device_status = 'offline',
  updated_at = now()
where device_status <> 'playing';

create index if not exists idx_devices_deployment_mode
  on public.devices (deployment_mode);

create index if not exists idx_devices_last_seen_at
  on public.devices (last_seen_at desc);

create or replace function public.start_device_game_session(
  p_device_id text,
  p_game_id text,
  p_game_name text default null,
  p_runtime_mode text default null,
  p_state jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id bigint;
  v_game_type text := nullif(trim(coalesce(p_state->>'gameType', '')), '');
begin
  if p_device_id is null or trim(p_device_id) = '' then
    raise exception 'p_device_id is required';
  end if;

  if p_game_id is null or trim(p_game_id) = '' then
    raise exception 'p_game_id is required';
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
    session_metadata = coalesce(p_state, '{}'::jsonb),
    last_seen_at = now(),
    last_activity_at = now(),
    updated_at = now()
  where device_id = p_device_id;

  return v_session_id;
end;
$$;

create or replace function public.end_device_game_session(
  p_device_id text,
  p_session_id bigint default null,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_device_id is null or trim(p_device_id) = '' then
    raise exception 'p_device_id is required';
  end if;

  update public.device_game_sessions
  set
    status = 'ended',
    ended_at = now(),
    updated_at = now()
  where device_id = p_device_id
    and (p_session_id is null or id = p_session_id)
    and status = 'active';

  update public.devices
  set
    device_status = 'idle',
    active_session_id = null,
    session_last_heartbeat = now(),
    session_ended_at = now(),
    is_free_game = false,
    free_spins_left = 0,
    pending_free_spins = 0,
    show_free_spin_intro = false,
    current_spin_id = 0,
    session_metadata = jsonb_build_object(
      'endReason', coalesce(p_reason, 'unknown'),
      'endedAt', now()
    ),
    last_seen_at = now(),
    updated_at = now()
  where device_id = p_device_id;
end;
$$;

create or replace function public.update_device_game_state(
  p_device_id text,
  p_session_id bigint default null,
  p_state jsonb default '{}'::jsonb
)
returns void
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
    current_spin_id = coalesce(v_current_spin_id, current_spin_id),
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

create or replace view public.device_stats_live as
select
  d.device_id,
  d.balance,
  d.hopper_balance,
  d.coins_in_total,
  d.hopper_in_total,
  d.hopper_out_total,
  d.bet_total,
  d.win_total,
  d.withdraw_total,
  d.updated_at,
  d.name,
  d.spins_total,
  d.prize_pool_contrib_total,
  d.prize_pool_paid_total,
  d.current_game_id,
  d.current_game_name,
  case
    when d.last_seen_at is null or d.last_seen_at < now() - interval '90 seconds' then 'offline'
    else d.device_status
  end as device_status,
  d.active_session_id,
  d.session_started_at,
  d.session_last_heartbeat,
  d.session_ended_at,
  d.runtime_mode,
  d.is_free_game,
  d.free_spins_left,
  d.pending_free_spins,
  d.show_free_spin_intro,
  d.current_spin_id,
  d.session_metadata,
  d.arcade_shell_version,
  d.current_ip,
  d.deployment_mode,
  d.current_game_type,
  d.last_seen_at,
  d.last_activity_at
from public.devices d;

create or replace view public.devices_dashboard_live as
select
  d.id,
  d.device_id,
  d.name,
  d.created_at,
  d.updated_at,
  d.balance,
  d.coins_in_total,
  d.hopper_balance,
  d.hopper_in_total,
  d.hopper_out_total,
  d.bet_total,
  d.win_total,
  d.withdraw_total,
  d.spins_total,
  d.prize_pool_contrib_total,
  d.prize_pool_paid_total,
  d.current_game_id,
  d.current_game_name,
  case
    when d.last_seen_at is null or d.last_seen_at < now() - interval '90 seconds' then 'offline'
    else d.device_status
  end as device_status,
  d.active_session_id,
  d.session_started_at,
  d.session_last_heartbeat,
  d.session_ended_at,
  d.runtime_mode,
  d.is_free_game,
  d.free_spins_left,
  d.pending_free_spins,
  d.show_free_spin_intro,
  d.current_spin_id,
  d.session_metadata,
  d.house_take_total,
  d.last_bet_amount,
  d.last_bet_at,
  d.jackpot_contrib_total,
  d.jackpot_win_total,
  d.arcade_shell_version,
  d.current_ip,
  coalesce(j.has_active, false) as jackpot_selected,
  coalesce(j.target_amount, 0::numeric) as jackpot_target_amount,
  coalesce(j.remaining_amount, 0::numeric) as jackpot_remaining_amount,
  coalesce(j.spins_until_start, 0) as jackpot_spins_until_start,
  d.arcade_total,
  d.deployment_mode,
  d.current_game_type,
  d.last_seen_at,
  d.last_activity_at
from public.devices d
left join (
  select
    q.device_id,
    true as has_active,
    sum(q.target_amount) as target_amount,
    sum(q.remaining_amount) as remaining_amount,
    min(q.spins_until_start) as spins_until_start
  from public.jackpot_payout_queue q
  where q.completed_at is null
  group by q.device_id
) j on j.device_id = d.device_id;

create or replace view public.devices_with_location as
select
  d.id,
  d.device_id,
  d.name,
  d.created_at,
  d.updated_at,
  d.balance,
  d.coins_in_total,
  d.hopper_balance,
  d.hopper_in_total,
  d.hopper_out_total,
  d.bet_total,
  d.win_total,
  d.withdraw_total,
  d.spins_total,
  d.prize_pool_contrib_total,
  d.prize_pool_paid_total,
  d.current_game_id,
  d.current_game_name,
  case
    when d.last_seen_at is null or d.last_seen_at < now() - interval '90 seconds' then 'offline'
    else d.device_status
  end as device_status,
  d.active_session_id,
  d.session_started_at,
  d.session_last_heartbeat,
  d.session_ended_at,
  d.runtime_mode,
  d.is_free_game,
  d.free_spins_left,
  d.pending_free_spins,
  d.show_free_spin_intro,
  d.current_spin_id,
  d.session_metadata,
  d.house_take_total,
  d.last_bet_amount,
  d.last_bet_at,
  d.jackpot_contrib_total,
  d.jackpot_win_total,
  d.arcade_shell_version,
  d.current_ip,
  d.agent_id,
  d.area_id,
  d.station,
  d.location_address,
  a.name as agent_name,
  ar.name as area_name,
  d.deployment_mode,
  d.current_game_type,
  d.last_seen_at,
  d.last_activity_at
from public.devices d
left join public.agents a on a.id = d.agent_id
left join public.areas ar on ar.id = d.area_id;

create or replace view public.global_daily_stats as
select
  s.stat_date,
  coalesce(sum(s.coins_in_amount), 0::numeric) as total_coins_in,
  coalesce(sum(s.hopper_in_amount), 0::numeric) as total_hopper_in,
  coalesce(sum(s.hopper_out_amount), 0::numeric) as total_hopper_out,
  coalesce(sum(s.bet_amount), 0::numeric) as total_bet_amount,
  coalesce(sum(s.win_amount), 0::numeric) as total_win_amount,
  coalesce(sum(s.withdrawal_amount), 0::numeric) as total_withdraw_amount,
  coalesce(sum(s.balance_change), 0::numeric) as total_balance_change,
  coalesce(sum(s.event_count), 0::numeric)::bigint as event_count
from public.device_daily_stats s
join public.devices d on d.device_id = s.device_id
where d.deployment_mode = 'online'
group by s.stat_date
order by s.stat_date desc;

create or replace view public.global_stats_live as
with totals as (
  select
    coalesce(sum(d.balance), 0::numeric) as total_balance,
    coalesce(sum(d.coins_in_total), 0::numeric) as total_coins_in,
    coalesce(sum(d.hopper_balance), 0::numeric) as total_hopper,
    coalesce(sum(d.bet_total), 0::numeric) as total_bet_amount,
    coalesce(sum(d.win_total), 0::numeric) as total_win_amount,
    coalesce(sum(d.withdraw_total), 0::numeric) as total_withdraw_amount,
    coalesce(sum(d.spins_total), 0::numeric)::bigint as total_spins,
    coalesce(sum(d.house_take_total), 0::numeric) as total_house_take,
    coalesce(sum(d.jackpot_contrib_total), 0::numeric) as total_jackpot_contrib,
    coalesce(sum(d.jackpot_win_total), 0::numeric) as total_jackpot_win,
    count(*) as device_count
  from public.devices d
  where d.deployment_mode = 'online'
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
  t.device_count,
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
left join runtime rt on true
left join liabilities lb on true
left join arcade am on true;
