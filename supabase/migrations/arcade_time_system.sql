-- =========================================
-- 1. DEVICE SCHEMA (TIME-BASED SYSTEM)
-- =========================================

alter table public.devices
    add column if not exists arcade_time_ms               bigint not null default 0,
    add column if not exists arcade_time_updated_at       timestamptz,
    add column if not exists arcade_session_started_at    timestamptz,
    add column if not exists arcade_time_last_deducted_at timestamptz;

-- =========================================
-- 2. BUY → TIME CONVERSION (MODIFY RPC)
-- =========================================

-- ⚠️ REQUIRED: drop old function first (signature match)
drop function if exists public.buy_arcade_credit(text, text);

create function public.buy_arcade_credit(
    p_device_id text,
    p_game_id text
)
    returns table
            (
                ok             boolean,
                arcade_credit  integer,
                balance        numeric,
                price          numeric,
                arcade_balance numeric,
                arcade_time_ms bigint
            )
    language plpgsql
    security definer
    set search_path = public
as
$$
declare
    v_price          numeric := null;
    v_arcade_balance numeric := 0;
    v_arcade_time_ms bigint  := 0;
    v_purchase_time_ms bigint := 600000;
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
    set balance                  = d.balance - v_price,

        -- backward compatibility (safe to remove later)
        arcade_credit            = coalesce(d.arcade_credit, 0) + 1,

        -- ✅ time system
        arcade_time_ms           = coalesce(d.arcade_time_ms, 0) + v_purchase_time_ms,
        arcade_time_updated_at   = now(),

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

    if to_regclass('public.arcade_metrics') is not null then
        update public.arcade_metrics m
        set arcade_balance = coalesce(m.arcade_balance, 0) + v_price
        where m.id = 1
        returning coalesce(m.arcade_balance, 0) into v_arcade_balance;
    end if;

    return query
        select true,
               coalesce(arcade_credit, 0),
               coalesce(balance, 0),
               v_price,
               coalesce(v_arcade_balance, 0),
               coalesce(v_arcade_time_ms, 0);
end;
$$;


-- =========================================
-- 3. SESSION LIFECYCLE RPCs
-- =========================================

-- Start session
create or replace function public.start_arcade_session(p_device_id text)
    returns void
    language plpgsql
    security definer
as
$$
begin
    update public.devices
    set arcade_session_started_at    = now(),
        arcade_time_last_deducted_at = now()
    where device_id = p_device_id;
end;
$$;


-- End session (pause/exit)
create or replace function public.stop_arcade_session(p_device_id text)
    returns void
    language plpgsql
    security definer
as
$$
begin
    update public.devices
    set arcade_session_started_at    = null,
        arcade_time_last_deducted_at = null
    where device_id = p_device_id;
end;
$$;


-- =========================================
-- 4. DEDUCTION LOGIC (ATOMIC, SAFE)
-- =========================================

create or replace function public.deduct_arcade_time(
    p_device_id text,
    p_elapsed_ms bigint
)
    returns table
            (
                ok           boolean,
                remaining_ms bigint
            )
    language plpgsql
    security definer
as
$$
declare
    v_remaining bigint := 0;
    v_deduct    bigint := greatest(coalesce(p_elapsed_ms, 0), 0);
begin
    update public.devices d
    set arcade_time_ms               = greatest(0, d.arcade_time_ms - v_deduct),
        arcade_time_last_deducted_at = now()
    where d.device_id = p_device_id
    returning arcade_time_ms into v_remaining;

    if not found then
        return query select false, 0::bigint;
        return;
    end if;

    return query select true, coalesce(v_remaining, 0);
end;
$$;


-- =========================================
-- 5. OPTIONAL: INDEX (performance)
-- =========================================

create index if not exists idx_devices_arcade_session_active
    on public.devices (arcade_session_started_at)
    where arcade_session_started_at is not null;
