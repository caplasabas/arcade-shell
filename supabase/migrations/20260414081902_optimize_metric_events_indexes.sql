-- Performance optimization: Add indexes for coins_in events and daily_stats conflict resolution
-- These indexes are non-breaking additions to improve query performance

-- Partial index for coins_in event type filtering
-- Speeds up queries filtering on event_type = 'coins_in'
CREATE INDEX IF NOT EXISTS idx_device_metric_events_coins_in_time 
ON public.device_metric_events (device_id, event_ts DESC) 
WHERE event_type = 'coins_in';

-- Partial index for hopper_in events (same pattern as coins_in)
CREATE INDEX IF NOT EXISTS idx_device_metric_events_hopper_in_time 
ON public.device_metric_events (device_id, event_ts DESC) 
WHERE event_type = 'hopper_in';

-- Partial index for withdrawal events (same pattern as coins_in)
CREATE INDEX IF NOT EXISTS idx_device_metric_events_withdrawal_time 
ON public.device_metric_events (device_id, event_ts DESC) 
WHERE event_type = 'withdrawal';

-- Index to support ON CONFLICT (stat_date, device_id) in device_daily_stats
-- The PK is already (stat_date, device_id) but this explicit index helps with lookup performance
CREATE INDEX IF NOT EXISTS idx_device_daily_stats_date_device 
ON public.device_daily_stats (stat_date, device_id);
