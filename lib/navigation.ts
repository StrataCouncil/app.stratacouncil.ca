/**
 * The app's menus (2026-11-12, docs/learn-decide-remember.md §2): which
 * top-bar section a page is in (components/TopNav.tsx), and the
 * second-level items inside a strata (components/StrataSphereNav.tsx).
 * Plain functions, so tests/navigation.test.ts can check them.
 */

export type TopSection = "resources" | "strata" | "stratasphere" | "admin";

/** Which top-bar section a path belongs to. */
export function sectionFor(pathname: string): TopSection | null {
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return "admin";
  if (pathname === "/training" || pathname.startsWith("/training/") || pathname === "/library" || pathname.startsWith("/library/")) {
    return "resources";
  }
  const strata = /^\/strata\/[^/]+(\/[^/]+)?/.exec(pathname);
  if (strata) return strata[1] === "/assistant" || strata[1] === "/documents" ? "stratasphere" : "strata";
  if (pathname === "/strata" || pathname.startsWith("/strata/")) return "strata";
  return null;
}

export type NavItem = {
  slug: string;
  label: string;
  section: "strata" | "stratasphere";
  gated?: boolean;
  managersOnly?: boolean;
  billingOnly?: boolean;
  councilOnly?: boolean;
  /** Works on a phone (ScreenGate). */
  phone?: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  // Overview is the strata's landing page: its dashboard.
  { slug: "", label: "Overview", section: "strata" },
  { slug: "meetings", label: "Meetings", section: "strata" },
  // Council votes between meetings (0070): council and those who run meetings.
  { slug: "discussions", label: "Discussions", section: "strata", councilOnly: true },
  { slug: "council", label: "Council", section: "strata" },
  { slug: "lots", label: "Owners", section: "strata" },
  // Only the Admin and the Manager role see this one at all.
  { slug: "management", label: "Management", section: "strata", managersOnly: true },
  // Billing: the admin, and anyone they've given billing access to (0046); others never see the tab.
  { slug: "billing", label: "Billing", section: "strata", billingOnly: true },
  { slug: "assistant", label: "Ask", section: "stratasphere", gated: true, phone: true },
  { slug: "documents", label: "Documents", section: "stratasphere" },
];

/** The menu for a page: its section's items that this person sees. */
export function navItemsFor(
  active: string,
  who: { canManage: boolean; canBill: boolean; seesDiscussions: boolean }
): NavItem[] {
  const key = active === "home" ? "" : active;
  const section = NAV_ITEMS.find((i) => i.slug === key)?.section ?? "strata";
  return NAV_ITEMS.filter(
    (i) =>
      i.section === section &&
      (!i.managersOnly || who.canManage) &&
      (!i.billingOnly || who.canBill) &&
      (!i.councilOnly || who.seesDiscussions)
  );
}

