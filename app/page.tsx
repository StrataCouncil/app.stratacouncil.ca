import Link from "next/link";
import { AutoRefresh } from "@/components/AutoRefresh";
import { AppShell } from "@/components/AppShell";
import { getConnectedCorporations } from "@/lib/data/corporations";
import { getCurrentProfile } from "@/lib/data/profile";
import { tracks } from "@/lib/placeholder-data";
import { getCurrentAnnouncements } from "@/lib/data/announcements";
import { HomeAnnouncements } from "@/components/HomeAnnouncements";
import { TrainingWelcome } from "@/components/TrainingWelcome";
import { HomeStratasphereCard } from "@/components/HomeStratasphereCard";
import { corporationRoleLabels, isCorporationRole } from "@/lib/strata";
import { createClient } from "@/lib/supabase/server";

/**
 * Home — the landing screen after sign-in. An overview, not a worklist:
 * who you are, which stratas you're connected to, where your training
 * stands, and what needs your attention next. Council Training's own
 * track list lives at `/training`; this page summarizes it rather than
 * repeating it.
 *
 * Profile and connected stratas are real; training progress reads "not
 * started" until Education is on real tables.
 *
 * Also (note 3, 2026-10-05): announcements posted by Super Admins, a
 * dismissible "How Council Training works", and a Stratasphere card for
 * people whose strata isn't subscribed.
 */
export default async function HomePage() {
  const [profile, corporations, announcements] = await Promise.all([
    getCurrentProfile(),
    getConnectedCorporations(),
    getCurrentAnnouncements("home"),
  ]);

  const supabase = await createClient();
  const { data: roleRows } = profile
    ? await supabase
        .from("corporation_role_assignments")
        .select("corporation_id, role")
        .eq("user_id", profile.id)
    : { data: [] };
  const rolesByCorp = new Map<string, string[]>();
  for (const r of roleRows ?? []) {
    if (!isCorporationRole(r.role)) continue;
    rolesByCorp.set(r.corporation_id, [...(rolesByCorp.get(r.corporation_id) ?? []), corporationRoleLabels[r.role]]);
  }
  const firstCorp = corporations[0];
  // The Stratasphere card: only when none of their stratas is subscribed.
  const subscribedAny = corporations.some((c) => c.subscriptionStatus === "active");
  const adminCorp = corporations.find((c) => (rolesByCorp.get(c.id) ?? []).includes(corporationRoleLabels.admin));
  const firstName = profile?.fullName.trim().split(" ")[0];

  const completed = tracks.filter((t) => t.certificateIssued);
  const inProgress = tracks.filter(
    (t) => !t.certificateIssued && t.completedModules > 0
  );
  const notStarted = tracks.filter(
    (t) => !t.certificateIssued && t.completedModules === 0
  );

  return (
    <AppShell active="home">
      <AutoRefresh />
      <div className="wrap page">
        <div className="page-header">
          <h1>{firstName ? `Welcome back, ${firstName}` : "Welcome back"}</h1>
          <p>Here&rsquo;s where things stand across your training and your strata.</p>
        </div>

        <HomeAnnouncements announcements={announcements} />

        <div className="grid-cards" style={{ marginBottom: "2.5rem" }}>
          <div className="card">
            <h3>Your profile</h3>
            <p>{profile?.fullName || "Name not set"}</p>
            <p style={{ marginTop: "-0.5rem" }}>{profile?.email}</p>
            <Link
              href="/account"
              className="button button-secondary button-small"
              style={{ alignSelf: "flex-start" }}
            >
              Manage account
            </Link>
          </div>

          <div className="card">
            <h3>Training progress</h3>
            <p>
              {completed.length === 0 && inProgress.length === 0 ? (
                <>Not started yet. {tracks.length} tracks to choose from.</>
              ) : (
                <>
                  {completed.length} completed &middot; {inProgress.length} in progress &middot; {notStarted.length} not
                  started
                </>
              )}
            </p>
            <Link
              href="/training"
              className="button button-secondary button-small"
              style={{ alignSelf: "flex-start" }}
            >
              View Council Training
            </Link>
          </div>

          <div className="card">
            <h3>Connected stratas</h3>
            <p>
              {corporations.length === 0
                ? "You're not connected to a strata yet."
                : `Connected to ${corporations.length} strata corporation${corporations.length === 1 ? "" : "s"}.`}
            </p>
            <Link
              href={corporations.length === 0 ? "/strata" : "/strata?connect=1"}
              className="button button-secondary button-small"
              style={{ alignSelf: "flex-start" }}
            >
              {corporations.length === 0 ? "Connect to a strata" : "Connect another"}
            </Link>
          </div>
        </div>

        {completed.length === 0 && inProgress.length === 0 && <TrainingWelcome />}

        {!subscribedAny && (
          <HomeStratasphereCard
            action={
              corporations.length === 0
                ? { kind: "connect" }
                : adminCorp
                  ? adminCorp.pending
                    ? { kind: "pending", corpId: adminCorp.id, isAdmin: true }
                    : { kind: "plans", corpId: adminCorp.id }
                  : firstCorp.pending
                    ? { kind: "pending", corpId: firstCorp.id, isAdmin: false }
                    : { kind: "request", corpId: firstCorp.id }
            }
          />
        )}

        {inProgress.length > 0 && (
          <>
            <h2 style={{ marginBottom: "1rem" }}>Continue where you left off</h2>
            <div className="grid-cards" style={{ marginBottom: "2.5rem" }}>
              {inProgress.map((track) => {
                const pct = Math.round(
                  (track.completedModules / track.moduleCount) * 100
                );
                return (
                  <Link
                    key={track.slug}
                    href={`/training/${track.slug}`}
                    className="card"
                  >
                    <h3>{track.title}</h3>
                    <p>
                      {track.completedModules} of {track.moduleCount} modules
                      complete
                    </p>
                    <div className="progress-track">
                      <div
                        className="progress-track__fill"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </Link>
                );
              })}
            </div>
          </>
        )}

        {firstCorp && (
          <>
            <h2 style={{ marginBottom: "1rem" }}>Your stratas</h2>
            <div className="grid-cards" style={{ marginBottom: "2.5rem" }}>
              {corporations.map((corporation) => {
                const roles = rolesByCorp.get(corporation.id) ?? [];
                return (
                  <Link key={corporation.id} href={`/strata/${corporation.id}`} className="card">
                    <h3>{corporation.buildingName ?? corporation.legalName}</h3>
                    <p>{corporation.address}</p>
                    <span className="card__meta">
                      {roles.length ? roles.join(", ") : "Connected member"} &middot;{" "}
                      {corporation.subscriptionStatus === "active" ? "Stratasphere™ active" : "Free tier"}
                    </span>
                  </Link>
                );
              })}
            </div>

            <h2 style={{ marginBottom: "1rem" }}>Resources</h2>
            <div className="grid-cards">
              <Link href={`/strata/${firstCorp.id}/guides`} className="card">
                <h3>Knowledge library</h3>
                <p>A free library of playbooks, guides, financial insights and legislation updates for every connected member &mdash; plus policy templates with Stratasphere&trade;.</p>
              </Link>
              <Link href={`/strata/${firstCorp.id}/documents`} className="card">
                <h3>Documents</h3>
                <p>Upload bylaws, minutes and financials &mdash; free, and kept permanently.</p>
              </Link>
              <Link href={`/strata/${firstCorp.id}/meetings`} className="card">
                <h3>Meetings</h3>
                <p>Build agendas, run meetings and produce minutes.</p>
              </Link>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
