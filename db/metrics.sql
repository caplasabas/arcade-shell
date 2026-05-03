-- Metrics and rollup schema for arcade cabinet monitoring.
-- Apply in Supabase SQL Editor (or migration runner) before deploying app changes.

-- 1) Extend devices with cumulative counters.
alter table public.devices
  add column if not exists coins_in_total numeric not null default 0,
  add column if not exists hopper_balance numeric not null default 0,
  add column if not exists hopper_in_total numeric not null default 0,
  add column if not exists hopper_out_total numeric not null default 0,
  add column if not exists bet_total numeric not null default 0,
  add column if not exists win_total numeric not null default 0,
  add column if not exists withdraw_total numeric not null default 0;

-- 2) Daily per-device rollup (historical by date).
create table if not exists public.device_daily_stats (
  stat_date date not null,
  device_id text not null references public.devices(device_id) on delete cascade,
  coins_in_amount numeric not null default 0,
  hopper_in_amount numeric not null default 0,
  hopper_out_amount numeric not null default 0,
  bet_amount numeric not null default 0,
  win_amount numeric not null default 0,
  withdrawal_amount numeric not null default 0,
  balance_change numeric not null default 0,
  event_count bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (stat_date, device_id)
);

create index if not exists idx_device_daily_stats_device_id
  on public.device_daily_stats (device_id, stat_date desc);

-- 3) Optional compact event ledger (append-only, lower cardinality if app batches writes).
create table if not exists public.device_metric_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  event_ts timestamptz not null default now(),
  device_id text not null references public.devices(device_id) on delete cascade,
  event_type text not null check (event_type in ('coins_in', 'hopper_in', 'withdrawal', 'bet', 'win')),
  amount numeric not null check (amount >= 0),
  metadata jsonb
);

create index if not exists idx_device_metric_events_device_time
  on public.device_metric_events (device_id, event_ts desc);

create index if not exists idx_device_metric_events_type_time
  on public.device_metric_events (event_type, event_ts desc);

