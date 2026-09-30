import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Supabase client for use in Server Components, Route Handlers, and
 * Server Actions. Still the anon key + RLS (doc01 §6) — this is not a
 * service-role client. Reads the request's auth cookies so RLS sees the
 * signed-in user via auth.uid().
 *
 * Call this fresh per request (don't cache/module-scope the instance) —
 * the cookies() call below is what ties it to the current request.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component that can't set cookies —
            // fine as long as middleware.ts is also refreshing the
            // session, which it is (see middleware.ts at the repo root).
          }
        },
      },
    }
  );
}
