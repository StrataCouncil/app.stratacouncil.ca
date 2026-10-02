-- 1. Super Admins have full admin control of every strata on the
--    platform: they can open any strata and do anything its admin can.
-- 2. The member directory includes each member's profile picture, for
--    the council roster.
--
-- Safe to run more than once. Run the whole file in one go.
--
-- Done at the root: the two checks every policy and definer function is
-- built on now answer yes for a Super Admin. can_run_meetings,
-- has_stratasphere_access and the rest follow from these.
--
-- Not changed, on purpose:
--   - A Super Admin doesn't become a member. They never appear in a
--     strata's roster, member directory or connected-strata list.
--   - Stratasphere conversations stay private to the person who had them
--     (their policy checks the owner, not membership).

create or replace function public.is_corporation_member(target_corporation_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.corporation_memberships
    where corporation_id = target_corporation_id
      and user_id = auth.uid()
      and status = 'active'
  ) or public.is_super_admin();
$$;

create or replace function public.has_corporation_role(target_corporation_id text, target_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.corporation_role_assignments
    where corporation_id = target_corporation_id
      and user_id = auth.uid()
      and role = any(target_roles)
  ) or public.is_super_admin();
$$;

-- The member directory, now with each member's profile picture path
-- (signed by the server for display). Same rules as 0017.
drop function if exists public.corporation_member_directory(text);
create function public.corporation_member_directory(p_corporation_id text)
returns table (
  user_id uuid,
  full_name text,
  email text,
  status text,
  joined_at timestamptz,
  can_run_meetings boolean,
  lot_number text,
  avatar_path text
)
language sql
stable
security definer
set search_path = public
as $$
  select m.user_id, p.full_name, p.email, m.status, m.joined_at, m.can_run_meetings, m.lot_number, p.avatar_path
  from public.corporation_memberships m
  join public.profiles p on p.id = m.user_id
  where m.corporation_id = p_corporation_id
    and m.status in ('active', 'invited')
    and (public.is_corporation_member(p_corporation_id) or public.is_super_admin())
  order by m.status, p.full_name;
$$;
grant execute on function public.corporation_member_directory(text) to authenticated;
