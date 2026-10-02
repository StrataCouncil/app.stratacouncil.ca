-- Strata Plan parsing, building name and verified addresses on creation
-- requests, and several billing contact emails. Safe to run more than
-- once. Run the whole file in one go.
--
-- 1. The lot count comes from the uploaded Strata Plan, not the requester.
--    The server reads the plan, stores what it found in
--    strata_plan_parses (server-only), and the creation request takes its
--    lot count from there. A plan with no text layer (scanned) falls back
--    to a typed count, flagged for the reviewer.
-- 2. Creation requests carry the building name (it isn't on the plan) and
--    whether the civic address was picked from the address lookup.
-- 3. Approval takes the building name too.
-- 4. subscriptions.billing_email may hold several addresses, comma-separated.

-- ── 1. Plan parses (server-only) ───────────────────────────────────────
create table if not exists public.strata_plan_parses (
  storage_path text primary key,          -- path in the strata-plans bucket
  requested_by uuid not null references public.profiles(id) on delete cascade,
  strata_plan_number text not null,       -- the number the requester looked up
  plan_number_matches boolean not null,
  lots int,
  lots_check text check (lots_check in ('consistent', 'differs', 'unchecked')),
  unit_entitlement_total numeric,
  filed_year int,
  status text not null check (status in ('parsed', 'no_text', 'failed')),
  created_at timestamptz not null default now()
);
alter table public.strata_plan_parses enable row level security;
-- No policies: only the server (service role) reads or writes parses.
revoke all on public.strata_plan_parses from authenticated;
grant all on public.strata_plan_parses to service_role;

-- ── 2. Creation request fields ─────────────────────────────────────────
alter table public.corporation_creation_requests add column if not exists building_name text;
alter table public.corporation_creation_requests add column if not exists address_verified boolean not null default false;
alter table public.corporation_creation_requests add column if not exists unit_count_source text not null default 'manual';
alter table public.corporation_creation_requests drop constraint if exists corporation_creation_requests_unit_count_source_check;
alter table public.corporation_creation_requests add constraint corporation_creation_requests_unit_count_source_check
  check (unit_count_source in ('plan', 'manual'));
alter table public.corporation_creation_requests add column if not exists lots_check text;
alter table public.corporation_creation_requests add column if not exists parsed_unit_entitlement_total numeric;
alter table public.corporation_creation_requests add column if not exists parsed_filed_year int;

-- ── 3. Approval takes the building name ────────────────────────────────
drop function if exists public.approve_corporation_creation_request(uuid, text, text, text, int, text);
create or replace function public.approve_corporation_creation_request(
  p_request_id uuid,
  p_strata_plan_number text,
  p_legal_name text,
  p_address text,
  p_unit_count int,
  p_jurisdiction text,
  p_building_name text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.corporation_creation_requests%rowtype;
begin
  if not public.is_super_admin() then
    raise exception 'Only platform staff can approve corporation requests.';
  end if;

  select * into v_request from public.corporation_creation_requests
  where id = p_request_id
  for update;

  if not found or v_request.status <> 'pending' then
    raise exception 'This request has already been resolved.';
  end if;

  if exists (select 1 from public.strata_corporations where strata_plan_number = p_strata_plan_number) then
    raise exception 'Strata Plan % is already on the platform — deny this request and point the requester to the join flow.', p_strata_plan_number;
  end if;

  if p_unit_count is null or p_unit_count < 1 then
    raise exception 'Unit count must be at least 1.';
  end if;

  update public.corporation_creation_requests
    set status = 'approved',
        reviewed_by = auth.uid(),
        resolved_at = now(),
        parsed_strata_plan_number = p_strata_plan_number,
        parsed_legal_name = p_legal_name,
        parsed_address = p_address,
        parsed_unit_count = p_unit_count,
        parsed_jurisdiction = p_jurisdiction,
        building_name = nullif(trim(p_building_name), '')
    where id = p_request_id;

  insert into public.strata_corporations (
    strata_plan_number, legal_name, address, unit_count, jurisdiction, building_name,
    source_document_id, creation_request_id
  ) values (
    p_strata_plan_number, p_legal_name, p_address, p_unit_count, p_jurisdiction,
    nullif(trim(p_building_name), ''),
    v_request.strata_plan_document_id, p_request_id
  );

  update public.documents
    set corporation_id = p_strata_plan_number
    where id = v_request.strata_plan_document_id;

  insert into public.corporation_memberships (user_id, corporation_id, status, joined_at)
  values (v_request.requested_by, p_strata_plan_number, 'active', now());

  insert into public.corporation_role_assignments (corporation_id, role, user_id)
  values (p_strata_plan_number, 'admin', v_request.requested_by);

  return p_strata_plan_number;
end;
$$;

revoke all on function public.approve_corporation_creation_request(uuid, text, text, text, int, text, text) from public;
grant execute on function public.approve_corporation_creation_request(uuid, text, text, text, int, text, text) to authenticated;

-- ── 4. Several billing contact emails ──────────────────────────────────
alter table public.subscriptions drop constraint if exists subscriptions_billing_email_check;
alter table public.subscriptions add constraint subscriptions_billing_email_check
  check (
    billing_email is null
    or billing_email ~* '^[^@\s,]+@[^@\s,]+\.[^@\s,]+(\s*,\s*[^@\s,]+@[^@\s,]+\.[^@\s,]+)*$'
  );
