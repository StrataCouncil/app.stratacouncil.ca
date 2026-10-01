-- Fixes and additions from the first end-to-end test (2026-10-01).
--
-- 1. Member at Large: a council role any number of members can hold.
-- 2. Owner type is one of exactly three: Owner Occupant, Owner
--    Absentee, Developer.
-- 3. Council members are tied to their strata lot. An admin sets each
--    member's lot; a member with a lot and a council role marks that lot
--    as a council lot, which is what council-meeting attendance and quorum
--    use.
-- 4. Invites expire after 7 days.
-- 5. Super Admins can read a corporation's decision ledger (support).
-- 6. Profile photos: a private `avatars` bucket and the stored path.
-- 7. Strata Plans uploaded at creation are proper repository documents
--    (file name + source), so they can be indexed.

-- ── 1. Member at Large ─────────────────────────────────────────────────
alter table public.corporation_role_assignments drop constraint corporation_role_assignments_role_check;
alter table public.corporation_role_assignments add constraint corporation_role_assignments_role_check
  check (role in ('admin', 'president', 'vice_president', 'treasurer', 'secretary', 'member_at_large', 'manager'));

drop index public.corporation_role_assignments_one_holder;
create unique index corporation_role_assignments_one_holder
  on public.corporation_role_assignments (corporation_id, role)
  where role not in ('manager', 'member_at_large');

alter table public.owners_and_council drop constraint owners_and_council_role_check;
alter table public.owners_and_council add constraint owners_and_council_role_check
  check (role is null or role in ('president', 'vice_president', 'treasurer', 'secretary', 'member_at_large'));

create or replace function public.set_corporation_member_roles(
  p_corporation_id text,
  p_user_id uuid,
  p_roles text[]
)
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

  select exists (
    select 1 from public.corporation_role_assignments
    where corporation_id = p_corporation_id and user_id = p_user_id and role = 'admin'
  ) into v_currently_admin;

  if v_currently_admin and not ('admin' = any(p_roles)) then
    raise exception 'A strata always needs an admin. To hand it over, assign Admin to another member instead.';
  end if;

  delete from public.corporation_role_assignments
  where corporation_id = p_corporation_id
    and user_id = p_user_id
    and not (role = any(p_roles));

  foreach v_role in array p_roles loop
    -- Single-holder roles move from their current holder.
    if v_role not in ('manager', 'member_at_large') then
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

-- ── 2. Owner type ──────────────────────────────────────────────────────
alter table public.owners_and_council drop constraint owners_and_council_owner_type_check;
update public.owners_and_council set owner_type = case owner_type when 'owner' then 'owner_occupant' else null end
  where owner_type is not null;
alter table public.owners_and_council add constraint owners_and_council_owner_type_check
  check (owner_type is null or owner_type in ('owner_occupant', 'owner_absentee', 'developer'));

-- ── 3. Council members tied to lots ────────────────────────────────────
alter table public.corporation_memberships add column lot_number text;

-- The lot roster's council flags follow from members: a lot is a council
-- lot when an active member with a council role is tied to it. Lots an
-- admin flagged by hand without a linked member are left alone.
create or replace function public.sync_council_lots(p_corporation_id text)
returns void
language sql
security definer
set search_path = public
as $$
  with council as (
    select m.lot_number, p.full_name,
      (select r.role from public.corporation_role_assignments r
        where r.corporation_id = m.corporation_id and r.user_id = m.user_id
          and r.role in ('president', 'vice_president', 'treasurer', 'secretary', 'member_at_large')
        order by array_position(array['president', 'vice_president', 'treasurer', 'secretary', 'member_at_large'], r.role)
        limit 1) as role
    from public.corporation_memberships m
    join public.profiles p on p.id = m.user_id
    where m.corporation_id = p_corporation_id and m.status = 'active' and m.lot_number is not null
  ),
  linked as (select lot_number from public.corporation_memberships
             where corporation_id = p_corporation_id and lot_number is not null)
  update public.owners_and_council o
    set is_council_member = (c.role is not null),
        role = c.role,
        council_member_name = case when c.role is not null then c.full_name else null end
  from (
    select l.lot_number, c.full_name, c.role
    from linked l left join council c on c.lot_number = l.lot_number
  ) c
  where o.corporation_id = p_corporation_id and o.lot_number = c.lot_number;
$$;

