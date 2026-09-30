import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import {
  connectedCorporations,
  currentProfile,
  tracks,
} from "@/lib/placeholder-data";

/**
 * Home — the landing screen after sign-in. An overview, not a worklist:
 * who you are, which stratas you're connected to, where your training
 * stands, and what needs your attention next. Council Training's own
 * track list lives at `/training`; this page summarizes it rather than
 * repeating it.
 */
export default function HomePage() {
  const completed = tracks.filter((t) => t.certificateIssued);
  const inProgress = tracks.filter(
    (t) => !t.certificateIssued && t.completedModules > 0
  );
  const notStarted = tracks.filter(
    (t) => !t.certificateIssued && t.completedModules === 0
  );

  return (
    <AppShell active="home">
      <div className="wrap page">
        <div className="page-header">
          <h1>Welcome back, {currentProfile.fullName.split(" ")[0]}</h1>
          <p>Here&rsquo;s where things stand across your training and your strata.</p>
        </div>

        <div className="grid-cards" style={{ marginBottom: "2.5rem" }}>
          <div className="card">
            <h3>Your profile</h3>
            <p>{currentProfile.fullName}</p>
            <p style={{ marginTop: "-0.5rem" }}>{currentProfile.email}</p>
            <span className="card__meta">
              Member since {currentProfile.memberSince}
            </span>
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
              {completed.length} completed &middot; {inProgress.length} in
              progress &middot; {notStarted.length} not started
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
              {connectedCorporations.length === 0
                ? "You're not connected to a strata yet."
                : `Connected to ${connectedCorporations.length} strata corporation${connectedCorporations.length === 1 ? "" : "s"}.`}
            </p>
            <Link
              href="/strata"
              className="button button-secondary button-small"
              style={{ alignSelf: "flex-start" }}
            >
              {connectedCorporations.length === 0 ? "Set up your strata" : "Connect another"}
            </Link>
          </div>
        </div>

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

        <h2 style={{ marginBottom: "1rem" }}>Your stratas</h2>
        <div className="grid-cards" style={{ marginBottom: "2.5rem" }}>
          {connectedCorporations.map(({ corporation, roles }) => (
            <Link
              key={corporation.id}
              href={`/strata/${corporation.id}`}
              className="card"
            >
              <h3>{corporation.buildingName}</h3>
              <p>{corporation.address}</p>
              <span className="card__meta">
                {roles.length ? roles.join(", ") : "Connected member"} &middot;{" "}
                {corporation.subscriptionStatus === "active"
                  ? "Stratasphere™ active"
                  : "Free tier"}
              </span>
            </Link>
          ))}
        </div>

        <h2 style={{ marginBottom: "1rem" }}>Resources</h2>
        <div className="grid-cards">
          <Link
            href={`/strata/${connectedCorporations[0]?.corporation.id ?? ""}/guides`}
            className="card"
          >
            <h3>Knowledge library</h3>
            <p>A free library of playbooks, guides, financial insights and legislation updates for every connected member &mdash; plus policy templates with Stratasphere&trade;.</p>
          </Link>
          <Link
            href={`/strata/${connectedCorporations[0]?.corporation.id ?? ""}/documents`}
            className="card"
          >
            <h3>Documents</h3>
            <p>Upload bylaws, minutes and financials &mdash; indexed the moment they&rsquo;re added.</p>
          </Link>
          <Link
            href={`/strata/${connectedCorporations[0]?.corporation.id ?? ""}/meetings`}
            className="card"
          >
            <h3>Meeting mode</h3>
            <p>
              {connectedCorporations[0]?.corporation.freeMeetingUsed
                ? "Your free meeting has been used."
                : "Your one free meeting is ready whenever council needs it."}
            </p>
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
