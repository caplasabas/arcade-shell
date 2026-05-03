-- Migration: Fix device reset to actually reset all stats to 0
-- Date: 2026-04-14
-- Purpose: Reset device stats properly regardless of deployment mode

-- Fix 1: Update enqueue_device_admin_command to bypass maintenance mode check
DO $$
DECLARE
    func_oid OID;
BEGIN
    SELECT oid INTO func_oid
    FROM pg_proc
    WHERE proname = 'enqueue_device_admin_command'
      AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
    
    IF func_oid IS NOT NULL THEN
        EXECUTE format(
            'DROP FUNCTION IF EXISTS public.enqueue_device_admin_command(text, text, text, text)'
        );
        
        EXECUTE format($SQL$
            CREATE OR REPLACE FUNCTION "public"."enqueue_device_admin_command"(
                "p_device_id" "text",
                "p_command" "text",
                "p_reason" "text" DEFAULT NULL::"text",
                "p_requested_by" "text" DEFAULT NULL::"text"
            ) RETURNS "jsonb"
            LANGUAGE "plpgsql"
            SECURITY DEFINER
            SET "search_path" TO 'public'
            AS
            $$
            declare
                v_device_id text := trim(coalesce(p_device_id, ''));
                v_command   text := lower(trim(coalesce(p_command, '')));
                v_row       public.device_admin_commands;
                v_device    public.devices%rowtype;
            begin
                if v_device_id = '' then
                    raise exception 'p_device_id is required';
                end if;

                if v_command not in ('restart', 'shutdown', 'reset') then
                    raise exception 'Unsupported command: %', v_command;
                end if;

                select *
                into v_device
                from public.devices d
                where d.device_id = v_device_id;

                if not found then
                    raise exception 'device not found: %', v_device_id;
                end if;

                -- MAINTENANCE CHECK BYPASSED FOR TESTING

                select *
                into v_row
                from public.device_admin_commands c
                where c.device_id = v_device_id
                  and c.command = v_command
                  and c.status in ('queued', 'processing')
                order by c.id desc
                limit 1;

                if found then
                    return jsonb_build_object(
                            'ok', true,
                            'deduped', true,
                            'id', v_row.id,
                            'device_id', v_row.device_id,
                            'command', v_row.command,
                            'status', v_row.status
                           );
                end if;

                insert into public.device_admin_commands (device_id, command, status, reason, requested_by, requested_at, created_at, processed_at)
                values (v_device_id, v_command, 'queued', p_reason, p_requested_by, now(), now(), null);

                return jsonb_build_object('ok', true, 'device_id', v_device_id, 'command', v_command);
            end;
            $$
        $SQL$);
        
        RAISE NOTICE 'Updated enqueue_device_admin_command';
    END IF;
END;
$$;

GRANT ALL ON FUNCTION "public"."enqueue_device_admin_command"(text, text, text, text) TO "anon";
GRANT ALL ON FUNCTION "public"."enqueue_device_admin_command"(text, text, text, text) TO "authenticated";
GRANT ALL ON FUNCTION "public"."enqueue_device_admin_command"(text, text, text, text) TO "service_role";

-- Fix 2: Update reset_device_maintenance_runtime to properly reset all stats
DO $$
DECLARE
    func_oid OID;
BEGIN
    SELECT oid INTO func_oid
    FROM pg_proc
    WHERE proname = 'reset_device_maintenance_runtime'
      AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
    
    IF func_oid IS NOT NULL THEN
        DROP FUNCTION IF EXISTS public.reset_device_maintenance_runtime(text);
    END IF;
END
$$;

CREATE OR REPLACE FUNCTION "public"."reset_device_maintenance_runtime"("p_device_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SECURITY DEFINER
    SET "search_path" TO 'public'
AS
$$
declare
    v_device_id             text    := trim(coalesce(p_device_id, ''));
    v_device                public.devices%rowtype;
    v_deleted_metric_events integer := 0;
    v_deleted_arcade_events integer := 0;
    v_deleted_daily_rows    integer := 0;
begin
    if v_device_id = '' then
        raise exception 'p_device_id is required';
    end if;

    select *
    into v_device
    from public.devices d
    where d.device_id = v_device_id
        for update;

    if not found then
        raise exception 'device not found: %', v_device_id;
    end if;

    -- MAINTENANCE CHECK BYPASSED FOR TESTING

    -- Delete ALL metric events
    delete from public.device_metric_events e where e.device_id = v_device_id;
    get diagnostics v_deleted_metric_events = row_count;

    if to_regclass('public.device_arcade_events') is not null then
        delete from public.device_arcade_events e where e.device_id = v_device_id;
        get diagnostics v_deleted_arcade_events = row_count;
    end if;

    delete from public.device_daily_stats s where s.device_id = v_device_id;
    get diagnostics v_deleted_daily_rows = row_count;

    -- RESET ALL DEVICE STATS DIRECTLY TO 0
    update public.devices d
    set balance                  = 0,
        coins_in_total           = 0,
        hopper_balance           = 0,
        hopper_in_total          = 0,
        hopper_out_total         = 0,
        bet_total                = 0,
        win_total                = 0,
        withdraw_total           = 0,
        spins_total              = 0,
        prize_pool_contrib_total = 0,
        prize_pool_paid_total    = 0,
        house_take_total         = 0,
        jackpot_contrib_total    = 0,
        jackpot_win_total        = 0,
        arcade_total             = 0,
        arcade_credit            = 0,
        arcade_credit_updated_at = now(),
        arcade_time_ms           = 0,
        arcade_time_updated_at   = now(),
        arcade_session_started_at = null,
        arcade_time_last_deducted_at = null,
        current_game_id         = null,
        current_game_name       = null,
        current_game_type       = null,
        device_status           = 'idle',
        active_session_id       = null,
        session_started_at      = null,
        session_last_heartbeat = null,
        session_ended_at        = null,
        runtime_mode            = null,
        is_free_game           = false,
        free_spins_left         = 0,
        pending_free_spins      = 0,
        show_free_spin_intro    = false,
        current_spin_id         = 0,
        session_metadata        = '{}'::jsonb,
        updated_at              = now()
    where d.device_id = v_device_id;

    -- Also reset device_accounting_totals
    if to_regclass('public.device_accounting_totals') is not null then
        update public.device_accounting_totals
        set eligible_balance                  = 0,
            eligible_coins_in_total           = 0,
            eligible_hopper_balance            = 0,
            eligible_hopper_in_total           = 0,
            eligible_hopper_out_total         = 0,
            eligible_bet_total                = 0,
            eligible_win_total                = 0,
            eligible_withdraw_total           = 0,
            eligible_spins_total              = 0,
            eligible_prize_pool_contrib_total = 0,
            eligible_prize_pool_paid_total   = 0,
            eligible_house_take_total         = 0,
            eligible_jackpot_contrib_total    = 0,
            eligible_jackpot_win_total        = 0,
            eligible_arcade_total             = 0,
            eligible_arcade_credit            = 0,
            eligible_arcade_time_ms           = 0
        where device_id = v_device_id;
    end if;

    return jsonb_build_object(
            'ok', true,
            'device_id', v_device_id,
            'deleted_metric_events', v_deleted_metric_events,
            'deleted_arcade_events', v_deleted_arcade_events,
            'deleted_daily_rows', v_deleted_daily_rows,
            'reset_all_stats', true
           );
end;
$$;

GRANT ALL ON FUNCTION "public"."reset_device_maintenance_runtime"("p_device_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."reset_device_maintenance_runtime"("p_device_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reset_device_maintenance_runtime"("p_device_id" "text") TO "service_role";
