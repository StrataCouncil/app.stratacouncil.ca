-- "Download everything" (2026-10-21): a strata's Admin can download all of
-- its documents as one ZIP. For safety the download isn't immediate: we
-- email the Admin a link that works once, for 24 hours, and only while
-- they're signed in. Each row is one request, kept as the record of who
-- exported the strata's documents and when. Only a hash of the link's
-- token is stored.
--
-- Safe to run more than once. Run the whole file in one go.

create table if not exists public.document_exports (
  id uuid primary key default gen_random_uuid(),
  corporation_id text not null references public.strata_corporations(strata_plan_number) on delete cascade on update cascade,
  requested_by uuid references public.profiles(id) on delete set null,
  token_hash text not null unique check (char_length(token_hash) = 64),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  -- When the emailed link was opened (it works once).
  opened_at timestamptz
);
create index if not exists document_exports_corporation_idx on public.document_exports (corporation_id, created_at desc);

-- The server (service role) makes and checks these; nobody else reads them.
alter table public.document_exports enable row level security;
revoke all on public.document_exports from anon, authenticated;
grant all on public.document_exports to service_role;
