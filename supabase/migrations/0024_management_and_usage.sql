-- 1. Strata management details (company, logo, managers), printed at the top
--    of agendas and minutes. Per strata for now. Edited by the strata's
--    Admin or Manager only; readable by its members (it's on every agenda).
-- 2. Stratasphere usage: one row per answer (tokens and estimated cost),
--    for the Super Admin dashboard. Written by the server, read by Super
--    Admins only.
--
-- Safe to run more than once. Run the whole file in one go.

-- 1. Management details ---------------------------------------------------

create table if not exists public.strata_management (
  corporation_id text primary key references public.strata_corporations(strata_plan_number) on delete cascade,
  company_name text check (company_name is null or char_length(company_name) <= 200),
  address text check (address is null or char_length(address) <= 300),
  phone text check (phone is null or char_length(phone) <= 60),
  email text check (email is null or char_length(email) <= 200),
  website text check (website is null or char_length(website) <= 300),
  -- [{ "name": "...", "title": "...", "phone": "...", "email": "..." }]
  managers jsonb not null default '[]'::jsonb check (jsonb_typeof(managers) = 'array'),
  logo_path text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

alter table public.strata_management enable row level security;

drop policy if exists "members read management details" on public.strata_management;
create policy "members read management details" on public.strata_management
  for select to authenticated
  using (public.is_corporation_member(corporation_id));

drop policy if exists "admin or manager edits management details" on public.strata_management;
create policy "admin or manager edits management details" on public.strata_management
  for all to authenticated
  using (public.has_corporation_role(corporation_id, array['admin', 'manager']))
  with check (public.has_corporation_role(corporation_id, array['admin', 'manager']));

grant select, insert, update, delete on public.strata_management to authenticated;
grant all on public.strata_management to service_role;

-- Logos: private, small images. Uploaded through signed URLs the server
-- mints after checking Admin or Manager.
insert into storage.buckets (id, name, public, file_size_limit)
values ('management-logos', 'management-logos', false, 2097152)
on conflict (id) do nothing;

-- 2. Stratasphere usage -----------------------------------------------------

create table if not exists public.stratasphere_usage (
  id uuid primary key default gen_random_uuid(),
  corporation_id text not null references public.strata_corporations(strata_plan_number) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  surface text not null check (surface in ('assistant', 'meeting')),
  input_tokens int not null default 0,
  cache_read_tokens int not null default 0,
  cache_write_tokens int not null default 0,
  output_tokens int not null default 0,
  cost_usd numeric(10, 5) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists stratasphere_usage_corp_idx on public.stratasphere_usage (corporation_id, created_at desc);

alter table public.stratasphere_usage enable row level security;

drop policy if exists "super admins read usage" on public.stratasphere_usage;
create policy "super admins read usage" on public.stratasphere_usage
  for select to authenticated
  using (public.is_super_admin());

grant select on public.stratasphere_usage to authenticated;
grant all on public.stratasphere_usage to service_role;
