do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'dashboard_role'
  ) then
    create type public.dashboard_role as enum ('superadmin', 'admin', 'staff', 'runner', 'accounts');
  end if;
end
$$;

create table if not exists public.dashboard_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  role public.dashboard_role not null default 'staff',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists dashboard_users_set_updated_at on public.dashboard_users;
create trigger dashboard_users_set_updated_at
before update on public.dashboard_users
for each row execute function public.set_updated_at();

create or replace function public.current_dashboard_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select du.role::text
  from public.dashboard_users du
  where du.user_id = auth.uid()
    and du.is_active = true
  limit 1;
$$;

create or replace function public.is_dashboard_role(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.dashboard_users du
    where du.user_id = auth.uid()
      and du.is_active = true
      and du.role::text = any(coalesce(p_roles, array[]::text[]))
  );
$$;

alter table public.dashboard_users enable row level security;

drop policy if exists dashboard_users_self_select on public.dashboard_users;
create policy dashboard_users_self_select
on public.dashboard_users
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists dashboard_users_admin_select on public.dashboard_users;
create policy dashboard_users_admin_select
on public.dashboard_users
for select
to authenticated
using (public.is_dashboard_role(array['superadmin', 'admin', 'accounts']));

drop policy if exists dashboard_users_admin_insert on public.dashboard_users;
create policy dashboard_users_admin_insert
on public.dashboard_users
for insert
to authenticated
with check (public.is_dashboard_role(array['superadmin', 'admin', 'accounts']));

drop policy if exists dashboard_users_admin_update on public.dashboard_users;
create policy dashboard_users_admin_update
on public.dashboard_users
for update
to authenticated
using (public.is_dashboard_role(array['superadmin', 'admin', 'accounts']))
with check (public.is_dashboard_role(array['superadmin', 'admin', 'accounts']));

grant all on table public.dashboard_users to authenticated;
grant all on function public.current_dashboard_role() to authenticated;
grant all on function public.is_dashboard_role(text[]) to authenticated;
