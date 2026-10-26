import { CAMPAIGN_KEYS, readCampaign, type Campaign } from "./campaign.ts";

/**
 * Demo requests (0067): the "Request a demo" form on stratacouncil.ca,
 * posted to /api/demo-requests and handled from the Super Admin console's
 * Demo tab. The checks here are shared by the route and the tests; the
 * saving and emailing are in lib/demo-requests-server.ts.
 */

export type DemoRequestSource = "home" | "coming-soon";

export const DEMO_REQUEST_SOURCES: Record<DemoRequestSource, string> = {
  home: "Home page",
  "coming-soon": "Coming soon page",
};

export type DemoRequestInput =
  | { ok: true; name: string; email: string; source: DemoRequestSource; campaign: Campaign | null }
  /** A bot filled in the hidden field: look successful, keep nothing. */
  | { ok: true; bot: true }
  | { ok: false; message: string };

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** Checks the posted form. Messages are the ones the visitor sees. */
export function parseDemoRequest(body: unknown): DemoRequestInput {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (String(b.website ?? "").trim()) return { ok: true, bot: true };

  const name = String(b.name ?? "").trim().replace(/\s+/g, " ");
  const email = String(b.email ?? "").trim().toLowerCase();
  if (!name || name.length > 120) return { ok: false, message: "Please enter your name." };
  if (!EMAIL.test(email) || email.length > 254) return { ok: false, message: "Please enter a valid email address." };

  const source: DemoRequestSource = b.page === "coming-soon" ? "coming-soon" : "home";
  const tags = b.campaign && typeof b.campaign === "object" ? (b.campaign as Record<string, unknown>) : {};
  const campaign = readCampaign({ get: (key: string) => tags[key] });
  return { ok: true, name, email, source, campaign };
}

/** "facebook / social / first-meeting": the campaign tags in a short line, for the console and the notice. */
export function campaignLine(campaign: Campaign | null | undefined): string {
  if (!campaign) return "";
  return CAMPAIGN_KEYS.slice(0, 3)
    .map((key) => campaign[key])
    .filter(Boolean)
    .join(" / ");
}
