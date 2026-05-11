do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'live_config'
      and policyname = 'insert config'
  ) then
    create policy "insert config"
      on public.live_config
      for insert
      with check (true);
  end if;
end $$;
