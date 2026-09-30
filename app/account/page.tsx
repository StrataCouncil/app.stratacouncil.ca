import { AppShell } from "@/components/AppShell";
import { AccountSettings } from "@/components/AccountSettings";

/**
 * Account — belongs to the user, not any corporation, same as Home and
 * Council Training (doc03's "two levels" split), so it lives in the
 * global `AppShell` rather than under `/strata/[corpId]`. Reachable from
 * `AccountMenu` in the header, which is also where this page previously
 * had no home at all — there was no way to reach a profile, change an
 * email, or delete an account anywhere in the app before this.
 */
export default function AccountPage() {
  return (
    <AppShell>
      <div className="wrap page">
        <div className="page-header">
          <h1>Account</h1>
          <p>Your profile, sign-in details, and account settings.</p>
        </div>

        <AccountSettings />
      </div>
    </AppShell>
  );
}