-- 4) Apply a single metric event atomically.
create or replace function public.apply_metric_event(
  p_device_id text,
  p_event_type text,
  p_amount numeric,
  p_event_ts timestamptz default now(),
  p_metadata jsonb default '{}'::jsonb,
  p_write_ledger boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date date := coalesce((p_event_ts at time zone 'utc')::date, (now() at time zone 'utc')::date);
  v_event text := lower(trim(coalesce(p_event_type, '')));
  v_amt numeric := greatest(coalesce(p_amount, 0), 0);
  v_balance_delta numeric := 0;
  v_coins_in numeric := 0;
  v_hopper_in numeric := 0;
  v_hopper_out numeric := 0;
  v_bet numeric := 0;
  v_win numeric := 0;
  v_withdraw numeric := 0;
begin
  if p_device_id is null or trim(p_device_id) = '' then
    raise exception 'p_device_id is required';
  end if;

  if v_amt = 0 then
    return;
  end if;

  if v_event = 'coins_in' then
    v_coins_in := v_amt;
    v_balance_delta := v_amt;
  elsif v_event = 'hopper_in' then
    v_hopper_in := v_amt;
  elsif v_event = 'withdrawal' then
    v_hopper_out := v_amt;
    v_withdraw := v_amt;
    v_balance_delta := -v_amt;
  elsif v_event = 'bet' then
    v_bet := v_amt;
    v_balance_delta := -v_amt;
  elsif v_event = 'win' then
    v_win := v_amt;
    v_balance_delta := v_amt;
  else
    raise exception 'unsupported metric event type: %', p_event_type;
  end if;

  -- Ensure device row exists (if it already exists, this is a no-op).
  insert into public.devices (device_id)
  values (p_device_id)
  on conflict (device_id) do nothing;

  -- Update cumulative counters and live balances.
  update public.devices
  set
    balance = greatest(0, balance + v_balance_delta),
    coins_in_total = coins_in_total + v_coins_in,
    hopper_balance = greatest(0, hopper_balance + v_hopper_in - v_hopper_out),
    hopper_in_total = hopper_in_total + v_hopper_in,
    hopper_out_total = hopper_out_total + v_hopper_out,
    bet_total = bet_total + v_bet,
    win_total = win_total + v_win,
    withdraw_total = withdraw_total + v_withdraw,
    updated_at = now()
  where device_id = p_device_id;

  -- Upsert daily rollup.
  insert into public.device_daily_stats (
    stat_date,
    device_id,
    coins_in_amount,
    hopper_in_amount,
    hopper_out_amount,
    bet_amount,
    win_amount,
    withdrawal_amount,
    balance_change,
    event_count,
    updated_at
  )
  values (
    v_date,
    p_device_id,
    v_coins_in,
    v_hopper_in,
    v_hopper_out,
    v_bet,
    v_win,
    v_withdraw,
    v_balance_delta,
    1,
    now()
  )
  on conflict (stat_date, device_id) do update
  set
    coins_in_amount = device_daily_stats.coins_in_amount + excluded.coins_in_amount,
    hopper_in_amount = device_daily_stats.hopper_in_amount + excluded.hopper_in_amount,
    hopper_out_amount = device_daily_stats.hopper_out_amount + excluded.hopper_out_amount,
    bet_amount = device_daily_stats.bet_amount + excluded.bet_amount,
    win_amount = device_daily_stats.win_amount + excluded.win_amount,
    withdrawal_amount = device_daily_stats.withdrawal_amount + excluded.withdrawal_amount,
    balance_change = device_daily_stats.balance_change + excluded.balance_change,
    event_count = device_daily_stats.event_count + 1,
    updated_at = now();

  if p_write_ledger then
    insert into public.device_metric_events (event_ts, device_id, event_type, amount, metadata)
    values (coalesce(p_event_ts, now()), p_device_id, v_event, v_amt, coalesce(p_metadata, '{}'::jsonb));
  end if;
end;
$$;

-- 5) Batch apply to reduce network + function overhead under bursty input.
create or replace function public.apply_metric_events(
  p_events jsonb,
  p_write_ledger boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
begin
  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    raise exception 'p_events must be a json array';
  end if;

  for v_item in
    select value from jsonb_array_elements(p_events)
  loop
    perform public.apply_metric_event(
      p_device_id := v_item->>'device_id',
      p_event_type := v_item->>'event_type',
      p_amount := coalesce((v_item->>'amount')::numeric, 0),
      p_event_ts := coalesce((v_item->>'event_ts')::timestamptz, now()),
      p_metadata := coalesce(v_item->'metadata', '{}'::jsonb),
      p_write_ledger := p_write_ledger
    );
  end loop;
end;
$$;

-- 6) Global summary views for dashboard.
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
  d.updated_at
from public.devices d;

create or replace view public.global_stats_live as
select
  coalesce(sum(d.balance), 0) as total_balance,
  coalesce(sum(d.coins_in_total), 0) as total_coins_in,
  coalesce(sum(d.hopper_balance), 0) as total_hopper,
  coalesce(sum(d.bet_total), 0) as total_bet_amount,
  coalesce(sum(d.win_total), 0) as total_win_amount,
  coalesce(sum(d.withdraw_total), 0) as total_withdraw_amount,
  count(*)::bigint as device_count,
  now() as generated_at
from public.devices d;

create or replace view public.global_daily_stats as
select
  s.stat_date,
  coalesce(sum(s.coins_in_amount), 0) as total_coins_in,
  coalesce(sum(s.hopper_in_amount), 0) as total_hopper_in,
  coalesce(sum(s.hopper_out_amount), 0) as total_hopper_out,
  coalesce(sum(s.bet_amount), 0) as total_bet_amount,
  coalesce(sum(s.win_amount), 0) as total_win_amount,
  coalesce(sum(s.withdrawal_amount), 0) as total_withdraw_amount,
  coalesce(sum(s.balance_change), 0) as total_balance_change,
  coalesce(sum(s.event_count), 0)::bigint as event_count
from public.device_daily_stats s
group by s.stat_date
order by s.stat_date desc;
