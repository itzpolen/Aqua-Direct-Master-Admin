create or replace function public.grant_admin_by_email(p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target_id uuid;
  normalized_email text := lower(trim(p_email));
begin
  if actor_id is null or not public.has_permission('roles.manage') then
    raise exception 'Admin role-management permission is required';
  end if;
  if normalized_email is null or normalized_email = '' or position('@' in normalized_email) < 2 then
    raise exception 'Enter a valid email address';
  end if;

  select u.id into target_id
  from auth.users u
  where lower(u.email) = normalized_email
    and u.email_confirmed_at is not null
  for update;
  if target_id is null then
    raise exception 'No confirmed account exists for that email';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = target_id and p.status = 'active'
  ) then
    raise exception 'The account must have an active profile';
  end if;
  if exists (
    select 1 from public.user_roles ur
    where ur.user_id = target_id and ur.role = 'admin'::public.app_role
  ) then
    raise exception 'This account already has admin access';
  end if;

  insert into public.user_roles (user_id, role)
  values (target_id, 'admin'::public.app_role);

  insert into public.admin_audit_logs (
    actor_id, action, entity_type, entity_id, after_data
  )
  values (
    actor_id, 'admin_role_granted', 'user_role', target_id,
    jsonb_build_object('role', 'admin')
  );

  return target_id;
end;
$$;

revoke all on function public.grant_admin_by_email(text) from public, anon;
grant execute on function public.grant_admin_by_email(text) to authenticated;
