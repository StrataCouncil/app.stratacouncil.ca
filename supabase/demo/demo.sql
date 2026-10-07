-- The demo site's own tables and functions (demo.stratacouncil.ca).
--
-- Applied to the demo database only, never to the live one: the
-- "Demo database" GitHub Action runs every migration that hasn't run there
-- yet, then this file, on every push to main. Safe to re-run.
--
-- demo_visitors: one row per personal demo link. The live site's Super
--   Admin console makes the row (name, email, link) through the demo
--   project's service-role key; the demo site reads it when the link is
--   opened, creates the visitor's account and their own copy of the
--   fictional strata, and signs them in. Links stop working at midnight
--   Pacific on the day they were made, and that night's clean-up deletes
--   the visitor's strata and account. The row itself (name, email, link)
--   is deleted 7 days after the link expired.
--
-- Nothing here is reachable by signed-in visitors: RLS is on with no
-- policies, and the functions are for the service role only.

create table if not exists public.demo_visitors (
  id uuid primary key default gen_random_uuid(),
  token text not null unique check (char_length(token) between 32 and 64),
  full_name text not null check (char_length(full_name) between 1 and 120),
  email text not null check (char_length(email) between 3 and 320),
  expires_at timestamptz not null,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  -- Filled in when the link is first opened. No foreign keys: the
  -- account and the strata are deleted at midnight, the row stays a week.
  user_id uuid,
  corporation_id text,
  setup_started_at timestamptz,
  first_opened_at timestamptz,
  last_opened_at timestamptz,
  wiped_at timestamptz
);
-- The fictional people who appear in every visitor's strata (council
-- members, the manager, the person asking to join). Shared by every copy
-- and never deleted by the nightly clean-up.
create table if not exists public.demo_cast (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  part text not null default ''
);
alter table public.demo_cast enable row level security;
revoke all on public.demo_cast from anon, authenticated;
grant all on public.demo_cast to service_role;

-- Where the link opens: the visitor's strata (the Stratasphere) or
-- Council Training. Chosen in the console; either way they get a strata.
alter table public.demo_visitors add column if not exists landing text not null default 'strata';
alter table public.demo_visitors drop constraint if exists demo_visitors_landing_check;
alter table public.demo_visitors add constraint demo_visitors_landing_check check (landing in ('strata', 'training'));

-- Search vectors for the fictional strata's documents, by a hash of the
-- (PII-stripped) passage: every visitor's strata has the same documents,
-- so each passage is sent to the embeddings service once, not per visitor.
create table if not exists public.demo_kit_embeddings (
  text_hash text primary key check (char_length(text_hash) = 64),
  embedding extensions.vector(1024) not null,
  created_at timestamptz not null default now()
);
alter table public.demo_kit_embeddings enable row level security;
revoke all on public.demo_kit_embeddings from anon, authenticated;
grant all on public.demo_kit_embeddings to service_role;

create index if not exists demo_visitors_email_idx on public.demo_visitors (lower(email), expires_at desc);

alter table public.demo_visitors enable row level security;
revoke all on public.demo_visitors from anon, authenticated;
grant all on public.demo_visitors to service_role;

-- ── Deleting a visitor's copy ───────────────────────────────────────────
--
-- demo_delete_rows deletes the rows of p_table matching p_condition and,
-- first, every row anywhere that refers to them, following the foreign
-- keys in the catalog (like ON DELETE CASCADE on every key). It reads the
-- keys each time it runs, so tables added by later migrations are covered
-- without changing this file. A key that loops back to a table already
-- being deleted from (documents.supersedes_document_id, or
-- strata_corporations.source_document_id) is cleared instead of followed.
-- Keys the database already handles (ON DELETE SET NULL / SET DEFAULT)
-- are left to it.
--
-- p_condition is SQL. Only this file calls it, with conditions built from
-- quoted values; nobody else can execute it.
create or replace function public.demo_delete_rows(p_table regclass, p_condition text, p_path regclass[] default '{}')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  fk record;
  child_condition text;
