-- Stand-ins for the parts of Supabase the migrations rely on (roles, the
-- auth and storage schemas, auth.uid()), so the migrations and the suites
-- run on a plain Postgres with pgvector. auth.uid() reads the
-- `test.uid` setting: suites "sign in" with `set test.uid = '<uuid>'`.
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
create schema auth; create schema storage;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
grant usage on schema public, auth to authenticated;
create schema extensions; grant usage on schema extensions to authenticated;
