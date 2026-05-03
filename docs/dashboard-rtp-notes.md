# Dashboard RTP And Spin Notes

Date: 2026-04-19

This note records current dashboard/reporting caveats only. It is not a gameplay/runtime change plan.

## Goal

Desired dashboard behavior:

- RTP should include base wins
- RTP should include natural free-spin wins
- RTP should exclude happy-hour wins
- RTP should exclude jackpot wins
- Device spin totals should exclude all free-spin rounds
- Global spin totals should exclude all free-spin rounds

## Current State

Current schema and dashboard behavior do not match that goal exactly.

### RTP

In the dashboard UI, RTP is currently derived by subtracting both:

- `jackpot_win_total`
- `prize_pool_paid_total`

from `win_total`.

That is not equivalent to the desired rule.

Reason:

- `jackpot_win_total` is appropriate to exclude
- `prize_pool_paid_total` is too broad and also includes non-happy, normal accepted wins
- this means the dashboard can under-report RTP relative to the intended visual definition

### Spins

Current spin totals include free spins.

Reason:

- every `spin` event increments the spin counters before the free-spin check
- those counters roll into `device_daily_stats`
- aggregated totals in `device_accounting_totals`, `devices_dashboard_live`, and `global_stats_live` therefore include free spins

## Important Constraint

Do not change live gameplay/runtime logic just to fix dashboard visuals while the system is live.

Avoid changing these paths unless there is a planned maintenance window and explicit testing:

- `public.apply_metric_event`
- `devices.spins_total`
- `device_daily_stats.spins_count`
- `device_daily_stats.included_spins_count`
- existing accounting/runtime views used elsewhere

## Safe Direction Later

Preferred low-risk approach:

- keep runtime/gameplay writes unchanged
- add a new read-only reporting view specifically for dashboard metrics
- have the dashboard read RTP/spin display values from that view

Likely signals available for visual-only reporting from event metadata:

- `isFreeGame`
- `jackpotCampaignPayout`
- `winFundingSource`

## Proposed Reporting Rules

For a future dashboard-only reporting view:

- `dashboard_spins_total`
  - count `spin` events
  - include only `counts_toward_global = true`
  - exclude rows where `metadata.isFreeGame = true`

- `dashboard_rtp_win_total`
  - sum `win` events
  - include only `counts_toward_global = true`
  - exclude jackpot payout rows
  - exclude happy-hour-funded win rows
  - include base wins and natural free-spin wins

- `dashboard_rtp_percent`
  - `dashboard_rtp_win_total / bet_total * 100`

## Decision For Now

Leave current behavior unchanged for now.

This is a reminder that any future fix should be implemented as a dashboard/reporting layer change, not as a live runtime logic rewrite.
