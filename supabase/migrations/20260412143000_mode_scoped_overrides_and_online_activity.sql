create or replace function public.post_bulk_device_admin_ledger_entry(
  p_target text,
  p_entry_kind text,
  p_amount numeric,
  p_account_name text,
  p_device_ids text[] default null,
  p_notes text default null,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target text := lower(trim(coalesce(p_target, '')));
  v_kind text := lower(trim(coalesce(p_entry_kind, '')));
  v_requested numeric := greatest(coalesce(p_amount, 0), 0);
  v_device_ids text[];
  v_device_id text;
  v_result jsonb;
  v_target_count integer := 0;
  v_processed_count integer := 0;
  v_total_applied numeric := 0;
begin
  if v_target not in ('accounting_balance', 'hopper_balance') then
    raise exception 'unsupported target: %', p_target;
  end if;

  if v_kind not in ('debit', 'credit') then
    raise exception 'unsupported entry kind: %', p_entry_kind;
  end if;

  if v_requested <= 0 then
    raise exception 'amount must be > 0';
  end if;

  if coalesce(trim(p_account_name), '') = '' then
    raise exception 'account_name is required';
  end if;

  select coalesce(array_agg(d.device_id order by d.device_id), array[]::text[])
  into v_device_ids
  from (
    select distinct trim(device_id) as device_id
    from public.devices
    where trim(coalesce(device_id, '')) <> ''
      and (
        coalesce(array_length(p_device_ids, 1), 0) = 0
        or device_id = any(p_device_ids)
      )
  ) d;

  v_target_count := coalesce(array_length(v_device_ids, 1), 0);

  if v_target_count = 0 then
    raise exception 'No target devices found';
  end if;

  foreach v_device_id in array v_device_ids
  loop
    v_result := public.post_device_admin_ledger_entry(
      p_device_id := v_device_id,
      p_target := v_target,
      p_entry_kind := v_kind,
      p_amount := v_requested,
      p_account_name := p_account_name,
      p_notes := p_notes,
      p_metadata := p_metadata
    );

    v_processed_count := v_processed_count + 1;
    v_total_applied := v_total_applied + coalesce((v_result->>'amount')::numeric, 0);
  end loop;

  return jsonb_build_object(
    'ok', true,
    'target', v_target,
    'entry_kind', v_kind,
    'target_count', v_target_count,
    'processed_count', v_processed_count,
    'amount_per_device', v_requested,
    'total_applied', v_total_applied
  );
end;
$$;

create or replace function public.post_device_admin_ledger_entry(
  p_device_id text,
  p_target text,
  p_entry_kind text,
  p_amount numeric,
  p_account_name text,
  p_notes text default null,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.devices;
  v_before numeric := 0;
  v_after numeric := 0;
  v_applied numeric := 0;
  v_target text := lower(trim(coalesce(p_target, '')));
  v_kind text := lower(trim(coalesce(p_entry_kind, '')));
  v_requested numeric := greatest(coalesce(p_amount, 0), 0);
  v_deployment_mode text := 'online';
  v_entry_scope text := 'eligible';
  v_counts_toward_global boolean := false;
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
  if coalesce(trim(p_device_id), '') = '' then
    raise exception 'p_device_id is required';
  end if;

  if v_target not in ('accounting_balance', 'hopper_balance') then
    raise exception 'unsupported target: %', p_target;
  end if;

  if v_kind not in ('debit', 'credit') then
    raise exception 'unsupported entry kind: %', p_entry_kind;
  end if;

  if v_requested <= 0 then
    raise exception 'amount must be > 0';
  end if;

  if coalesce(trim(p_account_name), '') = '' then
    raise exception 'account_name is required';
  end if;

  insert into public.devices (device_id)
  values (p_device_id)
  on conflict (device_id) do nothing;

  select *
  into v_device
  from public.devices
  where device_id = p_device_id
  for update;

  v_deployment_mode := coalesce(nullif(trim(v_device.deployment_mode), ''), 'online');
  v_entry_scope := case when v_deployment_mode = 'online' then 'eligible' else 'raw' end;
  v_counts_toward_global := (v_deployment_mode = 'online');

  if v_entry_scope = 'eligible' then
    if v_target = 'accounting_balance' then
      select coalesce(t.eligible_balance, 0::numeric)
      into v_before
      from public.device_accounting_totals t
      where t.device_id = p_device_id;
    else
      select coalesce(t.eligible_hopper_balance, 0::numeric)
      into v_before
      from public.device_accounting_totals t
      where t.device_id = p_device_id;
    end if;
  elsif v_target = 'accounting_balance' then
    v_before := greatest(coalesce(v_device.balance, 0), 0);
  else
    v_before := greatest(coalesce(v_device.hopper_balance, 0), 0);
  end if;

  if v_kind = 'credit' then
    v_applied := v_requested;
    v_after := v_before + v_applied;
  else
    v_applied := least(v_requested, v_before);
    v_after := greatest(0, v_before - v_applied);
  end if;

  if v_entry_scope = 'raw' then
    if v_target = 'accounting_balance' then
      update public.devices
      set
        balance = v_after,
        coins_in_total = case when v_kind = 'credit' then coins_in_total + v_applied else greatest(0, coins_in_total - v_applied) end,
        updated_at = now()
      where device_id = p_device_id;
    else
      update public.devices
      set
        hopper_balance = v_after,
        hopper_in_total = case when v_kind = 'credit' then hopper_in_total + v_applied else hopper_in_total end,
        hopper_out_total = case when v_kind = 'debit' then hopper_out_total + v_applied else hopper_out_total end,
        updated_at = now()
      where device_id = p_device_id;
    end if;
  end if;

  insert into public.device_admin_ledger_entries (
    device_id,
    target,
    entry_kind,
    amount,
    account_name,
    notes,
    balance_before,
    balance_after,
    metadata
  )
  values (
    p_device_id,
    v_target,
    v_kind,
    v_applied,
    trim(p_account_name),
    nullif(trim(coalesce(p_notes, '')), ''),
    v_before,
    v_after,
    v_metadata || jsonb_build_object(
      'requested_amount', v_requested,
      'entry_scope', v_entry_scope,
      'deployment_mode_at_entry', v_deployment_mode,
      'counts_toward_global', v_counts_toward_global
    )
  );

  return jsonb_build_object(
    'ok', true,
    'device_id', p_device_id,
    'target', v_target,
    'entry_kind', v_kind,
    'amount', v_applied,
    'before', v_before,
    'after', v_after,
    'entry_scope', v_entry_scope,
    'counts_toward_global', v_counts_toward_global
  );
end;
$$;

create or replace view public.device_activity_feed as
select
  e.device_id,
  e.id::bigint as activity_id,
  e.event_type as activity_name,
  e.amount,
  e.event_ts as activity_at,
  e.created_at,
  e.metadata,
  e.deployment_mode,
  e.device_status,
  e.counts_toward_global
from public.device_metric_events e
join public.devices d on d.device_id = e.device_id
where coalesce(nullif(trim(d.deployment_mode), ''), 'online') <> 'online'
   or e.counts_toward_global

union all

select
  a.device_id,
  (-a.id)::bigint as activity_id,
  ('admin_' || a.entry_kind)::text as activity_name,
  a.amount,
  a.created_at as activity_at,
  a.created_at,
  coalesce(a.metadata, '{}'::jsonb) || jsonb_build_object(
    'source', 'device_admin_ledger_entries',
    'target', a.target,
    'entry_kind', a.entry_kind,
    'account_name', a.account_name,
    'notes', a.notes,
    'balance_before', a.balance_before,
    'balance_after', a.balance_after
  ) as metadata,
  coalesce(nullif(trim(d.deployment_mode), ''), 'online') as deployment_mode,
  public.resolve_device_presence_status(d.device_status, d.last_seen_at, a.created_at) as device_status,
  coalesce((a.metadata->>'counts_toward_global')::boolean, false) as counts_toward_global
from public.device_admin_ledger_entries a
join public.devices d on d.device_id = a.device_id
where (
    coalesce(nullif(trim(d.deployment_mode), ''), 'online') <> 'online'
    or coalesce((a.metadata->>'counts_toward_global')::boolean, false)
  );

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
),
arcade as (
  select
    e.device_id,
    coalesce(sum(case when e.counts_toward_global then e.amount else 0 end), 0::numeric) as eligible_arcade_total,
    coalesce(sum(case when e.counts_toward_global then e.credit_delta else 0 end), 0)::integer as eligible_arcade_credit,
    coalesce(sum(case when e.counts_toward_global then e.time_ms_delta else 0 end), 0)::bigint as eligible_arcade_time_ms
  from public.device_arcade_events e
  group by e.device_id
),
admin_adjustments as (
  select
    a.device_id,
    coalesce(sum(
      case
        when coalesce((a.metadata->>'counts_toward_global')::boolean, false) and a.target = 'accounting_balance'
          then case when a.entry_kind = 'credit' then a.amount else -a.amount end
        else 0::numeric
      end
    ), 0::numeric) as eligible_balance_delta,
    coalesce(sum(
      case
        when coalesce((a.metadata->>'counts_toward_global')::boolean, false) and a.target = 'accounting_balance'
          then case when a.entry_kind = 'credit' then a.amount else -a.amount end
        else 0::numeric
      end
    ), 0::numeric) as eligible_coins_in_delta,
    coalesce(sum(
      case
        when coalesce((a.metadata->>'counts_toward_global')::boolean, false) and a.target = 'hopper_balance' and a.entry_kind = 'credit'
          then a.amount
        else 0::numeric
      end
    ), 0::numeric) as eligible_hopper_in_delta,
    coalesce(sum(
      case
        when coalesce((a.metadata->>'counts_toward_global')::boolean, false) and a.target = 'hopper_balance' and a.entry_kind = 'debit'
          then a.amount
        else 0::numeric
      end
    ), 0::numeric) as eligible_hopper_out_delta
  from public.device_admin_ledger_entries a
  group by a.device_id
)
select
  d.device_id,
  coalesce(i.eligible_balance, 0::numeric) + coalesce(a.eligible_balance_delta, 0::numeric) as eligible_balance,
  coalesce(i.eligible_coins_in_total, 0::numeric) + coalesce(a.eligible_coins_in_delta, 0::numeric) as eligible_coins_in_total,
  coalesce(i.eligible_hopper_balance, 0::numeric) + coalesce(a.eligible_hopper_in_delta, 0::numeric) - coalesce(a.eligible_hopper_out_delta, 0::numeric) as eligible_hopper_balance,
  coalesce(i.eligible_hopper_in_total, 0::numeric) + coalesce(a.eligible_hopper_in_delta, 0::numeric) as eligible_hopper_in_total,
  coalesce(i.eligible_hopper_out_total, 0::numeric) + coalesce(a.eligible_hopper_out_delta, 0::numeric) as eligible_hopper_out_total,
  coalesce(i.eligible_bet_total, 0::numeric) as eligible_bet_total,
  coalesce(i.eligible_win_total, 0::numeric) as eligible_win_total,
  coalesce(i.eligible_withdraw_total, 0::numeric) as eligible_withdraw_total,
  coalesce(i.eligible_spins_total, 0::bigint) as eligible_spins_total,
  coalesce(i.eligible_prize_pool_contrib_total, 0::numeric) as eligible_prize_pool_contrib_total,
  coalesce(i.eligible_prize_pool_paid_total, 0::numeric) as eligible_prize_pool_paid_total,
  coalesce(i.eligible_house_take_total, 0::numeric) as eligible_house_take_total,
  coalesce(i.eligible_jackpot_contrib_total, 0::numeric) as eligible_jackpot_contrib_total,
  coalesce(i.eligible_jackpot_win_total, 0::numeric) as eligible_jackpot_win_total,
  coalesce(ar.eligible_arcade_total, 0::numeric) as eligible_arcade_total,
  coalesce(ar.eligible_arcade_credit, 0)::integer as eligible_arcade_credit,
  coalesce(ar.eligible_arcade_time_ms, 0)::bigint as eligible_arcade_time_ms
from public.devices d
left join included i on i.device_id = d.device_id
left join arcade ar on ar.device_id = d.device_id
left join admin_adjustments a on a.device_id = d.device_id;

create or replace view public.device_stats_live as
select
  d.device_id,
  (
    case
      when d.deployment_mode = 'online' then greatest(0::numeric, coalesce(t.eligible_balance, 0::numeric))
      else d.balance
    end
  )::numeric(14,2) as balance,
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
  case
    when d.last_seen_at is null or d.last_seen_at < (now() - interval '90 seconds') then 'offline'::text
    else d.device_status
  end as device_status,
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
  (
    case
      when d.deployment_mode = 'online' then greatest(0::numeric, coalesce(t.eligible_balance, 0::numeric))
      else d.balance
    end
  )::numeric(14,2) as balance,
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
  case
    when d.last_seen_at is null or d.last_seen_at < now() - interval '90 seconds' then 'offline'::text
    else d.device_status
  end as device_status,
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

create or replace view public.global_stats_live as
with totals as (
  select
    coalesce(sum(t.eligible_balance), 0::numeric) as total_balance,
    coalesce(sum(t.eligible_coins_in_total), 0::numeric) as total_coins_in,
    coalesce(sum(t.eligible_hopper_balance), 0::numeric) as total_hopper,
    coalesce(sum(t.eligible_bet_total), 0::numeric) as total_bet_amount,
    coalesce(sum(t.eligible_win_total), 0::numeric) as total_win_amount,
    coalesce(sum(t.eligible_withdraw_total), 0::numeric) as total_withdraw_amount,
    coalesce(sum(t.eligible_spins_total), 0::numeric)::bigint as total_spins,
    coalesce(sum(t.eligible_house_take_total), 0::numeric) as total_house_take,
    coalesce(sum(t.eligible_jackpot_contrib_total), 0::numeric) as total_jackpot_contrib,
    coalesce(sum(t.eligible_jackpot_win_total), 0::numeric) as total_jackpot_win
  from public.device_accounting_totals t
), eligible_devices as (
  select count(*) as device_count
  from public.devices d
  where public.should_count_device_activity(d.deployment_mode, d.device_status, d.last_seen_at, now())
), runtime as (
  select
    coalesce(r.prize_pool_balance, 0::numeric) as prize_pool_balance,
    coalesce(r.happy_hour_prize_balance, 0::numeric) as happy_hour_prize_balance,
    coalesce(r.jackpot_pool_balance, 0::numeric) as jackpot_pool_balance
  from public.casino_runtime r
  where r.id = true
  limit 1
), liabilities as (
  select
    coalesce((select sum(hp.amount_remaining) from public.happy_hour_pots hp where hp.status = 'queued'), 0::numeric) as happy_queued_amount,
    coalesce((select sum(jp.amount_remaining) from public.jackpot_pots jp where jp.status = 'queued'), 0::numeric) as jackpot_queued_amount,
    coalesce((select sum(jp.amount_remaining) from public.jackpot_pots jp where jp.status = 'processing'), 0::numeric) as jackpot_processing_amount
), arcade as (
  select
    coalesce(sum(e.amount), 0::numeric) as total_arcade_amount
  from public.device_arcade_events e
  where e.counts_toward_global
)
select
  t.total_balance,
  t.total_coins_in,
  t.total_hopper,
  t.total_bet_amount,
  t.total_win_amount,
  t.total_withdraw_amount,
  t.total_spins,
  case
    when t.total_bet_amount > 0::numeric then round((t.total_win_amount / nullif(t.total_bet_amount, 0::numeric)) * 100.0, 4)
    else 0::numeric
  end as global_rtp_percent,
  ed.device_count,
  now() as generated_at,
  t.total_house_take,
  case
    when t.total_bet_amount > 0::numeric then round((t.total_house_take / nullif(t.total_bet_amount, 0::numeric)) * 100.0, 4)
    else 0::numeric
  end as global_house_edge_percent,
  t.total_jackpot_contrib,
  t.total_jackpot_win,
  ((((((((t.total_coins_in - t.total_withdraw_amount) - t.total_balance) - coalesce(rt.prize_pool_balance, 0::numeric)) - coalesce(rt.happy_hour_prize_balance, 0::numeric)) - coalesce(rt.jackpot_pool_balance, 0::numeric)) - coalesce(lb.happy_queued_amount, 0::numeric)) - coalesce(lb.jackpot_queued_amount, 0::numeric)) - coalesce(lb.jackpot_processing_amount, 0::numeric)) as total_house_net,
  case
    when t.total_coins_in > 0::numeric then round(((((((((t.total_coins_in - t.total_withdraw_amount) - t.total_balance) - coalesce(rt.prize_pool_balance, 0::numeric)) - coalesce(rt.happy_hour_prize_balance, 0::numeric)) - coalesce(rt.jackpot_pool_balance, 0::numeric)) - coalesce(lb.happy_queued_amount, 0::numeric)) - coalesce(lb.jackpot_queued_amount, 0::numeric)) - coalesce(lb.jackpot_processing_amount, 0::numeric)) / nullif(t.total_coins_in, 0::numeric) * 100.0, 4)
    else 0::numeric
  end as global_house_net_percent,
  coalesce(am.total_arcade_amount, 0::numeric) as total_arcade_amount
from totals t
cross join eligible_devices ed
left join runtime rt on true
left join liabilities lb on true
left join arcade am on true;
