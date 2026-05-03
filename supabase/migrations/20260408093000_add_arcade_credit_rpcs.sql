create or replace function "public"."buy_arcade_credit"(
  "p_device_id" "text",
  "p_amount" integer default 1
) returns table("ok" boolean, "arcade_credit" integer, "balance" numeric, "reason" "text")
    language "plpgsql"
    security definer
    set "search_path" to 'public'
as $$
declare
  v_amount integer := greatest(coalesce(p_amount, 0), 0);
  v_price numeric := 10;
  v_balance numeric := 0;
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

  return query
  select true, coalesce(arcade_credit, 0), coalesce(balance, 0), 'credited'::text;
end;
$$;

alter function "public"."buy_arcade_credit"("p_device_id" "text", integer) owner to "postgres";


create or replace function "public"."buy_arcade_credit"(
  "p_device_id" "text",
  "p_game_id" "text"
) returns table(
  "ok" boolean,
  "arcade_credit" integer,
  "balance" numeric,
  "price" numeric,
  "arcade_balance" numeric
)
    language "plpgsql"
    security definer
    set "search_path" to 'public'
as $$
declare
  v_price numeric := null;
  v_arcade_balance numeric := 0;
begin
  if p_device_id is null or trim(p_device_id) = '' then
    return query select false, 0::integer, 0::numeric, 0::numeric, 0::numeric;
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
    return query select false, 0::integer, 0::numeric, 0::numeric, 0::numeric;
    return;
  end if;

  update public.devices d
  set
    balance = d.balance - v_price,
    arcade_credit = coalesce(d.arcade_credit, 0) + 1,
    arcade_credit_updated_at = now()
  where d.device_id = p_device_id
    and d.balance >= v_price
  returning coalesce(d.arcade_credit, 0), d.balance
    into arcade_credit, balance;

  if not found then
    return query select false, 0::integer, 0::numeric, v_price, 0::numeric;
    return;
  end if;

  if to_regclass('public.arcade_metrics') is not null then
    update public.arcade_metrics m
    set arcade_balance = coalesce(m.arcade_balance, 0) + v_price
    where m.id = 1
    returning coalesce(m.arcade_balance, 0) into v_arcade_balance;
  end if;

  return query
  select true, coalesce(arcade_credit, 0), coalesce(balance, 0), v_price, coalesce(v_arcade_balance, 0);
end;
$$;

alter function "public"."buy_arcade_credit"("p_device_id" "text", "p_game_id" "text") owner to "postgres";


create or replace function "public"."consume_arcade_credit"(
  "p_device_id" "text"
) returns table("ok" boolean, "arcade_credit" integer)
    language "plpgsql"
    security definer
    set "search_path" to 'public'
as $$
declare
  v_credit integer := 0;
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

  return query select true, coalesce(v_credit, 0);
end;
$$;

alter function "public"."consume_arcade_credit"("p_device_id" "text") owner to "postgres";


grant all on function "public"."buy_arcade_credit"("p_device_id" "text", integer) to "anon";
grant all on function "public"."buy_arcade_credit"("p_device_id" "text", integer) to "authenticated";
grant all on function "public"."buy_arcade_credit"("p_device_id" "text", integer) to "service_role";

grant all on function "public"."buy_arcade_credit"("p_device_id" "text", "p_game_id" "text") to "anon";
grant all on function "public"."buy_arcade_credit"("p_device_id" "text", "p_game_id" "text") to "authenticated";
grant all on function "public"."buy_arcade_credit"("p_device_id" "text", "p_game_id" "text") to "service_role";

grant all on function "public"."consume_arcade_credit"("p_device_id" "text") to "anon";
grant all on function "public"."consume_arcade_credit"("p_device_id" "text") to "authenticated";
grant all on function "public"."consume_arcade_credit"("p_device_id" "text") to "service_role";
