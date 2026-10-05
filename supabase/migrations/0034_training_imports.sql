-- Council Training: the AI module builder. A Super Admin gives it one or
-- more documents (uploads, entries already in the legislation library, or
-- both); the AI breaks them into proposed modules (the plan), the Super Admin
-- reviews the plan, then the AI writes the chosen modules as unpublished
-- drafts for editing in the Module Builder. Safe to run more than once.
-- Run the whole file in one go.

create table if not exists public.training_imports (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 200),
  -- [{ kind: 'upload', path, fileName, mimeType } | { kind: 'library', legislationId, title }]
  sources jsonb not null default '[]'::jsonb,
  -- The track the modules are meant for; null lets the AI suggest one per module.
  track_id uuid references public.training_tracks(id) on delete set null,
  instructions text not null default '' check (char_length(instructions) <= 2000),
  -- The documents' text after PII stripping: the only form the AI ever sees.
  source_text text,
  status text not null default 'queued'
    check (status in ('queued', 'reading', 'planning', 'planned', 'building', 'built', 'failed', 'needs_text', 'not_readable')),
  -- { summary, modules: [{ key, include, title, trackCode, summary, estimatedMinutes,
  --   objectives[], sections: [{ title, keyPoints[] }], status, moduleId, error }] }
  plan jsonb,
  error text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists training_imports_created_idx on public.training_imports (created_at desc);

alter table public.training_imports enable row level security;
drop policy if exists "super admins" on public.training_imports;
create policy "super admins" on public.training_imports
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());
grant select, insert, update, delete on public.training_imports to authenticated;
grant all on public.training_imports to service_role;

-- Where an AI-drafted module came from, so the builder can say so until
-- someone has checked it and published.
alter table public.training_modules
  add column if not exists source_import_id uuid references public.training_imports(id) on delete set null;
alter table public.training_modules
  add column if not exists ai_drafted boolean not null default false;

-- Private bucket: written with signed upload URLs minted for Super Admins,
-- read only by the background job (service role).
insert into storage.buckets (id, name, public, file_size_limit)
values ('training-imports', 'training-imports', false, 52428800)
on conflict (id) do nothing;
