"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createDemoLink, deleteDemoFeedback, revokeDemoLink } from "@/app/admin/training/actions";
import type { DemoAdmin } from "@/lib/data/training-demo";

const when = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });

/**
 * Demo links (0040): Council Training without signing in, for outside
 * reviewers, and the comments they send back.
 */
export function DemoLinks({ links, feedback }: DemoAdmin) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [includeDrafts, setIncludeDrafts] = useState(false);
  const [days, setDays] = useState("30");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  async function create() {
    setBusy(true);
    setError(null);
    const r = await createDemoLink({ label, includeDrafts, expiresInDays: days ? Number(days) : null });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setLabel("");
    router.refresh();
  }

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(`${origin}/demo/${token}`);
      setCopied(token);
    } catch {
      setError("Couldn't copy. Select the link and copy it instead.");
    }
  }

  const live = links.filter((l) => !l.revokedAt && !(l.expiresAt && Date.parse(l.expiresAt) < Date.now()));
  const ended = links.filter((l) => !live.includes(l));

  return (
    <section className="card demo-links" data-testid="demo-links">
      <h2>Demo links</h2>
      <p className="card__meta">
        A link that opens Council Training without signing in, for outside feedback (for example, BCREA). Visitors see only
        Council Training, every module is open, and nothing they do is saved, except the comments they send, which appear
        below.
      </p>

      <div className="demo-links__form">
        <label className="field">
          <span>Who it&rsquo;s for</span>
          <input value={label} maxLength={120} placeholder="e.g. BCREA review" onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label className="field">
          <span>Expires after</span>
          <select value={days} onChange={(e) => setDays(e.target.value)}>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="">Never (turn it off by hand)</option>
          </select>
        </label>
        <label className="be-check">
          <input type="checkbox" checked={includeDrafts} onChange={(e) => setIncludeDrafts(e.target.checked)} />
          <span>Show unpublished drafts too (so reviewers can see modules before they&rsquo;re published)</span>
        </label>
        <div>
          <button type="button" className="button button-primary button-small" disabled={busy || !label.trim()} onClick={create}>
            {busy ? "Making…" : "Make a demo link"}
          </button>
        </div>
      </div>
      {error && (
        <p className="form-alert" role="alert">
          {error}
        </p>
      )}

      {live.length > 0 && (
        <ul className="demo-links__list">
          {live.map((l) => (
            <li key={l.id}>
              <div>
                <strong>{l.label}</strong>
                <div className="card__meta">
                  {l.includeDrafts ? "Published modules and drafts" : "Published modules only"} &middot;{" "}
                  {l.expiresAt ? `expires ${when(l.expiresAt)}` : "no expiry"} &middot;{" "}
                  {l.lastUsedAt ? `last opened ${when(l.lastUsedAt)}` : "not opened yet"}
                </div>
                <code className="demo-links__url">{`${origin}/demo/${l.token}`}</code>
              </div>
              <span className="demo-links__actions">
                <button type="button" className="button button-secondary button-small" onClick={() => copy(l.token)}>
                  {copied === l.token ? "Copied" : "Copy link"}
                </button>
                <button
                  type="button"
                  className="text-action"
                  onClick={async () => {
                    const r = await revokeDemoLink(l.id);
                    if (!r.ok) return setError(r.error);
                    router.refresh();
                  }}
                >
                  Turn off
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {ended.length > 0 && <p className="card__meta">{ended.length} expired or turned-off {ended.length === 1 ? "link" : "links"}.</p>}

      <h3 className="demo-links__subhead">Comments from demo links</h3>
      {feedback.length === 0 ? (
        <p className="card__meta">No comments yet.</p>
      ) : (
        <ul className="demo-feedback-list">
          {feedback.map((f) => (
            <li key={f.id}>
              <div className="card__meta">
                {f.name || "Someone"} via {f.linkLabel} &middot; {f.moduleTitle}
                {f.screenTitle ? ` · ${f.screenTitle}` : ""} &middot; {when(f.createdAt)}
              </div>
              <p>{f.message}</p>
              <button
                type="button"
                className="text-action"
                onClick={async () => {
                  const r = await deleteDemoFeedback(f.id);
                  if (!r.ok) return setError(r.error);
                  router.refresh();
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
