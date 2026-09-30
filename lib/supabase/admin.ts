import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client — bypasses RLS entirely. Server-only,
 * never imported into anything that ships to the browser.
 *
 * Reserve this for the handful of operations that genuinely need to act
 * outside a user's own permissions: the Supabase Auth Send Email Hook
 * receiver (doc04 §7a), Inngest background jobs (doc04 §4/§11), and
 * Stripe/webhook handlers. Everything else should go through
 * lib/supabase/server.ts so RLS (doc01 §6) stays the one place
 * authorization is enforced — duplicating those checks in application
 * code here would be exactly the anti-pattern doc04 §3 warns against.
 */
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
