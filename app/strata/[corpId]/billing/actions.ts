"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripeFor, stripeModeFor } from "@/lib/stripe/client";
import { annualTermEnd, getPriceIds, type BillingInterval } from "@/lib/stripe/prices";
import { parseCivicAddress, readBillingAddress, toStripeAddress, type BillingAddress } from "@/lib/billing-address";
import { recordPaymentMethodUpdate, recordSubscriptionPayment } from "@/lib/stripe/payment-results";
import type Stripe from "stripe";
import { syncSubscription } from "@/lib/stripe/sync";
import { parseEmails } from "@/lib/roster-csv";
import { canManageBilling } from "@/lib/auth/strata-admin";

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

  if (!(await canManageBilling(supabase, corporationId))) {
    throw new Error("Only this strata's admin, or its Manager when the admin allows it, can manage billing.");
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
/** False when Stripe has no such customer, or it was deleted. */
async function customerStillExists(stripe: Awaited<ReturnType<typeof stripeFor>>, customerId: string) {
  try {
    const customer = await stripe.customers.retrieve(customerId);
    return !customer.deleted;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "resource_missing") return false;
    throw error;
  }
}

async function getOrCreateStripeCustomer(corporationId: string, billingEmail: string | null) {
  const admin = createAdminClient();
  const stripe = await stripeFor(corporationId);
  const { data: existing } = await admin
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("corporation_id", corporationId)
    .maybeSingle();

  if (existing?.stripe_customer_id && (await customerStillExists(stripe, existing.stripe_customer_id))) {
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
  if (existing?.stripe_customer_id) {
    // The stored customer was deleted in Stripe (or belongs to the other
    // Stripe mode). Its subscriptions went with it, so forget them too,
    // unless the row still says active: that's left for the webhook.
    console.warn(`[billing] ${corporationId}: stored Stripe customer is gone; creating a new one.`);
    await admin
      .from("subscriptions")
      .update({ stripe_subscription_id: null, stripe_status: null })
      .eq("corporation_id", corporationId)
      .neq("status", "active");
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

/** Step 2: the billing contacts and address. Saved now, used when paying. */
export async function saveBillingContacts(
  corporationId: string,
  interval: BillingInterval,
  _prev: { error: string } | undefined,
  formData: FormData
): Promise<{ error: string } | undefined> {
  await requireAdmin(corporationId);
  const emails = readBillingEmails(formData);
  if (!emails.ok) return { error: emails.error };

  // The billing address (0030): the building's civic address, or one typed
  // in, usually a management company's office. Stripe calculates GST from it.
  const admin = createAdminClient();
  const same = formData.get("addressSame") === "on";
  let address: BillingAddress;
  if (same) {
    const { data: corp } = await admin.from("strata_corporations").select("address").eq("strata_plan_number", corporationId).single();
    const civic = parseCivicAddress(corp?.address);
    if (!civic || !civic.postalCode) {
      return { error: "We couldn't read a full civic address with postal code for the building. Enter the billing address instead." };
    }
    address = civic;
  } else {
    const typed = readBillingAddress({
      line1: formData.get("line1"),
      line2: formData.get("line2"),
      city: formData.get("city"),
      province: formData.get("province"),
      postalCode: formData.get("postalCode"),
    });
    if (!typed.ok) return { error: typed.error };
    address = typed.address;
  }

  const { data: sub } = await admin
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("corporation_id", corporationId)
    .maybeSingle();
  if (sub?.stripe_customer_id) {
    try {
      const stripe = await stripeFor(corporationId);
      // A customer deleted in Stripe is replaced when paying; nothing to update now.
      if (await customerStillExists(stripe, sub.stripe_customer_id)) {
        await stripe.customers.update(sub.stripe_customer_id, {
          email: emails.first,
          address: toStripeAddress(address),
        });
      }
    } catch (error) {
      console.error("[saveBillingContacts]", error instanceof Error ? error.message : error);
      return { error: "Couldn't save these details with Stripe. Please try again." };
    }
  }
  await admin
    .from("subscriptions")
    .upsert(
      { corporation_id: corporationId, billing_email: emails.joined, billing_address: address, billing_address_same: same },
      { onConflict: "corporation_id" }
    );
  redirect(`/strata/${corporationId}/billing?plan=${isInterval(interval) ? interval : "annual"}&step=review`);
}

/**
 * The last step: pay inside our dialog. Stripe's hosted checkout doesn't
 * take Canadian bank debits for subscriptions, so the subscription is
 * created here first, unpaid, with its pre-authorized debit agreement set
 * up as Business (a strata corporation's account). Stripe's payment form
 * in the dialog (the Payment Element) then confirms its first payment,
 * by bank debit or card. Until that's confirmed it isn't recorded as
 * pending anywhere (lib/stripe/sync), and an abandoned one lapses by
 * itself after a day. Returns the payment's client secret, or why it
 * couldn't open (Stripe's own words on a sandbox strata).
 */
export async function startSubscriptionPayment(
  corporationId: string,
  interval: BillingInterval
): Promise<{ clientSecret: string; subscriptionId: string } | { error: string }> {
  await requireAdmin(corporationId);
  if (!isInterval(interval)) return { error: "Choose a plan first." };

  const admin = createAdminClient();
  const [{ data: corp }, { data: sub }] = await Promise.all([
    admin.from("strata_corporations").select("unit_count").eq("strata_plan_number", corporationId).maybeSingle(),
    admin
      .from("subscriptions")
      .select("status, stripe_subscription_id, stripe_status, billing_email, billing_address")
      .eq("corporation_id", corporationId)
      .maybeSingle(),
  ]);
  if (!corp) return { error: "Corporation not found." };
  if (sub?.status === "active") return { error: "This strata is already subscribed." };
  if (sub?.stripe_subscription_id && sub.stripe_status === "incomplete") {
    return { error: "A first payment is already in progress. Close this window to see where it stands on Billing." };
  }
  if (!sub?.billing_email) return { error: "Add a billing contact email first." };
  if (!sub.billing_address) return { error: "Add a billing address first." };

  const mode = await stripeModeFor(corporationId);
  try {
    const stripe = await stripeFor(corporationId);
    const customerId = await getOrCreateStripeCustomer(corporationId, sub.billing_email);
    // Stripe calculates GST from the customer's address.
    await stripe.customers.update(customerId, {
      email: firstEmail(sub.billing_email),
      address: toStripeAddress(sub.billing_address as BillingAddress),
    });

    // Never a second subscription. One already paying (or paid) is
    // recorded and that's that; one opened here earlier but never paid is
    // picked up again if it's the same plan, or replaced if not.
    const existing = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 10,
      expand: ["data.latest_invoice.payment_intent"],
    });
    for (const s of existing.data) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const intent = (s.latest_invoice as any)?.payment_intent as Stripe.PaymentIntent | null | undefined;
      const unpaid = s.status === "incomplete" && intent && ["requires_payment_method", "requires_confirmation"].includes(intent.status);
      if (["active", "trialing", "past_due", "unpaid"].includes(s.status) || (s.status === "incomplete" && !unpaid)) {
        await syncSubscription(s, mode);
        return { error: "This strata already has a subscription. Close this window to see it on Billing." };
      }
      if (unpaid && intent?.client_secret) {
        if (s.metadata?.billing_interval === interval) return { clientSecret: intent.client_secret, subscriptionId: s.id };
        await stripe.subscriptions.cancel(s.id);
      }
    }

    const { base, perUnit } = getPriceIds(interval, mode);
    const created = await stripe.subscriptions.create({
      customer: customerId,
      items: [
        { price: base, quantity: 1 },
        { price: perUnit, quantity: corp.unit_count },
      ],
      automatic_tax: { enabled: true },
      payment_behavior: "default_incomplete",
      payment_settings: {
        payment_method_types: ["acss_debit", "card"],
        payment_method_options: {
          acss_debit: {
            verification_method: "automatic",
            // A strata corporation's account: a business agreement, not personal.
            mandate_options: { transaction_type: "business" },
          },
        },
        // The method used for this first payment pays every renewal.
        save_default_payment_method: "on_subscription",
      },
      // awaiting_payment: opened in the dialog, not paid yet (lib/stripe/sync).
      metadata: { corporation_id: corporationId, billing_interval: interval, awaiting_payment: "1" },
      expand: ["latest_invoice.payment_intent"],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const intent = (created.latest_invoice as any)?.payment_intent as Stripe.PaymentIntent | null | undefined;
    if (!intent?.client_secret) {
      await stripe.subscriptions.cancel(created.id);
      return { error: "Stripe didn't return a payment to confirm. Please try again." };
    }
    return { clientSecret: intent.client_secret, subscriptionId: created.id };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[startSubscriptionPayment] ${corporationId} (${mode}):`, detail);
    return {
      error:
        mode === "sandbox"
          ? `Sandbox: ${detail}`
          : "Stripe's payment form couldn't be opened. Please try again. If this keeps happening, contact us.",
    };
  }
}

/**
 * After the payment form confirms: record the subscription now rather
 * than waiting for the webhook. Safe to run twice (the form and the
 * return page for banks that redirect can both call it).
 */
export async function finishSubscriptionPayment(corporationId: string, subscriptionId: string): Promise<{ ok: boolean }> {
  await requireAdmin(corporationId);
  return { ok: await recordSubscriptionPayment(corporationId, subscriptionId) };
}

/**
 * Billing → Update payment method: Stripe's form inside our dialog
 * again, in setup mode, saving a new bank account or card for the
 * subscription. Stripe only allows a saved debit agreement to pay
 * subscriptions when it's marked for them (default_for), and then it
 * picks the Type of Service itself.
 */
export async function startPaymentMethodUpdate(
  corporationId: string
): Promise<{ clientSecret: string; sessionId: string } | { error: string }> {
  await requireAdmin(corporationId);
  const admin = createAdminClient();
  const { data: sub } = await admin
    .from("subscriptions")
    .select("stripe_customer_id, billing_email")
    .eq("corporation_id", corporationId)
    .maybeSingle();
  if (!sub?.stripe_customer_id) return { error: "Subscribe first; the payment method is added then." };

  const mode = await stripeModeFor(corporationId);
  try {
    const stripe = await stripeFor(corporationId);
    const customerId = await getOrCreateStripeCustomer(corporationId, sub.billing_email ?? null);
    const origin = await siteUrl();
    const session = await stripe.checkout.sessions.create({
      ui_mode: "embedded",
      mode: "setup",
      currency: "cad",
      customer: customerId,
      payment_method_types: ["acss_debit", "card"],
      payment_method_options: {
        acss_debit: {
          currency: "cad",
          verification_method: "automatic",
          mandate_options: { default_for: ["invoice", "subscription"] },
        },
      },
      setup_intent_data: { metadata: { corporation_id: corporationId, purpose: "update_payment_method" } },
      metadata: { corporation_id: corporationId, purpose: "update_payment_method" },
      redirect_on_completion: "if_required",
      return_url: `${origin}/strata/${corporationId}/billing/payment-updated?session_id={CHECKOUT_SESSION_ID}`,
    });
    if (!session.client_secret) return { error: "Stripe didn't return a payment form. Please try again." };
    return { clientSecret: session.client_secret, sessionId: session.id };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[startPaymentMethodUpdate] ${corporationId} (${mode}):`, detail);
    return {
      error:
        mode === "sandbox"
          ? `Sandbox: ${detail}`
          : "Stripe's payment form couldn't be opened. Please try again. If this keeps happening, contact us.",
    };
  }
}

/** After the update form completes: use the new method from now on, if it's ready. */
export async function finishPaymentMethodUpdate(
  corporationId: string,
  sessionId: string
): Promise<{ state: "updated" | "verify" | "failed" }> {
  await requireAdmin(corporationId);
  return { state: await recordPaymentMethodUpdate(corporationId, sessionId) };
}

/**
 * A first payment that can't go through (declined, or a bank account that
 * won't verify): cancel that subscription and go back to the payment form
 * to use a different method. Nothing was charged.
 */
export async function restartSubscription(corporationId: string) {
  await requireAdmin(corporationId);
  const admin = createAdminClient();
  const { data: sub } = await admin
    .from("subscriptions")
    .select("status, stripe_subscription_id, stripe_status, billing_interval")
    .eq("corporation_id", corporationId)
    .maybeSingle();
  if (sub?.stripe_subscription_id && sub.status !== "active" && sub.stripe_status === "incomplete") {
    try {
      await (await stripeFor(corporationId)).subscriptions.cancel(sub.stripe_subscription_id);
    } catch (error) {
      console.error("[restartSubscription]", error instanceof Error ? error.message : error);
    }
    await admin
      .from("subscriptions")
      .update({ stripe_subscription_id: null, stripe_status: null, status: "deactivated" })
      .eq("corporation_id", corporationId);
  }
  redirect(`/strata/${corporationId}/billing?plan=${sub?.billing_interval === "monthly" ? "monthly" : "annual"}&step=pay`);
}
