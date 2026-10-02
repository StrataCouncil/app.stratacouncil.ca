-- DESTRUCTIVE: deletes every user except Super Admins, and all strata data.
-- Schema, functions, policies and storage buckets stay. Not a migration:
-- run by hand in the Supabase SQL editor only when starting over. Run the
-- whole file in one go, in an empty tab.
--
-- Kept:
--   - Super Admin accounts (profiles.is_super_admin), with their profile
--     and two-factor setup. They lose every strata connection.
--   - The legislation library: its entries and their indexed passages
--     (knowledge_chunks with scope 'legislation').
--
-- Removed: every strata and everything in it (members, roles, invites,
-- join requests, roster, documents and their indexing, meetings, notes,
-- decisions, subscriptions, Stratasphere conversations), the
-- cross-platform precedent pool, creation requests and Strata Plan
-- parses, and every non-Super-Admin account.
--
-- Files in Storage are NOT removed by this (Supabase only allows that
-- through the Storage API). Afterwards, empty these buckets in the
-- dashboard: `strata-plans`, `corporation-documents`, `avatars`.
-- Leave the `legislation` bucket alone. A kept Super Admin's photo will be
-- missing after `avatars` is emptied; upload it again.

begin;

-- Stratasphere conversations (messages and projects go with them).
delete from public.conversation_messages;
delete from public.conversations;
delete from public.conversation_projects;

-- The knowledge base, except the legislation library.
delete from public.knowledge_chunks where scope <> 'legislation';

-- Stratas, documents and requests point at each other; unlink them first.
update public.strata_corporations set source_document_id = null, creation_request_id = null;
update public.documents set supersedes_document_id = null;

-- Meetings, the decision ledger, documents and the requests that cite them.
delete from public.decisions;
delete from public.meeting_item_notes;
delete from public.stratasphere_reactivation_requests;
delete from public.corporation_creation_requests;
delete from public.strata_plan_parses;
delete from public.documents;
delete from public.meetings;

-- People, roles and billing in each strata.
delete from public.owners_and_council;
delete from public.corporation_role_assignments;
delete from public.corporation_memberships;
delete from public.corporation_join_requests;
delete from public.corporation_invites;
delete from public.subscriptions;

-- The stratas themselves.
delete from public.strata_corporations;

update public.profiles set avatar_path = null where is_super_admin;

-- Deleting the auth user removes their profile and backup codes too.
delete from auth.users
where id not in (select id from public.profiles where is_super_admin);

commit;

-- Expected: users = profiles = super_admins; corporations, documents,
-- conversations and other_chunks 0; legislation entries and chunks as before.
select
  (select count(*) from auth.users) as users,
  (select count(*) from public.profiles) as profiles,
  (select count(*) from public.profiles where is_super_admin) as super_admins,
  (select count(*) from public.strata_corporations) as corporations,
  (select count(*) from public.documents) as documents,
  (select count(*) from public.conversations) as conversations,
  (select count(*) from public.knowledge_chunks where scope <> 'legislation') as other_chunks,
  (select count(*) from public.legislation_documents) as legislation_entries,
  (select count(*) from public.knowledge_chunks where scope = 'legislation') as legislation_chunks;
