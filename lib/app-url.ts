/**
 * The app's own public URL, for links we put in emails. Deliberately not
 * taken from Supabase's `site_url` (unreliable in hook payloads — see
 * app/api/auth/send-email-hook/route.ts) or the request's Host header
 * (an email link should always point at the canonical app).
 * NEXT_PUBLIC_APP_URL lets a preview deployment override it.
 */
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.stratacouncil.ca";
