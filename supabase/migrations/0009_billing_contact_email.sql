-- doc01 §4b — a billing contact email, separate from any council member's
-- login. The admin who subscribes may not be the right person to receive
-- invoices/receipts (the Treasurer usually is, or the Strata Management
-- company if the corporation is self-managed vs. professionally managed),
-- and that person changes over time independently of who's an admin — so
-- this is its own field, set at subscribe time and editable any time after,
-- not derived from auth.users/profiles.
--
-- Written by the same Server Actions that manage Stripe (billing/actions.ts),
-- never by the webhook — same "no direct client write policy" as the rest
-- of this table (0005_rls.sql).
alter table public.subscriptions
  add column billing_email text
    check (billing_email is null or billing_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');
