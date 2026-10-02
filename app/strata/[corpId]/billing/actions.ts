"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe/client";
import { getPriceIds, type BillingInterval } from "@/lib/stripe/prices";
import { parseEmails } from "@/lib/roster-csv";

/**
 * Server Actions behind billing/page.tsx's buttons. These are the
 * "handful of operations" lib/supabase/admin.ts reserves the service-role
 * client for: `subscriptions` has no client write policy at all
 * (0005_rls.sql), so authorization has to be checked here in application
 * code instead of leaning on RLS — every action below starts by
 * confirming the caller is a signed-in admin of this corporation before
 * touching Stripe or the service-role client.
 */

async function requireAdmin(corporationId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { data, error } = await supabase
    .from("corporation_role_assignments")
    .select("role")
    .eq("corporation_id", corporationId)
    .eq("user_id", user.id)
    .eq("role", "admin")
    .maybeSingle();

  if (error || !data) {
    throw new Error("Only a corporation admin can manage billing.");
  }
  return user;
}

async function siteUrl() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

/**
 * Billing contacts: one or more emails, comma-separated (0018 allows a
 * list). Stripe's Customer takes the first; the webhook copies each paid
 * invoice to the rest.
 */
function readBillingEmails(formData: FormData): { ok: true; joined: string; first: string } | { ok: false; error: string } {
  const raw = String(formData.get("billingEmail") ?? "").trim();
  if (!raw) return { ok: false, error: "Enter at least one billing contact email." };
  const parsed = parseEmails(raw);
  if (!parsed.ok) return { ok: false, error: `"${parsed.invalid}" isn't a valid email.` };
  const list = parsed.value.split(", ").slice(0, 10);
  return { ok: true, joined: list.join(", "), first: list[0] };
}

function requireBillingEmail(formData: FormData): string {
  const result = readBillingEmails(formData);
  if (!result.ok) throw new Error(result.error);
  return result.joined;
}

const firstEmail = (joined: string) => joined.split(",")[0].trim();

/**
 * The billing contact (doc01 §4b) — who Stripe actually emails invoices
 * and receipts to. Often the Treasurer or the strata's management
 * company, not necessarily the admin doing the subscribing, and it
 * changes over time (a Treasurer rotates out, the corporation switches
 * management companies) independently of who holds the admin role — so
 * it's captured once at subscribe time and stays editable afterward via
 * `updateBillingEmail` below, rather than being derived from the signed-in
 * user's own account email.
 */
async function getOrCreateStripeCustomer(corporationId: string, billingEmail: string | null) {
  const admin = createAdminClient();
  const stripe = getStripe();
  const { data: existing } = await admin
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("corporation_id", corporationId)
    .maybeSingle();

  if (existing?.stripe_customer_id) {
    // Keep the Stripe Customer's email in sync with whatever was just
    // submitted, in case it changed since the customer record was first
    // created (e.g. resubscribing under a new Treasurer). Also re-assert
    // `name` as the strata plan number — self-heals any Customer created
    // before `name` was pinned to corporationId below.
    await stripe.customers.update(existing.stripe_customer_id, {
      ...(billingEmail ? { email: firstEmail(billingEmail) } : {}),
      name: corporationId,
    });
    if (billingEmail) {
      await admin
        .from("subscriptions")
        .update({ billing_email: billingEmail })
        .eq("corporation_id", corporationId);
    }
    return existing.stripe_customer_id;
  }

  const { data: corp } = await admin
    .from("strata_corporations")
    .select("legal_name, building_name")
    .eq("strata_plan_number", corporationId)
    .single();

  const customer = await stripe.customers.create({
    // The Customer's `name` is the strata plan number itself (e.g.
    // "EPS1234") — corporationId here *is* that number
    // (subscriptions.corporation_id references
    // strata_corporations.strata_plan_number) — deliberately, because it's
    // immutable, unlike a building name or legal name, either of which can
    // change (a rename, a legal-name correction) without the corporation's
    // identity changing. `description` carries the human-readable name for
    // anyone scanning the Stripe dashboard, but `name` is what's durable.
    name: corporationId,
    description: corp?.building_name ?? corp?.legal_name ?? undefined,
    email: billingEmail ? firstEmail(billingEmail) : undefined,
    metadata: { corporation_id: corporationId },
  });

  // Upsert a placeholder row so the customer id (and billing email) is on
  // file even before any webhook fires — status stays at its
  // 'deactivated' default until the webhook confirms an actual active
  // subscription.
  await admin
    .from("subscriptions")
    .upsert(
      { corporation_id: corporationId, stripe_customer_id: customer.id, ...(billingEmail ? { billing_email: billingEmail } : {}) },
      { onConflict: "corporation_id" }
    );

  return customer.id;
}

/** Payment-method update / "Invoices" — both live in the Stripe-hosted
 * Billing Portal rather than a hand-built card form or invoice list. */
