-- Enterprise (2026-11-12, docs/learn-decide-remember.md §4).
--
-- Stratas over 100 lots, and management companies, talk to us instead of
-- subscribing themselves:
--
-- 1. enterprise_requests: a "Talk to us" from a strata's billing page (who,
--    why, and what they wrote), for the Super Admin console. The Super
--    Admins are emailed too.
-- 2. enterprise_prices: the price a Super Admin agreed for one strata, per
--    month or per year, before GST. When a strata has one, its billing page
--    offers only that plan, and subscribing charges it (a Stripe Price made
--    for that one subscription).
--
-- Grants: both server-only, like stratasphere_recall_cases (0089): RLS on
-- with no policies; anon and authenticated have no access. The billing page
-- and the console go through the service role after checking the person
-- (billing access, or a two-step-verified Super Admin).
--
-- Safe to re-run.

create table if not exists public.enterprise_requests (
  id uuid primary key default gen_random_uuid(),
  corporation_id text not null references public.strata_corporations(strata_plan_number) on delete cascade on update cascade,
  user_id uuid references public.profiles(id) on delete set null,
  reason text not null check (reason in ('large', 'several')),
  message text not null default '' check (char_length(message) <= 2000),
  created_at timestamptz not null default now(),
  handled_at timestamptz
);
create index if not exists enterprise_requests_open_idx on public.enterprise_requests (created_at desc) where handled_at is null;

create table if not exists public.enterprise_prices (
  corporation_id text primary key references public.strata_corporations(strata_plan_number) on delete cascade on update cascade,
  billing_interval text not null check (billing_interval in ('monthly', 'annual')),
  amount numeric(10, 2) not null check (amount > 0 and amount <= 100000),
  note text not null default '' check (char_length(note) <= 500),
  set_by uuid references public.profiles(id) on delete set null,
  set_at timestamptz not null default now()
);

alter table public.enterprise_requests enable row level security;
alter table public.enterprise_prices enable row level security;
revoke all on public.enterprise_requests from anon, authenticated;
revoke all on public.enterprise_prices from anon, authenticated;
grant all on public.enterprise_requests to service_role;
grant all on public.enterprise_prices to service_role;
