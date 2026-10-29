-- People's activity for the Super Admin console's Users tab (2026-10-29).
--
-- What the app didn't already record about a person's use of it: Library
-- guides opened and templates downloaded, strata documents opened and
-- downloaded, and agenda and minutes exports. Everything else on the tab
-- (training, stratas and roles, Stratasphere question counts, meetings)
-- comes from the tables that already hold it.
--
-- What's kept is what happened and when, never content: a guide's title
-- (staff-written Library content) or, for a strata document, only its
-- category, since a document's own title can name an owner. Nothing from
-- Stratasphere conversations is logged here or shown on the tab.
--
-- The strata column is deliberately not called corporation_id: account
-- deletion (platform_delete_person, 0047/0048) refuses to delete a person
-- whose rows carry a corporation_id, and this log should go with the
-- person. Deleting a strata clears the column instead (on delete set null).
--
-- Retention: 24 months. Each insert also deletes every row older than
-- that (an indexed range delete, so it stays cheap).
--
-- Grants: server-only. The app writes through the service role after the
-- page or route has checked the person's access to the strata, and the
-- console reads through the service role after requireSuperAdmin()
-- (lib/data/admin.ts). anon and authenticated have no access.
--
-- Safe to re-run.

create table if not exists public.user_activity (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in (
    'guide_opened',
    'template_downloaded',
    'document_viewed',
    'document_downloaded',
    'agenda_downloaded',
    'minutes_downloaded'
  )),
  strata text references public.strata_corporations(strata_plan_number) on delete set null on update cascade,
  -- The guide, document or meeting it was about.
  ref text check (char_length(ref) <= 100),
  -- A guide's title, a document's category, or the file exported.
  label text check (char_length(label) <= 200),
  created_at timestamptz not null default now()
);
create index if not exists user_activity_user_idx on public.user_activity (user_id, created_at desc);
create index if not exists user_activity_created_idx on public.user_activity (created_at);

alter table public.user_activity enable row level security;
revoke all on public.user_activity from anon, authenticated;
grant all on public.user_activity to service_role;

create or replace function public.user_activity_prune()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.user_activity where created_at < now() - interval '24 months';
  return null;
end;
$$;
revoke all on function public.user_activity_prune() from public, anon, authenticated;

drop trigger if exists user_activity_prune on public.user_activity;
create trigger user_activity_prune
  after insert on public.user_activity
  for each statement execute function public.user_activity_prune();
