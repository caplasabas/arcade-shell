-- ============================================
-- RESET DEVICE: 81c3af6c2f8c48ec
-- Run this in Supabase SQL Editor
-- ============================================

DO
$$
    DECLARE
        target_device_id TEXT := '81c3af6c2f8c48ec';
    BEGIN
        -- 1. Clear any active jackpot runtime tied to this device before queue rows are deleted.
        WITH jackpot_targets AS (
          SELECT
            COALESCE(
              ARRAY_AGG(DISTINCT q.jackpot_pot_id) FILTER (WHERE q.jackpot_pot_id IS NOT NULL),
              ARRAY[]::bigint[]
            ) AS pot_ids,
            COALESCE(
              ARRAY_AGG(DISTINCT q.campaign_id) FILTER (WHERE q.campaign_id IS NOT NULL),
              ARRAY[]::uuid[]
            ) AS campaign_ids
          FROM public.jackpot_payout_queue q
          WHERE q.device_id = target_device_id
        )
        UPDATE public.casino_runtime
        SET jackpot_pending_payout = false,
            active_jackpot_pot_id = null,
            updated_at = now()
        WHERE active_jackpot_pot_id = ANY(COALESCE((SELECT pot_ids FROM jackpot_targets), ARRAY[]::bigint[]))
           OR (
             cardinality(COALESCE((SELECT campaign_ids FROM jackpot_targets), ARRAY[]::uuid[])) > 0
             AND active_jackpot_pot_id IN (
               SELECT jp.id
               FROM public.jackpot_pots jp
               WHERE jp.campaign_id = ANY(COALESCE((SELECT campaign_ids FROM jackpot_targets), ARRAY[]::uuid[]))
             )
           );
        RAISE NOTICE 'Cleared casino_runtime jackpot state';

        -- 2. Delete jackpot queue state for this device
        DELETE FROM public.jackpot_payout_plan_steps WHERE device_id = target_device_id;
        DELETE FROM public.jackpot_payout_queue WHERE device_id = target_device_id;
        RAISE NOTICE 'Deleted jackpot queue state';

        -- 3. Delete ALL metric events for this device
        DELETE FROM public.device_metric_events WHERE device_id = target_device_id;
        RAISE NOTICE 'Deleted metric events';

        -- 4. Delete ALL device arcade events
        DELETE FROM public.device_arcade_events WHERE device_id = target_device_id;
        RAISE NOTICE 'Deleted device_arcade_events';

        -- 5. Delete ALL daily stats for this device
        DELETE FROM public.device_daily_stats WHERE device_id = target_device_id;
        RAISE NOTICE 'Deleted daily stats';

        -- 6. Delete ALL device ledger entries
        DELETE FROM public.device_ledger WHERE device_id = target_device_id;
        RAISE NOTICE 'Deleted device_ledger';

        -- 7. Delete ALL game sessions for this device
        DELETE FROM public.device_game_sessions WHERE device_id = target_device_id;
        RAISE NOTICE 'Deleted game sessions';

        -- 8. Reset devices table (keeps name, device_id, ip, agent, location)
        UPDATE public.devices
        SET balance                      = 0,
            coins_in_total               = 0,
            hopper_balance               = 0,
            hopper_in_total              = 0,
            hopper_out_total             = 0,
            bet_total                    = 0,
            win_total                    = 0,
            withdraw_total               = 0,
            spins_total                  = 0,
            prize_pool_contrib_total     = 0,
            prize_pool_paid_total        = 0,
            house_take_total             = 0,
            jackpot_contrib_total        = 0,
            jackpot_win_total            = 0,
            arcade_total                 = 0,
            arcade_credit                = 0,
            arcade_credit_updated_at     = null,
            arcade_time_ms               = 0,
            arcade_time_updated_at       = null,
            arcade_session_started_at    = null,
            arcade_time_last_deducted_at = null,
            current_game_id              = null,
            current_game_name            = null,
            current_game_type            = null,
            device_status                = 'idle',
            active_session_id            = null,
            session_started_at           = null,
            session_last_heartbeat       = null,
            session_ended_at             = null,
            runtime_mode                 = null,
            is_free_game                 = false,
            free_spins_left              = 0,
            pending_free_spins           = 0,
            show_free_spin_intro         = false,
            current_spin_id              = 0,
            session_metadata             = '{}'::jsonb,
            last_bet_amount              = 0,
            last_bet_at                  = null,
            updated_at                   = now()
        WHERE device_id = target_device_id;
        RAISE NOTICE 'Reset devices table';

        -- 9. Clear spin dedup for this device
        DELETE FROM public.device_spin_event_dedup WHERE device_id = target_device_id;
        RAISE NOTICE 'Cleared spin dedup';

        -- 10. Clear device admin ledger entries
        DELETE FROM public.device_admin_ledger_entries WHERE device_id = target_device_id;
        RAISE NOTICE 'Cleared device admin ledger';

        RAISE NOTICE 'Device % fully reset!', target_device_id;
    END
$$;
