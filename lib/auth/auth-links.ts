import { safeNext } from "../safe-next.ts";

/**
 * Links between the sign-in and sign-up pages that keep `next`, the page
 * someone was sent to (a Library item, say), so it survives creating an
 * account: login ?next= → signup ?next= → the confirmation email's link
 * (lib/auth/actions.ts sendOtp) → /auth/confirm → that page. Only a path
 * on this site is ever carried (safeNext); anything else, or the home
 * page, is left off.
 */
export function authHref(page: "/login" | "/signup", opts: { next?: string | null; email?: string | null } = {}): string {
  const params = new URLSearchParams();
  if (opts.email) params.set("email", opts.email);
  const next = safeNext(opts.next);
  if (next !== "/") params.set("next", next);
  const query = params.toString();
  return query ? `${page}?${query}` : page;
}
