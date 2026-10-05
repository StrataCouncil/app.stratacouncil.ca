import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isStrataAdmin } from "@/lib/auth/strata-admin";
import { recordSubscriptionPayment } from "@/lib/stripe/checkout-results";

/**
 * Where the subscribe dialog's payment form returns when a bank or card
 * check needed a redirect to finish (most finish inside the dialog and
 * never come here). Records the subscription, then shows Billing's result.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ corpId: string }> }) {
  const { corpId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isStrataAdmin(supabase, corpId))) redirect(`/strata/${corpId}`);

  await recordSubscriptionPayment(corpId, request.nextUrl.searchParams.get("subscription_id") ?? "");
  redirect(`/strata/${corpId}/billing?subscribed=1`);
}
