-- Stratasphere recall check (2026-11-12, docs/learn-decide-remember.md §7).
--
-- Test cases for "does Stratasphere see the records that answer this
-- question?", and the result of each run. A case is a question asked of one
-- strata (optionally about one agenda item, as in Meeting Mode), the records
-- that hold the answer (documents, ledger decisions, and phrases that must
-- reach the model), and optionally phrases the answer itself must state.
--
-- The finding check builds the request exactly as Stratasphere would and
-- looks for those records in it, without calling the AI. The answering check
-- also asks the AI, and records what that cost. No change to how Stratasphere
-- finds records ships unless every case passes the finding check.
--
-- Cases hold real strata records, so they live here, never in the code.
--
-- Grants: both tables are server-only, like social_templates (0088): RLS on
-- with no policies; anon and authenticated have no access; the Super Admin
-- console reads and writes through the service role after checking the
-- person is a Super Admin in a two-step-verified session.
--
-- Safe to re-run.

create table if not exists public.stratasphere_recall_cases (
  id uuid primary key default gen_random_uuid(),
  corporation_id text not null references public.strata_corporations(strata_plan_number) on delete cascade,
  question text not null check (char_length(question) between 1 and 4000),
  -- Asked about one agenda item (Meeting Mode), or neither.
  meeting_id uuid references public.meetings(id) on delete set null,
  item_id text check (item_id is null or char_length(item_id) <= 100),
  expect_documents uuid[] not null default '{}',
  expect_decisions uuid[] not null default '{}',
  -- Must appear in what's sent to the model (after PII stripping).
  expect_phrases text[] not null default '{}' check (cardinality(expect_phrases) <= 20),
  -- Must appear in the answer (answering check only).
  answer_phrases text[] not null default '{}' check (cardinality(answer_phrases) <= 20),
  note text not null default '' check (char_length(note) <= 1000),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stratasphere_recall_cases_item_needs_meeting check (item_id is null or meeting_id is not null)
);
create index if not exists stratasphere_recall_cases_corp_idx on public.stratasphere_recall_cases (corporation_id, created_at);

create table if not exists public.stratasphere_recall_runs (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.stratasphere_recall_cases(id) on delete cascade,
  kind text not null check (kind in ('find', 'answer')),
  passed boolean not null,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  cost_usd numeric(10, 5) not null default 0 check (cost_usd >= 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists stratasphere_recall_runs_case_idx on public.stratasphere_recall_runs (case_id, created_at desc);

alter table public.stratasphere_recall_cases enable row level security;
alter table public.stratasphere_recall_runs enable row level security;
revoke all on public.stratasphere_recall_cases from anon, authenticated;
revoke all on public.stratasphere_recall_runs from anon, authenticated;
grant all on public.stratasphere_recall_cases to service_role;
grant all on public.stratasphere_recall_runs to service_role;
