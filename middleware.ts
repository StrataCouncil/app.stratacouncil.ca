import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { IS_DEMO } from "@/lib/demo";

// Reachable without a session. Everything else redirects to /login.
// /start and /demo: the demo site's personal links and the page that
// explains them (both do nothing on the live site).
const PUBLIC_PATHS = ["/login", "/signup", "/auth/confirm", "/start", "/demo"];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  );
}

/**
 * Refreshes the Supabase auth session on every request. Required with
 * @supabase/ssr's cookie-based auth — without this, a Server Component's
 * session can go stale mid-visit since Server Components can't write
 * cookies themselves (server.ts's setAll() no-ops there by design).
 *
 * Also the route guard: everything except PUBLIC_PATHS requires a
 * session (doc03 — the whole app past signup/login is behind auth), and
 * a signed-in user hitting /login or /signup is sent straight to the
 * dashboard instead of being shown the form again.
 *
 * 2FA is NOT enforced here — reversed 2026-09-29 (doc00 changelog, doc01
 * §2, doc03 Stage 2/2a). A magic-link session is sufficient on its own;
 * nothing redirects to /auth/mfa/enroll or /auth/mfa/challenge any more.
 * This is a deliberate, temporary call: 2FA (TOTP, built and working —
 * lib/auth/mfa.ts, the enroll/challenge screens, backup codes, all of it)
 * adds real setup friction to a free-tier signup funnel with zero revenue
 * to justify it yet, and this audience (a first-time volunteer council
 * member) is judged unlikely to get through an authenticator-app setup
 * step unassisted. The gate is commented out, not deleted, and the whole
 * TOTP implementation stays in the codebase, reachable by visiting
 * /auth/mfa/enroll directly — re-enabling 2FA later is uncommenting the
 * block below (and deciding whether to also require it retroactively for
 * already-signed-up accounts), not rebuilding anything. See doc01 §2 for
 * the full reasoning and the plan to revisit once there's a paying
 * customer base to justify the added friction (and, separately, once SMS
 * via Twilio is worth its own cost — doc04 §7b).
 *
 * Kept for later, not wired in:
 *   const { data: factorsData } = await supabase.auth.mfa.listFactors();
 *   const hasVerifiedTotpFactor = Boolean(
 *     factorsData?.totp?.some((f) => f.status === "verified")
 *   );
 *   if (!hasVerifiedTotpFactor) redirect to /auth/mfa/enroll
 *   const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
 *   if (aal?.currentLevel !== "aal2" && no valid backup-code cookie) redirect to /auth/mfa/challenge
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Touches the session so an expired access token gets refreshed via
  // the request's refresh token before any Server Component runs.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const publicPath = isPublicPath(pathname);

  if (IS_DEMO) return demoGuard(request, supabase, user, () => response);

  if (!user && !publicPath) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  if (user && (pathname === "/login" || pathname === "/signup")) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // MFA gate intentionally not wired in — see the comment above. A signed-in
  // user proceeds straight through regardless of 2FA enrollment status.

  return response;
}

/**
 * The demo site (lib/demo.ts). Visitors only ever arrive through their
 * personal link (/start/<token>), so there's no sign-up or sign-in page,
 * and a session ends at midnight Pacific with the link: the account
 * carries the time (app_metadata.demo_expires_at, set when the link is
 * opened). The Super Admin console and the builders aren't part of the
 * demo.
 */
async function demoGuard(
  request: NextRequest,
  supabase: ReturnType<typeof createServerClient>,
  user: { app_metadata?: Record<string, unknown> } | null,
  // The response so far: the session cookie handlers replace it when they
  // set cookies, so it's read at the end, not passed in.
  currentResponse: () => NextResponse
) {
  const { pathname } = request.nextUrl;
  const go = (path: string) => {
    const to = NextResponse.redirect(new URL(path, request.url));
    // Keep any cookies the session refresh (or sign-out) just set.
    currentResponse().cookies.getAll().forEach((c) => to.cookies.set(c));
    return to;
  };

  // A new link always gets through: it signs its visitor in afresh.
  if (pathname === "/start" || pathname.startsWith("/start/")) return currentResponse();

  if (user) {
    const endsAt = Date.parse(String(user.app_metadata?.demo_expires_at ?? ""));
    if (!(endsAt > Date.now())) {
      await supabase.auth.signOut();
      return pathname === "/demo" ? currentResponse() : go("/demo?link=expired");
    }
  }

  if (pathname === "/login" || pathname === "/signup" || pathname.startsWith("/admin") || pathname.startsWith("/build")) {
    return go(user ? "/" : "/demo");
  }
  if (!user && !isPublicPath(pathname)) return go("/demo");
  return currentResponse();
}

export const config = {
  // /api is excluded: API routes authenticate themselves (session cookie,
  // a signature like send-email-hook's, or a service-role key) rather than
  // relying on this middleware's user-session redirect, and a webhook
  // caller like Supabase has no session cookie to present — without this
  // exclusion it was getting redirected to /login and bouncing off that
  // page's GET-only handler with a 405 (2026-09-30, doc00 changelog).
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
