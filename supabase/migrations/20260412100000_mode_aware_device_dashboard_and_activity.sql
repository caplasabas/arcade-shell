create or replace view public.device_activity_feed as
select
  e.device_id,
  e.id as activity_id,
  e.event_type as activity_name,
  e.amount,
  e.event_ts as activity_at,
  e.created_at,
  e.metadata,
  e.deployment_mode,
  e.device_status,
  e.counts_toward_global
from public.device_metric_events e;

create or replace view public.device_accounting_totals as
with included as (
  select
    s.device_id,
    coalesce(sum(s.included_balance_change), 0::numeric) as eligible_balance,
    coalesce(sum(s.included_coins_in_amount), 0::numeric) as eligible_coins_in_total,
    coalesce(sum(s.included_hopper_in_amount - s.included_hopper_out_amount), 0::numeric) as eligible_hopper_balance,
    coalesce(sum(s.included_hopper_in_amount), 0::numeric) as eligible_hopper_in_total,
    coalesce(sum(s.included_hopper_out_amount), 0::numeric) as eligible_hopper_out_total,
    coalesce(sum(s.included_bet_amount), 0::numeric) as eligible_bet_total,
    coalesce(sum(s.included_win_amount), 0::numeric) as eligible_win_total,
    coalesce(sum(s.included_withdrawal_amount), 0::numeric) as eligible_withdraw_total,
    coalesce(sum(s.included_spins_count), 0::numeric)::bigint as eligible_spins_total,
    coalesce(sum(s.included_prize_pool_contrib_amount), 0::numeric) as eligible_prize_pool_contrib_total,
    coalesce(sum(s.included_prize_pool_paid_amount), 0::numeric) as eligible_prize_pool_paid_total,
    coalesce(sum(s.included_house_take_amount), 0::numeric) as eligible_house_take_total,
    coalesce(sum(s.included_jackpot_contrib_amount), 0::numeric) as eligible_jackpot_contrib_total,
    coalesce(sum(s.included_jackpot_win_amount), 0::numeric) as eligible_jackpot_win_total
  from public.device_daily_stats s
  group by s.device_id
)
select
  d.device_id,
  coalesce(i.eligible_balance, 0::numeric) as eligible_balance,
  coalesce(i.eligible_coins_in_total, 0::numeric) as eligible_coins_in_total,
  coalesce(i.eligible_hopper_balance, 0::numeric) as eligible_hopper_balance,
  coalesce(i.eligible_hopper_in_total, 0::numeric) as eligible_hopper_in_total,
  coalesce(i.eligible_hopper_out_total, 0::numeric) as eligible_hopper_out_total,
  coalesce(i.eligible_bet_total, 0::numeric) as eligible_bet_total,
  coalesce(i.eligible_win_total, 0::numeric) as eligible_win_total,
  coalesce(i.eligible_withdraw_total, 0::numeric) as eligible_withdraw_total,
  coalesce(i.eligible_spins_total, 0::bigint) as eligible_spins_total,
  coalesce(i.eligible_prize_pool_contrib_total, 0::numeric) as eligible_prize_pool_contrib_total,
  coalesce(i.eligible_prize_pool_paid_total, 0::numeric) as eligible_prize_pool_paid_total,
  coalesce(i.eligible_house_take_total, 0::numeric) as eligible_house_take_total,
  coalesce(i.eligible_jackpot_contrib_total, 0::numeric) as eligible_jackpot_contrib_total,
  coalesce(i.eligible_jackpot_win_total, 0::numeric) as eligible_jackpot_win_total
from public.devices d
left join included i on i.device_id = d.device_id;

