-- A strata can have up to two admins (good governance: no single point of
-- failure). Every council office still has one holder at a time, and one
-- person can still hold several offices; nothing else about roles changes.
--
-- Safe to run more than once. Run the whole file in one go.

-- 1. Admin is no longer a one-holder role.
drop index if exists public.corporation_role_assignments_one_holder;
create unique index corporation_role_assignments_one_holder
  on public.corporation_role_assignments (corporation_id, role)
  where role not in ('admin', 'manager', 'member_at_large');

-- 2. Never more than two admins, however the row is written.
create or replace function public.enforce_admin_limit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.role = 'admin' and (
    select count(*) from public.corporation_role_assignments
    where corporation_id = new.corporation_id and role = 'admin' and user_id <> new.user_id
  ) >= 2 then
    raise exception 'A strata can have at most two admins. Take Admin off one of them first.';
  end if;
  return new;
end;
$$;

drop trigger if exists corporation_role_assignments_admin_limit on public.corporation_role_assignments;
create trigger corporation_role_assignments_admin_limit
  before insert or update on public.corporation_role_assignments
  for each row execute function public.enforce_admin_limit();

-- 3. Same function as 0022, with the admin rules changed: assigning Admin
-- adds an admin instead of moving it, and an admin can give it up as long
-- as another admin remains.
create or replace function public.set_corporation_member_roles(p_corporation_id text, p_user_id uuid, p_roles text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_currently_admin boolean;
begin
  if not public.has_corporation_role(p_corporation_id, array['admin']) then
    raise exception 'Only this strata''s admin can change roles.';
  end if;

  if not exists (
    select 1 from public.corporation_memberships
    where corporation_id = p_corporation_id and user_id = p_user_id and status = 'active'
  ) then
    raise exception 'Roles can only be assigned to active members.';
  end if;

  p_roles := coalesce(p_roles, array[]::text[]);
  if p_roles && array['president', 'vice_president', 'treasurer', 'secretary'] then
    p_roles := array_remove(p_roles, 'member_at_large');
  end if;

  select exists (
    select 1 from public.corporation_role_assignments
    where corporation_id = p_corporation_id and user_id = p_user_id and role = 'admin'
  ) into v_currently_admin;

  if v_currently_admin and not ('admin' = any(p_roles)) and not exists (
    select 1 from public.corporation_role_assignments
    where corporation_id = p_corporation_id and role = 'admin' and user_id <> p_user_id
  ) then
    raise exception 'A strata always needs an admin. Make another member Admin first.';
  end if;

  delete from public.corporation_role_assignments
  where corporation_id = p_corporation_id
    and user_id = p_user_id
    and not (role = any(p_roles));

  foreach v_role in array p_roles loop
    -- Single-holder offices move from their current holder.
    if v_role not in ('admin', 'manager', 'member_at_large') then
      delete from public.corporation_role_assignments
      where corporation_id = p_corporation_id and role = v_role and user_id <> p_user_id;
    end if;

    insert into public.corporation_role_assignments (corporation_id, role, user_id)
    values (p_corporation_id, v_role, p_user_id)
    on conflict do nothing;
  end loop;

  perform public.sync_council_lots(p_corporation_id);
end;
$$;
