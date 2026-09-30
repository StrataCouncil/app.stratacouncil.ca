-- doc01 §4b, §6 — real Stripe wiring for StrataSphere billing, plus the
-- free/permanent document repository decided in the same round of edits.
--
-- 1. subscriptions gets the columns the cancellation design actually needs
--    (doc01 §4b): `committed_until` is the annual plan's 12-month
--    anniversary, computed once at activation and never recalculated;
--    `cancel_at` mirrors Stripe's own field so the billing page can show
--    "cancels on <date>" without a live Stripe call on every page load;
--    `current_period_end` likewise mirrors Stripe so "next billing date"
--    is real instead of a hardcoded display string. All three are written
--    only by the webhook / service-role path, same as the rest of this
--    table (0005_rls.sql's "no direct client write policy" comment still
--    holds — this migration doesn't change that).
alter table public.subscriptions
  add column committed_until timestamptz,
  add column cancel_at timestamptz,
  add column current_period_end timestamptz;

-- 2. documents: no longer StrataSphere-gated. Decided this round (doc01
-- §4a/§6, doc00 changelog) — upload and browsing are free and permanent,
-- independent of subscription history in either direction. Membership
-- alone is now sufficient; meetings/decisions/governance_calendar/
-- knowledge_chunks remain subscription-gated once those tables exist.
drop policy "subscribed members can read documents" on public.documents;
drop policy "subscribed members can upload documents" on public.documents;

create policy "members can read documents" on public.documents
  for select using (public.is_corporation_member(corporation_id));

create policy "members can upload documents" on public.documents
  for insert with check (public.is_corporation_member(corporation_id));
