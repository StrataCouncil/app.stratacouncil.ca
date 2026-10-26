-- Demo requests (2026-10-26): the "Request a demo" form on stratacouncil.ca.
--
-- The marketing site posts the form to /api/demo-requests; the request is
-- kept here and platform staff are emailed a notice that links to the
-- Super Admin console (Demo tab). There, one click makes the person's demo
-- link and emails it (or the request is dismissed). A handled request is
-- deleted 30 days later, the same as demo links.
--
-- Grants: the server (service role) does everything; Super Admins can
-- read in the console. Nobody else can read or write it.
--
-- Safe to re-run. Run the whole file in one go.

create table if not exists public.demo_requests (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(full_name) between 1 and 120),
  email text not null check (email = lower(email) and char_length(email) between 3 and 254),
  -- Where the form was: the home page or the old Coming soon page.
  source text not null default 'home' check (source in ('home', 'coming-soon')),
  -- The campaign tags the visitor first arrived with (lib/campaign.ts), if any.
  campaign jsonb,
  created_at timestamptz not null default now(),
  handled_at timestamptz,
  outcome text check (outcome in ('sent', 'dismissed')),
  handled_by_name text,
  constraint demo_requests_handled check ((handled_at is null) = (outcome is null))
);
create index if not exists demo_requests_waiting_idx on public.demo_requests (created_at desc) where handled_at is null;
create index if not exists demo_requests_email_idx on public.demo_requests (email, created_at desc);

alter table public.demo_requests enable row level security;
revoke all on public.demo_requests from anon, authenticated;
grant select on public.demo_requests to authenticated;
grant all on public.demo_requests to service_role;

drop policy if exists "super admins read demo requests" on public.demo_requests;
create policy "super admins read demo requests" on public.demo_requests for select to authenticated using (public.is_super_admin());
