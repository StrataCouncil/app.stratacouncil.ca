import Link from "next/link";

export type MarketingTab = "socials" | "emails";

/**
 * The Marketing tab's sections (2026-11-11). Newsletter and Interactives
 * join as they're built; no empty "coming soon" screens.
 */
const TABS: Array<{ key: MarketingTab; label: string; href: string }> = [
  { key: "socials", label: "Socials", href: "/admin/marketing/socials" },
  { key: "emails", label: "Emails", href: "/admin/marketing/emails" },
];

export function MarketingTabs({ active }: { active: MarketingTab }) {
  return (
    <nav className="marketing-tabs" aria-label="Marketing">
      {TABS.map((t) => (
        <Link key={t.key} href={t.href} data-active={active === t.key} aria-current={active === t.key ? "page" : undefined} data-testid={`marketing-tab-${t.key}`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
