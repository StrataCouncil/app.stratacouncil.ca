"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { dismissDemoRequest, sendDemoRequestLink } from "@/app/admin/demo-actions";
import { DEMO_LANDINGS, type DemoLanding } from "@/lib/demo";
import { DEMO_REQUEST_SOURCES, campaignLine } from "@/lib/demo-requests";
import type { DemoRequest } from "@/lib/demo-requests-server";

const PACIFIC = "America/Los_Angeles";
const time = (iso: string) =>
  new Date(iso).toLocaleString("en-CA", { timeZone: PACIFIC, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * Super Admin console: demo requests from stratacouncil.ca (0067). Send
 * demo link makes the person's link and emails it in one click; Dismiss
 * takes a request off the list without sending anything.
 */
export function DemoRequestsAdmin({ requests, connected }: { requests: DemoRequest[]; connected: boolean }) {
  const router = useRouter();
  const [landing, setLanding] = useState<Record<string, DemoLanding>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const waiting = requests.filter((r) => !r.handledAt);
  const handled = requests.filter((r) => r.handledAt);

  async function send(r: DemoRequest) {
    setBusy(r.id);
    setError(null);
    setNotice(null);
    const result = await sendDemoRequestLink(r.id, landing[r.id] ?? "strata");
    setBusy(null);
    if (!result.ok) return setError(result.error);
    if (result.emailed) setNotice(result.notice);
    else setError(result.notice);
    router.refresh();
  }

  async function dismiss(r: DemoRequest) {
    if (!window.confirm(`Dismiss ${r.fullName}'s request? Nothing is sent to them.`)) return;
    setBusy(r.id);
    setError(null);
    setNotice(null);
    const result = await dismissDemoRequest(r.id);
    setBusy(null);
    if (!result.ok) return setError(result.error);
    router.refresh();
  }

  return (
    <section className="card demo-links" id="requests" data-testid="demo-requests" style={{ marginBottom: "2.5rem" }}>
      <h2>Requests</h2>
      <p className="card__meta">
        People who asked for a demo on stratacouncil.ca. Send demo link makes their link and emails it to them. Handled
        requests are deleted 30 days later.
      </p>
      {!connected && (
        <p className="form-alert" data-testid="demo-requests-off">
          The demo site isn&rsquo;t connected, so links can&rsquo;t be sent yet.
        </p>
      )}
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

      {waiting.length === 0 ? (
        <p className="card__meta" data-testid="demo-requests-none">
          No requests waiting.
        </p>
      ) : (
        <div className="roster-table-wrap">
          <table className="roster-table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Asked</th>
                <th>Came from</th>
                <th>Opens on</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {waiting.map((r) => (
                <tr key={r.id} data-testid={`demo-request-${r.id}`}>
                  <td>
                    {r.fullName}
                    <div className="roster-table__meta">{r.email}</div>
                  </td>
                  <td>
                    {time(r.createdAt)}
                    <div className="roster-table__meta">{DEMO_REQUEST_SOURCES[r.source]}</div>
                  </td>
                  <td>{campaignLine(r.campaign) || <span className="roster-table__meta">Direct</span>}</td>
                  <td>
                    <select
                      className="demo-links__landing"
                      aria-label={`Opens on, for ${r.fullName}`}
                      value={landing[r.id] ?? "strata"}
                      onChange={(e) => setLanding((l) => ({ ...l, [r.id]: e.target.value as DemoLanding }))}
                    >
                      {DEMO_LANDINGS.map((l) => (
                        <option key={l.value} value={l.value}>
                          {l.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="demo-links__actions">
                    <button
                      type="button"
                      className="button button-primary button-small"
                      disabled={busy !== null || !connected}
                      onClick={() => send(r)}
                      data-testid={`demo-request-send-${r.id}`}
                    >
                      {busy === r.id ? "Sending…" : "Send demo link"}
                    </button>
                    <button
                      type="button"
                      className="button button-secondary button-small"
                      disabled={busy !== null}
                      onClick={() => dismiss(r)}
                      data-testid={`demo-request-dismiss-${r.id}`}
                    >
                      Dismiss
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {handled.length > 0 && (
        <>
          <h3>Handled (last 30 days)</h3>
          <div className="roster-table-wrap">
            <table className="roster-table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Asked</th>
                  <th>Came from</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {handled.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.fullName}
                      <div className="roster-table__meta">{r.email}</div>
                    </td>
                    <td>
                      {time(r.createdAt)}
                      <div className="roster-table__meta">{DEMO_REQUEST_SOURCES[r.source]}</div>
                    </td>
                    <td>{campaignLine(r.campaign) || <span className="roster-table__meta">Direct</span>}</td>
                    <td>
                      {r.outcome === "sent" ? "Link sent" : "Dismissed"} {r.handledAt && time(r.handledAt)}
                      {r.handledByName && <div className="roster-table__meta">by {r.handledByName}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
