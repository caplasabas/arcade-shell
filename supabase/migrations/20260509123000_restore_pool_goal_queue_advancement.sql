alter table public.casino_runtime
  add column if not exists happy_pool_goal_queue numeric[] not null default '{}',
  add column if not exists happy_pool_goal_queue_index integer not null default 0,
  add column if not exists jackpot_pool_goal_queue numeric[] not null default '{}',
  add column if not exists jackpot_pool_goal_queue_index integer not null default 0;

update public.casino_runtime
set
  happy_pool_goal_queue = case
    when cardinality(coalesce(happy_pool_goal_queue, '{}')) = 0
      and coalesce(prize_pool_goal, 0) > 0
    then array[prize_pool_goal]
    else happy_pool_goal_queue
  end,
  jackpot_pool_goal_queue = case
    when cardinality(coalesce(jackpot_pool_goal_queue, '{}')) = 0
      and coalesce(jackpot_pool_goal, 0) > 0
    then array[jackpot_pool_goal]
    else jackpot_pool_goal_queue
  end,
  happy_pool_goal_queue_index = greatest(coalesce(happy_pool_goal_queue_index, 0), 0),
  jackpot_pool_goal_queue_index = greatest(coalesce(jackpot_pool_goal_queue_index, 0), 0)
where id = true;

