import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe/client";

/**
 * Where Stripe's secure payment-method page returns (billing step 2). Makes
 * the newly saved card or pre-authorized debit the corporation's default,
 * then continues to the billing contacts step. Admin-only, and the Stripe
 * session must belong to this corporation's customer.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ corpId: string }> }) {
  const { corpId } = await params;
  const sessionId = request.nextUrl.searchParams.get("session_id") ?? "";
  const back = (step: string, plan = "annual", note?: string) =>
    redirect(`/strata/${corpId}/billing?plan=${plan}&step=${step}${note ? `&note=${note}` : ""}`);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: role } = await supabase
    .from("corporation_role_assignments")
    .select("role")
    .eq("corporation_id", corpId)
    .eq("user_id", user.id)
    .eq("role", "admin")
    .maybeSingle();
  if (!role) redirect(`/strata/${corpId}`);

  const { data: sub } = await createAdminClient()
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("corporation_id", corpId)
    .maybeSingle();
  if (!sessionId.startsWith("cs_") || !sub?.stripe_customer_id) back("payment");

  const stripe = getStripe();
  let plan = "annual";
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["setup_intent"] });
    plan = session.metadata?.billing_interval === "monthly" ? "monthly" : "annual";
    const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
    if (!customerId || session.mode !== "setup" || customerId !== sub!.stripe_customer_id || session.metadata?.corporation_id !== corpId) {
      return back("payment", plan);
    }
    const intent = session.setup_intent;
    const pm =
      intent && typeof intent !== "string" && intent.payment_method
        ? typeof intent.payment_method === "string"
          ? intent.payment_method
          : intent.payment_method.id
        : null;
    if (!pm) return back("payment", plan);
    await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: pm } });
    // A pre-authorized debit can still be confirming its bank account.
    const pending = typeof intent !== "string" && intent?.status !== "succeeded";
    return back("contact", plan, pending ? "verifying" : undefined);
  } catch (error) {
    // redirect() throws on purpose; let it through.
    if (error && typeof error === "object" && "digest" in error) throw error;
    console.error("[billing setup-complete]", error instanceof Error ? error.message : error);
    return back("payment", plan);
  }
}
