import type { NextRequest } from "next/server";

/**
 * POSTs to the meeting routes come from our own pages. Browsers send Origin
 * on every POST; one from another site is refused (the session cookie is
 * already SameSite=Lax; this is the second lock).
 */
export function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === (request.headers.get("x-forwarded-host") ?? request.headers.get("host"));
  } catch {
    return false;
  }
}
