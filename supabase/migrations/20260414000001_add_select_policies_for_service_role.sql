-- Migration: Add explicit SELECT policy for cabinet_games and games
-- Date: 2026-04-14
-- Purpose: Ensure devices can SELECT cabinet_games even when using service_role
-- Note: service_role bypasses RLS, but explicit policies ensure consistency

-- Add SELECT policy for cabinet_games (for service_role, though it bypasses RLS)
DO $$
BEGIN
    -- Check if policy already exists
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'cabinet_games' 
        AND policyname = 'service_role_select'
    ) THEN
        CREATE POLICY "service_role_select" ON "public"."cabinet_games" 
        FOR SELECT TO "service_role" USING (true);
        RAISE NOTICE 'Created policy: service_role_select on cabinet_games';
    ELSE
        RAISE NOTICE 'Policy service_role_select already exists on cabinet_games';
    END IF;
END $$;

-- Grant SELECT explicitly (service_role already has ALL, but this is for clarity)
GRANT SELECT ON TABLE "public"."cabinet_games" TO "service_role";

-- Also add SELECT policy for games table
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'games' 
        AND policyname = 'service_role_select'
    ) THEN
        CREATE POLICY "service_role_select" ON "public"."games" 
        FOR SELECT TO "service_role" USING (true);
        RAISE NOTICE 'Created policy: service_role_select on games';
    ELSE
        RAISE NOTICE 'Policy service_role_select already exists on games';
    END IF;
END $$;

GRANT SELECT ON TABLE "public"."games" TO "service_role";
