/** A post-login redirect target, restricted to same-site paths — never an open redirect. */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}
