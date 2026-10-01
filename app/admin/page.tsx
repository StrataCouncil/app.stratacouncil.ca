import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { AdminCorporationSearch } from "@/components/AdminCorporationSearch";
import { allCorporations } from "@/lib/placeholder-data";
import { getCurrentProfile } from "@/lib/data/profile";

/**
 * The Super Admin console — platform staff only. Now gated on the real
 * `profiles.is_super_admin` flag instead of the `currentProfile` mock,
 * which could show/hide this page for the wrong reason regardless of who
 * was actually signed in — a real gap given this is an authorization
 * check, not just cosmetic nav chrome. `AppShell`'s own nav link uses the
 * same real check now (components/AppShell.tsx); this is the server-side
 * backstop for anyone who navigates here directly.
 *
 * `AdminCorporationSearch`/`allCorporations` below is still placeholder
 * data — not part of this identity/billing pass.
 */
export default async function AdminConsolePage() {
  const profile = await getCurrentProfile();
  if (!profile?.isSuperAdmin) notFound();

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
