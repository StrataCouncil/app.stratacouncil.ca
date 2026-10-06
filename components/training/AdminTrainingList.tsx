"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  addModule,
  attachTrackStockPhoto,
  attachTrackUpload,
  createTrackCoverUpload,
  removeTrackCover,
  updateTrackCoverAlt,
  addModuleAuthor,
  deleteModule,
  moveModule,
  removeModuleAuthor,
  updateModuleDetails,
  updateTrackDetails,
} from "@/app/admin/training/actions";
import { Modal } from "@/components/Modal";
import { PhotoCreditLine, PhotoPicker } from "@/components/training/PhotoPicker";
import { createClient } from "@/lib/supabase/client";
import type { AdminModule } from "@/lib/data/training";
import { MEDIA_BUCKET, type ModuleCover } from "@/lib/training/slides";

type AdminTrack = { id: string; title: string; description: string; modules: AdminModule[]; cover: ModuleCover | null };
type Authors = Record<string, { userId: string; name: string; email: string }[]>;

/** Super Admin: every track and module, their state, and the module settings. */
export function AdminTrainingList({ tracks, authors }: { tracks: AdminTrack[]; authors: Authors }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<AdminModule | null>(null);
  const [trackEdit, setTrackEdit] = useState<AdminTrack | null>(null);
  const [adding, setAdding] = useState<AdminTrack | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn();
      setError(r.ok ? null : (r.error ?? "Something went wrong."));
      if (r.ok) router.refresh();
    });

  return (
    <>
      {error && <p className="form-error" role="alert">{error}</p>}
      {tracks.map((t) => (
        <section key={t.id} className="card training-admin__track">
          <div className="billing-card__head">
            <div>
              <h3>{t.title}</h3>
              <p className="card__meta">{t.description}</p>
            </div>
            <span className="text-actions">
              <button type="button" className="text-action" onClick={() => setTrackEdit(t)}>
                Edit track
              </button>
              <button type="button" className="text-action" onClick={() => setAdding(t)}>
                + Add module
              </button>
            </span>
          </div>
          <div className="roster-table-wrap">
            <table className="roster-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Module</th>
                  <th data-center="true">Slides</th>
                  <th>Status</th>
                  <th>Authors</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {t.modules.map((m, i) => (
                  <tr key={m.id}>
                    <td>{i + 1}</td>
                    <td>
                      <Link href={`/admin/training/${m.id}`} style={{ fontWeight: 600 }}>
                        {m.title}
                      </Link>
                      {m.estimatedMinutes && <div className="roster-table__meta">{m.estimatedMinutes} min</div>}
                    </td>
                    <td data-center="true">{m.slideCount}</td>
                    <td>
                      <span className={`billing-tag ${m.publishedVersion ? "billing-tag--ok" : "billing-tag--off"}`}>
                        {m.publishedVersion ? `Published v${m.publishedVersion}` : "Draft"}
                      </span>
                      {m.hasUnpublishedChanges && m.publishedVersion > 0 && <div className="roster-table__meta">Unpublished changes</div>}
                      {m.readyForReview && <div className="roster-table__warn">Ready for review</div>}
                      {m.checkout && <div className="roster-table__meta">Being edited by {m.checkout.name}</div>}
                    </td>
                    <td>
                      {(authors[m.id] ?? []).map((a) => a.name).join(", ") || <span className="roster-table__na">&mdash;</span>}
                    </td>
                    <td>
                      <span className="text-actions">
                        <Link href={`/admin/training/${m.id}`} className="text-action">
                          Open
                        </Link>
                        <button type="button" className="text-action" onClick={() => setSettings(m)}>
                          Settings
                        </button>
                        <button type="button" className="be-icon" disabled={pending || i === 0} onClick={() => run(() => moveModule(m.id, -1))} aria-label="Move up">
                          &uarr;
                        </button>
                        <button
                          type="button"
                          className="be-icon"
                          disabled={pending || i === t.modules.length - 1}
                          onClick={() => run(() => moveModule(m.id, 1))}
                          aria-label="Move down"
                        >
                          &darr;
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {settings && (
        <ModuleSettings
          module={settings}
          authors={authors[settings.id] ?? []}
          onClose={() => setSettings(null)}
          onSaved={() => router.refresh()}
        />
      )}

      {trackEdit && (
        <Modal title={`Edit ${trackEdit.title}`} onClose={() => setTrackEdit(null)}>
          {/* Outside the form: the picture saves by itself, and the photo search has its own form. */}
          <TrackPicture
            track={trackEdit}
            onChanged={(cover) => {
              setTrackEdit((t) => (t ? { ...t, cover } : t));
              router.refresh();
            }}
          />
          <form
            className="be-stack"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              run(async () => {
                const r = await updateTrackDetails(trackEdit.id, { title: String(f.get("title")), description: String(f.get("description")) });
                if (r.ok) setTrackEdit(null);
                return r;
              });
            }}
          >
            <label className="field">
              <span>Title</span>
              <input name="title" defaultValue={trackEdit.title} maxLength={200} required />
            </label>
            <label className="field">
              <span>Description</span>
              <textarea name="description" rows={3} defaultValue={trackEdit.description} maxLength={1000} />
            </label>
            <div className="role-editor__actions">
              <button type="button" className="button button-secondary" onClick={() => setTrackEdit(null)}>
                Cancel
              </button>
              <button className="button button-primary" disabled={pending}>
                Save
              </button>
            </div>
          </form>
        </Modal>
      )}

      {adding && (
        <Modal title={`Add a module to ${adding.title}`} onClose={() => setAdding(null)}>
          <form
            className="be-stack"
            onSubmit={(e) => {
              e.preventDefault();
              const title = String(new FormData(e.currentTarget).get("title"));
              run(async () => {
                const r = await addModule(adding.id, title);
                if (r.ok) setAdding(null);
                return r;
              });
            }}
          >
            <label className="field">
              <span>Module title</span>
              <input name="title" maxLength={200} required autoFocus />
            </label>
            <div className="role-editor__actions">
              <button type="button" className="button button-secondary" onClick={() => setAdding(null)}>
                Cancel
              </button>
              <button className="button button-primary" disabled={pending}>
                Add module
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

/**
 * The picture on a track's card. Saved as soon as it's chosen, into the
 * track's own folder; replacing or removing it deletes the old file.
 */
function TrackPicture({ track, onChanged }: { track: AdminTrack; onChanged: (c: ModuleCover | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [alt, setAlt] = useState(track.cover?.alt ?? "");
  const cover = track.cover;

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    const ticket = await createTrackCoverUpload(track.id, { type: file.type, size: file.size });
    if (!ticket.ok) {
      setBusy(false);
      return setError(ticket.error);
    }
    const { error: upErr } = await createClient().storage.from(MEDIA_BUCKET).uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: file.type });
    if (upErr) {
      setBusy(false);
      return setError("The upload didn't finish. Try again.");
    }
    const r = await attachTrackUpload(track.id, { path: ticket.path, alt });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    const src = createClient().storage.from(MEDIA_BUCKET).getPublicUrl(ticket.path).data.publicUrl;
    onChanged({ src, alt, credit: null });
  }

  async function remove() {
    if (!window.confirm("Remove this track's picture? Its card will show the first module's photo instead.")) return;
    const r = await removeTrackCover(track.id);
    if (!r.ok) return setError(r.error);
    setAlt("");
    onChanged(null);
  }

  async function saveAlt() {
    if (!cover || alt === cover.alt) return;
    const r = await updateTrackCoverAlt(track.id, alt);
    if (!r.ok) return setError(r.error);
    onChanged({ ...cover, alt });
  }

  return (
    <div className="field">
      <span>Card picture</span>
      {cover ? (
        <div className="be-media">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cover.src} alt="" className="be-media__thumb" />
          <PhotoCreditLine credit={cover.credit} />
        </div>
      ) : (
        <p className="card__meta">None yet: the card shows the first module&rsquo;s photo.</p>
      )}
      <div className="be-row">
        <input ref={input} type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        <button type="button" className="button button-secondary button-small" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? "Saving…" : cover ? "Replace with a file" : "Upload a picture"}
        </button>
        <button type="button" className="button button-secondary button-small" disabled={busy} onClick={() => setPicking(true)}>
          Find a photo
        </button>
        {cover && (
          <button type="button" className="text-action" onClick={remove}>
            Remove
          </button>
        )}
      </div>
      {cover && (
        <label className="field">
          <span>Describe the picture (for screen readers)</span>
          <input value={alt} maxLength={500} onChange={(e) => setAlt(e.target.value)} onBlur={saveAlt} />
        </label>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {picking && (
        <PhotoPicker
          moduleId=""
          initialQuery={track.title}
          onClose={() => setPicking(false)}
          onPick={async (p) => {
            setPicking(false);
            setBusy(true);
            const r = await attachTrackStockPhoto(track.id, p);
            setBusy(false);
            if (!r.ok) return setError(r.error);
            setAlt(p.alt);
            onChanged({ src: p.src, alt: p.alt, credit: p.credit });
          }}
        />
      )}
    </div>
  );
}

function ModuleSettings({
  module,
  authors,
  onClose,
  onSaved,
}: {
  module: AdminModule;
  authors: { userId: string; name: string; email: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, close = false) =>
    start(async () => {
      const r = await fn();
      setError(r.ok ? null : (r.error ?? "Something went wrong."));
      if (r.ok) {
        onSaved();
        if (close) onClose();
      }
    });

  return (
    <Modal title={`${module.title}: settings`} onClose={onClose}>
      <form
        className="be-stack"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          run(
            () =>
              updateModuleDetails(module.id, {
                title: String(f.get("title")),
                summary: String(f.get("summary")),
                estimatedMinutes: Number(f.get("minutes")) || null,
              }),
            true
          );
        }}
      >
        <label className="field">
          <span>Title</span>
          <input name="title" defaultValue={module.title} maxLength={200} required />
        </label>
        <label className="field">
          <span>Summary (shown on the track page)</span>
          <textarea name="summary" rows={2} defaultValue={module.summary} maxLength={1000} />
        </label>
        <label className="field">
          <span>Estimated minutes</span>
          <input name="minutes" type="number" min={1} max={600} defaultValue={module.estimatedMinutes ?? ""} />
        </label>
        <button className="button button-primary button-small" style={{ alignSelf: "flex-start" }} disabled={pending}>
          Save details
        </button>
      </form>

      <h3 className="training-admin__subhead">Authors</h3>
      <p className="card__meta">Authors can build and preview this module only, at /build. Publishing stays with Super Admins.</p>
      {authors.length > 0 && (
        <ul className="training-admin__authors">
          {authors.map((a) => (
            <li key={a.userId}>
              {a.name} <span className="card__meta">{a.email}</span>
              <button type="button" className="text-action" onClick={() => run(() => removeModuleAuthor(module.id, a.userId))} disabled={pending}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="be-row"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const r = await addModuleAuthor(module.id, email);
            if (r.ok) setEmail("");
            return r;
          });
        }}
      >
        <input className="be-grow" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="author@example.com" required aria-label="Author email" />
        <button className="button button-secondary button-small" disabled={pending}>
          Add author
        </button>
      </form>

      {module.publishedVersion === 0 && (
        <div className="training-admin__danger">
          {confirmDelete ? (
            <>
              <span>Delete this module and its draft?</span>
              <button type="button" className="button button-danger button-small" onClick={() => run(() => deleteModule(module.id), true)} disabled={pending}>
                Delete module
              </button>
              <button type="button" className="text-action" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" className="text-action roster-table__remove-trigger" onClick={() => setConfirmDelete(true)}>
              Delete module
            </button>
          )}
        </div>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </Modal>
  );
}
