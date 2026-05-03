-- Add last_network_latency column to devices table
ALTER TABLE "public"."devices" ADD COLUMN IF NOT EXISTS "last_network_latency" integer;

-- Index for faster queries on latency
CREATE INDEX IF NOT EXISTS idx_devices_last_network_latency ON "public"."devices" ("device_id", "last_network_latency");
