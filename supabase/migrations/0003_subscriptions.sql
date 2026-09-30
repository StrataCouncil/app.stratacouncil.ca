-- doc01 §4b — StrataSphere subscription lifecycle, separate from
-- corporation existence (corporations are free; StrataSphere is paid).

create table public.subscriptions (
  corporation_id text primary key references public.strata_corporations(strata_plan_number),
  status text not null default 'deactivated'
    check (status in ('active', 'deactivated')),  -- binary, no past_due — doc01 §4b
  billing_interval text
    check (billing_interval in ('monthly', 'annual')),
  stripe_customer_id text,
  stripe_subscription_id text,
  unit_count int,                      -- mirrors strata_corporations.unit_count for billing quantity
  activated_at timestamptz
);

create table public.stratasphere_reactivation_requests (
  id uuid primary key default gen_random_uuid(),
  corporation_id text not null references public.strata_corporations(strata_plan_number),
  requested_by uuid not null references public.profiles(id),
  proof_document_id uuid references public.documents(id),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'denied')),
  reviewed_by uuid references public.profiles(id),
  requested_at timestamptz not null default now(),
  resolved_at timestamptz
);
