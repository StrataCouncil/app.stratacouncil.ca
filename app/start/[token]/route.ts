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
 * GET only shows a small "Setting up your demo" page (the logo and a
 * spinner, with a button only if it's still waiting after 10 seconds, or
 * when scripts are off), titled for link previews, that sends itself on as
 * a POST. Messages, email scanners and
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
  const image = new URL("/opengraph-image.png", request.url).href;
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
<meta property="og:image" content="${image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f8f6f1;color:#1b2a41;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
main{text-align:center;padding:24px}
.logo{display:block;width:211px;height:32px;margin:0 auto 32px}
.spinner{width:28px;height:28px;margin:0 auto 18px;border:3px solid #d9d4c7;border-top-color:#1b2a41;border-radius:50%;animation:spin .9s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.spinner{animation-duration:2.4s}}
h1{margin:0 0 6px;font-size:20px;font-weight:600}
p{margin:0 0 16px;font-size:16px;color:#5b6575}
button{font:inherit;font-weight:600;font-size:16px;padding:12px 22px;border:0;border-radius:8px;background:#1b2a41;color:#fff;cursor:pointer}
[hidden]{display:none}
</style>
<noscript><style>.spinner{display:none}button[hidden]{display:inline-block}</style></noscript>
</head>
<body>
<main>
<img class="logo" src="/email/stratacouncil-logo-2026.png" width="211" height="32" alt="StrataCouncil.ca">
<form method="post" action="/start/${token}">
<div class="spinner" aria-hidden="true"></div>
<h1 role="status">Setting up your demo</h1>
<p id="note">This takes a few seconds.</p>
<noscript><p>Select the button to continue.</p></noscript>
<button type="submit" hidden>Open the demo</button>
</form>
</main>
<script>
// Goes on by itself; the button only appears if it's still waiting after 10 seconds.
document.forms[0].submit();
setTimeout(function(){document.getElementById("note").textContent="Taking a while?";document.querySelector("button").hidden=false;},10000);
</script>
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
