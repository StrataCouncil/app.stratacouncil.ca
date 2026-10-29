import Link from "next/link";

export type AdminTab = "overview" | "stratas" | "users" | "training" | "library" | "legislation" | "announcements" | "demo" | "investors" | "social";

const TABS: Array<{ key: AdminTab; label: string; href: string }> = [
  { key: "overview", label: "Overview", href: "/admin" },
  { key: "stratas", label: "Stratas", href: "/admin/stratas" },
  { key: "users", label: "Users", href: "/admin/users" },
  { key: "announcements", label: "Announcements", href: "/admin/announcements" },
  { key: "library", label: "Library", href: "/admin/library" },
  { key: "training", label: "Council Training", href: "/admin/training" },
  { key: "legislation", label: "Knowledge Base", href: "/admin/legislation" },
  { key: "demo", label: "Demo", href: "/admin/demo" },
  { key: "investors", label: "Investors", href: "/admin/investors" },
  { key: "social", label: "Social", href: "/admin/social" },
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
