create or replace function public.handoff_device_jackpot_queue(
  p_device_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.jackpot_payout_queue;
  v_replacement_device_id text;
  v_handed_off integer := 0;
  v_unmoved integer := 0;
begin
  if p_device_id is null or trim(p_device_id) = '' then
    return jsonb_build_object('ok', false, 'reason', 'missing_device_id');
  end if;

  for v_row in
    select q.*
    from public.jackpot_payout_queue q
    where q.device_id = p_device_id
      and q.completed_at is null
      and q.payout_ready_at is null
    order by q.created_at asc, q.id asc
  loop
    select d.device_id
      into v_replacement_device_id
    from public.devices d
    where d.device_id <> p_device_id
      and d.device_status = 'playing'
      and public.should_count_device_activity(d.deployment_mode, d.device_status, d.last_seen_at, now())
    order by random()
    limit 1;

    if v_replacement_device_id is null then
      v_unmoved := v_unmoved + 1;
      continue;
    end if;

    update public.jackpot_payout_queue
    set
      device_id = v_replacement_device_id,
      updated_at = now()
    where id = v_row.id;

    update public.jackpot_payout_plan_steps
    set
      device_id = v_replacement_device_id
    where queue_id = v_row.id
      and consumed_at is null;

    v_handed_off := v_handed_off + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'device_id', p_device_id,
    'handed_off_count', v_handed_off,
    'unmoved_count', v_unmoved
  );
end;
$$;

create or replace function public.handle_device_maintenance_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
    and coalesce(old.deployment_mode, 'online') <> 'maintenance'
    and coalesce(new.deployment_mode, 'online') = 'maintenance' then
    perform public.handoff_device_jackpot_queue(new.device_id);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_handoff_jackpot_queue_on_maintenance on public.devices;

create trigger trg_handoff_jackpot_queue_on_maintenance
after update of deployment_mode on public.devices
for each row
execute function public.handle_device_maintenance_transition();
