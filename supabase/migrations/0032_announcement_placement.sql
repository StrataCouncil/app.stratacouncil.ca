-- Where an announcement shows (2026-10-08): the Home page, every strata's
-- Overview, or both. Existing announcements keep showing in both.
--
-- Safe to run more than once. Run the whole file in one go.

alter table public.announcements
  add column if not exists show_on_home boolean not null default true;
alter table public.announcements
  add column if not exists show_on_overview boolean not null default true;

alter table public.announcements drop constraint if exists announcements_placement_check;
alter table public.announcements
  add constraint announcements_placement_check
  check (show_on_home or show_on_overview);
