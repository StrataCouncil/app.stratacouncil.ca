import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { AccountSettings } from "@/components/AccountSettings";
import { EmailPreferences } from "@/components/EmailPreferences";
import { getCurrentProfile } from "@/lib/data/profile";
import { createClient } from "@/lib/supabase/server";

/**
 * Account — belongs to the user, not any corporation, same as Home and
 * Council Training (doc03's "two levels" split), so it lives in the
 * global `AppShell` rather than under `/strata/[corpId]`.
 *
 * Now fetches the real signed-in profile server-side and passes it down
 * — `AccountSettings` no longer reads the `currentProfile` mock, which
 * previously showed the same fake email/phone/2FA state to every signed-in
 * user regardless of who they actually were.
 */
export default async function AccountPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  // Read on their own, so the page still works if the columns aren't there yet.
  const { data: prefs } = await (await createClient())
    .from("profiles")
    .select("setup_emails_off_at, marketing_opt_in")
    .eq("id", profile.id)
    .maybeSingle();

  return (
    <AppShell>
      <div className="wrap page">
        <div className="page-header">
          <h1>Account</h1>
          <p>Your profile, sign-in details, and account settings.</p>
        </div>

        <AccountSettings
          profile={profile}
          emails={prefs ? <EmailPreferences initial={{ setupTips: !prefs.setup_emails_off_at, productNews: Boolean(prefs.marketing_opt_in) }} /> : null}
        />
      </div>
    </AppShell>
  );
}
