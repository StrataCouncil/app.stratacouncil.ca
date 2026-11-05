"use client";

import { tz } from "@/lib/time-zone";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSandbox, deleteSandbox, renewSandbox } from "@/app/admin/demo-actions";
import type { SandboxList } from "@/lib/data/demo-visitors";

const PACIFIC = "America/Vancouver";
const day = (iso: string) =>
  new Date(new Date(iso).getTime() - 60_000).toLocaleDateString("en-CA", { timeZone: tz(PACIFIC, iso), weekday: "long", month: "long", day: "numeric" });
const time = (iso: string) =>
  new Date(iso).toLocaleString("en-CA", { timeZone: tz(PACIFIC, iso), month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * Super Admin console: sandboxes on the demo site (lib/demo.ts, SANDBOX_*).
 * A test strata with a sign-in link for each person in it, to try features
 * with several people at once (one browser or private window each).
 * Fictional, separate from the live site, no demo limits, and every email
 * it sends comes to you.
 */
export function SandboxAdmin({ list }: { list: SandboxList }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function run(key: string, action: () => Promise<{ ok: true; notice?: string } | { ok: false; error: string }>) {
    setBusy(key);
    setError(null);
    setNotice(null);
    const r = await action().catch(() => ({ ok: false as const, error: "Couldn't reach the server. Try again." }));
    setBusy(null);
    if (!r.ok) return setError(r.error);
    if (r.notice) setNotice(r.notice);
    router.refresh();
  }

  async function copy(link: string) {
    await navigator.clipboard.writeText(link).catch(() => undefined);
    setCopied(link);
    setTimeout(() => setCopied((c) => (c === link ? null : c)), 2000);
  }

  return (
    <section className="card demo-links" data-testid="sandbox-admin" style={{ marginBottom: "2.5rem" }}>
      <div className="sandbox__top">
        <div>
          <h2>Sandboxes</h2>
          <p className="card__meta">
            A test strata on the demo site with a sign-in link for each person in it: you as admin, the council and the
            manager. Open each link in its own browser or private window to be several people at once. Everything in it is
            fictional and separate from the live site; the demo&rsquo;s limits don&rsquo;t apply, and every email it sends comes to
            you. A sandbox lasts 7 days.
          </p>
        </div>
        {list.configured && (
          <button type="button" className="button button-primary" onClick={() => run("create", createSandbox)} disabled={busy !== null} data-testid="sandbox-create">
            {busy === "create" ? "Making…" : "New sandbox"}
          </button>
        )}
      </div>

      {!list.configured && <p className="card__meta">The demo site isn&rsquo;t connected yet.</p>}
      {error && <p className="form-alert" role="alert">{error}</p>}
      {notice && <p className="sync-note sync-note--ok" role="status">{notice}</p>}
      {list.configured && list.error && <p className="form-alert">{list.error}</p>}
      {list.configured && !list.error && list.sandboxes.length === 0 && <p className="card__meta">No sandboxes right now.</p>}

      {list.configured &&
        list.sandboxes.map((box) => (
          <div className="sandbox" key={box.id} data-testid={`sandbox-${box.id}`}>
            <div className="sandbox__head">
              <span>
                <strong>Larchwood Commons sandbox</strong> · until midnight (Pacific) on {day(box.expiresAt)} · emails to {box.emailTo}
                {!box.ready && " · builds when a link is first opened"}
              </span>
              <span className="sandbox__actions">
                <button type="button" className="button button-secondary button-small" onClick={() => run(`renew-${box.id}`, () => renewSandbox(box.id))} disabled={busy !== null}>
                  Renew 7 days
                </button>
                <button
                  type="button"
                  className="button button-secondary button-small agenda-danger"
                  onClick={() => {
                    if (window.confirm("Delete this sandbox? Its strata, its people and their links are removed now.")) void run(`delete-${box.id}`, () => deleteSandbox(box.id));
                  }}
                  disabled={busy !== null}
                >
                  Delete
                </button>
              </span>
            </div>
            <div className="roster-table-wrap">
            <table className="roster-table">
              <thead>
                <tr>
                  <th scope="col">Sign in as</th>
                  <th scope="col">Role</th>
                  <th scope="col">Last opened</th>
                  <th scope="col" aria-label="Link" />
                </tr>
              </thead>
              <tbody>
                {box.people.map((p) => (
                  <tr key={p.visitorId}>
                    <td>{p.name}</td>
                    <td>{p.label}</td>
                    <td className="card__meta">{p.lastOpenedAt ? time(p.lastOpenedAt) : "Not yet"}</td>
                    <td className="sandbox__link">
                      <a href={p.link} target="_blank" rel="noopener noreferrer" className="button button-secondary button-small">
                        Open
                      </a>
                      <button type="button" className="link-button" onClick={() => copy(p.link)}>
                        {copied === p.link ? "Copied" : "Copy link"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        ))}
    </section>
  );
}
