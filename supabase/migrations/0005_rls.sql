-- doc01 §6 — Row-level security shape for everything migrated so far.
-- Corporation-scoped access goes through this helper rather than
-- repeating the EXISTS(...) check inline everywhere.

create or replace function public.is_corporation_member(target_corporation_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.corporation_memberships
    where corporation_id = target_corporation_id
      and user_id = auth.uid()
      and status = 'active'
  );
$$;

create or replace function public.has_corporation_role(target_corporation_id text, target_roles text[])
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.corporation_role_assignments
    where corporation_id = target_corporation_id
      and user_id = auth.uid()
      and role = any(target_roles)
  );
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select is_super_admin from public.profiles where id = auth.uid()), false);
$$;

-- profiles: user-owned. doc01 §6.
alter table public.profiles enable row level security;
create policy "read own profile" on public.profiles for select using (id = auth.uid());
create policy "update own profile" on public.profiles for update using (id = auth.uid());

-- strata_corporations: readable by anyone connected; parsed identity
-- fields are immutable in application logic (not enforced at the SQL
-- layer here — building_name and Super-Admin-only unit_count edits are
-- an app-level concern, doc01 §4).
alter table public.strata_corporations enable row level security;
create policy "members can read their corporation" on public.strata_corporations
  for select using (public.is_corporation_member(strata_plan_number) or public.is_super_admin());

-- corporation_memberships: a member can read their own row and every
-- other active member's row on a corporation they belong to (needed for
-- roster views); only an admin can write.
alter table public.corporation_memberships enable row level security;
create policy "read memberships on your corporations" on public.corporation_memberships
  for select using (
    user_id = auth.uid() or public.is_corporation_member(corporation_id)
  );
create policy "admin manages memberships" on public.corporation_memberships
  for all using (public.has_corporation_role(corporation_id, array['admin']))
  with check (public.has_corporation_role(corporation_id, array['admin']));

-- corporation_join_requests / corporation_invites: requester or admin only.
alter table public.corporation_join_requests enable row level security;
create policy "requester or admin reads join requests" on public.corporation_join_requests
  for select using (
    requested_by = auth.uid() or public.has_corporation_role(corporation_id, array['admin'])
  );
create policy "admin resolves join requests" on public.corporation_join_requests
  for update using (public.has_corporation_role(corporation_id, array['admin']));
create policy "any authenticated user can request to join" on public.corporation_join_requests
  for insert with check (requested_by = auth.uid());

alter table public.corporation_invites enable row level security;
create policy "admin manages invites" on public.corporation_invites
  for all using (public.has_corporation_role(corporation_id, array['admin']))
  with check (public.has_corporation_role(corporation_id, array['admin']));

-- corporation_role_assignments: readable by any connected member
-- (roster views need this), writable by admin only.
alter table public.corporation_role_assignments enable row level security;
create policy "members can read role assignments" on public.corporation_role_assignments
  for select using (public.is_corporation_member(corporation_id));
create policy "admin manages role assignments" on public.corporation_role_assignments
  for all using (public.has_corporation_role(corporation_id, array['admin']))
  with check (public.has_corporation_role(corporation_id, array['admin']));

-- corporation_creation_requests: requester reads their own; approve/deny
-- is Super Admin only, per doc01 §6 (worth a real "platform reviewer"
-- role once this is more than one person).
alter table public.corporation_creation_requests enable row level security;
create policy "requester reads own creation request" on public.corporation_creation_requests
  for select using (requested_by = auth.uid() or public.is_super_admin());
create policy "any authenticated user can submit a creation request" on public.corporation_creation_requests
  for insert with check (requested_by = auth.uid());
create policy "super admin resolves creation requests" on public.corporation_creation_requests
  for update using (public.is_super_admin());

-- stratasphere_reactivation_requests: same shape as creation requests.
alter table public.stratasphere_reactivation_requests enable row level security;
create policy "requester reads own reactivation request" on public.stratasphere_reactivation_requests
  for select using (requested_by = auth.uid() or public.is_super_admin());
create policy "admin can submit a reactivation request" on public.stratasphere_reactivation_requests
  for insert with check (public.has_corporation_role(corporation_id, array['admin']));
create policy "super admin resolves reactivation requests" on public.stratasphere_reactivation_requests
  for update using (public.is_super_admin());

-- subscriptions: StrataSphere-gated tables need membership AND an
-- active subscription (doc01 §6) — this table itself is readable by any
-- connected member (so the UI can show lock/upgrade state) but writable
-- only via the Stripe webhook path (service-role client, doc04 §7a-style
-- server-only mutation — no direct client write policy).
alter table public.subscriptions enable row level security;
create policy "members can read their subscription state" on public.subscriptions
  for select using (public.is_corporation_member(corporation_id));

-- documents: StrataSphere-gated — membership alone isn't sufficient.
alter table public.documents enable row level security;
create policy "subscribed members can read documents" on public.documents
  for select using (
    public.is_corporation_member(corporation_id)
    and exists (
      select 1 from public.subscriptions
      where corporation_id = documents.corporation_id and status = 'active'
    )
  );
create policy "subscribed members can upload documents" on public.documents
  for insert with check (
    public.is_corporation_member(corporation_id)
    and exists (
      select 1 from public.subscriptions
      where corporation_id = documents.corporation_id and status = 'active'
    )
  );

-- owners_and_council: connected members can read (needed for the
-- PIPA name-to-lot resolution pass and the training-visibility roster);
-- only an admin can write, either via bulk upload or a direct edit
-- (doc02 §2a — application code enforces the blank-means-no-change
-- upload semantics; this policy just gates who can write at all).
alter table public.owners_and_council enable row level security;
create policy "members can read the roster" on public.owners_and_council
  for select using (public.is_corporation_member(corporation_id));
create policy "admin manages the roster" on public.owners_and_council
  for all using (public.has_corporation_role(corporation_id, array['admin']))
  with check (public.has_corporation_role(corporation_id, array['admin']));