begin
  if array_length(p_path, 1) >= 12 then
    raise exception 'demo_delete_rows: foreign keys nested too deep under %', p_table;
  end if;

  for fk in
    select c.conrelid::regclass as child,
           c.confdeltype as on_delete,
           (select string_agg(quote_ident(a.attname), ', ' order by k.ord)
              from unnest(c.conkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as child_cols,
           (select string_agg(quote_ident(a.attname), ', ' order by k.ord)
              from unnest(c.confkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum) as parent_cols,
           (select string_agg(quote_ident(a.attname) || ' = null', ', ' order by k.ord)
              from unnest(c.conkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as set_null,
           (select bool_and(not a.attnotnull)
              from unnest(c.conkey) k(attnum)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as nullable
    from pg_constraint c
    where c.contype = 'f' and c.confrelid = p_table
    order by c.conrelid::regclass::text, c.conname
  loop
    if fk.on_delete in ('n', 'd') then
      continue;
    end if;
    child_condition := format('(%s) in (select %s from %s where %s)', fk.child_cols, fk.parent_cols, p_table, p_condition);
    if fk.child = p_table or fk.child = any(p_path) then
      if fk.nullable then
        execute format('update %s set %s where %s', fk.child, fk.set_null, child_condition);
      end if;
      continue;
    end if;
    perform public.demo_delete_rows(fk.child, child_condition, p_path || p_table);
  end loop;

  execute format('delete from %s where %s', p_table, p_condition);
end;
$$;

revoke all on function public.demo_delete_rows(regclass, text, regclass[]) from public, anon, authenticated, service_role;

-- A visitor's copy of the fictional strata, and everything in it.
create or replace function public.demo_delete_strata(p_corporation_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_corporation_id is null or p_corporation_id not like 'DEMO-%' then
    raise exception 'Only a demo strata can be deleted here.';
  end if;
  perform public.demo_delete_rows('public.strata_corporations'::regclass,
    format('strata_plan_number = %L', p_corporation_id));
end;
$$;

-- What a person left behind outside a strata (Council Training progress,
-- their profile). The account itself is deleted through Supabase Auth
-- afterwards, by the app.
create or replace function public.demo_delete_person(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.profiles where id = p_user_id and is_super_admin)
     or exists (select 1 from public.demo_cast where user_id = p_user_id) then
    raise exception 'Only a visitor''s own account can be deleted here.';
  end if;
  perform public.demo_delete_rows('public.profiles'::regclass, format('id = %L', p_user_id));
end;
$$;

-- Accounts that exist only because of this strata (the visitor, and
-- anyone they invited), to delete along with it. Never the fictional
-- people, a Super Admin, or anyone who is also in another strata.
create or replace function public.demo_strata_people(p_corporation_id text)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.user_id from public.corporation_memberships m
  where m.corporation_id = p_corporation_id
    and not exists (select 1 from public.demo_cast c where c.user_id = m.user_id)
    and not exists (select 1 from public.profiles p where p.id = m.user_id and p.is_super_admin)
    and not exists (
      select 1 from public.corporation_memberships o
      where o.user_id = m.user_id and o.corporation_id <> p_corporation_id
    );
$$;

revoke all on function public.demo_strata_people(text) from public, anon, authenticated;
grant execute on function public.demo_strata_people(text) to service_role;
revoke all on function public.demo_delete_strata(text) from public, anon, authenticated;
revoke all on function public.demo_delete_person(uuid) from public, anon, authenticated;
grant execute on function public.demo_delete_strata(text) to service_role;
grant execute on function public.demo_delete_person(uuid) to service_role;

-- ── A visitor's own strata ──────────────────────────────────────────────
--
-- Makes the visitor's copy of the fictional strata: subscribed, with the
-- visitor as its admin. Strata Plan numbers start with DEMO- so they can
-- never be mistaken for a real one (and so demo_delete_strata will only
-- ever delete a demo strata).
create or replace function public.demo_create_strata(p_visitor_id uuid, p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_visitor public.demo_visitors%rowtype;
  v_corp text;
begin
  select * into v_visitor from public.demo_visitors where id = p_visitor_id for update;
  if not found then
    raise exception 'No such demo visitor.';
  end if;
  if v_visitor.corporation_id is not null then
    return v_visitor.corporation_id;
  end if;

  loop
    v_corp := 'DEMO-' || lpad((floor(random() * 1000000))::int::text, 6, '0');
    exit when not exists (select 1 from public.strata_corporations where strata_plan_number = v_corp);
  end loop;

  insert into public.strata_corporations (strata_plan_number, legal_name, address, unit_count, jurisdiction, building_name)
  values (v_corp, 'The Owners, Strata Plan ' || replace(v_corp, '-', ''), '2150 Larchwood Crescent, Port Moody, BC V3H 0Z9', 24, 'BC', 'Larchwood Commons');

  insert into public.subscriptions (corporation_id, status, billing_interval, unit_count, activated_at)
  values (v_corp, 'active', 'annual', 24, now());

  insert into public.corporation_memberships (user_id, corporation_id, status, joined_at)
  values (p_user_id, v_corp, 'active', now());

  insert into public.corporation_role_assignments (corporation_id, role, user_id)
  values (v_corp, 'admin', p_user_id);

  update public.demo_visitors set user_id = p_user_id, corporation_id = v_corp where id = p_visitor_id;
  return v_corp;
end;
$$;

revoke all on function public.demo_create_strata(uuid, uuid) from public, anon, authenticated;
grant execute on function public.demo_create_strata(uuid, uuid) to service_role;

-- Claims a visitor's first-time setup, so that two requests opening the
-- link at once (an email client checking it, a double click) don't both
-- set up: true for the one that should go ahead. setup_started_at stays
-- set until the strata is completely filled (the app clears it), so a
-- claim more than two minutes old was cut off and can be taken over,
-- even if its strata was already made (the app starts that one again).
-- p_release gives a failed claim back.
create or replace function public.demo_claim_setup(p_visitor_id uuid, p_release boolean default false)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_release then
    update public.demo_visitors set setup_started_at = null where id = p_visitor_id;
    return false;
  end if;
  update public.demo_visitors set setup_started_at = now()
  where id = p_visitor_id
    and (
      (corporation_id is null and (setup_started_at is null or setup_started_at < now() - interval '2 minutes'))
      or (corporation_id is not null and setup_started_at < now() - interval '2 minutes')
    );
  return found;
end;
$$;

revoke all on function public.demo_claim_setup(uuid, boolean) from public, anon, authenticated;
grant execute on function public.demo_claim_setup(uuid, boolean) to service_role;

-- What a visitor has used of the demo's limits (lib/demo-limits.ts): the
-- Stratasphere chat's questions, Meeting Mode's questions, the one
-- meeting they can create, and motions drafted for it. Counted against
-- the link, so a second device doesn't start again.
alter table public.demo_visitors add column if not exists chat_questions int not null default 0;
alter table public.demo_visitors add column if not exists meeting_questions int not null default 0;
alter table public.demo_visitors add column if not exists meetings_created int not null default 0;
alter table public.demo_visitors add column if not exists motion_drafts int not null default 0;

-- Takes one of p_what if any are left (true), or gives one back
-- (p_refund, when the question failed). Atomic, so a double click can't
-- go over the limit.
create or replace function public.demo_use(p_visitor_id uuid, p_what text, p_limit int, p_refund boolean default false)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_column text;
  v_rows int;
begin
  v_column := case p_what
    when 'chat' then 'chat_questions'
    when 'meeting' then 'meeting_questions'
    when 'meetings' then 'meetings_created'
    when 'motions' then 'motion_drafts'
  end;
  if v_column is null then
    raise exception 'Unknown demo limit %', p_what;
  end if;
  if p_refund then
    execute format('update public.demo_visitors set %1$I = greatest(%1$I - 1, 0) where id = $1', v_column) using p_visitor_id;
    return false;
  end if;
  execute format('update public.demo_visitors set %1$I = %1$I + 1 where id = $1 and %1$I < $2 and expires_at > now()', v_column)
    using p_visitor_id, p_limit;
  -- EXECUTE doesn't set FOUND.
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

revoke all on function public.demo_use(uuid, text, int, boolean) from public, anon, authenticated;
grant execute on function public.demo_use(uuid, text, int, boolean) to service_role;

-- Everything a visitor does (lib/demo-activity.ts): pages, clicks, what
-- they asked the Stratasphere and its answers, the meeting they ran,
-- Council Training progress, limits reached, errors. Deleted with the
-- visitor's row (7 days after the link expired), and anything older than
-- 7 days by the nightly clean-up.
create table if not exists public.demo_activity (
  id bigint generated always as identity primary key,
  visitor_id uuid not null references public.demo_visitors(id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null check (char_length(kind) between 1 and 60),
  path text check (char_length(path) <= 500),
  detail jsonb not null default '{}'::jsonb
);
create index if not exists demo_activity_visitor_idx on public.demo_activity (visitor_id, at);
create index if not exists demo_activity_at_idx on public.demo_activity (at);

alter table public.demo_activity enable row level security;
revoke all on public.demo_activity from anon, authenticated;
grant all on public.demo_activity to service_role;
