"use client";

import { useEffect, useState } from "react";
import { submitDemoFeedback } from "@/app/demo/actions";

const NAME_KEY = "sc-demo-feedback-name";

/** "Comment on this screen" for demo-link visitors: a short note that goes to the StrataCouncil.ca team. */
export function DemoFeedback({
  token,
  moduleId,
  moduleTitle,
  screenId,
  screenTitle,
  open: startOpen = false,
}: {
  token: string;
  moduleId: string;
  moduleTitle: string;
  screenId: string | null;
  screenTitle: string;
  open?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    try {
      setName(localStorage.getItem(NAME_KEY) ?? "");
    } catch {
      // No storage: they type it again.
    }
  }, []);
  // A new screen starts a fresh comment.
  useEffect(() => {
    setMessage("");
    setStatus(null);
    if (!startOpen) setOpen(false);
  }, [screenId, startOpen]);

  async function send() {
    setBusy(true);
    const r = await submitDemoFeedback({ token, moduleId, moduleTitle, screenId, screenTitle, name, message });
    setBusy(false);
    if (!r.ok) return setStatus({ ok: false, text: r.error });
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      // Fine.
    }
    setMessage("");
    setStatus({ ok: true, text: "Thanks. Your comment has been sent." });
  }

  if (!open)
    return (
      <div className="demo-feedback">
        <button type="button" className="text-action" onClick={() => setOpen(true)} data-testid="demo-feedback-open">
          Comment on this screen
        </button>
        {status?.ok && <span className="card__meta"> {status.text}</span>}
      </div>
    );

  return (
    <div className="demo-feedback demo-feedback--open">
      <label className="field">
        <span>{screenId ? `Your comment on "${screenTitle}"` : "Your comment"}</span>
        <textarea rows={3} maxLength={4000} value={message} onChange={(e) => setMessage(e.target.value)} />
      </label>
      <label className="field">
        <span>Your name or organization (optional)</span>
        <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
      </label>
      {status && (
        <p className="card__meta" role="status">
          {status.text}
        </p>
      )}
      <div className="text-actions">
        <button type="button" className="button button-primary button-small" disabled={busy || !message.trim()} onClick={send}>
          {busy ? "Sending…" : "Send comment"}
        </button>
        {!startOpen && (
          <button type="button" className="text-action" onClick={() => setOpen(false)}>
            Close
          </button>
        )}
      </div>
    </div>
  );
}
