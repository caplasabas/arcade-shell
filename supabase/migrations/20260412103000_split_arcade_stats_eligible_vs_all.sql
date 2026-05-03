create table if not exists public.device_arcade_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  event_ts timestamptz not null default now(),
  device_id text not null references public.devices(device_id) on delete cascade,
  event_type text not null,
  amount numeric not null default 0,
  credit_delta integer not null default 0,
  time_ms_delta bigint not null default 0,
  deployment_mode text not null default 'online',
  device_status text not null default 'offline',
  counts_toward_global boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  constraint device_arcade_events_event_type_check check (
    event_type = any (
      array[
        'credit_purchase'::text,
        'time_purchase'::text,
        'credit_consume'::text,
        'time_consume'::text
      ]
    )
  )
);

create index if not exists idx_device_arcade_events_device_time
  on public.device_arcade_events (device_id, event_ts desc, id desc);

create index if not exists idx_device_arcade_events_global_time
  on public.device_arcade_events (counts_toward_global, event_ts desc);

create or replace function public.record_device_arcade_event(
  p_device_id text,
  p_event_type text,
  p_amount numeric default 0,
  p_credit_delta integer default 0,
  p_time_ms_delta bigint default 0,
  p_event_ts timestamptz default now(),
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_ts timestamptz := coalesce(p_event_ts, now());
  v_deployment_mode text := 'online';
  v_effective_device_status text := 'offline';
  v_counts_toward_global boolean := false;
begin
  if p_device_id is null or trim(p_device_id) = '' then
    return;
  end if;

  insert into public.devices (device_id)
  values (p_device_id)
  on conflict (device_id) do nothing;

  select
    coalesce(nullif(trim(d.deployment_mode), ''), 'online'),
    public.resolve_device_presence_status(d.device_status, d.last_seen_at, v_event_ts),
    public.should_count_device_activity(d.deployment_mode, d.device_status, d.last_seen_at, v_event_ts)
    into v_deployment_mode, v_effective_device_status, v_counts_toward_global
  from public.devices d
  where d.device_id = p_device_id;

  insert into public.device_arcade_events (
    event_ts,
    device_id,
    event_type,
    amount,
    credit_delta,
    time_ms_delta,
    deployment_mode,
    device_status,
    counts_toward_global,
    metadata
  )
  values (
    v_event_ts,
    p_device_id,
    lower(trim(coalesce(p_event_type, ''))),
    coalesce(p_amount, 0),
    coalesce(p_credit_delta, 0),
    coalesce(p_time_ms_delta, 0),
    v_deployment_mode,
    v_effective_device_status,
    v_counts_toward_global,
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

create or replace function public.buy_arcade_credit(
  p_device_id text,
  p_amount integer default 1
)
returns table(ok boolean, arcade_credit integer, balance numeric, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount integer := greatest(coalesce(p_amount, 0), 0);
  v_price numeric := 10;
  v_balance numeric := 0;
  v_event_ts timestamptz := now();
begin
  if p_device_id is null or trim(p_device_id) = '' then
    return query select false, 0::integer, 0::numeric, 'missing_device_id'::text;
    return;
  end if;

  if v_amount <= 0 then
    return query select false, 0::integer, 0::numeric, 'invalid_amount'::text;
    return;
  end if;

  select d.balance
    into v_balance
  from public.devices d
  where d.device_id = p_device_id
  for update;

  if not found then
    return query select false, 0::integer, 0::numeric, 'device_not_found'::text;
    return;
  end if;

  if coalesce(v_balance, 0) < v_price then
    return query
    select false, 0::integer, coalesce(v_balance, 0), 'insufficient_balance'::text;
    return;
  end if;

  update public.devices d
  set
    balance = d.balance - v_price,
    arcade_credit = coalesce(d.arcade_credit, 0) + v_amount,
    arcade_credit_updated_at = now()
  where d.device_id = p_device_id
  returning coalesce(d.arcade_credit, 0), d.balance
    into arcade_credit, balance;

  perform public.record_device_arcade_event(
    p_device_id := p_device_id,
    p_event_type := 'credit_purchase',
    p_amount := v_price,
    p_credit_delta := v_amount,
    p_event_ts := v_event_ts,
    p_metadata := jsonb_build_object('source', 'buy_arcade_credit_amount')
  );

  return query
  select true, coalesce(arcade_credit, 0), coalesce(balance, 0), 'credited'::text;
end;
$$;

create or replace function public.buy_arcade_credit(
  p_device_id text,
  p_game_id text
)
returns table(ok boolean, arcade_credit integer, balance numeric, price numeric, arcade_balance numeric, arcade_time_ms bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_price numeric := null;
    v_arcade_balance numeric := 0;
    v_arcade_time_ms bigint := 0;
    v_purchase_time_ms bigint := 600000;
    v_event_ts timestamptz := now();
begin
    if p_device_id is null or trim(p_device_id) = '' then
        return query select false, 0::integer, 0::numeric, 0::numeric, 0::numeric, 0::bigint;
        return;
    end if;

    select g.price
    into v_price
    from public.games g
    where g.id = p_game_id
      and g.type = 'arcade'
      and g.enabled = true
    limit 1;

    if v_price is null then
        return query select false, 0::integer, 0::numeric, 0::numeric, 0::numeric, 0::bigint;
        return;
    end if;

    update public.devices d
    set balance = d.balance - v_price,
        arcade_credit = coalesce(d.arcade_credit, 0) + 1,
        arcade_total = coalesce(d.arcade_total, 0) + v_price,
        arcade_time_ms = coalesce(d.arcade_time_ms, 0) + v_purchase_time_ms,
        arcade_time_updated_at = now(),
        arcade_credit_updated_at = now()
    where d.device_id = p_device_id
      and d.balance >= v_price
    returning
        coalesce(d.arcade_credit, 0),
        d.balance,
        coalesce(d.arcade_time_ms, 0)
    into arcade_credit, balance, v_arcade_time_ms;

    if not found then
        return query select false, 0::integer, 0::numeric, v_price, 0::numeric, 0::bigint;
        return;
    end if;

    insert into public.arcade_metrics (id, arcade_balance)
    values (1, 0)
    on conflict (id) do nothing;

    update public.arcade_metrics m
    set arcade_balance = coalesce(m.arcade_balance, 0) + v_price,
        updated_at = now()
    where m.id = 1
    returning coalesce(m.arcade_balance, 0) into v_arcade_balance;

    perform public.record_device_arcade_event(
      p_device_id := p_device_id,
      p_event_type := 'time_purchase',
      p_amount := v_price,
      p_credit_delta := 1,
      p_time_ms_delta := v_purchase_time_ms,
      p_event_ts := v_event_ts,
      p_metadata := jsonb_build_object('source', 'buy_arcade_credit_game', 'game_id', p_game_id)
    );

    return query
        select true,
               coalesce(arcade_credit, 0),
               coalesce(balance, 0),
               v_price,
               coalesce(v_arcade_balance, 0),
               coalesce(v_arcade_time_ms, 0);
end;
$$;

create or replace function public.consume_arcade_credit(
  p_device_id text
)
returns table(ok boolean, arcade_credit integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_credit integer := 0;
  v_event_ts timestamptz := now();
begin
  update public.devices d
  set
    arcade_credit = coalesce(d.arcade_credit, 0) - 1,
    arcade_credit_updated_at = now()
  where d.device_id = p_device_id
    and coalesce(d.arcade_credit, 0) > 0
  returning coalesce(d.arcade_credit, 0) into v_credit;

  if not found then
    return query select false, 0::integer;
    return;
  end if;

  perform public.record_device_arcade_event(
    p_device_id := p_device_id,
    p_event_type := 'credit_consume',
    p_credit_delta := -1,
    p_event_ts := v_event_ts,
    p_metadata := jsonb_build_object('source', 'consume_arcade_credit')
  );

  return query select true, coalesce(v_credit, 0);
end;
$$;

create or replace function public.deduct_arcade_time(
  p_device_id text,
  p_elapsed_ms bigint
)
returns table(ok boolean, remaining_ms bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_remaining bigint := 0;
    v_deduct bigint := greatest(coalesce(p_elapsed_ms, 0), 0);
    v_event_ts timestamptz := now();
begin
    update public.devices d
    set arcade_time_ms = greatest(0, d.arcade_time_ms - v_deduct),
        arcade_time_last_deducted_at = now()
    where d.device_id = p_device_id
    returning arcade_time_ms into v_remaining;

    if not found then
        return query select false, 0::bigint;
        return;
    end if;

    if v_deduct > 0 then
      perform public.record_device_arcade_event(
        p_device_id := p_device_id,
        p_event_type := 'time_consume',
        p_time_ms_delta := -v_deduct,
        p_event_ts := v_event_ts,
        p_metadata := jsonb_build_object('source', 'deduct_arcade_time')
      );
    end if;

    return query select true, coalesce(v_remaining, 0);
end;
$$;

drop view if exists public.devices_dashboard_live;
drop view if exists public.device_stats_live;
drop view if exists public.device_accounting_totals;

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
), arcade as (
  select
    e.device_id,
    coalesce(sum(case when e.counts_toward_global then e.amount else 0 end), 0::numeric) as eligible_arcade_total,
    coalesce(sum(case when e.counts_toward_global then e.credit_delta else 0 end), 0)::integer as eligible_arcade_credit,
    coalesce(sum(case when e.counts_toward_global then e.time_ms_delta else 0 end), 0)::bigint as eligible_arcade_time_ms
  from public.device_arcade_events e
  group by e.device_id
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
  coalesce(i.eligible_jackpot_win_total, 0::numeric) as eligible_jackpot_win_total,
  coalesce(a.eligible_arcade_total, 0::numeric) as eligible_arcade_total,
  coalesce(a.eligible_arcade_credit, 0)::integer as eligible_arcade_credit,
  coalesce(a.eligible_arcade_time_ms, 0)::bigint as eligible_arcade_time_ms
from public.devices d
left join included i on i.device_id = d.device_id
left join arcade a on a.device_id = d.device_id;

create or replace view public.device_stats_live as
select
  d.device_id,
  (case when d.deployment_mode = 'online' then coalesce(t.eligible_balance, 0::numeric) else d.balance end)::numeric(14,2) as balance,
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
  case when d.last_seen_at is null or d.last_seen_at < (now() - interval '90 seconds') then 'offline'::text else d.device_status end as device_status,
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
  case when d.deployment_mode = 'online' then coalesce(t.eligible_arcade_credit, 0)::integer else d.arcade_credit end as arcade_credit,
  d.arcade_credit_updated_at,
  case when d.deployment_mode = 'online' then coalesce(t.eligible_arcade_time_ms, 0)::bigint else d.arcade_time_ms end as arcade_time_ms,
  d.arcade_time_updated_at,
  d.arcade_session_started_at,
  d.arcade_time_last_deducted_at,
  case when d.deployment_mode = 'online' then coalesce(t.eligible_arcade_total, 0::numeric) else d.arcade_total end as arcade_total,
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
  coalesce(t.eligible_arcade_total, 0::numeric) as eligible_arcade_total,
  coalesce(t.eligible_arcade_credit, 0)::integer as eligible_arcade_credit,
  coalesce(t.eligible_arcade_time_ms, 0)::bigint as eligible_arcade_time_ms,
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
  d.jackpot_win_total as all_jackpot_win_total,
  d.arcade_total as all_arcade_total,
  d.arcade_credit as all_arcade_credit,
  d.arcade_time_ms as all_arcade_time_ms
from public.devices d
left join public.device_accounting_totals t on t.device_id = d.device_id;

create or replace view public.devices_dashboard_live as
select
  d.id,
  d.device_id,
  d.name,
  d.created_at,
  d.updated_at,
  (case when d.deployment_mode = 'online' then coalesce(t.eligible_balance, 0::numeric) else d.balance end)::numeric(14,2) as balance,
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
  case when d.last_seen_at is null or d.last_seen_at < now() - interval '90 seconds' then 'offline'::text else d.device_status end as device_status,
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
  case when d.deployment_mode = 'online' then coalesce(t.eligible_arcade_total, 0::numeric) else d.arcade_total end as arcade_total,
  d.deployment_mode,
  d.current_game_type,
  d.last_seen_at,
  d.last_activity_at,
  d.withdraw_enabled,
  case when d.deployment_mode = 'online' then coalesce(t.eligible_arcade_credit, 0)::integer else d.arcade_credit end as arcade_credit,
  d.arcade_credit_updated_at,
  case when d.deployment_mode = 'online' then coalesce(t.eligible_arcade_time_ms, 0)::bigint else d.arcade_time_ms end as arcade_time_ms,
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
  coalesce(t.eligible_arcade_total, 0::numeric) as eligible_arcade_total,
  coalesce(t.eligible_arcade_credit, 0)::integer as eligible_arcade_credit,
  coalesce(t.eligible_arcade_time_ms, 0)::bigint as eligible_arcade_time_ms,
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
  d.jackpot_win_total as all_jackpot_win_total,
  d.arcade_total as all_arcade_total,
  d.arcade_credit as all_arcade_credit,
  d.arcade_time_ms as all_arcade_time_ms
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

grant all on table public.device_arcade_events to anon;
grant all on table public.device_arcade_events to authenticated;
grant all on table public.device_arcade_events to service_role;

grant all on function public.record_device_arcade_event(text, text, numeric, integer, bigint, timestamptz, jsonb) to anon;
grant all on function public.record_device_arcade_event(text, text, numeric, integer, bigint, timestamptz, jsonb) to authenticated;
grant all on function public.record_device_arcade_event(text, text, numeric, integer, bigint, timestamptz, jsonb) to service_role;
