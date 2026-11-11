-- Socials editor, part 2 (2026-11-11, docs/marketing.md).
--
-- 1. Post templates: a whole carousel (its slides, their designs, and the
--    slide-number setting) saved under a name, to start new posts from.
--    The built-in templates live in the code (lib/social/templates.ts);
--    this table holds the ones saved from the editor. Checked by the
--    server before it's saved; uploaded photos and videos aren't kept
--    (they belong to one post).
-- 2. Video in the private social-media bucket: uploads (MP4 or MOV) and
--    clips copied from Pixabay, up to 200 MB a file. The bucket now names
--    the file types it takes: the three picture types it already held,
--    plus the two video types.
--
-- Grants: social_templates is server-only, like social_posts (0068) and
-- social_layouts (0087): RLS on with no policies; anon and authenticated
-- have no access; the console reads and writes through the service role
-- after checking the person is a Super Admin. The bucket stays private,
-- with no storage policies: files go up through one-time signed upload
-- links made by the server, and are shown through short-lived signed
-- links. Grants on the bucket are unchanged.
--
-- Safe to re-run.

create table if not exists public.social_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  description text not null default '' check (char_length(description) <= 200),
  slides jsonb not null check (jsonb_typeof(slides) = 'array'),
  show_slide_numbers boolean,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists social_templates_created_idx on public.social_templates (created_at desc);

alter table public.social_templates enable row level security;
revoke all on public.social_templates from anon, authenticated;
grant all on public.social_templates to service_role;

update storage.buckets
   set file_size_limit = 209715200,
       allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/quicktime']
 where id = 'social-media';
