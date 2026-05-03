create or replace function public.revoke_dashboard_user_sessions(p_target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'Unauthorized';
  end if;

  if not public.is_dashboard_role(array['superadmin']) then
    raise exception 'Forbidden';
  end if;

  if p_target_user_id is null then
    raise exception 'p_target_user_id is required';
  end if;

  delete from auth.sessions
  where user_id = p_target_user_id;
end;
$$;

grant execute on function public.revoke_dashboard_user_sessions(uuid) to authenticated;
