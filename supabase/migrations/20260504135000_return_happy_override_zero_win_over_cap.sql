CREATE OR REPLACE FUNCTION public.return_happy_override_over_cap_win()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_releasable numeric := 0;
  v_override public.device_happy_hour_overrides%rowtype;
begin
  if lower(coalesce(new.funding_source, '')) not in ('device_happy_override', 'dashboard_device_happy_override', 'happy_override') then
    return new;
  end if;

  if coalesce(new.over_amount, 0) <= 0.0001 then
    return new;
  end if;

  select *
    into v_override
  from public.device_happy_hour_overrides
  where device_id = new.device_id
    and status = 'active'
    and amount_remaining > 0
  order by created_at desc, id desc
  limit 1
  for update;

  if not found then
    return new;
  end if;

  v_releasable := least(greatest(coalesce(new.over_amount, 0), 0), greatest(coalesce(v_override.amount_remaining, 0), 0));

  if v_releasable <= 0.0001 then
    return new;
  end if;

  update public.device_happy_hour_overrides
  set
    amount_remaining = greatest(0, amount_remaining - v_releasable),
    status = case
      when greatest(0, amount_remaining - v_releasable) <= 0 then 'completed'
      else status
    end,
    completed_at = case
      when greatest(0, amount_remaining - v_releasable) <= 0 then coalesce(completed_at, new.event_ts, now())
      else completed_at
    end,
    updated_at = now(),
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'lastOverCapReturnedToHappyPool', v_releasable,
      'lastOverCapReturnedAt', coalesce(new.event_ts, now())
    )
  where id = v_override.id
  returning * into v_override;

  update public.casino_runtime
  set
    prize_pool_balance = greatest(coalesce(prize_pool_balance, 0) + v_releasable, 0),
    updated_at = now()
  where id = true;

  new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
    'happyOverrideOverCapReturnedToPool', v_releasable,
    'happyOverrideOverCapPool', 'happy',
    'happyOverrideId', v_override.id,
    'happyOverrideRemainingAfterOverCapReturn', greatest(coalesce(v_override.amount_remaining, 0), 0)
  );

  return new;
end;
$$;

DROP TRIGGER IF EXISTS trg_return_happy_override_over_cap_win ON public.over_cap_win_events;

CREATE TRIGGER trg_return_happy_override_over_cap_win
BEFORE INSERT ON public.over_cap_win_events
FOR EACH ROW
EXECUTE FUNCTION public.return_happy_override_over_cap_win();
