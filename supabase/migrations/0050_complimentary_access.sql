-- Complimentary Stratasphere access: a Super Admin can switch a strata's
-- subscription on without Stripe (no card, no charges), from the strata's
-- console page. The subscription reads as active, so everything a
-- subscription unlocks works as usual; the Billing page says
-- "Complimentary" instead of showing prices and payment details.
-- Switching it off ends access straight away, and the strata can then
-- subscribe and pay like any other.
--
-- complimentary_at: when it was switched on (null when it isn't).
-- complimentary_by: the Super Admin who switched it on, for the record.
--
-- No one can change this from the browser: subscriptions has no insert or
-- update policy, so only the server (after checking Super Admin) writes it.
--
-- Safe to run more than once. Run the whole file in one go.

alter table public.subscriptions add column if not exists complimentary_at timestamptz;
alter table public.subscriptions add column if not exists complimentary_by text;
