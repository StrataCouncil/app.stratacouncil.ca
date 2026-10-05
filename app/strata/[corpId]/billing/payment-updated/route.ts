import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isStrataAdmin } from "@/lib/auth/strata-admin";
import { recordPaymentMethodUpdate } from "@/lib/stripe/payment-results";

/** Where the update-payment-method form returns when a bank needed a redirect. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ corpId: string }> }) {
  const { corpId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isStrataAdmin(supabase, corpId))) redirect(`/strata/${corpId}`);

  await recordPaymentMethodUpdate(corpId, request.nextUrl.searchParams.get("session_id") ?? "");
  redirect(`/strata/${corpId}/billing`);
}
