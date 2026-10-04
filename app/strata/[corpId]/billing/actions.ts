"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripeFor, stripeModeFor } from "@/lib/stripe/client";
import { annualTermEnd, getPriceIds, type BillingInterval } from "@/lib/stripe/prices";
import { parseEmails } from "@/lib/roster-csv";
import { isStrataAdmin } from "@/lib/auth/strata-admin";

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

  if (!(await isStrataAdmin(supabase, corporationId))) {
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
  const stripe = await stripeFor(corporationId);
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
  const stripe = await stripeFor(corporationId);
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
    await (await stripeFor(corporationId)).customers.update(sub.stripe_customer_id, { email: firstEmail(billingEmail) });
  }

  const { error } = await admin
    .from("subscriptions")
    .upsert(
      { corporation_id: corporationId, billing_email: billingEmail },
      { onConflict: "corporation_id" }
    );
  if (error) {
    console.error("[updateBillingEmail]", error.message);
    throw new Error("Couldn't save the billing contacts. Please try again.");
  }
  revalidatePath(`/strata/${corporationId}/billing`);
  redirect(`/strata/${corporationId}/billing?note=contacts-saved`);
}

/**
 * "Switch to monthly / annual". The switch takes effect on the next
 * anniversary, never immediately (Jeremy, 2026-10-04): annual to monthly
 * at the end of the 12-month term already committed to, monthly to
 * annual at the next monthly billing date. Nothing moves off the annual
 * rate early.
 *
 * Stripe holds the change as a subscription schedule: the current plan
 * runs until the switch date, then the new plan's Prices and
 * `billing_interval` metadata apply. The webhook sees that and starts the
 * new term (and clears the pending columns).
 */
export async function changePlan(corporationId: string, newInterval: BillingInterval) {
  await requireAdmin(corporationId);
  if (!isInterval(newInterval)) throw new Error("Choose a plan.");

  const admin = createAdminClient();
  const { data: sub } = await admin
    .from("subscriptions")
    .select("status, stripe_subscription_id, billing_interval, committed_until, activated_at, cancel_at, pending_interval")
    .eq("corporation_id", corporationId)
    .maybeSingle();
  if (!sub?.stripe_subscription_id || sub.status !== "active") throw new Error("No active subscription to change.");
  if (sub.billing_interval === newInterval || sub.pending_interval === newInterval) return;
  if (sub.cancel_at) throw new Error("This subscription is set to cancel, so the plan can't be switched.");

  const { data: corp } = await admin
    .from("strata_corporations")
    .select("unit_count")
    .eq("strata_plan_number", corporationId)
    .single();
  if (!corp) throw new Error("Corporation not found.");

  const stripe = await stripeFor(corporationId);
  const current = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const currentAny = current as any;
  const periodEnd: number | null = currentAny.current_period_end ?? currentAny.items?.data?.[0]?.current_period_end ?? null;

  const switchAt =
    sub.billing_interval === "annual"
      ? annualTermEnd(sub)
      : periodEnd
        ? new Date(periodEnd * 1000)
        : null;
  if (!switchAt) throw new Error("Couldn't work out the next anniversary date. Please contact us.");
  const switchAtUnix = Math.floor(switchAt.getTime() / 1000);

  const { base, perUnit } = getPriceIds(newInterval, await stripeModeFor(corporationId));
  const scheduleId = current.schedule
    ? typeof current.schedule === "string"
      ? current.schedule
      : current.schedule.id
    : (await stripe.subscriptionSchedules.create({ from_subscription: current.id })).id;
  const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
  const running = schedule.current_phase?.start_date ?? schedule.phases[0]?.start_date;
  if (!running) throw new Error("Couldn't schedule the switch. Please try again.");

  await stripe.subscriptionSchedules.update(scheduleId, {
    end_behavior: "release",
    proration_behavior: "none",
    phases: [
      {
        // The plan as it is now, unchanged, until the anniversary.
        start_date: running,
        end_date: switchAtUnix,
        items: current.items.data.map((item) => ({ price: item.price.id, quantity: item.quantity ?? 1 })),
        automatic_tax: { enabled: true },
      },
      {
        items: [
          { price: base, quantity: 1 },
          { price: perUnit, quantity: corp.unit_count },
        ],
        iterations: 1,
        automatic_tax: { enabled: true },
        proration_behavior: "none",
        metadata: { corporation_id: corporationId, billing_interval: newInterval },
      },
    ],
  });

  await admin
    .from("subscriptions")
    .update({ pending_interval: newInterval, pending_interval_at: switchAt.toISOString(), stripe_schedule_id: scheduleId })
    .eq("corporation_id", corporationId);
  revalidatePath(`/strata/${corporationId}/billing`);
}

/** Undo a scheduled switch: keep the current plan as it is. */
export async function keepCurrentPlan(corporationId: string) {
  await requireAdmin(corporationId);
  await releasePendingSwitch(corporationId);
  revalidatePath(`/strata/${corporationId}/billing`);
}

async function releasePendingSwitch(corporationId: string) {
  const admin = createAdminClient();
  const { data: sub } = await admin
    .from("subscriptions")
    .select("stripe_schedule_id")
    .eq("corporation_id", corporationId)
    .maybeSingle();
  if (sub?.stripe_schedule_id) {
    const stripe = await stripeFor(corporationId);
    const schedule = await stripe.subscriptionSchedules.retrieve(sub.stripe_schedule_id);
    // Releasing leaves the subscription exactly as it is now.
    if (schedule.status === "active" || schedule.status === "not_started") {
      await stripe.subscriptionSchedules.release(sub.stripe_schedule_id);
    }
  }
  await admin
    .from("subscriptions")
    .update({ pending_interval: null, pending_interval_at: null, stripe_schedule_id: null })
    .eq("corporation_id", corporationId);
}

/**
 * Cancel — doc01 §4b, no early-termination fee, nothing ends early.
 * Monthly: `cancel_at_period_end`, so the current month runs out.
 * Annual: `cancel_at` the end of the 12-month term running now (each
 * anniversary starts a new term), so billing and access continue until
 * then, and it doesn't renew. A scheduled plan switch is dropped first.
 * This only schedules the stop; the webhook flips `status` when Stripe
 * actually ends it.
 */
export async function cancelSubscription(corporationId: string) {
  await requireAdmin(corporationId);

  const admin = createAdminClient();
  const { data: sub } = await admin
    .from("subscriptions")
    .select("stripe_subscription_id, billing_interval, committed_until, activated_at, stripe_schedule_id")
    .eq("corporation_id", corporationId)
    .maybeSingle();

  if (!sub?.stripe_subscription_id) {
    throw new Error("No active subscription to cancel.");
  }
  if (sub.stripe_schedule_id) await releasePendingSwitch(corporationId);

  const stripe = await stripeFor(corporationId);
  const termEnd = sub.billing_interval === "annual" ? annualTermEnd(sub) : null;
  const updated = termEnd
    ? await stripe.subscriptions.update(sub.stripe_subscription_id, { cancel_at: Math.floor(termEnd.getTime() / 1000) })
    : await stripe.subscriptions.update(sub.stripe_subscription_id, { cancel_at_period_end: true });

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

  const session = await (await stripeFor(corporationId)).checkout.sessions.create({
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
    await (await stripeFor(corporationId)).customers.update(sub.stripe_customer_id, { email: emails.first });
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

  const stripe = await stripeFor(corporationId);
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

  const { base, perUnit } = getPriceIds(interval, await stripeModeFor(corporationId));
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
