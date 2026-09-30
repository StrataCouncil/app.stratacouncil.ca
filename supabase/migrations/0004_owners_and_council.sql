-- doc02 §2/§2a — the owner/lot roster. Pre-seeded with one blank row per
-- lot the moment a corporation is created (unit_count is fixed at
-- creation from the parsed Strata Plan, doc01 §4), so a roster upload is
-- always an update against known rows, never a bulk insert.

create table public.owners_and_council (
  id uuid primary key default gen_random_uuid(),
  corporation_id text not null references public.strata_corporations(strata_plan_number),
  full_name text,
  lot_number text not null,            -- e.g. 'SL001' — the AI-facing identifier, doc02 §2
  email text,                          -- registered owner's contact email — doc02 §2a
  unit_number text,
  unit_entitlement numeric,
  owner_type text
    check (owner_type is null or owner_type in ('owner', 'tenant', 'strata_agent')),
  parking text,
  storage text,
  bike_rack text,
  strata_fees numeric,
  council_member_name text,            -- admin-set in-app only — never CSV-uploadable, doc02 §2a
  council_email text,                  -- admin-set in-app only — never CSV-uploadable, doc02 §2a
  is_council_member boolean not null default false,  -- admin-set only, doc02 §2a
  role text                            -- admin-set only, doc02 §2a
    check (role is null or role in ('president', 'vice_president', 'treasurer', 'secretary')),
  updated_at timestamptz not null default now(),

  unique (corporation_id, lot_number)  -- the roster-upload upsert key, doc02 §2a
);

-- Pre-seeds SL001..SL{unit_count} the moment a corporation is created,
-- so lot rows always exist before any roster upload touches them.
create or replace function public.seed_owners_and_council()
returns trigger
language plpgsql
as $$
declare
  i int;
begin
  for i in 1..new.unit_count loop
    insert into public.owners_and_council (corporation_id, lot_number)
    values (new.strata_plan_number, 'SL' || lpad(i::text, 3, '0'));
  end loop;
  return new;
end;
$$;

create trigger seed_owners_and_council_on_corp_create
  after insert on public.strata_corporations
  for each row execute function public.seed_owners_and_council();

create or replace function public.touch_owners_and_council_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger owners_and_council_touch_updated_at
  before update on public.owners_and_council
  for each row execute function public.touch_owners_and_council_updated_at();
