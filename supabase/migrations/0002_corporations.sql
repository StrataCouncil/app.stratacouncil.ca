-- doc01 §1, §4 — Corporation creation (reviewed), strata_corporations,
-- membership, invites, join requests, and role assignments.

-- documents is forward-referenced by corporation_creation_requests below
-- (the uploaded Strata Plan) but its full definition belongs to the
-- StrataSphere-tier tables migration — declared minimally here and
-- extended later isn't an option in Postgres, so this migration defines
-- the column set documents needs for that reference to resolve. The
-- fuller StrataSphere-tier documents/meetings/decisions tables come in
-- a later migration once the document-indexing pipeline (doc04 §5) is
-- being built; this is just enough for the FK below to exist.
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  corporation_id text,                 -- FK added once strata_corporations exists, below
  category text,
  title text,
  storage_path text,
  supersedes_document_id uuid references public.documents(id),
  is_current boolean not null default true,
  uploaded_by uuid references public.profiles(id),
  uploaded_at timestamptz not null default now()
);

create table public.corporation_creation_requests (
  id uuid primary key default gen_random_uuid(),
  strata_plan_document_id uuid references public.documents(id),
  parsed_strata_plan_number text,
  parsed_legal_name text,
  parsed_address text,
  parsed_unit_count int,
  parsed_jurisdiction text,
  requested_by uuid not null references public.profiles(id),
  attestation_full_name text,
  attestation_address text,
  attestation_email text,
  attestation_phone text,
  attestation_confirmed boolean not null default false,
  attestation_confirmed_at timestamptz,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'denied')),
  reviewed_by uuid references public.profiles(id),
  requested_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table public.strata_corporations (
  strata_plan_number text primary key,  -- e.g. 'BCS-1234'
  legal_name text not null,
  address text not null,
  unit_count int not null,
  jurisdiction text not null,
  building_name text,                   -- the one editable identity field
  source_document_id uuid references public.documents(id),
  creation_request_id uuid references public.corporation_creation_requests(id),
  free_meeting_used boolean not null default false,
  free_meeting_used_at timestamptz,
  free_meeting_ai_requests_used int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.documents
  add constraint documents_corporation_id_fkey
  foreign key (corporation_id) references public.strata_corporations(strata_plan_number);

create table public.corporation_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  corporation_id text not null references public.strata_corporations(strata_plan_number),
  status text not null default 'invited'
    check (status in ('active', 'invited', 'removed')),
  invited_by uuid references public.profiles(id),
  joined_at timestamptz,
  can_create_meetings boolean not null default false,
  can_chair_meetings boolean not null default false,
  unique (user_id, corporation_id)
);

create table public.corporation_join_requests (
  id uuid primary key default gen_random_uuid(),
  corporation_id text not null references public.strata_corporations(strata_plan_number),
  requested_by uuid not null references public.profiles(id),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'denied')),
  reviewed_by uuid references public.profiles(id),
  requested_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table public.corporation_invites (
  id uuid primary key default gen_random_uuid(),
  corporation_id text not null references public.strata_corporations(strata_plan_number),
  invited_email text not null,
  invited_by uuid not null references public.profiles(id),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'revoked')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

create table public.corporation_role_assignments (
  corporation_id text not null references public.strata_corporations(strata_plan_number),
  role text not null
    check (role in ('admin', 'president', 'vice_president', 'treasurer', 'secretary', 'manager')),
  user_id uuid not null references public.profiles(id),
  assigned_at timestamptz not null default now(),
  primary key (corporation_id, role, user_id)
);

-- Enforces "one holder" for admin and the officer roles; 'manager' is
-- exempt (a management company can have multiple simultaneous holders).
create unique index corporation_role_assignments_one_holder
  on public.corporation_role_assignments (corporation_id, role)
  where role <> 'manager';

-- BC SPA Standard Bylaw 13(2): president and vice_president must be two
-- different people. Scoped to jurisdiction = 'BC' deliberately — doc01 §4.
create or replace function public.enforce_bc_president_vp_distinct()
returns trigger
language plpgsql
as $$
declare
  corp_jurisdiction text;
  other_role text;
begin
  if new.role not in ('president', 'vice_president') then
    return new;
  end if;

  select jurisdiction into corp_jurisdiction
  from public.strata_corporations
  where strata_plan_number = new.corporation_id;

  if corp_jurisdiction <> 'BC' then
    return new;
  end if;

  other_role := case when new.role = 'president' then 'vice_president' else 'president' end;

  if exists (
    select 1 from public.corporation_role_assignments
    where corporation_id = new.corporation_id
      and user_id = new.user_id
      and role = other_role
  ) then
    raise exception 'BC SPA Standard Bylaw 13(2): president and vice president must be different people';
  end if;

  return new;
end;
$$;

create trigger bc_president_vp_distinct
  before insert or update on public.corporation_role_assignments
  for each row execute function public.enforce_bc_president_vp_distinct();
