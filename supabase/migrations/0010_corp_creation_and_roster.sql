-- doc01 §1, §3, §4, §6 — corporation creation (reviewed) and the real
-- council roster: lookup, join requests, invites, role assignments and
-- per-member meeting permissions. Tables already exist (0002, 0005); this
-- migration adds the functions and constraints the app needs to use them.
--
-- Two kinds of function below:
--   * security definer — reads that have to cross the profiles RLS
--     boundary (profiles is "read own row" only, but a roster needs other
--     members' names/emails), and writes that can't be expressed as a
--     single RLS-checked statement (admin transfer, invite acceptance,
--     creation approval). Every one checks membership / admin /
--     super-admin explicitly before doing anything.
--   * security invoker — multi-statement admin writes that RLS can gate
--     on its own; wrapped only so they're atomic.

-- ── Constraints ────────────────────────────────────────────────────────

-- One open join request per person per corporation.
create unique index corporation_join_requests_one_pending
  on public.corporation_join_requests (corporation_id, requested_by)
  where status = 'pending';

-- One open invite per email per corporation.
create unique index corporation_invites_one_pending
  on public.corporation_invites (corporation_id, lower(invited_email))
  where status = 'pending';

-- One open creation request per person per Strata Plan number.
create unique index corporation_creation_requests_one_pending
  on public.corporation_creation_requests (requested_by, parsed_strata_plan_number)
  where status = 'pending';

-- ── Storage: uploaded Strata Plans ─────────────────────────────────────
-- Private bucket. No client policies: uploads go through a signed upload
-- URL minted server-side, and Super Admin review reads through a
-- server-minted signed URL — both via the service-role client.
insert into storage.buckets (id, name, public)
values ('strata-plans', 'strata-plans', false)
on conflict (id) do nothing;

-- ── Lookup (zero-corp page) ────────────────────────────────────────────
-- strata_corporations is members-only under RLS, but the first step of
-- connecting is "is my SP# already here?" from someone who isn't a member
-- yet. Returns just enough to confirm it's the right strata.
create or replace function public.lookup_strata_corporation(p_strata_plan_number text)
returns table (strata_plan_number text, legal_name text, building_name text)
language sql
security definer
set search_path = public
stable
as $$
  select c.strata_plan_number, c.legal_name, c.building_name
  from public.strata_corporations c
  where auth.uid() is not null
    and c.strata_plan_number = p_strata_plan_number;
$$;

-- ── Roster reads ───────────────────────────────────────────────────────

-- Active and invited members with display fields. Readable by any active
-- member (the roster is visible to the whole council) or a Super Admin.
create or replace function public.corporation_member_directory(p_corporation_id text)
returns table (
  user_id uuid,
  full_name text,
  email text,
  status text,
  joined_at timestamptz,
  can_create_meetings boolean,
  can_chair_meetings boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select m.user_id, p.full_name, p.email, m.status, m.joined_at,
         m.can_create_meetings, m.can_chair_meetings
  from public.corporation_memberships m
  join public.profiles p on p.id = m.user_id
  where m.corporation_id = p_corporation_id
    and m.status in ('active', 'invited')
    and (public.is_corporation_member(p_corporation_id) or public.is_super_admin())
  order by m.status, p.full_name;
$$;

-- Pending join requests with the requester's name/email. Admin only.
create or replace function public.corporation_join_request_queue(p_corporation_id text)
returns table (id uuid, requested_by uuid, full_name text, email text, requested_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select r.id, r.requested_by, p.full_name, p.email, r.requested_at
  from public.corporation_join_requests r
  join public.profiles p on p.id = r.requested_by
  where r.corporation_id = p_corporation_id
    and r.status = 'pending'
    and public.has_corporation_role(p_corporation_id, array['admin'])
  order by r.requested_at;
$$;

-- The signed-in user's own open invites, matched on their account email
-- (corporation_invites itself is admin-only under RLS).
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
    and lower(i.invited_email) = lower((select email from auth.users where id = auth.uid()))
  order by i.created_at;
$$;

-- ── Invite acceptance ──────────────────────────────────────────────────
-- The invitee can't write corporation_memberships (admin-only), so
-- acceptance runs as definer, gated on the invite's email matching the
-- signed-in account. Returns the corporation id to redirect into.
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

  if v_invite.status = 'pending' then
    update public.corporation_invites
      set status = 'accepted', accepted_at = now()
      where id = p_invite_id;

    insert into public.corporation_memberships (user_id, corporation_id, status, invited_by, joined_at)
    values (auth.uid(), v_invite.corporation_id, 'active', v_invite.invited_by, now())
    on conflict (user_id, corporation_id) do update
      set status = 'active', joined_at = now(), invited_by = excluded.invited_by;

    -- If they'd also asked to join, the invite answers that request.
    update public.corporation_join_requests
      set status = 'approved', reviewed_by = v_invite.invited_by, resolved_at = now()
      where corporation_id = v_invite.corporation_id
        and requested_by = auth.uid()
        and status = 'pending';
  end if;

  -- Already-accepted invite clicked again: idempotent, just route them in.
  return v_invite.corporation_id;
end;
$$;

-- ── Admin roster writes ────────────────────────────────────────────────

-- Approve or deny a join request. Security invoker: RLS ("admin resolves
-- join requests", "admin manages memberships") is the gate.
create or replace function public.resolve_corporation_join_request(p_request_id uuid, p_approve boolean)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_request public.corporation_join_requests%rowtype;
begin
  select * into v_request from public.corporation_join_requests
  where id = p_request_id and status = 'pending';

  if not found then
    raise exception 'This request has already been resolved.';
  end if;

  update public.corporation_join_requests
    set status = case when p_approve then 'approved' else 'denied' end,
        reviewed_by = auth.uid(),
        resolved_at = now()
    where id = p_request_id;

  if p_approve then
    insert into public.corporation_memberships (user_id, corporation_id, status, invited_by, joined_at)
    values (v_request.requested_by, v_request.corporation_id, 'active', auth.uid(), now())
    on conflict (user_id, corporation_id) do update
      set status = 'active', joined_at = now(), invited_by = auth.uid();
  end if;
end;
$$;

-- Replace one member's full set of roles. Single-holder roles (everything
-- but 'manager') move from their current holder to this member — that's
-- how a seat changes hands. Definer, with an explicit admin check, because
-- transferring 'admin' can't pass RLS statement-by-statement: inserting
-- the new holder first trips the one-holder index, and deleting the
-- caller's own row first revokes the admin check mid-transaction.
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

  -- Exactly one admin at all times: admin is handed over by assigning it
  -- to someone else, never just dropped.
  if v_currently_admin and not ('admin' = any(p_roles)) then
    raise exception 'A strata always needs an admin. To hand it over, assign Admin to another member instead.';
  end if;

  delete from public.corporation_role_assignments
  where corporation_id = p_corporation_id
    and user_id = p_user_id
    and not (role = any(p_roles));

  foreach v_role in array p_roles loop
    if v_role <> 'manager' then
      delete from public.corporation_role_assignments
      where corporation_id = p_corporation_id and role = v_role and user_id <> p_user_id;
    end if;

    insert into public.corporation_role_assignments (corporation_id, role, user_id)
    values (p_corporation_id, v_role, p_user_id)
    on conflict do nothing;
  end loop;
end;
$$;

-- Remove a member (council turnover). Keeps the membership row as
-- 'removed' for history; drops their roles. The admin holder can't be
-- removed — admin has to be handed over first. Definer with an explicit
-- admin check, because revoking their outstanding invite needs their
-- email from profiles, which RLS hides from the caller.
create or replace function public.remove_corporation_member(p_corporation_id text, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
    set status = 'removed', can_create_meetings = false, can_chair_meetings = false
    where corporation_id = p_corporation_id and user_id = p_user_id;

  -- A still-pending invite for this person would otherwise let them
  -- straight back in.
  update public.corporation_invites i
    set status = 'revoked'
    from public.profiles p
    where p.id = p_user_id
      and i.corporation_id = p_corporation_id
      and i.status = 'pending'
      and lower(i.invited_email) = lower(p.email);
end;
$$;

-- ── Corporation creation approval (Super Admin) ────────────────────────
-- Creates the real strata_corporations row (which seeds owners_and_council
-- via 0004's trigger), connects the requester as an active member and
-- makes them admin, attaches the uploaded plan to the new corporation, and
-- closes the request — atomically. The reviewer passes the final identity
-- fields, having checked them against the uploaded Strata Plan.
create or replace function public.approve_corporation_creation_request(
  p_request_id uuid,
  p_strata_plan_number text,
  p_legal_name text,
  p_address text,
  p_unit_count int,
  p_jurisdiction text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.corporation_creation_requests%rowtype;
begin
  if not public.is_super_admin() then
    raise exception 'Only platform staff can approve corporation requests.';
  end if;

  select * into v_request from public.corporation_creation_requests
  where id = p_request_id
  for update;

  if not found or v_request.status <> 'pending' then
    raise exception 'This request has already been resolved.';
  end if;

  if exists (select 1 from public.strata_corporations where strata_plan_number = p_strata_plan_number) then
    raise exception 'Strata Plan % is already on the platform — deny this request and point the requester to the join flow.', p_strata_plan_number;
  end if;

  if p_unit_count is null or p_unit_count < 1 then
    raise exception 'Unit count must be at least 1.';
  end if;

  update public.corporation_creation_requests
    set status = 'approved',
        reviewed_by = auth.uid(),
        resolved_at = now(),
        parsed_strata_plan_number = p_strata_plan_number,
        parsed_legal_name = p_legal_name,
        parsed_address = p_address,
        parsed_unit_count = p_unit_count,
        parsed_jurisdiction = p_jurisdiction
    where id = p_request_id;

  insert into public.strata_corporations (
    strata_plan_number, legal_name, address, unit_count, jurisdiction,
    source_document_id, creation_request_id
  ) values (
    p_strata_plan_number, p_legal_name, p_address, p_unit_count, p_jurisdiction,
    v_request.strata_plan_document_id, p_request_id
  );

  update public.documents
    set corporation_id = p_strata_plan_number
    where id = v_request.strata_plan_document_id;

  insert into public.corporation_memberships (user_id, corporation_id, status, joined_at)
  values (v_request.requested_by, p_strata_plan_number, 'active', now());

  insert into public.corporation_role_assignments (corporation_id, role, user_id)
  values (p_strata_plan_number, 'admin', v_request.requested_by);

  return p_strata_plan_number;
end;
$$;

-- Super Admin can read every corporation's role assignments and
-- memberships too (the admin console's read-only detail view).
create policy "super admin reads role assignments" on public.corporation_role_assignments
  for select using (public.is_super_admin());
create policy "super admin reads memberships" on public.corporation_memberships
  for select using (public.is_super_admin());
