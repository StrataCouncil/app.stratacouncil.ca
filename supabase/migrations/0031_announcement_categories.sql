-- Announcements on every strata's Overview too (2026-10-07): news from
-- StrataCouncil.ca to all customers, subscribed or not. Adds a category
-- (new feature, change, training, Library, legislation, general) and lets
-- a link point to a page inside the app (/training, a Library item)
-- as well as an https:// address.
--
-- Safe to run more than once. Run the whole file in one go.

alter table public.announcements
  add column if not exists category text not null default 'general';

alter table public.announcements drop constraint if exists announcements_category_check;
alter table public.announcements
  add constraint announcements_category_check
  check (category in ('general', 'feature', 'change', 'training', 'library', 'legislation'));

alter table public.announcements drop constraint if exists announcements_link_url_check;
alter table public.announcements
  add constraint announcements_link_url_check
  check (link_url is null or link_url ~ '^https://' or link_url ~ '^/[^/]');
