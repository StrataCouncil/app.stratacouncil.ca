-- The Library (2026-10-09): playbooks, guides and templates, written by
-- platform staff and shared by every strata. General BC content, nothing
-- about a particular strata. Replaces the hard-coded sample articles one
-- item at a time (the samples stay, labelled "Sample", until replaced).
--
-- Each item has a draft, which staff edit in the Super Admin console, and
-- a published copy, which is what members read. Policy templates are for
-- subscribers, so nothing here is readable through the API by members:
-- the app reads it with the service role, after checking access.
--
-- Safe to re-run. Paste the whole file into an empty SQL editor tab.

create table if not exists public.library_resources (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'playbook',
  title text not null default '',
  summary text not null default '',
  tags text[] not null default '{}',
  -- The item as staff edit it: text in the Library's markup
  -- (lib/library/markup.ts), the Legislation Library sections it cites
  -- ([{chunkId, label}]), and the statements the AI flagged for checking.
  draft_markup text not null default '',
  draft_sources jsonb not null default '[]'::jsonb,
  claims jsonb not null default '[]'::jsonb,
  -- What members read: {kind, title, summary, tags, markup, sources}, or
  -- null while it isn't published.
  published jsonb,
  published_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.library_resources drop constraint if exists library_resources_kind_check;
alter table public.library_resources add constraint library_resources_kind_check
  check (kind in ('playbook', 'emergency_playbook', 'policy_template', 'operational_guide', 'financial_insight', 'legislation_update'));

create index if not exists library_resources_published_idx on public.library_resources (published_at desc) where published is not null;

alter table public.library_resources enable row level security;
revoke all on public.library_resources from anon, authenticated;
grant all on public.library_resources to service_role;
