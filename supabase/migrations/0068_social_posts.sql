-- Social posts (2026-10-27): the Super Admin console's Social tab, a
-- carousel builder for Instagram, Facebook, LinkedIn, TikTok and X.
--
-- A post is drafted by the AI from a topic and edited by staff: its slides
-- (text, template and photos) and a caption per platform. Slides are drawn
-- and exported (a ZIP with a folder per platform) in the browser, so
-- nothing here renders images. Uploaded photos live in the private
-- social-media bucket under <post id>/; Unsplash photos are linked.
-- Deleting a post removes its row and its folder for good.
--
-- Grants: server-only. The console reads and writes through the service
-- role after checking the person is a Super Admin (lib/data/admin.ts);
-- anon and authenticated have no access to the table or the bucket.
--
-- Safe to re-run. Run the whole file in one go.

create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  title text not null default '' check (char_length(title) <= 200),
  -- utm_campaign for every link in the post: lower case, digits and hyphens.
  campaign text not null check (campaign ~ '^[a-z0-9][a-z0-9-]{0,59}$'),
  template text not null default 'list' check (template in ('list', 'story', 'editorial')),
  theme text not null default 'paper' check (theme in ('paper', 'accent', 'ink')),
  -- Where the call to action points (lib/social/post.ts).
  destination text not null default 'home' check (destination in ('home', 'signup', 'demo')),
  topic text not null default '' check (char_length(topic) <= 2000),
  audience text not null default 'council' check (audience in ('council', 'managers', 'owners')),
  slides jsonb not null default '[]'::jsonb check (jsonb_typeof(slides) = 'array'),
  captions jsonb not null default '{}'::jsonb check (jsonb_typeof(captions) = 'object'),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists social_posts_updated_idx on public.social_posts (updated_at desc);

alter table public.social_posts enable row level security;
revoke all on public.social_posts from anon, authenticated;
grant all on public.social_posts to service_role;

-- Private: the editor shows uploads through short-lived signed links.
insert into storage.buckets (id, name, public, file_size_limit)
values ('social-media', 'social-media', false, 20971520)
on conflict (id) do nothing;
