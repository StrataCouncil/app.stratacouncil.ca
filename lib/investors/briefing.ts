import { COMPANY_LEGAL_NAME } from "../company.ts";

/**
 * The investor briefing (0061): a private deck for prospective investors
 * at /investors. Shared constants and the legal disclaimer they accept
 * before reading it.
 */

export const INVESTORS_EMAIL = "investors@stratacouncil.ca";
export const MEETING_URL = "https://calendly.com/stratacouncil/demo";
export const PRIVACY_URL = "https://stratacouncil.ca/privacy";
export const INVESTOR_DECK_BUCKET = "investor-deck";
/** A sign-in link, and the visit it starts, works this long. */
export const LINK_DAYS = 30;
export const SESSION_COOKIE = "sc_investor";

/** Bump when the disclaimer text changes; each investor's acceptance records the version. */
export const DISCLAIMER_VERSION = "2026-10-21";

export const DISCLAIMER_TITLE = "Legal Disclaimer and Private Placement Notice";

export const DISCLAIMER: Array<{ heading?: string; paragraphs: string[]; points?: Array<[string, string]> }> = [
  {
    paragraphs: [
      `This presentation (the "Presentation") is for informational purposes only and does not constitute an offer to sell, or a solicitation of an offer to buy, any securities of ${COMPANY_LEGAL_NAME} (the "Company").`,
    ],
  },
  {
    heading: "Private placement and jurisdictional notice",
    paragraphs: [
      `Any offering of securities will be made only to "accredited investors" (as defined under National Instrument 45-106 Prospectus Exemptions) or pursuant to other available prospectus exemptions under applicable Canadian securities laws. This Presentation is not, and under no circumstances is to be construed as, a prospectus, a public offering, or an advertisement of securities in British Columbia or any other jurisdiction. No securities regulatory authority in Canada or elsewhere has reviewed or in any way passed upon this document or the merits of the securities described herein.`,
    ],
  },
  {
    heading: "Confidentiality",
    paragraphs: [
      `This Presentation and the information contained herein are confidential and proprietary to the Company. By accepting or viewing this Presentation, you agree that you will not distribute, reproduce, or disclose this document, in whole or in part, to any third party without the prior written consent of the Company.`,
    ],
  },
  {
    heading: "Forward-looking information",
    paragraphs: [
      `This Presentation contains "forward-looking information" within the meaning of applicable Canadian securities legislation. This information relates to future events, anticipated financial or operational performance, business strategy, and market growth.`,
    ],
    points: [
      ["Assumptions", "Forward-looking statements are based on a number of material assumptions made by management, including market conditions, ability to obtain financing, and timing of product development."],
      ["Risks", "These statements involve significant known and unknown risks, uncertainties, and other factors that may cause actual results or achievements to be materially different from any future results expressed or implied by the forward-looking information."],
      ["No obligation to update", "The Company explicitly disclaims any intention or obligation to update or revise any forward-looking information, whether as a result of new information, future events, or otherwise, except as expressly required by applicable law."],
    ],
  },
  {
    heading: "No reliance and investment risks",
    paragraphs: [
      `The information contained herein is a summary and does not purport to be complete. An investment in the Company involves a high degree of risk, is highly speculative, and is suitable only for sophisticated investors who can bear the risk of a total loss of their investment. Prospective investors must conduct their own independent due diligence and consult their own legal, financial, and tax advisors.`,
    ],
  },
];

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
export function normalizeInvestorEmail(value: unknown): string | null {
  const email = String(value ?? "").trim().toLowerCase();
  return EMAIL.test(email) && email.length <= 254 ? email : null;
}

export function normalizeInvestorName(value: unknown): string | null {
  const name = String(value ?? "").trim().replace(/\s+/g, " ");
  return name && name.length <= 120 ? name : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The ?ref= on a shared sign-up link: the sharer's investor id, or nothing. */
export function referralId(value: unknown): string | null {
  const v = String(value ?? "").trim();
  return UUID.test(v) ? v.toLowerCase() : null;
}

/** "3m 20s", "45s", "1h 5m". */
export function formatSeconds(total: number): string {
  const s = Math.max(0, Math.round(total));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** "Oct 21, 2026, 3:04 p.m." in Pacific time, or a dash. */
export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-CA", {
    timeZone: "America/Vancouver",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
