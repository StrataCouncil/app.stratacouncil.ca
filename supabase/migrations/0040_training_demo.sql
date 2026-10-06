-- Council Training demo links (2026-10-06): a link that opens Council
-- Training without signing in, for outside feedback (e.g. BCREA).
--
-- training_demo_links: one per audience. The token is the secret in the
--   link; a link can expire or be revoked. include_drafts shows modules'
--   latest drafts instead of only published versions.
-- training_feedback: comments left from a demo link, on a module and
--   screen. Visitors' progress is never stored; only what they choose to
--   send as feedback.
--
-- Both are Super Admin only under RLS. Demo pages and feedback go through
-- the server (service role), which checks the token first.
--
-- Safe to re-run.

create table if not exists public.training_demo_links (
  id uuid primary key default gen_random_uuid(),
  token text not null unique check (char_length(token) between 20 and 64),
  label text not null check (char_length(label) between 1 and 120),
  include_drafts boolean not null default false,
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.training_feedback (
  id uuid primary key default gen_random_uuid(),
  link_id uuid references public.training_demo_links(id) on delete set null,
  link_label text not null default '',
  module_id uuid references public.training_modules(id) on delete set null,
  module_title text not null default '',
  screen_id text,
  screen_title text not null default '',
  name text not null default '' check (char_length(name) <= 120),
  message text not null check (char_length(message) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists training_feedback_created_idx on public.training_feedback (created_at desc);

alter table public.training_demo_links enable row level security;
alter table public.training_feedback enable row level security;

drop policy if exists "super admins manage demo links" on public.training_demo_links;
create policy "super admins manage demo links" on public.training_demo_links
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists "super admins read and clear feedback" on public.training_feedback;
create policy "super admins read and clear feedback" on public.training_feedback
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

grant select, insert, update, delete on public.training_demo_links, public.training_feedback to authenticated;
grant all on public.training_demo_links, public.training_feedback to service_role;
