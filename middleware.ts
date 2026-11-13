import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { IS_DEMO } from "@/lib/demo";
import { MFA_BACKUP_COOKIE_NAME, verifyMfaBackupCookieValue } from "@/lib/auth/mfa-session";

// Reachable without a session. Everything else redirects to /login.
// /start and /demo: the demo site's personal links and the page that
// explains them (both do nothing on the live site).
// /investors: the investor briefing, which has its own sign-in by email (0061).
const PUBLIC_PATHS = ["/login", "/signup", "/auth/confirm", "/start", "/demo", "/investors", "/google-drive/return", "/e", "/unsubscribe"];

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
 * Two-step verification is optional, and set up from Account Settings
 * (authenticator app, free; no SMS). Anyone who has set it up is asked for
 * the code at sign-in; Super Admins must set it up (0053). It was made
 * optional for everyone else 2026-09-29 (doc01 §2) so a first-time
 * volunteer can sign up and sign in with an email code alone.
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
    // Signing in brings them back here (an email's link, say).
    if (pathname !== "/") loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }

  if (user && (pathname === "/login" || pathname === "/signup")) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // Two-step verification (0053; everyone, 2026-11-13). Anyone who has set
  // up an authenticator app is asked for its code once per sign-in, then
  // goes through as normal; a backup code (lib/auth/mfa-session.ts) also
  // counts. Without this, Supabase's "Limit duration of AAL1 sessions"
  // would sign them out after 15 minutes. Setting one up stays optional,
  // except for Super Admins: their account reaches every strata, so they're
  // sent to set one up, and the database withholds their powers until the
  // session has the code (aal2). Public pages (an email's link, say) never
  // ask.
  if (user && !publicPath && !pathname.startsWith("/auth/")) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel !== "aal2") {
      const redirectTo = (path: string) => {
        const url = new URL(path, request.url);
        if (pathname !== "/") url.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
        const to = NextResponse.redirect(url);
        response.cookies.getAll().forEach((c) => to.cookies.set(c));
        return to;
      };
      if (aal?.nextLevel === "aal2") {
        if (!(await hasBackupClearance(request, user.id))) return redirectTo("/auth/mfa/challenge");
      } else {
        const { data: profile } = await supabase.from("profiles").select("is_super_admin").eq("id", user.id).maybeSingle();
        if (profile?.is_super_admin) return redirectTo("/auth/mfa/enroll");
      }
    }
  }

  return response;
}

/** A backup code used this session (never issued to Super Admins). */
async function hasBackupClearance(request: NextRequest, userId: string) {
  try {
    return await verifyMfaBackupCookieValue(request.cookies.get(MFA_BACKUP_COOKIE_NAME)?.value, userId);
  } catch {
    // No signing secret configured: no backup code could have been accepted.
    return false;
  }
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
