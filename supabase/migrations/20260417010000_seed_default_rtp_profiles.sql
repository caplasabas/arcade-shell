insert into public.rtp_profiles (
  id,
  name,
  mode,
  house_pct,
  pool_pct,
  player_pct,
  prize_pct,
  enabled,
  sort_order
)
values
  ('base_slow', 'Base Slow', 'BASE', 20, 20, 60, 60, true, 10),
  ('happy_slow', 'Happy Slow', 'HAPPY', 20, 20, 60, 60, true, 10)
on conflict (id) do nothing;
