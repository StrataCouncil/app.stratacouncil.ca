-- DESTRUCTIVE: deletes every user except Super Admins, and all app data.
-- Schema, functions, policies and storage buckets stay. Not a migration —
-- run by hand in the Supabase SQL editor only when starting over. Run the
-- whole file in one go.
--
-- Super Admin accounts (profiles.is_super_admin) are kept, with their
-- profile and two-factor setup, so nobody has to re-grant Super Admin
-- after a sweep. They lose every strata connection like everyone else.
--
-- Files in Storage are NOT removed by this (Supabase only allows that
-- through the Storage API): empty the `strata-plans`,
-- `corporation-documents` and `avatars` buckets in the dashboard afterwards.
-- A kept Super Admin's photo will then be missing; upload it again.

begin;

truncate table
  public.knowledge_chunks,
  public.decisions,
  public.meeting_item_notes,
  public.meetings,
  public.owners_and_council,
  public.corporation_role_assignments,
  public.corporation_memberships,
  public.corporation_join_requests,
  public.corporation_invites,
  public.stratasphere_reactivation_requests,
  public.subscriptions,
  public.strata_corporations,
  public.corporation_creation_requests,
  public.documents;

update public.profiles set avatar_path = null where is_super_admin;

-- Deleting the auth user removes their profile and backup codes too.
delete from auth.users
where id not in (select id from public.profiles where is_super_admin);

commit;

-- Users and profiles should equal the number of Super Admins; the rest 0.
select
  (select count(*) from auth.users) as users,
  (select count(*) from public.profiles) as profiles,
  (select count(*) from public.profiles where is_super_admin) as super_admins,
  (select count(*) from public.strata_corporations) as corporations,
  (select count(*) from public.documents) as documents;
