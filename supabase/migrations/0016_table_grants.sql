-- Table privileges for the API roles.
--
-- Row-level security decides WHICH rows a signed-in user can touch, but
-- Postgres checks table privileges first. This project's tables were never
-- granted to the `authenticated` role (newer Supabase projects don't expose
-- new tables to the Data API automatically), so every query the app made
-- as a signed-in user failed with "permission denied" — which the app read
-- as "no rows": no connected strata, failed join requests, empty rosters.
--
-- Safe to grant broadly because every table in public has RLS enabled
-- (0001, 0005, 0007, 0013, 0014). Two deliberate narrowings:
--   - profiles: users may only update their own full_name and phone. A
--     table-wide UPDATE would let anyone set is_super_admin on themselves.
--   - anon gets no table access at all; nothing is read before sign-in.

grant usage on schema public to authenticated, service_role;
grant usage on schema extensions to authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;

revoke update on public.profiles from authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

-- Tables created by later migrations get the same treatment.
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant usage, select on sequences to authenticated, service_role;
alter default privileges in schema public grant execute on functions to authenticated, service_role;