create or replace function public.process_pool_goal_queues(
  p_event_ts timestamp with time zone default now()
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_runtime public.casino_runtime;
  v_now timestamptz := coalesce(p_event_ts, now());
  v_happy_reached boolean := false;
  v_jackpot_reached boolean := false;
  v_spin_target bigint := 1000;
  v_time_target integer := 1800;
  v_mode text := 'amount';
  v_happy_goal_queue numeric[] := '{}';
  v_jackpot_goal_queue numeric[] := '{}';
  v_happy_queue_len integer := 0;
  v_jackpot_queue_len integer := 0;
  v_next_happy_queue_index integer := 0;
  v_next_jackpot_queue_index integer := 0;
  v_next_happy_goal numeric := null;
  v_next_jackpot_goal numeric := null;
  v_jackpot_pot_amount numeric := 0;
  v_jackpot_overflow_to_happy numeric := 0;
begin
  select * into v_runtime
  from public.casino_runtime
  where id = true
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'runtime_missing');
  end if;

  select coalesce(array_agg(goal_amount order by ord), '{}')
    into v_happy_goal_queue
  from unnest(coalesce(v_runtime.happy_pool_goal_queue, '{}')) with ordinality as q(goal_amount, ord)
  where goal_amount > 0;

  select coalesce(array_agg(goal_amount order by ord), '{}')
    into v_jackpot_goal_queue
  from unnest(coalesce(v_runtime.jackpot_pool_goal_queue, '{}')) with ordinality as q(goal_amount, ord)
  where goal_amount > 0;

  v_happy_queue_len := cardinality(v_happy_goal_queue);
  v_jackpot_queue_len := cardinality(v_jackpot_goal_queue);

  v_mode := lower(coalesce(v_runtime.pool_goal_mode, 'amount'));
  if v_mode not in ('amount', 'spins', 'time') then
    v_mode := 'amount';
  end if;

  v_spin_target := greatest(coalesce(v_runtime.pool_goal_spins, 1000), 1);
  v_time_target := greatest(coalesce(v_runtime.pool_goal_time_seconds, 1800), 1);

  if v_mode = 'amount' then
    v_happy_reached := v_runtime.prize_pool_balance >= greatest(coalesce(v_runtime.prize_pool_goal, 0), 0)
      and v_runtime.prize_pool_balance > 0;
    v_jackpot_reached := v_runtime.jackpot_pool_balance >= greatest(coalesce(v_runtime.jackpot_pool_goal, 0), 0)
      and v_runtime.jackpot_pool_balance > 0;
  elsif v_mode = 'spins' then
    v_happy_reached := v_runtime.happy_pool_spin_counter >= v_spin_target and v_runtime.prize_pool_balance > 0;
    v_jackpot_reached := v_runtime.jackpot_pool_spin_counter >= v_spin_target and v_runtime.jackpot_pool_balance > 0;
  else
    v_happy_reached := extract(epoch from (v_now - coalesce(v_runtime.happy_pool_goal_anchor_at, v_now))) >= v_time_target
      and v_runtime.prize_pool_balance > 0;
    v_jackpot_reached := extract(epoch from (v_now - coalesce(v_runtime.jackpot_pool_goal_anchor_at, v_now))) >= v_time_target
      and v_runtime.jackpot_pool_balance > 0;
  end if;

  if v_happy_reached then
    insert into public.happy_hour_pots (
      amount_total,
      amount_remaining,
      status,
      goal_mode,
      goal_snapshot,
      created_at
    )
    values (
      greatest(v_runtime.prize_pool_balance, 0),
      greatest(v_runtime.prize_pool_balance, 0),
      'queued',
      v_mode,
      jsonb_build_object(
        'goalAmount', v_runtime.prize_pool_goal,
        'goalSpins', v_spin_target,
        'goalTimeSeconds', v_time_target,
        'triggeredAt', v_now,
        'goalQueueIndex', v_runtime.happy_pool_goal_queue_index,
        'goalQueue', v_happy_goal_queue
      ),
      v_now
    );

    if v_mode = 'amount' and v_happy_queue_len > 0 then
      v_next_happy_queue_index := (greatest(coalesce(v_runtime.happy_pool_goal_queue_index, 0), 0) + 1) % v_happy_queue_len;
      v_next_happy_goal := v_happy_goal_queue[v_next_happy_queue_index + 1];
    else
      v_next_happy_queue_index := greatest(coalesce(v_runtime.happy_pool_goal_queue_index, 0), 0);
      v_next_happy_goal := v_runtime.prize_pool_goal;
    end if;

    update public.casino_runtime
    set
      prize_pool_balance = 0,
      prize_pool_goal = coalesce(v_next_happy_goal, prize_pool_goal),
      happy_pool_goal_queue = v_happy_goal_queue,
      happy_pool_goal_queue_index = v_next_happy_queue_index,
      happy_pool_spin_counter = 0,
      happy_pool_goal_anchor_at = v_now,
      updated_at = now()
    where id = true;
  else
    v_next_happy_goal := v_runtime.prize_pool_goal;
    v_next_happy_queue_index := greatest(coalesce(v_runtime.happy_pool_goal_queue_index, 0), 0);
  end if;

  if v_jackpot_reached then
    v_jackpot_pot_amount := case
      when v_mode = 'amount' then least(
        greatest(coalesce(v_runtime.jackpot_pool_balance, 0), 0),
        greatest(coalesce(v_runtime.jackpot_pool_goal, 0), 0)
      )
      else greatest(coalesce(v_runtime.jackpot_pool_balance, 0), 0)
    end;

    v_jackpot_overflow_to_happy := case
      when v_mode = 'amount' then greatest(coalesce(v_runtime.jackpot_pool_balance, 0) - v_jackpot_pot_amount, 0)
      else 0
    end;

    insert into public.jackpot_pots (
      amount_total,
      amount_remaining,
      status,
      goal_mode,
      goal_snapshot,
      created_at
    )
    values (
      v_jackpot_pot_amount,
      v_jackpot_pot_amount,
      'queued',
      v_mode,
      jsonb_build_object(
        'goalAmount', v_runtime.jackpot_pool_goal,
        'goalSpins', v_spin_target,
        'goalTimeSeconds', v_time_target,
        'triggeredAt', v_now,
        'goalQueueIndex', v_runtime.jackpot_pool_goal_queue_index,
        'goalQueue', v_jackpot_goal_queue,
        'overflowToHappyPool', v_jackpot_overflow_to_happy
      ),
      v_now
    );

    if v_mode = 'amount' and v_jackpot_queue_len > 0 then
      v_next_jackpot_queue_index := (greatest(coalesce(v_runtime.jackpot_pool_goal_queue_index, 0), 0) + 1) % v_jackpot_queue_len;
      v_next_jackpot_goal := v_jackpot_goal_queue[v_next_jackpot_queue_index + 1];
    else
      v_next_jackpot_queue_index := greatest(coalesce(v_runtime.jackpot_pool_goal_queue_index, 0), 0);
      v_next_jackpot_goal := v_runtime.jackpot_pool_goal;
    end if;

    update public.casino_runtime
    set
      jackpot_pool_balance = 0,
      prize_pool_balance = greatest(coalesce(prize_pool_balance, 0) + v_jackpot_overflow_to_happy, 0),
      jackpot_pool_goal = coalesce(v_next_jackpot_goal, jackpot_pool_goal),
      jackpot_pool_goal_queue = v_jackpot_goal_queue,
      jackpot_pool_goal_queue_index = v_next_jackpot_queue_index,
      jackpot_pool_spin_counter = 0,
      jackpot_pool_goal_anchor_at = v_now,
      updated_at = now()
    where id = true;
  else
    v_next_jackpot_goal := v_runtime.jackpot_pool_goal;
    v_next_jackpot_queue_index := greatest(coalesce(v_runtime.jackpot_pool_goal_queue_index, 0), 0);
  end if;

  return jsonb_build_object(
    'ok', true,
    'mode', v_mode,
    'happyReached', v_happy_reached,
    'jackpotReached', v_jackpot_reached,
    'happyGoal', v_next_happy_goal,
    'happyGoalQueueIndex', v_next_happy_queue_index,
    'jackpotGoal', v_next_jackpot_goal,
    'jackpotGoalQueueIndex', v_next_jackpot_queue_index,
    'jackpotOverflowToHappyPool', v_jackpot_overflow_to_happy
  );
