alter table public.live_config
  add column if not exists side_ads jsonb default null;