create or replace view public.device_stats_live as
select
  d.device_id,
  (
    case when d.deployment_mode = 'online' then coalesce(t.eligible_balance, 0::numeric) else d.balance end
  )::numeric(14,2) as balance,
  case when d.deployment_mode = 'online' then coalesce(t.eligible_hopper_balance, 0::numeric) else d.hopper_balance end as hopper_balance,
  case when d.deployment_mode = 'online' then coalesce(t.eligible_coins_in_total, 0::numeric) else d.coins_in_total end as coins_in_total,
  case when d.deployment_mode = 'online' then coalesce(t.eligible_hopper_in_total, 0::numeric) else d.hopper_in_total end as hopper_in_total,
  case when d.deployment_mode = 'online' then coalesce(t.eligible_hopper_out_total, 0::numeric) else d.hopper_out_total end as hopper_out_total,
  case when d.deployment_mode = 'online' then coalesce(t.eligible_bet_total, 0::numeric) else d.bet_total end as bet_total,
  case when d.deployment_mode = 'online' then coalesce(t.eligible_win_total, 0::numeric) else d.win_total end as win_total,
  case when d.deployment_mode = 'online' then coalesce(t.eligible_withdraw_total, 0::numeric) else d.withdraw_total end as withdraw_total,
  d.updated_at,
  d.name,
  case when d.deployment_mode = 'online' then coalesce(t.eligible_spins_total, 0::bigint) else d.spins_total end as spins_total,
  case when d.deployment_mode = 'online' then coalesce(t.eligible_prize_pool_contrib_total, 0::numeric) else d.prize_pool_contrib_total end as prize_pool_contrib_total,
  case when d.deployment_mode = 'online' then coalesce(t.eligible_prize_pool_paid_total, 0::numeric) else d.prize_pool_paid_total end as prize_pool_paid_total,
  d.current_game_id,
  d.current_game_name,
  case
    when d.last_seen_at is null or d.last_seen_at < (now() - interval '90 seconds') then 'offline'::text
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
  d.withdraw_enabled,
  d.arcade_credit,
  d.arcade_credit_updated_at,
  d.arcade_time_ms,
  d.arcade_time_updated_at,
  d.arcade_session_started_at,
  d.arcade_time_last_deducted_at,
  d.arcade_total,
  coalesce(t.eligible_balance, 0::numeric) as eligible_balance,
  coalesce(t.eligible_coins_in_total, 0::numeric) as eligible_coins_in_total,
  coalesce(t.eligible_hopper_balance, 0::numeric) as eligible_hopper_balance,
  coalesce(t.eligible_hopper_in_total, 0::numeric) as eligible_hopper_in_total,
  coalesce(t.eligible_hopper_out_total, 0::numeric) as eligible_hopper_out_total,
  coalesce(t.eligible_bet_total, 0::numeric) as eligible_bet_total,
  coalesce(t.eligible_win_total, 0::numeric) as eligible_win_total,
  coalesce(t.eligible_withdraw_total, 0::numeric) as eligible_withdraw_total,
  coalesce(t.eligible_spins_total, 0::bigint) as eligible_spins_total,
  coalesce(t.eligible_prize_pool_contrib_total, 0::numeric) as eligible_prize_pool_contrib_total,
  coalesce(t.eligible_prize_pool_paid_total, 0::numeric) as eligible_prize_pool_paid_total,
  coalesce(t.eligible_house_take_total, 0::numeric) as eligible_house_take_total,
  coalesce(t.eligible_jackpot_contrib_total, 0::numeric) as eligible_jackpot_contrib_total,
  coalesce(t.eligible_jackpot_win_total, 0::numeric) as eligible_jackpot_win_total,
  d.balance as all_balance,
  d.coins_in_total as all_coins_in_total,
  d.hopper_balance as all_hopper_balance,
  d.hopper_in_total as all_hopper_in_total,
  d.hopper_out_total as all_hopper_out_total,
  d.bet_total as all_bet_total,
  d.win_total as all_win_total,
  d.withdraw_total as all_withdraw_total,
  d.spins_total as all_spins_total,
  d.prize_pool_contrib_total as all_prize_pool_contrib_total,
  d.prize_pool_paid_total as all_prize_pool_paid_total,
  d.house_take_total as all_house_take_total,
  d.jackpot_contrib_total as all_jackpot_contrib_total,
  d.jackpot_win_total as all_jackpot_win_total
from public.devices d
left join public.device_accounting_totals t on t.device_id = d.device_id;

