-- Security review (2026-11-03). Four tightenings, none of which changes what
-- the app shows a council member:
--
-- 1. Draft minutes: only council. A meeting's minutes (minutes_content) are
--    readable through meeting_minutes() below: final minutes by any member of
--    the strata; draft minutes only by council members, by whoever can run
--    meetings (they write and finalize them: admin, secretary, delegates), and
--    by Super Admins. The column itself is no longer readable directly; every
--    other column of meetings stays readable under the existing row rules.
--    Writing draft minutes is unchanged (update rights and policies as before).
--
-- 2. Backup codes for two-step login: server only. Members could insert and
--    update their own rows, so someone with only a password could have made
--    themselves a code. Nothing accepts backup codes yet (two-step is for Super
--    Admins only, and they use the authenticator), but this closes it before it
--    matters: the table gets no client access at all, and the app reads and
--    writes it with the service role after checking the signed-in user (and,
--    to create codes, a two-step-verified session).
--
-- 3. Database functions: nobody signed out can call any. Postgres lets everyone
--    (PUBLIC) execute a new function unless it's revoked, so twelve older
--    functions could be called before sign-in. Each refused or returned nothing
--    without a user, so nothing leaked; this removes the possibility, for those
--    and for every function created from now on. Signed-in users keep exactly
--    the functions they had (granted to authenticated in 0016 and since).
--
-- 4. Training modules: the editing lock's token (checkout_token) is no longer
--    readable. Who has a module checked out stays visible to builders.
--
-- Columns hidden from signed-in users this way: meetings.minutes_content and
-- training_modules.checkout_token. A column added to either table later must
-- be granted to authenticated in its migration (supabase/tests/suites/
-- security-review.sql fails until it is).
--
-- Grants: no new tables. meeting_minutes(): authenticated only.
--
-- Safe to re-run.

-- 1. Draft minutes ----------------------------------------------------------

create or replace function public.meeting_minutes(p_meeting_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select m.minutes_content
  from public.meetings m
  where m.id = p_meeting_id
    and (
      (m.minutes_state = 'FINAL' and public.is_corporation_member(m.corporation_id))
      or public.is_on_council(m.corporation_id)
      or public.can_run_meetings(m.corporation_id)
      or public.is_super_admin()
    );
$$;

revoke all on function public.meeting_minutes(uuid) from public, anon;
grant execute on function public.meeting_minutes(uuid) to authenticated, service_role;

-- Every column but the hidden ones, so a re-run picks up the table as it is.
do $$
declare
  cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'meetings' and column_name <> 'minutes_content';
  execute 'revoke select on public.meetings from authenticated';
  execute format('grant select (%s) on public.meetings to authenticated', cols);

  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'training_modules' and column_name <> 'checkout_token';
  execute 'revoke select on public.training_modules from authenticated';
  execute format('grant select (%s) on public.training_modules to authenticated', cols);
end $$;

-- 2. Backup codes -----------------------------------------------------------

drop policy if exists "mfa_backup_codes_select_own" on public.mfa_backup_codes;
drop policy if exists "mfa_backup_codes_insert_own" on public.mfa_backup_codes;
drop policy if exists "mfa_backup_codes_update_own" on public.mfa_backup_codes;
drop policy if exists "mfa_backup_codes_delete_own" on public.mfa_backup_codes;
alter table public.mfa_backup_codes enable row level security;
revoke all on public.mfa_backup_codes from anon, authenticated;
grant all on public.mfa_backup_codes to service_role;

-- 3. Functions --------------------------------------------------------------

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
  end loop;
end $$;

-- Functions created from now on: Postgres's own default (everyone may
-- execute) is global, so it's revoked without a schema; any grant to anon
-- that Supabase adds for the public schema is revoked with one.
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;
