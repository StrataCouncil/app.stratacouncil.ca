import Link from "next/link";

export type AdminTab = "overview" | "stratas" | "training" | "library" | "legislation" | "announcements" | "demo";

const TABS: Array<{ key: AdminTab; label: string; href: string }> = [
  { key: "overview", label: "Overview", href: "/admin" },
  { key: "stratas", label: "Stratas", href: "/admin/stratas" },
  { key: "training", label: "Council Training", href: "/admin/training" },
  { key: "library", label: "Library", href: "/admin/library" },
  { key: "legislation", label: "Legislation Library", href: "/admin/legislation" },
  { key: "announcements", label: "Announcements", href: "/admin/announcements" },
  { key: "demo", label: "Demo", href: "/admin/demo" },
];

/** The Super Admin console's sections, on every /admin page (styled like the Stratasphere sub-nav). */
export function AdminTabs({ active }: { active: AdminTab }) {
  return (
    <nav className="substrata-nav admin-tabs" aria-label="Super Admin console">
      {TABS.map((t) => (
        <Link key={t.key} href={t.href} data-active={active === t.key} aria-current={active === t.key ? "page" : undefined} data-testid={`admin-tab-${t.key}`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