end;
$$;

with normalized as (
  select
    coalesce(array_agg(goal_amount order by ord), '{}') as goal_queue,
    cardinality(coalesce(array_agg(goal_amount order by ord), '{}')) as queue_len,
    greatest(coalesce(max(r.jackpot_pool_goal_queue_index), 0), 0) as current_index,
    max(r.jackpot_pool_goal) as current_goal,
    max(r.jackpot_pool_goal_anchor_at) as goal_anchor_at
  from public.casino_runtime r
  cross join unnest(coalesce(r.jackpot_pool_goal_queue, '{}')) with ordinality as q(goal_amount, ord)
  where r.id = true
    and goal_amount > 0
),
candidate as (
  select
    goal_queue,
    queue_len,
    case
      when queue_len > 0 then current_index % queue_len
      else 0
    end as current_index,
    current_goal,
    goal_anchor_at
  from normalized
)
update public.casino_runtime r
set
  jackpot_pool_goal_queue = c.goal_queue,
  jackpot_pool_goal_queue_index = (c.current_index + 1) % c.queue_len,
  jackpot_pool_goal = c.goal_queue[((c.current_index + 1) % c.queue_len) + 1],
  updated_at = now()
from candidate c
where r.id = true
  and c.queue_len > 0
  and c.goal_queue[c.current_index + 1] = c.current_goal
  and exists (
    select 1
    from public.jackpot_pots p
    where p.created_at >= coalesce(c.goal_anchor_at, p.created_at) - interval '10 seconds'
      and p.goal_snapshot ? 'goalAmount'
      and (p.goal_snapshot ->> 'goalAmount') ~ '^[0-9]+(\.[0-9]+)?$'
      and (p.goal_snapshot ->> 'goalAmount')::numeric = c.current_goal
  );

alter function public.process_pool_goal_queues(timestamp with time zone) owner to postgres;
grant all on function public.process_pool_goal_queues(timestamp with time zone) to anon;
grant all on function public.process_pool_goal_queues(timestamp with time zone) to authenticated;
grant all on function public.process_pool_goal_queues(timestamp with time zone) to service_role;
