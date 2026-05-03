-- Migration: Fix cabinet_games for devices with missing or incorrect entries
-- Date: 2026-04-14
-- Purpose: Ensure all devices have cabinet_games entries with installed=true for enabled games

-- Step 1: Check current state
-- This will show which devices are missing cabinet_games entries
DO $$
DECLARE
    v_missing_count INTEGER;
    v_total_devices INTEGER;
    v_total_games INTEGER;
BEGIN
    -- Count devices
    SELECT COUNT(*) INTO v_total_devices FROM public.devices WHERE trim(coalesce(device_id, '')) <> '';
    RAISE NOTICE 'Total devices: %', v_total_devices;
    
    -- Count games
    SELECT COUNT(*) INTO v_total_games FROM public.games;
    RAISE NOTICE 'Total games: %', v_total_games;
    
    -- Count missing cabinet_games entries
    SELECT COUNT(*)
    INTO v_missing_count
    FROM public.devices d
    CROSS JOIN public.games g
    WHERE trim(coalesce(d.device_id, '')) <> ''
      AND NOT EXISTS (
          SELECT 1 FROM public.cabinet_games cg
          WHERE cg.device_id = d.device_id AND cg.game_id = g.id
      );
    
    RAISE NOTICE 'Missing cabinet_games entries: %', v_missing_count;
END $$;

-- Step 2: Upsert cabinet_games for all devices and enabled games
-- This will insert missing entries with installed=true
INSERT INTO public.cabinet_games (device_id, game_id, installed, installed_version)
SELECT 
    d.device_id,
    g.id AS game_id,
    CASE
        -- Casino games are installed only if enabled
        WHEN g.type = 'casino' THEN g.enabled = true OR g.enabled IS NULL
        -- Arcade games are always installed if enabled
        WHEN g.type = 'arcade' THEN true
        ELSE false
    END AS installed,
    NULL AS installed_version
FROM public.devices d
CROSS JOIN public.games g
WHERE trim(coalesce(d.device_id, '')) <> ''
  AND g.enabled = true
  AND (
      -- Include all arcade games
      g.type = 'arcade'
      -- Include casino games that are enabled
      OR (g.type = 'casino' AND g.enabled = true)
  )
ON CONFLICT (device_id, game_id) DO UPDATE
    SET 
        installed = EXCLUDED.installed,
        installed_version = EXCLUDED.installed_version;

-- Step 3: Verify the fix
DO $$
DECLARE
    v_fixed_count INTEGER;
BEGIN
    SELECT COUNT(*)
    INTO v_fixed_count
    FROM public.cabinet_games
    WHERE installed = true;
    
    RAISE NOTICE 'cabinet_games with installed=true: %', v_fixed_count;
END $$;
