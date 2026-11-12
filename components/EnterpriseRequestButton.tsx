"use client";

import { useState, useTransition } from "react";
import { Modal } from "@/components/Modal";
import { requestEnterprise } from "@/app/strata/[corpId]/billing/enterprise-actions";

/**
 * "Talk to us" (Enterprise, 0091): a short note to the StrataCouncil.ca
 * team, from a strata over the self-serve size or someone managing
 * several stratas.
 */
export function EnterpriseRequestButton({ corpId, reason, primary = false }: { corpId: string; reason: "large" | "several"; primary?: boolean }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function send(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await requestEnterprise(corpId, reason, message);
      if (!r.ok) return setError(r.error);
      setSent(true);
    });
  }

  return (
    <>
      <button
        type="button"
        className={primary ? "button button-primary" : "link-button"}
        onClick={() => setOpen(true)}
        data-testid={`enterprise-${reason}`}
      >
        Talk to us
      </button>
      {open && (
        <Modal title="Talk to us about Enterprise" onClose={() => setOpen(false)}>
          {sent ? (
            <>
              <p role="status" data-testid="enterprise-sent">
                Thanks. We&rsquo;ll be in touch by email soon.
              </p>
              <div className="role-editor__actions">
                <button type="button" className="button button-primary" onClick={() => setOpen(false)}>
                  Close
                </button>
              </div>
            </>
          ) : (
            <form onSubmit={send}>
              <p className="card__meta">
                {reason === "large"
                  ? "We set the price with stratas over 100 lots."
                  : "For management companies and anyone looking after several stratas."}{" "}
                We&rsquo;ll reply to the email on your account.
              </p>
              <label className="field">
                <span>Anything we should know? (optional)</span>
                <textarea
                  rows={4}
                  maxLength={2000}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={reason === "large" ? "e.g. how you'd like to be billed" : "e.g. how many stratas, and roughly how many lots"}
                  data-testid="enterprise-message"
                />
              </label>
              {error && (
                <p className="form-alert" role="alert">
                  {error}
                </p>
              )}
              <div className="role-editor__actions">
                <button type="button" className="button button-secondary" onClick={() => setOpen(false)} disabled={pending}>
                  Cancel
                </button>
                <button type="submit" className="button button-primary" disabled={pending} data-testid="enterprise-send">
                  {pending ? "Sending…" : "Send"}
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}
