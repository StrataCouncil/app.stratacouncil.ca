"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createDemoLink, endDemoLink, resendDemoLink } from "@/app/admin/demo-actions";
import type { DemoVisitor, DemoVisitorList } from "@/lib/data/demo-visitors";
import { DEMO_LANDINGS, type DemoLanding } from "@/lib/demo";

const PACIFIC = "America/Los_Angeles";
const time = (iso: string) =>
  new Date(iso).toLocaleString("en-CA", { timeZone: PACIFIC, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * Super Admin console: personal links to the demo site
 * (demo.stratacouncil.ca, lib/demo.ts). Each person gets their own copy of
 * the fictional strata, as its admin, until midnight Pacific. The link is
 * emailed to them and shown here, in case the email goes astray.
 */
export function DemoLinksAdmin({ list }: { list: DemoVisitorList }) {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [landing, setLanding] = useState<DemoLanding>("strata");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [made, setMade] = useState<DemoVisitor | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy("create");
    setError(null);
    setNotice(null);
    const r = await createDemoLink({ fullName, email, landing });
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setMade(r.visitor);
    if (r.emailed) setNotice(r.notice);
    else setError(r.notice);
    setFullName("");
    setEmail("");
    router.refresh();
  }

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(link);
    } catch {
      setError("Couldn't copy. Select the link and copy it instead.");
    }
  }

  async function resend(v: DemoVisitor) {
    setBusy(v.id);
    setError(null);
    setNotice(null);
    const r = await resendDemoLink(v.id);
    setBusy(null);
    if (r.ok) setNotice(r.notice);
    else setError(r.error);
  }

  async function end(v: DemoVisitor) {
    if (!window.confirm(`End ${v.fullName}'s demo now? The link stops working and their demo strata is cleared.`)) return;
    setBusy(v.id);
    setError(null);
    setNotice(null);
    const r = await endDemoLink(v.id);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    if (made?.id === v.id) setMade(null);
    router.refresh();
  }

  const visitors = list.configured ? list.visitors : [];
  const today = visitors.filter((v) => v.active);
  const ended = visitors.filter((v) => !v.active);

  return (
    <section className="card demo-links" data-testid="demo-links" style={{ marginBottom: "2.5rem" }}>
      <h2>Demo links</h2>
      <p className="card__meta">
        A personal link to demo.stratacouncil.ca, opening on the Stratasphere or Council Training. Either way the person gets
        their own fictional strata, as its admin, with nothing emailed and no billing. Each link works until midnight (Pacific) on the day you make it, and their strata is cleared
        overnight. Names and emails are deleted a week later.
      </p>

      {!list.configured ? (
        <p className="form-alert" data-testid="demo-links-off">
          The demo site isn&rsquo;t connected yet. Add DEMO_SUPABASE_URL and DEMO_SUPABASE_SERVICE_ROLE_KEY to this project in
          Vercel, then redeploy.
        </p>
      ) : (
        <>
          <form className="demo-links__form" onSubmit={create}>
            <div className="field">
              <label htmlFor="demo-name">Name</label>
              <input id="demo-name" value={fullName} maxLength={120} autoComplete="off" onChange={(e) => setFullName(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="demo-email">Email</label>
              <input id="demo-email" type="email" value={email} maxLength={320} autoComplete="off" onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="demo-landing">Opens on</label>
              <select id="demo-landing" value={landing} onChange={(e) => setLanding(e.target.value as DemoLanding)} data-testid="demo-links-landing">
                {DEMO_LANDINGS.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="button button-primary" disabled={busy !== null} data-testid="demo-links-create">
              {busy === "create" ? "Making the link…" : "Make link and email it"}
            </button>
          </form>

          {error && (
            <p className="form-alert" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="sync-note sync-note--ok" role="status">
              {notice}
            </p>
          )}
          {made && (
            <div className="demo-links__made" data-testid="demo-links-made">
              <span className="card__meta">Link for {made.fullName}:</span>
              <code className="demo-links__url">{made.link}</code>
              <button type="button" className="button button-secondary button-small" onClick={() => copy(made.link)}>
                {copied === made.link ? "Copied" : "Copy link"}
              </button>
            </div>
          )}
          {list.error && <p className="form-alert">{list.error}</p>}

          <h3>Today</h3>
          {today.length === 0 ? (
            <p className="card__meta">No links working right now.</p>
          ) : (
            <VisitorTable visitors={today} busy={busy} copied={copied} onCopy={copy} onResend={resend} onEnd={end} />
          )}

          {ended.length > 0 && (
            <>
              <h3>Ended (last 7 days)</h3>
              <VisitorTable visitors={ended} busy={busy} copied={copied} />
            </>
          )}
        </>
      )}
    </section>
  );
}

function VisitorTable({
  visitors,
  busy,
  copied,
  onCopy,
  onResend,
  onEnd,
}: {
  visitors: DemoVisitor[];
  busy: string | null;
  copied: string | null;
  onCopy?: (link: string) => void;
  onResend?: (v: DemoVisitor) => void;
  onEnd?: (v: DemoVisitor) => void;
}) {
  return (
    <div className="roster-table-wrap">
      <table className="roster-table">
        <thead>
          <tr>
            <th>Person</th>
            <th>Opens on</th>
            <th>Made</th>
            <th>Opened</th>
            {onCopy && <th aria-label="Actions" />}
          </tr>
        </thead>
        <tbody>
          {visitors.map((v) => (
            <tr key={v.id} data-testid={`demo-visitor-${v.id}`}>
              <td>
                {v.fullName}
                <div className="roster-table__meta">{v.email}</div>
              </td>
              <td>{DEMO_LANDINGS.find((l) => l.value === v.landing)?.label}</td>
              <td>
                {time(v.createdAt)}
                {v.createdByName && <div className="roster-table__meta">by {v.createdByName}</div>}
              </td>
              <td>{v.lastOpenedAt ? time(v.lastOpenedAt) : "Not yet"}</td>
              {onCopy && (
                <td className="demo-links__actions">
                  <button type="button" className="button button-secondary button-small" onClick={() => onCopy(v.link)}>
                    {copied === v.link ? "Copied" : "Copy link"}
                  </button>
                  <button type="button" className="button button-secondary button-small" disabled={busy !== null} onClick={() => onResend?.(v)}>
                    {busy === v.id ? "…" : "Resend"}
                  </button>
                  <button type="button" className="button button-secondary button-small" disabled={busy !== null} onClick={() => onEnd?.(v)}>
                    End now
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