export async function openBillingPortal(corporationId: string) {
  await requireAdmin(corporationId);

  const admin = createAdminClient();
  const { data: sub } = await admin
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("corporation_id", corporationId)
    .maybeSingle();
  if (!sub?.stripe_customer_id) {
    throw new Error("No billing account on file yet — subscribe first.");
  }

  const origin = await siteUrl();
  const stripe = getStripe();
  const portal = await stripe.billingPortal.sessions.create({
    customer: sub.stripe_customer_id,
    return_url: `${origin}/strata/${corporationId}/billing`,
  });

  redirect(portal.url);
}

/**
 * Update the billing contact email on its own, independent of any other
 * subscription change — doc01 §4b. Needs to work whether or not a Stripe
 * Customer exists yet (an admin can set this ahead of subscribing), and
 * whether or not the corporation currently has an active subscription (a
 * Treasurer handover shouldn't require touching the plan at all).
 */
export async function updateBillingEmail(corporationId: string, formData: FormData) {
  await requireAdmin(corporationId);
  const billingEmail = requireBillingEmail(formData);

  const admin = createAdminClient();
  const { data: sub } = await admin
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("corporation_id", corporationId)
    .maybeSingle();

  if (sub?.stripe_customer_id) {
    await getStripe().customers.update(sub.stripe_customer_id, { email: firstEmail(billingEmail) });
  }

  await admin
    .from("subscriptions")
    .upsert(
      { corporation_id: corporationId, billing_email: billingEmail },
      { onConflict: "corporation_id" }
    );
}

/** "Change billing interval" — swaps the existing subscription's two
 * line items (base + per-unit) onto the other plan's Prices in place,
 * rather than starting a second subscription. Switching onto the annual
 * plan restarts the 12-month commitment window from today (the webhook
 * recomputes `committed_until` once it sees the new activation-shaped
 * state — see stripe-webhook-route.ts's `syncSubscription`). */
export async function changePlan(corporationId: string, newInterval: BillingInterval) {
  await requireAdmin(corporationId);

  const admin = createAdminClient();
  const { data: sub } = await admin
    .from("subscriptions")
    .select("stripe_subscription_id, billing_interval")
    .eq("corporation_id", corporationId)
    .maybeSingle();
  if (!sub?.stripe_subscription_id) {
    throw new Error("No active subscription to change.");
  }
  if (sub.billing_interval === newInterval) return;

  const { data: corp } = await admin
    .from("strata_corporations")
    .select("unit_count")
    .eq("strata_plan_number", corporationId)
    .single();
  if (!corp) throw new Error("Corporation not found.");

  const stripe = getStripe();
  const current = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
  const { base, perUnit } = getPriceIds(newInterval);

  // Two existing items (base qty 1, per-unit qty N) swapped for the new
  // plan's two Prices in place — `deleted: true` removes each old item
  // as the corresponding new one is added, same subscription throughout.
  const items = current.items.data.map((item, i) => ({
    id: item.id,
    price: i === 0 ? base : perUnit,
    quantity: i === 0 ? 1 : corp.unit_count,
  }));

  await stripe.subscriptions.update(sub.stripe_subscription_id, {
    items,
    proration_behavior: "create_prorations",
    metadata: { corporation_id: corporationId, billing_interval: newInterval },
    // A plan change is a fresh commitment, not a cancellation — clear any
    // pending cancel_at so switching plans also un-schedules a cancel.
    cancel_at_period_end: false,
    cancel_at: null,
  });

  // Reset so the webhook treats this as a fresh activation and
  // recomputes committed_until for the new interval (see note above).
  await admin
    .from("subscriptions")
    .update({ billing_interval: newInterval, activated_at: new Date().toISOString(), committed_until: null, cancel_at: null })
    .eq("corporation_id", corporationId);
}

/**
 * Cancel — doc01 §4b's Stripe-native design, no early-termination fee.
 * Monthly: `cancel_at_period_end`, so it runs out the current monthly
 * anniversary. Annual: `cancel_at` set to the stored 12-month
 * `committed_until` (the term the corporation already committed to,
 * computed once at activation) — access and billing continue exactly as
 * before until that date, then the subscription simply doesn't renew.
 * Either way this only *schedules* the stop; the webhook is what flips
 * `status` to 'deactivated' once Stripe actually ends it.
 */
export async function cancelSubscription(corporationId: string) {
  await requireAdmin(corporationId);

  const admin = createAdminClient();
  const { data: sub } = await admin
    .from("subscriptions")
    .select("stripe_subscription_id, billing_interval, committed_until")
    .eq("corporation_id", corporationId)
    .maybeSingle();

  if (!sub?.stripe_subscription_id) {
    throw new Error("No active subscription to cancel.");
  }

  const stripe = getStripe();
  let updated;
  if (sub.billing_interval === "annual" && sub.committed_until) {
    const cancelAtUnix = Math.floor(new Date(sub.committed_until).getTime() / 1000);
    updated = await stripe.subscriptions.update(sub.stripe_subscription_id, {
      cancel_at: cancelAtUnix,
    });
  } else {
    updated = await stripe.subscriptions.update(sub.stripe_subscription_id, {
      cancel_at_period_end: true,
    });
  }

  // Optimistic local mirror — the webhook will reconfirm this, but the
  // admin shouldn't have to reload to see "cancels on <date>".
  await admin
    .from("subscriptions")
    .update({
      cancel_at: updated.cancel_at
        ? new Date(updated.cancel_at * 1000).toISOString()
        : null,
    })
    .eq("corporation_id", corporationId);
}


