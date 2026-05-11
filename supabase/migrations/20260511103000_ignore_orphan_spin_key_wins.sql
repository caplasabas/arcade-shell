create or replace function public.apply_metric_events(
  p_events jsonb,
  p_write_ledger boolean default true
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_item jsonb;
  v_device_id text;
  v_event_type text;
  v_spin_key text;
  v_has_matching_spin boolean;
  v_amount numeric;
  v_is_free_game boolean;
begin
  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    raise exception 'p_events must be a json array';
  end if;

  for v_item in
    select value from jsonb_array_elements(p_events)
  loop
    v_device_id := nullif(trim(coalesce(v_item->>'device_id', '')), '');
    v_event_type := lower(trim(coalesce(v_item->>'event_type', '')));
    v_spin_key := nullif(trim(coalesce(v_item->'metadata'->>'spinKey', '')), '');
    v_amount := greatest(coalesce((v_item->>'amount')::numeric, 0), 0);
    v_is_free_game := false;

    if v_item->'metadata' ? 'isFreeGame' then
      begin
        v_is_free_game := coalesce((v_item->'metadata'->>'isFreeGame')::boolean, false);
      exception when others then
        v_is_free_game := false;
      end;
    end if;

    if v_event_type = 'spin' and v_amount <= 0 and not v_is_free_game then
      raise exception 'paid spin amount must be greater than zero'
        using errcode = '22023';
    end if;

    if v_event_type = 'win'
      and v_spin_key is not null
      and coalesce(v_item->'metadata'->>'clientApp', '') = 'ultra-ace-web'
    then
      select exists (
        select 1
        from public.device_spin_event_dedup d
        where d.device_id = v_device_id
          and d.spin_key = v_spin_key
          and d.event_type = 'spin'
      ) or exists (
        select 1
        from jsonb_array_elements(p_events) sibling(value)
        where nullif(trim(coalesce(sibling.value->>'device_id', '')), '') = v_device_id
          and lower(trim(coalesce(sibling.value->>'event_type', ''))) = 'spin'
          and nullif(trim(coalesce(sibling.value->'metadata'->>'spinKey', '')), '') = v_spin_key
      )
      into v_has_matching_spin;

      if not coalesce(v_has_matching_spin, false) then
        continue;
      end if;
    end if;

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

alter function public.apply_metric_events(jsonb, boolean) owner to postgres;
grant all on function public.apply_metric_events(jsonb, boolean) to anon;
grant all on function public.apply_metric_events(jsonb, boolean) to authenticated;
grant all on function public.apply_metric_events(jsonb, boolean) to service_role;
