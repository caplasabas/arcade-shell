alter table public.devices
  add column if not exists withdraw_enabled boolean not null default false;

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
    when d.last_seen_at is null or d.last_seen_at < (now() - interval '00:01:30') then 'offline'::text
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
  d.last_activity_at,
  d.withdraw_enabled
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
    when d.last_seen_at is null or d.last_seen_at < (now() - interval '00:01:30') then 'offline'::text
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
  d.last_activity_at,
  d.withdraw_enabled
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
    when d.last_seen_at is null or d.last_seen_at < (now() - interval '00:01:30') then 'offline'::text
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
  d.last_activity_at,
  d.withdraw_enabled
from public.devices d
left join public.agents a on a.id = d.agent_id
left join public.areas ar on ar.id = d.area_id;
