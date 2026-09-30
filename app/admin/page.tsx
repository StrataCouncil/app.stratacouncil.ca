import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { AdminCorporationSearch } from "@/components/AdminCorporationSearch";
import { allCorporations, currentProfile } from "@/lib/placeholder-data";

/**
 * The Super Admin console — platform staff only (`currentProfile.
 * isSuperAdmin`), enforced here with `notFound()` rather than a
 * lock-panel: unlike a paywalled Stratasphere feature, there's no reason
 * for a connected council member to know this exists at all, let alone
 * see an upgrade pitch for it. `AppShell` already hides the nav link for
 * the same reason; this is the server-side backstop for anyone who
 * navigates here directly.
 *
 * Lists every corporation on the platform (`allCorporations`), not just
 * ones this profile belongs to — a Super Admin doesn't need a
 * `corporation_role_assignments` row anywhere to look a corp up (doc01
 * §1). Search is by SP# or building name, the two things support usually
 * starts from.
 */
export default function AdminConsolePage() {
  if (!currentProfile.isSuperAdmin) notFound();

  return (
    <AppShell active="admin">
      <div className="wrap page">
        <div className="page-header">
          <h1>Admin console</h1>
          <p>
            Platform-staff only. Search any corporation by Strata Plan
            number or building name &mdash; this list isn&rsquo;t scoped to
            corporations you&rsquo;re a connected member of.
          </p>
        </div>

        <AdminCorporationSearch corporations={allCorporations} />
      </div>
    </AppShell>
  );
}
