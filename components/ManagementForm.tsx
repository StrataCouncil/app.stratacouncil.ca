"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { createLogoUpload, removeLogo, saveManagementDetails, setLogo } from "@/app/strata/[corpId]/management/actions";
import { LOGO_TYPES, MAX_LOGO_BYTES, MAX_MANAGERS, letterheadLines, type ManagementDetails, type ManagerContact } from "@/lib/management";

const blankManager = (): ManagerContact => ({ name: "", title: "Strata Manager", phone: "", email: "" });

/** The Management tab's form: company details, managers, logo, and a preview of the letterhead. */
export function ManagementForm({
  corpId,
  initial,
  initialLogoUrl,
}: {
  corpId: string;
  initial: ManagementDetails;
  initialLogoUrl: string | null;
}) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [logo, setLogoUrl] = useState(initialLogoUrl);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const set = (key: keyof Omit<ManagementDetails, "managers" | "logoPath">) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));
  const setManager = (i: number, patch: Partial<ManagerContact>) =>
    setForm((f) => ({ ...f, managers: f.managers.map((m, j) => (j === i ? { ...m, ...patch } : m)) }));

  function save(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const res = await saveManagementDetails(corpId, form);
      setMessage(res.ok ? { ok: true, text: "Saved. New agendas and minutes will carry these details." } : { ok: false, text: res.error });
      if (res.ok) router.refresh();
    });
  }

  async function uploadLogo(file: File) {
    setMessage(null);
    if (!(LOGO_TYPES as readonly string[]).includes(file.type)) return setMessage({ ok: false, text: "Use a PNG or JPEG image for the logo." });
    if (file.size > MAX_LOGO_BYTES) return setMessage({ ok: false, text: "The logo must be 2 MB or smaller." });
    setUploading(true);
    try {
      const ticket = await createLogoUpload(corpId, { name: file.name, type: file.type, size: file.size });
      if (!ticket.ok) return setMessage({ ok: false, text: ticket.error });
      const { error } = await createClient().storage.from("management-logos").uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: file.type });
      if (error) return setMessage({ ok: false, text: `The logo didn't upload: ${error.message}` });
      const res = await setLogo(corpId, ticket.path);
      if (!res.ok) return setMessage({ ok: false, text: res.error });
      setLogoUrl(URL.createObjectURL(file));
      setMessage({ ok: true, text: "Logo saved." });
      router.refresh();
    } finally {
      setUploading(false);
      if (picker.current) picker.current.value = "";
    }
  }

  const preview = letterheadLines(form);

  return (
    <form className="management" onSubmit={save} data-testid="management-form">
      <div className="management__grid">
        <section className="card">
          <h3>Company</h3>
          <div className="field">
            <label htmlFor="mg-company">Company name</label>
            <input id="mg-company" value={form.companyName} onChange={set("companyName")} maxLength={200} placeholder="e.g. Alpine Strata Management Ltd." />
          </div>
          <div className="field">
            <label htmlFor="mg-address">Address</label>
            <input id="mg-address" value={form.address} onChange={set("address")} maxLength={300} placeholder="Street, city, province, postal code" />
          </div>
          <div className="setup-form__row">
            <div className="field">
              <label htmlFor="mg-phone">Phone</label>
              <input id="mg-phone" type="tel" value={form.phone} onChange={set("phone")} maxLength={60} />
            </div>
            <div className="field">
              <label htmlFor="mg-email">Email</label>
              <input id="mg-email" type="email" value={form.email} onChange={set("email")} maxLength={200} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="mg-website">Website</label>
            <input id="mg-website" value={form.website} onChange={set("website")} maxLength={300} placeholder="www.example.com" />
          </div>

          <h3 style={{ marginTop: "1.5rem" }}>Logo</h3>
          <div className="management__logo">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt="Company logo" />
            ) : (
              <span className="card__meta">No logo yet.</span>
            )}
            <div className="management__logo-actions">
              <button type="button" className="button button-secondary button-small" onClick={() => picker.current?.click()} disabled={uploading}>
                {uploading ? "Uploading…" : logo ? "Replace logo" : "Upload logo"}
              </button>
              {logo && (
                <button
                  type="button"
                  className="link-button agenda-danger"
                  onClick={() =>
                    startTransition(async () => {
                      const res = await removeLogo(corpId);
                      if (res.ok) setLogoUrl(null);
                      else setMessage({ ok: false, text: res.error });
                    })
                  }
                >
                  Remove
                </button>
              )}
              <span className="field__hint">PNG or JPEG, up to 2 MB. A wide logo on a white or clear background prints best.</span>
            </div>
            <input
              ref={picker}
              type="file"
              accept="image/png,image/jpeg"
              hidden
              onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])}
              data-testid="management-logo-input"
            />
          </div>
        </section>

        <section className="card">
          <h3>Managers</h3>
          <p className="card__meta" style={{ marginTop: "-0.25rem" }}>
            The people council and owners contact. Each one prints on its own line.
          </p>
          {form.managers.map((m, i) => (
            <div className="management__manager" key={i}>
              <div className="setup-form__row">
                <div className="field">
                  <label>Name</label>
                  <input value={m.name} onChange={(e) => setManager(i, { name: e.target.value })} maxLength={120} />
                </div>
                <div className="field">
                  <label>Title</label>
                  <input value={m.title} onChange={(e) => setManager(i, { title: e.target.value })} maxLength={120} />
                </div>
              </div>
              <div className="setup-form__row">
                <div className="field">
                  <label>Phone</label>
                  <input type="tel" value={m.phone} onChange={(e) => setManager(i, { phone: e.target.value })} maxLength={60} />
                </div>
                <div className="field">
                  <label>Email</label>
                  <input type="email" value={m.email} onChange={(e) => setManager(i, { email: e.target.value })} maxLength={200} />
                </div>
              </div>
              <button
                type="button"
                className="link-button agenda-danger"
                onClick={() => setForm((f) => ({ ...f, managers: f.managers.filter((_, j) => j !== i) }))}
              >
                Remove this manager
              </button>
            </div>
          ))}
          {form.managers.length < MAX_MANAGERS && (
            <button
              type="button"
              className="button button-secondary button-small"
              onClick={() => setForm((f) => ({ ...f, managers: [...f.managers, blankManager()] }))}
            >
              Add a manager
            </button>
          )}

          <h3 style={{ marginTop: "1.5rem" }}>Letterhead preview</h3>
          <div className="management__preview" data-testid="management-preview">
            {logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt="" />
            )}
            {preview.length ? (
              preview.map((l, i) => (
                <p key={i} style={l.bold ? { fontWeight: 700, color: "var(--ink)" } : undefined}>
                  {l.text}
                </p>
              ))
            ) : (
              <p className="card__meta">Fill in the details to see how they&rsquo;ll print.</p>
            )}
          </div>
        </section>
      </div>

      <div className="management__actions">
        {message && (
          <p className={message.ok ? "sync-note" : "form-error"} role="status">
            {message.text}
          </p>
        )}
        <button type="submit" className="button button-primary" disabled={pending} data-testid="management-save">
          {pending ? "Saving…" : "Save details"}
        </button>
      </div>
    </form>
  );
}
