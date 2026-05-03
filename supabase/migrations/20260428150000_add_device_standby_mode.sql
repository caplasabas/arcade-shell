alter table public.devices
  drop constraint if exists devices_deployment_mode_check;

alter table public.devices
  add constraint devices_deployment_mode_check
  check (deployment_mode = any (array['online'::text, 'standby'::text, 'maintenance'::text]));
