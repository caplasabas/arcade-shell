alter table public.games
  add column if not exists join_mode text not null default 'simultaneous';

update public.games
set join_mode = 'simultaneous'
where join_mode is null
   or btrim(join_mode) = '';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'games_join_mode_check'
  ) then
    alter table public.games
      add constraint games_join_mode_check
      check (join_mode in ('simultaneous', 'alternating', 'single_only'));
  end if;
end $$;
