-- Atomic arcade-life purchase RPC.
-- Run in Supabase SQL editor before deploying input-service life gating.

create or replace function public.consume_arcade_life(
  p_device_id text,
  p_game_id text,
  p_player text,
  p_amount numeric,
  p_reason text default 'start',
  p_event_ts timestamptz default now(),
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  ok boolean,
  balance numeric,
  charged_amount numeric,
  reason text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount numeric := round(greatest(coalesce(p_amount, 0), 0), 2);
  v_balance numeric := 0;
  v_rows integer := 0;
  v_date date := coalesce((p_event_ts at time zone 'utc')::date, (now() at time zone 'utc')::date);
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
    'source', 'arcade_life',
    'game_id', coalesce(p_game_id, ''),
    'player', coalesce(p_player, ''),
    'reason', coalesce(p_reason, 'start'),
    'amount', v_amount
  );
begin
  if p_device_id is null or trim(p_device_id) = '' then
    return query select false, 0::numeric, 0::numeric, 'missing_device_id'::text;
    return;
  end if;

  if v_amount <= 0 then
    select d.balance into v_balance
    from public.devices d
    where d.device_id = p_device_id;

    return query select false, coalesce(v_balance, 0)::numeric, 0::numeric, 'invalid_amount'::text;
    return;
  end if;

  insert into public.devices (device_id)
  values (p_device_id)
  on conflict (device_id) do nothing;

  if exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'devices'
      and c.column_name = 'bet_total'
  ) then
    execute
      'update public.devices
       set balance = balance - $1,
           bet_total = coalesce(bet_total, 0) + $1,
           updated_at = now()
       where device_id = $2
         and balance >= $1
       returning balance'
    into v_balance
    using v_amount, p_device_id;
    get diagnostics v_rows = row_count;
  else
    update public.devices
    set balance = balance - v_amount,
        updated_at = now()
    where device_id = p_device_id
      and balance >= v_amount
    returning devices.balance into v_balance;
    get diagnostics v_rows = row_count;
  end if;

  if coalesce(v_rows, 0) = 0 then
    select d.balance into v_balance
    from public.devices d
    where d.device_id = p_device_id;

    return query select false, coalesce(v_balance, 0)::numeric, 0::numeric, 'insufficient_balance'::text;
    return;
  end if;

  if to_regclass('public.device_daily_stats') is not null then
    insert into public.device_daily_stats (
      stat_date,
      device_id,
      bet_amount,
      balance_change,
      event_count,
      updated_at
    )
    values (
      v_date,
      p_device_id,
      v_amount,
      -v_amount,
      1,
      now()
    )
    on conflict (stat_date, device_id) do update
    set
      bet_amount = public.device_daily_stats.bet_amount + excluded.bet_amount,
      balance_change = public.device_daily_stats.balance_change + excluded.balance_change,
      event_count = public.device_daily_stats.event_count + 1,
      updated_at = now();
  end if;

  if to_regclass('public.device_metric_events') is not null then
    insert into public.device_metric_events (event_ts, device_id, event_type, amount, metadata)
    values (coalesce(p_event_ts, now()), p_device_id, 'bet', v_amount, v_meta);
  end if;

  return query select true, v_balance, v_amount, 'charged'::text;
end;
$$;

grant execute on function public.consume_arcade_life(
  text,
  text,
  text,
  numeric,
  text,
  timestamptz,
  jsonb
) to service_role;
