-- DESTRUCTIVE: deletes every user and all app data. Schema, functions,
-- policies and storage buckets stay. Not a migration — run by hand in the
-- Supabase SQL editor only when starting over.
--
-- Files in Storage are NOT removed by this (Supabase only allows that
-- through the Storage API): empty the `strata-plans`,
-- `corporation-documents` and `avatars` buckets in the dashboard afterwards.

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
  public.documents,
  public.mfa_backup_codes,
  public.profiles
cascade;

delete from auth.users;

commit;

-- Should all be 0.
select
  (select count(*) from auth.users) as users,
  (select count(*) from public.profiles) as profiles,
  (select count(*) from public.strata_corporations) as corporations,
  (select count(*) from public.documents) as documents;
