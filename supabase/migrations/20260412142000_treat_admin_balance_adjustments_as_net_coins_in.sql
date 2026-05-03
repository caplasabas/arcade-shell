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
  coalesce(i.eligible_coins_in_total, 0::numeric) + coalesce(a.eligible_admin_balance_delta, 0::numeric) as eligible_coins_in_total,
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

create or replace view public.global_stats_live as
with metric_totals as (
  select
    coalesce(sum(t.eligible_balance), 0::numeric) as total_balance,
    coalesce(sum(t.eligible_coins_in_total), 0::numeric) as total_coins_in,
    coalesce(sum(t.eligible_bet_total), 0::numeric) as total_bet_amount,
    coalesce(sum(t.eligible_win_total), 0::numeric) as total_win_amount,
    coalesce(sum(t.eligible_withdraw_total), 0::numeric) as total_withdraw_amount,
    coalesce(sum(t.eligible_spins_total), 0::numeric)::bigint as total_spins,
    coalesce(sum(t.eligible_house_take_total), 0::numeric) as total_house_take,
    coalesce(sum(t.eligible_jackpot_contrib_total), 0::numeric) as total_jackpot_contrib,
    coalesce(sum(t.eligible_jackpot_win_total), 0::numeric) as total_jackpot_win
  from public.device_accounting_totals t
),
hopper_totals as (
  select
    coalesce(sum(d.hopper_balance), 0::numeric) as total_hopper
  from public.devices d
  where public.should_count_device_activity(d.deployment_mode, d.device_status, d.last_seen_at, now())
),
eligible_devices as (
  select count(*) as device_count
  from public.devices d
  where public.should_count_device_activity(d.deployment_mode, d.device_status, d.last_seen_at, now())
),
runtime as (
  select
    coalesce(r.prize_pool_balance, 0::numeric) as prize_pool_balance,
    coalesce(r.happy_hour_prize_balance, 0::numeric) as happy_hour_prize_balance,
    coalesce(r.jackpot_pool_balance, 0::numeric) as jackpot_pool_balance
  from public.casino_runtime r
  where r.id = true
  limit 1
),
liabilities as (
  select
    coalesce((select sum(hp.amount_remaining) from public.happy_hour_pots hp where hp.status = 'queued'), 0::numeric) as happy_queued_amount,
    coalesce((select sum(jp.amount_remaining) from public.jackpot_pots jp where jp.status = 'queued'), 0::numeric) as jackpot_queued_amount,
    coalesce((select sum(jp.amount_remaining) from public.jackpot_pots jp where jp.status = 'processing'), 0::numeric) as jackpot_processing_amount
),
arcade as (
  select
    coalesce(sum(e.amount), 0::numeric) as total_arcade_amount
  from public.device_arcade_events e
  where e.counts_toward_global
)
select
  m.total_balance,
  m.total_coins_in,
  h.total_hopper,
  m.total_bet_amount,
  m.total_win_amount,
  m.total_withdraw_amount,
  m.total_spins,
  case
    when m.total_bet_amount > 0::numeric then round((m.total_win_amount / nullif(m.total_bet_amount, 0::numeric)) * 100.0, 4)
    else 0::numeric
  end as global_rtp_percent,
  ed.device_count,
  now() as generated_at,
  m.total_house_take,
  case
    when m.total_bet_amount > 0::numeric then round((m.total_house_take / nullif(m.total_bet_amount, 0::numeric)) * 100.0, 4)
    else 0::numeric
  end as global_house_edge_percent,
  m.total_jackpot_contrib,
  m.total_jackpot_win,
  ((((((((m.total_coins_in - m.total_withdraw_amount) - m.total_balance) - coalesce(rt.prize_pool_balance, 0::numeric)) - coalesce(rt.happy_hour_prize_balance, 0::numeric)) - coalesce(rt.jackpot_pool_balance, 0::numeric)) - coalesce(lb.happy_queued_amount, 0::numeric)) - coalesce(lb.jackpot_queued_amount, 0::numeric)) - coalesce(lb.jackpot_processing_amount, 0::numeric)) as total_house_net,
  case
    when m.total_coins_in > 0::numeric then round(((((((((m.total_coins_in - m.total_withdraw_amount) - m.total_balance) - coalesce(rt.prize_pool_balance, 0::numeric)) - coalesce(rt.happy_hour_prize_balance, 0::numeric)) - coalesce(rt.jackpot_pool_balance, 0::numeric)) - coalesce(lb.happy_queued_amount, 0::numeric)) - coalesce(lb.jackpot_queued_amount, 0::numeric)) - coalesce(lb.jackpot_processing_amount, 0::numeric)) / nullif(m.total_coins_in, 0::numeric) * 100.0, 4)
    else 0::numeric
  end as global_house_net_percent,
  coalesce(am.total_arcade_amount, 0::numeric) as total_arcade_amount
from metric_totals m
cross join hopper_totals h
cross join eligible_devices ed
left join runtime rt on true
left join liabilities lb on true
left join arcade am on true;
