"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { sectionFor } from "@/lib/navigation";

/**
 * The top bar's three sections (2026-11-12, docs/learn-decide-remember.md §2):
 *
 *   Resources     Council Training and the Library. Belongs to the person;
 *                 no strata needed.
 *   Your Strata   The strata's own pages: Overview, Meetings, Discussions,
 *                 Documents, Council, Owners, Management, Billing.
 *   Stratasphere  Ask: the assistant that reads the strata's records.
 *
 * Inside a strata, both strata links stay on that strata (the one in the
 * URL), so switching sections never switches stratas. Elsewhere they go to
 * the person's first strata, or to /strata (connect one) if they have none.
 */
export function TopNav({
  firstCorpId,
  isSuperAdmin,
  pathname: fixedPath,
}: {
  firstCorpId: string | null;
  isSuperAdmin: boolean;
  /** For previews: the page to light the menu for, instead of the current one. */
  pathname?: string;
}) {
  const current = usePathname() ?? "";
  const pathname = fixedPath ?? current;
  const active = sectionFor(pathname);
  const inUrl = /^\/strata\/([^/]+)/.exec(pathname)?.[1] ?? null;
  const corpId = inUrl ?? (firstCorpId ? encodeURIComponent(firstCorpId) : null);
  const strataHref = corpId ? `/strata/${corpId}` : "/strata";
  const sphereHref = corpId ? `/strata/${corpId}/assistant` : "/strata";

  return (
    <nav className="app-nav" aria-label="Primary">
      <Link href="/training" data-active={active === "resources"} data-testid="top-resources">
        Resources
      </Link>
      <Link href={strataHref} data-active={active === "strata"} data-testid="top-strata">
        Your Strata
      </Link>
      <Link href={sphereHref} data-active={active === "stratasphere"} className="app-nav__sphere" data-testid="top-stratasphere">
        Stratasphere&trade;
      </Link>
      {isSuperAdmin && (
        <Link href="/admin" data-active={active === "admin"} data-testid="top-admin" aria-label="Super Admin">
          {/* "Admin" alone on the narrowest phones, so the sections keep to one row. */}
          <span className="app-nav__long">Super </span>Admin
        </Link>
      )}
    </nav>
  );
}
