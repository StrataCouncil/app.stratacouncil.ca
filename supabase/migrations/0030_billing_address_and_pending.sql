-- Billing flow, round 2 (2026-10-05):
-- 1. Stripe's own subscription status, so a first payment still processing
--    (a pre-authorized debit takes a few business days) shows as Pending
--    instead of "Not subscribed".
-- 2. The billing address, which may be the building's civic address or a
--    management company's office. It goes to Stripe so GST is calculated.
--
-- Safe to run more than once. Run the whole file in one go.

alter table public.subscriptions add column if not exists stripe_status text;

-- { "line1", "line2", "city", "province", "postal_code" } in Canada.
alter table public.subscriptions add column if not exists billing_address jsonb
  check (billing_address is null or jsonb_typeof(billing_address) = 'object');
alter table public.subscriptions add column if not exists billing_address_same boolean not null default true;
