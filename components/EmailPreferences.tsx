"use client";

import { useState, useTransition } from "react";
import { saveEmailPreferences } from "@/app/account/actions";

/**
 * The Account page's Emails card (0086). Setup tips are the occasional
 * emails that help someone get started; product news is the marketing
 * opt-in from sign-up (0006). Neither switch affects sign-in links,
 * security notices, invitations, or meeting and discussion emails.
 */
export function EmailPreferences({ initial }: { initial: { setupTips: boolean; productNews: boolean } }) {
  const [prefs, setPrefs] = useState(initial);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function change(next: { setupTips: boolean; productNews: boolean }) {
    const before = prefs;
    setPrefs(next);
    setStatus(null);
    start(async () => {
      const r = await saveEmailPreferences(next);
      if (r.ok) setStatus("Saved.");
      else {
        setPrefs(before);
        setStatus(r.error);
      }
    });
  }

  return (
    <div className="card" style={{ marginBottom: "1.5rem" }} data-testid="email-preferences">
      <h3>Emails</h3>
      <div className="field field--checkbox">
        <label>
          <input type="checkbox" checked={prefs.setupTips} disabled={pending} onChange={(e) => change({ ...prefs, setupTips: e.target.checked })} data-testid="email-setup-tips" />
          <span>
            <strong>Setup tips</strong>: a few emails to help you get started, such as connecting your strata.
          </span>
        </label>
      </div>
      <div className="field field--checkbox">
        <label>
          <input type="checkbox" checked={prefs.productNews} disabled={pending} onChange={(e) => change({ ...prefs, productNews: e.target.checked })} data-testid="email-product-news" />
          <span>
            <strong>Product news</strong>: occasional updates on legislative changes, new Stratasphere&trade; features, and other news.
          </span>
        </label>
      </div>
      <p className="field__hint">
        Sign-in links, security notices, invitations, and meeting and discussion emails are always sent.{status ? ` ${status}` : ""}
      </p>
    </div>
  );
}
