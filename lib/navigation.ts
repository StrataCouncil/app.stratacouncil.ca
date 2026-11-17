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
  if (pathname === "/training" || pathname.startsWith("/training/") || pathname === "/library" || pathname.startsWith("/library/") || pathname === "/templates") {
    return "resources";
  }
  const strata = /^\/strata\/[^/]+(\/[^/]+)?/.exec(pathname);
  if (strata) return strata[1] === "/assistant" ? "stratasphere" : "strata";
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
  // Directives (0097) live here too, so managers see the tab for those.
  { slug: "discussions", label: "Discussions", section: "strata", councilOnly: true },
  // The strata's document repository: every connected member, free to store.
  // Stratasphere reads it, but it belongs to the strata (2026-11-12).
  { slug: "documents", label: "Documents", section: "strata" },
  { slug: "council", label: "Council", section: "strata" },
  { slug: "lots", label: "Owners", section: "strata" },
  // Only the Admin and the Manager role see this one at all.
  { slug: "management", label: "Management", section: "strata", managersOnly: true },
  // Billing: the admin, and anyone they've given billing access to (0046); others never see the tab.
  { slug: "billing", label: "Billing", section: "strata", billingOnly: true },
  { slug: "assistant", label: "Ask", section: "stratasphere", gated: true, phone: true },
];

/** The menu for a page: its section's items that this person sees. */
export function navItemsFor(
  active: string,
  who: { canManage: boolean; canBill: boolean; seesDiscussions: boolean; seesDirectives?: boolean }
): NavItem[] {
  const key = active === "home" ? "" : active;
  const section = NAV_ITEMS.find((i) => i.slug === key)?.section ?? "strata";
  return NAV_ITEMS.filter(
    (i) =>
      i.section === section &&
      (!i.managersOnly || who.canManage) &&
      (!i.billingOnly || who.canBill) &&
      (!i.councilOnly || who.seesDiscussions || who.seesDirectives === true)
  );
}

