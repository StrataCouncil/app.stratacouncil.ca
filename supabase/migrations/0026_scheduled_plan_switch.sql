-- A billing-interval switch now takes effect on the next anniversary
-- instead of immediately: annual to monthly at the end of the current
-- 12-month term, monthly to annual at the next monthly billing date.
-- Stripe holds the change as a subscription schedule; these columns let
-- the billing page show it. Cleared by the webhook once the switch lands,
-- or by the app when the admin keeps the current plan.
--
-- Safe to run more than once. Run the whole file in one go.

alter table public.subscriptions add column if not exists pending_interval public.billing_interval;
alter table public.subscriptions add column if not exists pending_interval_at timestamptz;
alter table public.subscriptions add column if not exists stripe_schedule_id text;
