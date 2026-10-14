/**
 * A post-login redirect target, restricted to same-site paths — never an
 * open redirect. Browsers read "/\evil.com" like "//evil.com", so a
 * backslash (or a control character) anywhere refuses the path too.
 */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !/[\\\u0000-\u001f]/.test(next) ? next : "/";
}
