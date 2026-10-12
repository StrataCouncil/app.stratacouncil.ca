import { after, NextResponse, type NextRequest } from "next/server";
import { IS_DEMO, isDemoToken } from "@/lib/demo";
import { openDemoLink, wipeExpiredVisitors } from "@/lib/demo-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * A visitor's personal demo link (demo site only). Works again (and on
 * another device) until it ends (lib/demo.ts, demoLinkEnds); then /demo
 * explains that it has ended.
 *
 * GET only shows a small "Opening your demo" page, titled for link
 * previews, that sends itself on as a POST. Messages, email scanners and
 * other link previews fetch the link without running scripts, so they
 * stop there: they don't set anything up or count as the visitor opening
 * it. The POST sets up the visitor's account and their own copy of the
 * fictional strata the first time, signs them in, and opens the strata or
 * Council Training (whichever the link was made for).
 */
export const maxDuration = 60;

const PREVIEW_TITLE = "StrataCouncil.ca Demo";
const PREVIEW_DESCRIPTION = "Your personal link to try StrataCouncil.ca with your own fictional strata.";

function goTo(request: NextRequest, path: string) {
  // 303, so the browser follows with a GET.
  return NextResponse.redirect(new URL(path, request.url), 303);
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (!IS_DEMO) return new Response("Not found", { status: 404 });
  const { token } = await params;
  if (!isDemoToken(token)) return goTo(request, "/demo?link=unknown");
  // The token is only letters, digits, "-" and "_" (isDemoToken), so it's safe in the page as is.
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="same-origin">
<title>${PREVIEW_TITLE}</title>
<meta name="description" content="${PREVIEW_DESCRIPTION}">
<meta property="og:title" content="${PREVIEW_TITLE}">
<meta property="og:description" content="${PREVIEW_DESCRIPTION}">
<meta property="og:site_name" content="StrataCouncil.ca">
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f8f6f1;color:#1b2a41;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
main{text-align:center;padding:24px}
p{margin:0 0 16px;font-size:17px}
button{font:inherit;font-weight:600;font-size:16px;padding:12px 22px;border:0;border-radius:8px;background:#1b2a41;color:#fff;cursor:pointer}
</style>
</head>
<body>
<main>
<form method="post" action="/start/${token}">
<p>Opening your demo&hellip;</p>
<noscript><p>Select the button to continue.</p></noscript>
<button type="submit">Open the demo</button>
</form>
</main>
<script>document.forms[0].submit();</script>
</body>
</html>`;
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (!IS_DEMO) return new Response("Not found", { status: 404 });
  // Only the page above may sign someone in: a form on another site can't.
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return new Response("Forbidden", { status: 403 });
  const { token } = await params;
  if (!isDemoToken(token)) return goTo(request, "/demo?link=unknown");

  const opened = await openDemoLink(token);
  // Yesterday's visitors, if the nightly clean-up hasn't got to them yet.
  after(() => wipeExpiredVisitors().catch((err) => console.error("[start] clean-up:", err)));
  if (!opened.ok) return goTo(request, `/demo?link=${opened.reason}`);

  // Sign in as the visitor: a one-time sign-in token, used straight away
  // (nothing is emailed).
  const { data: link, error: linkError } = await createAdminClient().auth.admin.generateLink({
    type: "magiclink",
    email: opened.email,
  });
  if (linkError || !link.properties?.hashed_token) {
    console.error("[start] sign-in link:", linkError?.message);
    return goTo(request, "/demo?link=busy");
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });
  if (error) {
    console.error("[start] sign-in:", error.message);
    return goTo(request, "/demo?link=busy");
  }

  return goTo(request, opened.landing === "training" ? "/training" : `/strata/${opened.corporationId}`);
}
