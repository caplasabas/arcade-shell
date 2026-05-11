CREATE OR REPLACE FUNCTION public.return_happy_override_win_overflow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_overflow numeric := greatest(coalesce(new.requested_amount, 0) - coalesce(new.accepted_amount, 0), 0);
  v_releasable numeric := 0;
  v_override public.device_happy_hour_overrides%rowtype;
begin
  if v_overflow <= 0.0001 or coalesce(new.override_paid_amount, 0) <= 0 then
    return new;
  end if;

  select *
    into v_override
  from public.device_happy_hour_overrides
  where id = new.override_id
  for update;

  if not found then
    return new;
  end if;

  v_releasable := least(v_overflow, greatest(coalesce(v_override.amount_remaining, 0), 0));

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
      'lastOverflowReturnedToHappyPool', v_releasable,
      'lastOverflowReturnedAt', coalesce(new.event_ts, now())
    )
  where id = new.override_id
  returning * into v_override;

  update public.casino_runtime
  set
    prize_pool_balance = greatest(coalesce(prize_pool_balance, 0) + v_releasable, 0),
    updated_at = now()
  where id = true;

  new.override_remaining_after := greatest(coalesce(new.override_remaining_after, 0) - v_releasable, 0);
  new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
    'happyOverrideOverflowReturnedToPool', v_releasable,
    'happyOverrideOverflowPool', 'happy',
    'happyOverrideRemainingAfterOverflowReturn', new.override_remaining_after
  );

  return new;
end;
$$;

DROP TRIGGER IF EXISTS trg_return_happy_override_win_overflow ON public.device_happy_hour_override_wins;

CREATE TRIGGER trg_return_happy_override_win_overflow
BEFORE INSERT ON public.device_happy_hour_override_wins
FOR EACH ROW
EXECUTE FUNCTION public.return_happy_override_win_overflow();
