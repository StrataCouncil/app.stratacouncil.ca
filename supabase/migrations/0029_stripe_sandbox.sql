-- A strata can bill through Stripe test mode (the sandbox) instead of live
-- Stripe, so billing can be tested on a test strata while real customers
-- are billed normally. Set by a Super Admin from the strata's console page;
-- every page of a sandbox strata shows a red banner.
--
-- No one can change this from the browser: strata_corporations has no
-- update policy, so only the server (after checking Super Admin) writes it.
--
-- Safe to run more than once. Run the whole file in one go.

alter table public.strata_corporations add column if not exists stripe_sandbox boolean not null default false;