// ── Subscribe, step by step: plan → payment method → contacts → pay ──────

const isInterval = (v: string): v is BillingInterval => v === "monthly" || v === "annual";

/**
 * Step 2: save a payment method on Stripe's own secure page (Checkout in
 * setup mode), so card and bank details never touch our servers. Stripe
 * collects the pre-authorized debit mandate there too. It returns to
 * ./setup-complete, which makes the method the default, then step 3.
 */
export async function startPaymentSetup(corporationId: string, interval: BillingInterval) {
  await requireAdmin(corporationId);
  if (!isInterval(interval)) throw new Error("Choose a plan first.");
  const customerId = await getOrCreateStripeCustomer(corporationId, null);
  const origin = await siteUrl();

  const session = await getStripe().checkout.sessions.create({
    mode: "setup",
    customer: customerId,
    currency: "cad",
    payment_method_types: ["acss_debit", "card"],
    payment_method_options: {
      acss_debit: {
        currency: "cad",
        verification_method: "automatic",
        mandate_options: {
          payment_schedule: "interval",
          interval_description: "Monthly, for the Stratasphere subscription",
          transaction_type: "business",
        },
      },
    },
    metadata: { corporation_id: corporationId, billing_interval: interval },
    success_url: `${origin}/strata/${corporationId}/billing/setup-complete?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/strata/${corporationId}/billing?plan=${interval}&step=payment`,
  });
  if (!session.url) throw new Error("Stripe did not return a setup page.");
  redirect(session.url);
}

/** Step 3: the billing contacts. Saved now, used when paying. */
export async function saveBillingContacts(
  corporationId: string,
  interval: BillingInterval,
  _prev: { error: string } | undefined,
  formData: FormData
): Promise<{ error: string } | undefined> {
  await requireAdmin(corporationId);
  const emails = readBillingEmails(formData);
  if (!emails.ok) return { error: emails.error };

  const admin = createAdminClient();
  const { data: sub } = await admin
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("corporation_id", corporationId)
    .maybeSingle();
  if (sub?.stripe_customer_id) {
    await getStripe().customers.update(sub.stripe_customer_id, { email: emails.first });
  }
  await admin
    .from("subscriptions")
    .upsert({ corporation_id: corporationId, billing_email: emails.joined }, { onConflict: "corporation_id" });
  redirect(`/strata/${corporationId}/billing?plan=${isInterval(interval) ? interval : "annual"}&step=review`);
}

/**
 * Step 4: create the subscription on the saved payment method. A card
 * charge settles now; a pre-authorized debit takes a few business days,
 * and the webhook switches the subscription on when Stripe confirms it.
 */
export async function paySubscription(
  corporationId: string,
  interval: BillingInterval,
  _prev: { error: string } | undefined,
  _formData: FormData
): Promise<{ error: string } | undefined> {
  await requireAdmin(corporationId);
  if (!isInterval(interval)) return { error: "Choose a plan first." };

  const admin = createAdminClient();
  const [{ data: sub }, { data: corp }] = await Promise.all([
    admin
      .from("subscriptions")
      .select("stripe_customer_id, billing_email, status, stripe_subscription_id")
      .eq("corporation_id", corporationId)
      .maybeSingle(),
    admin.from("strata_corporations").select("unit_count").eq("strata_plan_number", corporationId).single(),
  ]);
  if (!corp) return { error: "Corporation not found." };
  if (sub?.status === "active") redirect(`/strata/${corporationId}/billing`);
  if (!sub?.stripe_customer_id) return { error: "Add a payment method first." };
  if (!sub.billing_email) return { error: "Add a billing contact email first." };

  const stripe = getStripe();
  const customer = await stripe.customers.retrieve(sub.stripe_customer_id);
  const defaultPm =
    !customer.deleted && customer.invoice_settings?.default_payment_method
      ? String(
          typeof customer.invoice_settings.default_payment_method === "string"
            ? customer.invoice_settings.default_payment_method
            : customer.invoice_settings.default_payment_method.id
        )
      : null;
  if (!defaultPm) return { error: "Add a payment method first." };

  const { base, perUnit } = getPriceIds(interval);
  try {
    await stripe.subscriptions.create({
      customer: sub.stripe_customer_id,
      items: [
        { price: base, quantity: 1 },
        { price: perUnit, quantity: corp.unit_count },
      ],
      default_payment_method: defaultPm,
      automatic_tax: { enabled: true },
      payment_behavior: "allow_incomplete",
      metadata: { corporation_id: corporationId, billing_interval: interval },
    });
  } catch (error) {
    console.error("[paySubscription]", error instanceof Error ? error.message : error);
    return { error: "Stripe couldn't take the payment. Check the payment method, or add a different one." };
  }
  redirect(`/strata/${corporationId}/billing?subscribed=1`);
}
