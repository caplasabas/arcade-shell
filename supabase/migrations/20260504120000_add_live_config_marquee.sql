alter table public.live_config
  add column if not exists marquee jsonb default null;

create policy "insert config"
  on public.live_config
  for insert
  with check (true);
