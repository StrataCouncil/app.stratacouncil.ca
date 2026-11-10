-- Social posts (2026-11-10): the slide numbers ("01 / 05") can be turned
-- on or off for each post. null means automatic: shown when the post has
-- two or more slides, hidden on a single slide (lib/social/post.ts).
--
-- Grants: unchanged. social_posts stays server-only (service role); anon
-- and authenticated still have no access.
--
-- Safe to re-run.

alter table public.social_posts add column if not exists show_slide_numbers boolean;
