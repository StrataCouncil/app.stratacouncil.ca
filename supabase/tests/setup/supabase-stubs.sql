-- Stand-ins for the parts of Supabase the migrations rely on (roles, the
-- auth and storage schemas, auth.uid()), so the migrations and the suites
-- run on a plain Postgres with pgvector. auth.uid() reads the
-- `test.uid` setting: suites "sign in" with `set test.uid = '<uuid>'`.
-- auth.jwt() reports the session's assurance level from `test.aal`.
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
create schema auth; create schema storage;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
-- auth.jwt(): only the session's assurance level is used (0053). Suites
-- run as a two-step-verified session (aal2) unless they `set test.aal = 'aal1'`.
create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('aal', coalesce(nullif(current_setting('test.aal', true), ''), 'aal2')) $$;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
grant usage on schema public, auth to authenticated;
create schema extensions; grant usage on schema extensions to authenticated;
