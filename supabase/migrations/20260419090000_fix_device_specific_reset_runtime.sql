CREATE OR REPLACE FUNCTION "public"."reset_device_maintenance_runtime"("p_device_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SECURITY DEFINER
    SET "search_path" TO 'public'
AS
$$
declare
    v_device_id                  text := trim(coalesce(p_device_id, ''));
    v_deleted_metric_events      integer := 0;
    v_deleted_arcade_events      integer := 0;
    v_deleted_daily_rows         integer := 0;
    v_deleted_ledger_rows        integer := 0;
    v_deleted_game_sessions      integer := 0;
    v_deleted_spin_dedup_rows    integer := 0;
    v_deleted_admin_ledger_rows  integer := 0;
    v_deleted_queue_rows         integer := 0;
    v_deleted_plan_step_rows     integer := 0;
    v_jackpot_pot_ids            bigint[] := array[]::bigint[];
    v_jackpot_campaign_ids       uuid[] := array[]::uuid[];
begin
    if v_device_id = '' then
        raise exception 'p_device_id is required';
    end if;

    if not exists (
        select 1
        from public.devices d
        where d.device_id = v_device_id
        for update
    ) then
        raise exception 'device not found: %', v_device_id;
    end if;

    select coalesce(array_agg(distinct q.jackpot_pot_id) filter (where q.jackpot_pot_id is not null), array[]::bigint[]),
           coalesce(array_agg(distinct q.campaign_id) filter (where q.campaign_id is not null), array[]::uuid[])
    into v_jackpot_pot_ids, v_jackpot_campaign_ids
    from public.jackpot_payout_queue q
    where q.device_id = v_device_id;

    delete from public.jackpot_payout_plan_steps
    where device_id = v_device_id;
    get diagnostics v_deleted_plan_step_rows = row_count;

    delete from public.jackpot_payout_queue
    where device_id = v_device_id;
    get diagnostics v_deleted_queue_rows = row_count;

    delete from public.device_metric_events
    where device_id = v_device_id;
    get diagnostics v_deleted_metric_events = row_count;

    delete from public.device_arcade_events
    where device_id = v_device_id;
    get diagnostics v_deleted_arcade_events = row_count;

    delete from public.device_daily_stats
    where device_id = v_device_id;
    get diagnostics v_deleted_daily_rows = row_count;

    delete from public.device_ledger
    where device_id = v_device_id;
    get diagnostics v_deleted_ledger_rows = row_count;

    delete from public.device_game_sessions
    where device_id = v_device_id;
    get diagnostics v_deleted_game_sessions = row_count;

    delete from public.device_spin_event_dedup
    where device_id = v_device_id;
    get diagnostics v_deleted_spin_dedup_rows = row_count;

    delete from public.device_admin_ledger_entries
    where device_id = v_device_id;
    get diagnostics v_deleted_admin_ledger_rows = row_count;

    update public.devices
    set balance = 0,
        coins_in_total = 0,
        hopper_balance = 0,
        hopper_in_total = 0,
        hopper_out_total = 0,
        bet_total = 0,
        win_total = 0,
        withdraw_total = 0,
        spins_total = 0,
        prize_pool_contrib_total = 0,
        prize_pool_paid_total = 0,
        house_take_total = 0,
        jackpot_contrib_total = 0,
        jackpot_win_total = 0,
        arcade_total = 0,
        arcade_credit = 0,
        arcade_credit_updated_at = null,
        arcade_time_ms = 0,
        arcade_time_updated_at = null,
        arcade_session_started_at = null,
        arcade_time_last_deducted_at = null,
        current_game_id = null,
        current_game_name = null,
        current_game_type = null,
        device_status = 'idle',
        active_session_id = null,
        session_started_at = null,
        session_last_heartbeat = null,
        session_ended_at = null,
        runtime_mode = null,
        is_free_game = false,
        free_spins_left = 0,
        pending_free_spins = 0,
        show_free_spin_intro = false,
        current_spin_id = 0,
        session_metadata = '{}'::jsonb,
        last_bet_amount = 0,
        last_bet_at = null,
        updated_at = now()
    where device_id = v_device_id;

    update public.casino_runtime
    set jackpot_pending_payout = false,
        active_jackpot_pot_id = null,
        updated_at = now()
    where active_jackpot_pot_id = any(v_jackpot_pot_ids)
       or (
            cardinality(v_jackpot_campaign_ids) > 0
            and active_jackpot_pot_id in (
                select jp.id
                from public.jackpot_pots jp
                where jp.campaign_id = any(v_jackpot_campaign_ids)
            )
        );

    return jsonb_build_object(
        'ok', true,
        'device_id', v_device_id,
        'deleted_plan_step_rows', v_deleted_plan_step_rows,
        'deleted_queue_rows', v_deleted_queue_rows,
        'deleted_metric_events', v_deleted_metric_events,
        'deleted_arcade_events', v_deleted_arcade_events,
        'deleted_daily_rows', v_deleted_daily_rows,
        'deleted_ledger_rows', v_deleted_ledger_rows,
        'deleted_game_sessions', v_deleted_game_sessions,
        'deleted_spin_dedup_rows', v_deleted_spin_dedup_rows,
        'deleted_admin_ledger_rows', v_deleted_admin_ledger_rows,
        'reset_all_stats', true
    );
end;
$$;

GRANT ALL ON FUNCTION "public"."reset_device_maintenance_runtime"("p_device_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."reset_device_maintenance_runtime"("p_device_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reset_device_maintenance_runtime"("p_device_id" "text") TO "service_role";