create or replace view public.devices_dashboard_live as
select
  d.id,
  d.device_id,
  d.name,
  d.created_at,
  d.updated_at,
  (
    case when d.deployment_mode = 'online' then coalesce(t.eligible_balance, 0::numeric) else d.balance end
  )::numeric(14,2) as balance,
  case when d.deployment_mode = 'online' then coalesce(t.eligible_coins_in_total, 0::numeric) else d.coins_in_total end as coins_in_total,
  case when d.deployment_mode = 'online' then coalesce(t.eligible_hopper_balance, 0::numeric) else d.hopper_balance end as hopper_balance,
  case when d.deployment_mode = 'online' then coalesce(t.eligible_hopper_in_total, 0::numeric) else d.hopper_in_total end as hopper_in_total,
  case when d.deployment_mode = 'online' then coalesce(t.eligible_hopper_out_total, 0::numeric) else d.hopper_out_total end as hopper_out_total,
  case when d.deployment_mode = 'online' then coalesce(t.eligible_bet_total, 0::numeric) else d.bet_total end as bet_total,
  case when d.deployment_mode = 'online' then coalesce(t.eligible_win_total, 0::numeric) else d.win_total end as win_total,
  case when d.deployment_mode = 'online' then coalesce(t.eligible_withdraw_total, 0::numeric) else d.withdraw_total end as withdraw_total,
  case when d.deployment_mode = 'online' then coalesce(t.eligible_spins_total, 0::bigint) else d.spins_total end as spins_total,
  case when d.deployment_mode = 'online' then coalesce(t.eligible_prize_pool_contrib_total, 0::numeric) else d.prize_pool_contrib_total end as prize_pool_contrib_total,
  case when d.deployment_mode = 'online' then coalesce(t.eligible_prize_pool_paid_total, 0::numeric) else d.prize_pool_paid_total end as prize_pool_paid_total,
  d.current_game_id,
  d.current_game_name,
  case
    when d.last_seen_at is null or d.last_seen_at < now() - interval '90 seconds' then 'offline'::text
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
  case when d.deployment_mode = 'online' then coalesce(t.eligible_house_take_total, 0::numeric) else d.house_take_total end as house_take_total,
  d.last_bet_amount,
  d.last_bet_at,
  case when d.deployment_mode = 'online' then coalesce(t.eligible_jackpot_contrib_total, 0::numeric) else d.jackpot_contrib_total end as jackpot_contrib_total,
  case when d.deployment_mode = 'online' then coalesce(t.eligible_jackpot_win_total, 0::numeric) else d.jackpot_win_total end as jackpot_win_total,
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
  d.withdraw_enabled,
  d.arcade_credit,
  d.arcade_credit_updated_at,
  d.arcade_time_ms,
  d.arcade_time_updated_at,
  d.arcade_session_started_at,
  d.arcade_time_last_deducted_at,
  coalesce(t.eligible_balance, 0::numeric) as eligible_balance,
  coalesce(t.eligible_coins_in_total, 0::numeric) as eligible_coins_in_total,
  coalesce(t.eligible_hopper_balance, 0::numeric) as eligible_hopper_balance,
  coalesce(t.eligible_hopper_in_total, 0::numeric) as eligible_hopper_in_total,
  coalesce(t.eligible_hopper_out_total, 0::numeric) as eligible_hopper_out_total,
  coalesce(t.eligible_bet_total, 0::numeric) as eligible_bet_total,
  coalesce(t.eligible_win_total, 0::numeric) as eligible_win_total,
  coalesce(t.eligible_withdraw_total, 0::numeric) as eligible_withdraw_total,
  coalesce(t.eligible_spins_total, 0::bigint) as eligible_spins_total,
  coalesce(t.eligible_prize_pool_contrib_total, 0::numeric) as eligible_prize_pool_contrib_total,
  coalesce(t.eligible_prize_pool_paid_total, 0::numeric) as eligible_prize_pool_paid_total,
  coalesce(t.eligible_house_take_total, 0::numeric) as eligible_house_take_total,
  coalesce(t.eligible_jackpot_contrib_total, 0::numeric) as eligible_jackpot_contrib_total,
  coalesce(t.eligible_jackpot_win_total, 0::numeric) as eligible_jackpot_win_total,
  d.balance as all_balance,
  d.coins_in_total as all_coins_in_total,
  d.hopper_balance as all_hopper_balance,
  d.hopper_in_total as all_hopper_in_total,
  d.hopper_out_total as all_hopper_out_total,
  d.bet_total as all_bet_total,
  d.win_total as all_win_total,
  d.withdraw_total as all_withdraw_total,
  d.spins_total as all_spins_total,
  d.prize_pool_contrib_total as all_prize_pool_contrib_total,
  d.prize_pool_paid_total as all_prize_pool_paid_total,
  d.house_take_total as all_house_take_total,
  d.jackpot_contrib_total as all_jackpot_contrib_total,
  d.jackpot_win_total as all_jackpot_win_total
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
) j on j.device_id = d.device_id
left join public.device_accounting_totals t on t.device_id = d.device_id;

grant all on table public.device_activity_feed to anon;
grant all on table public.device_activity_feed to authenticated;
grant all on table public.device_activity_feed to service_role;

grant all on table public.device_accounting_totals to anon;
grant all on table public.device_accounting_totals to authenticated;
grant all on table public.device_accounting_totals to service_role;
