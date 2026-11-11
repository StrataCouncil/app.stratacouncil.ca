-- Socials editor (2026-11-11, docs/marketing.md): saved layouts. A layout
-- is one slide's design (its background and layers, lib/social/design.ts)
-- saved under a name, to start other slides from. Checked by the server
-- before it's saved; the database keeps it as given.
--
-- Grants: server-only, like social_posts (0068). RLS on with no policies;
-- anon and authenticated have no access; the console reads and writes
-- through the service role after checking the person is a Super Admin.
--
-- Safe to re-run.

create table if not exists public.social_layouts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  design jsonb not null check (jsonb_typeof(design) = 'object'),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists social_layouts_created_idx on public.social_layouts (created_at desc);

alter table public.social_layouts enable row level security;
revoke all on public.social_layouts from anon, authenticated;
grant all on public.social_layouts to service_role;
