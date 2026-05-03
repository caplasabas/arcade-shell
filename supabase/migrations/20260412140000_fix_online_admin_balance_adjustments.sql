create or replace view public.device_activity_feed as
select
  e.device_id,
  e.id::bigint as activity_id,
  e.event_type as activity_name,
  e.amount,
  e.event_ts as activity_at,
  e.created_at,
  e.metadata,
  e.deployment_mode,
  e.device_status,
  e.counts_toward_global
from public.device_metric_events e

union all

select
  a.device_id,
  (-a.id)::bigint as activity_id,
  ('admin_' || a.entry_kind)::text as activity_name,
  a.amount,
  a.created_at as activity_at,
  a.created_at,
  coalesce(a.metadata, '{}'::jsonb) || jsonb_build_object(
    'source', 'device_admin_ledger_entries',
    'target', a.target,
    'entry_kind', a.entry_kind,
    'account_name', a.account_name,
    'notes', a.notes,
    'balance_before', a.balance_before,
    'balance_after', a.balance_after
  ) as metadata,
  coalesce(nullif(trim(d.deployment_mode), ''), 'online') as deployment_mode,
  public.resolve_device_presence_status(d.device_status, d.last_seen_at, a.created_at) as device_status,
  public.should_count_device_activity(d.deployment_mode, d.device_status, d.last_seen_at, a.created_at) as counts_toward_global
from public.device_admin_ledger_entries a
join public.devices d on d.device_id = a.device_id
where a.target = 'accounting_balance';

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
),
arcade as (
  select
    e.device_id,
    coalesce(sum(case when e.counts_toward_global then e.amount else 0 end), 0::numeric) as eligible_arcade_total,
    coalesce(sum(case when e.counts_toward_global then e.credit_delta else 0 end), 0)::integer as eligible_arcade_credit,
    coalesce(sum(case when e.counts_toward_global then e.time_ms_delta else 0 end), 0)::bigint as eligible_arcade_time_ms
  from public.device_arcade_events e
  group by e.device_id
),
admin_balance_adjustments as (
  select
    a.device_id,
    coalesce(
      sum(
        case
          when public.should_count_device_activity(d.deployment_mode, d.device_status, d.last_seen_at, a.created_at)
            then case when a.entry_kind = 'credit' then a.amount else -a.amount end
          else 0::numeric
        end
      ),
      0::numeric
    ) as eligible_admin_balance_delta
  from public.device_admin_ledger_entries a
  join public.devices d on d.device_id = a.device_id
  where a.target = 'accounting_balance'
  group by a.device_id
)
select
  d.device_id,
  coalesce(i.eligible_balance, 0::numeric) + coalesce(a.eligible_admin_balance_delta, 0::numeric) as eligible_balance,
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
  coalesce(i.eligible_jackpot_win_total, 0::numeric) as eligible_jackpot_win_total,
  coalesce(ar.eligible_arcade_total, 0::numeric) as eligible_arcade_total,
  coalesce(ar.eligible_arcade_credit, 0)::integer as eligible_arcade_credit,
  coalesce(ar.eligible_arcade_time_ms, 0)::bigint as eligible_arcade_time_ms
from public.devices d
left join included i on i.device_id = d.device_id
left join arcade ar on ar.device_id = d.device_id
left join admin_balance_adjustments a on a.device_id = d.device_id;
