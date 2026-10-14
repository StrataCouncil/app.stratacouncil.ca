/**
 * True for an absolute http(s) address. Links people add (agenda
 * attachments, link documents) are only ever opened if they pass this, so
 * a `javascript:` or `data:` address can't run code in someone's session.
 */
export function isWebUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}