create or replace function public.set_member_lot(p_corporation_id text, p_user_id uuid, p_lot_number text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old text;
begin
  if not public.has_corporation_role(p_corporation_id, array['admin']) then
    raise exception 'Only this strata''s admin can set members'' strata lots.';
  end if;
  if p_lot_number is not null and not exists (
    select 1 from public.owners_and_council where corporation_id = p_corporation_id and lot_number = p_lot_number
  ) then
    raise exception 'That strata lot isn''t on this strata''s roster.';
  end if;

  select lot_number into v_old from public.corporation_memberships
    where corporation_id = p_corporation_id and user_id = p_user_id and status = 'active';
  if not found then
    raise exception 'Only active members can be tied to a strata lot.';
  end if;

  update public.corporation_memberships set lot_number = p_lot_number
    where corporation_id = p_corporation_id and user_id = p_user_id;

  -- The lot this member left is no longer a council lot because of them.
  if v_old is not null and v_old is distinct from p_lot_number and not exists (
    select 1 from public.corporation_memberships
    where corporation_id = p_corporation_id and lot_number = v_old and status = 'active'
  ) then
    update public.owners_and_council set is_council_member = false, role = null, council_member_name = null
      where corporation_id = p_corporation_id and lot_number = v_old;
  end if;

  perform public.sync_council_lots(p_corporation_id);
end;
$$;

-- Removing a member takes their lot off council too.
create or replace function public.remove_corporation_member(p_corporation_id text, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lot text;
begin
  if not public.has_corporation_role(p_corporation_id, array['admin']) then
    raise exception 'Only this strata''s admin can remove members.';
  end if;

  if exists (
    select 1 from public.corporation_role_assignments
    where corporation_id = p_corporation_id and user_id = p_user_id and role = 'admin'
  ) then
    raise exception 'The admin can''t be removed. Assign Admin to another member first.';
  end if;

  delete from public.corporation_role_assignments
  where corporation_id = p_corporation_id and user_id = p_user_id;

  update public.corporation_memberships
    set status = 'removed', can_run_meetings = false
    where corporation_id = p_corporation_id and user_id = p_user_id
    returning lot_number into v_lot;

  if v_lot is not null and not exists (
    select 1 from public.corporation_memberships
    where corporation_id = p_corporation_id and lot_number = v_lot and status = 'active'
  ) then
    update public.owners_and_council set is_council_member = false, role = null, council_member_name = null
      where corporation_id = p_corporation_id and lot_number = v_lot;
  end if;

  update public.corporation_invites i
    set status = 'revoked'
    from public.profiles p
    where p.id = p_user_id
      and i.corporation_id = p_corporation_id
      and i.status = 'pending'
      and lower(i.invited_email) = lower(p.email);
end;
$$;

drop function public.corporation_member_directory(text);
create function public.corporation_member_directory(p_corporation_id text)
returns table (
  user_id uuid,
  full_name text,
  email text,
  status text,
  joined_at timestamptz,
  can_run_meetings boolean,
  lot_number text
)
language sql
security definer
set search_path = public
stable
as $$
  select m.user_id, p.full_name, p.email, m.status, m.joined_at, m.can_run_meetings, m.lot_number
  from public.corporation_memberships m
  join public.profiles p on p.id = m.user_id
  where m.corporation_id = p_corporation_id
    and m.status in ('active', 'invited')
    and (public.is_corporation_member(p_corporation_id) or public.is_super_admin())
  order by m.status, p.full_name;
$$;

-- ── 4. Invites expire after 7 days ─────────────────────────────────────
alter table public.corporation_invites add column expires_at timestamptz not null default (now() + interval '7 days');
update public.corporation_invites set expires_at = created_at + interval '7 days';

create or replace function public.accept_corporation_invite(p_invite_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.corporation_invites%rowtype;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  select * into v_invite from public.corporation_invites
  where id = p_invite_id
  for update;

  if not found or lower(v_invite.invited_email) <> lower(v_email) then
    raise exception 'This invitation isn''t for the account you''re signed in with.';
  end if;

  if v_invite.status = 'revoked' then
    raise exception 'This invitation was revoked by the strata''s admin.';
  end if;

  if v_invite.status = 'pending' and v_invite.expires_at < now() then
    raise exception 'This invitation has expired. Ask the strata''s admin to send a new one.';
  end if;

  if v_invite.status = 'pending' then
    update public.corporation_invites
      set status = 'accepted', accepted_at = now()
      where id = p_invite_id;

    insert into public.corporation_memberships (user_id, corporation_id, status, invited_by, joined_at)
    values (auth.uid(), v_invite.corporation_id, 'active', v_invite.invited_by, now())
    on conflict (user_id, corporation_id) do update
      set status = 'active', joined_at = now(), invited_by = excluded.invited_by;

    update public.corporation_join_requests
      set status = 'approved', reviewed_by = v_invite.invited_by, resolved_at = now()
      where corporation_id = v_invite.corporation_id
        and requested_by = auth.uid()
        and status = 'pending';
  end if;

  return v_invite.corporation_id;
end;
$$;

-- Expired invites no longer show on the invitee's connect page.
create or replace function public.my_pending_invites()
returns table (
  id uuid,
  corporation_id text,
  legal_name text,
  building_name text,
  invited_by_name text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select i.id, i.corporation_id, c.legal_name, c.building_name, p.full_name, i.created_at
  from public.corporation_invites i
  join public.strata_corporations c on c.strata_plan_number = i.corporation_id
  left join public.profiles p on p.id = i.invited_by
  where i.status = 'pending'
    and i.expires_at >= now()
    and lower(i.invited_email) = lower((select email from auth.users where id = auth.uid()))
  order by i.created_at;
$$;

-- ── 5. Super Admins read decision ledgers ──────────────────────────────
create policy "super admin reads decisions" on public.decisions
  for select using (public.is_super_admin());

-- ── 6. Profile photos ──────────────────────────────────────────────────
alter table public.profiles add column avatar_path text;
insert into storage.buckets (id, name, public, file_size_limit)
values ('avatars', 'avatars', false, 5242880)
on conflict (id) do nothing;

-- ── 7. Strata Plans as repository documents ────────────────────────────
update public.documents d
  set source_type = 'strata_plan',
      file_name = coalesce(d.file_name, regexp_replace(d.storage_path, '^.*/', '')),
      mime_type = coalesce(d.mime_type, 'application/pdf'),
      indexing_status = case when d.indexing_status = 'not_indexable' then 'pending' else d.indexing_status end,
      indexing_error = null
  where d.storage_path like 'strata-plans/%';

revoke all on function public.set_member_lot(text, uuid, text) from public;
revoke all on function public.sync_council_lots(text) from public, authenticated;
grant execute on function public.set_member_lot(text, uuid, text) to authenticated;
grant execute on function public.corporation_member_directory(text) to authenticated;
