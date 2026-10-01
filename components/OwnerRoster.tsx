"use client";

import { useRef, useState, useTransition } from "react";
import {
  applyRosterUpload,
  previewRosterUpload,
  saveLot,
  type LotEdit,
  type PreviewResult,
} from "@/app/strata/[corpId]/lots/actions";
import type { OwnerLot } from "@/lib/data/owners";
import { ownerTypeLabels, ownerTypes } from "@/lib/roster-csv";

const roleLabels: Record<string, string> = {
  president: "President",
  vice_president: "Vice President",
  treasurer: "Treasurer",
  secretary: "Secretary",
  member_at_large: "Member at Large",
};

const fmt = (n: number) => n.toLocaleString("en-CA", { style: "currency", currency: "CAD" });

const NA = <span className="roster-table__na">&mdash;</span>;

/**
 * Strata Lots — the owner/lot roster (doc02 §2, §2a), one row per lot on
 * the Strata Plan. Every connected member can see it; the admin maintains
 * it two ways:
 *
 *   - CSV upload: download the template (or the current roster), fill it
 *     in, upload. The upload is previewed as a field-by-field diff before
 *     anything is written. A blank cell never clears anything.
 *   - Direct edit of one lot, including the four governance fields
 *     (council member, role, council delegate name/email) that no upload
 *     can touch. A direct edit saves exactly what's typed.
 */
export function OwnerRoster({
  corporationId,
  lots,
  isAdmin,
}: {
  corporationId: string;
  lots: OwnerLot[];
  isAdmin: boolean;
}) {
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <>
      {isAdmin && <RosterUpload corporationId={corporationId} />}

      <div className="roster-table-wrap">
        <table className="roster-table" data-testid="strata-lots-table">
          <thead>
            <tr>
              <th>SL #</th>
              <th>Unit #</th>
              <th>Owner</th>
              <th>Type</th>
              <th>Parking</th>
              <th>Storage</th>
              <th>Bike rack</th>
              <th data-center="true">Unit entitlement</th>
              <th data-center="true">Strata fee / mo</th>
              <th>Council</th>
              {isAdmin && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {lots.map((lot) => (
              <LotRow
                key={lot.id}
                corporationId={corporationId}
                lot={lot}
                isAdmin={isAdmin}
                editing={editing === lot.lotNumber}
                onEdit={() => setEditing(lot.lotNumber)}
                onClose={() => setEditing(null)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function LotRow({
  corporationId,
  lot,
  isAdmin,
  editing,
  onEdit,
  onClose,
}: {
  corporationId: string;
  lot: OwnerLot;
  isAdmin: boolean;
  editing: boolean;
  onEdit: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <tr data-testid={`lot-row-${lot.lotNumber}`}>
        <td>{lot.lotNumber}</td>
        <td>{lot.unitNumber ?? NA}</td>
        <td>
          {lot.fullName ?? NA}
          {lot.email && <div className="roster-table__meta">{lot.email}</div>}
        </td>
        <td>{lot.ownerType ? ownerTypeLabels[lot.ownerType] : NA}</td>
        <td>{lot.parking ?? NA}</td>
        <td>{lot.storage ?? NA}</td>
        <td>{lot.bikeRack ?? NA}</td>
        <td data-center="true">{lot.unitEntitlement ?? NA}</td>
        <td data-center="true">{lot.strataFees === null ? NA : fmt(lot.strataFees)}</td>
        <td>
          {lot.isCouncilMember ? (
            <span className="role-tag">{lot.role ? roleLabels[lot.role] : "Council"}</span>
          ) : (
            NA
          )}
          {lot.councilMemberName && (
            <div className="roster-table__meta">
              Delegate: {lot.councilMemberName}
              {lot.councilEmail && <> &middot; {lot.councilEmail}</>}
            </div>
          )}
        </td>
        {isAdmin && (
          <td>
            <button
              className="roster-table__edit-roles"
              onClick={onEdit}
              data-testid={`edit-lot-${lot.lotNumber}`}
            >
              Edit
            </button>
          </td>
        )}
      </tr>
      {editing && (
        <tr>
          <td colSpan={11}>
            <LotEditor corporationId={corporationId} lot={lot} onClose={onClose} />
          </td>
        </tr>
      )}
    </>
  );
}

function LotEditor({
  corporationId,
  lot,
  onClose,
}: {
  corporationId: string;
  lot: OwnerLot;
  onClose: () => void;
}) {
  const [form, setForm] = useState<LotEdit>({
    fullName: lot.fullName ?? "",
    email: lot.email ?? "",
    unitNumber: lot.unitNumber ?? "",
    unitEntitlement: lot.unitEntitlement?.toString() ?? "",
    ownerType: lot.ownerType ?? "",
    parking: lot.parking ?? "",
    storage: lot.storage ?? "",
    bikeRack: lot.bikeRack ?? "",
    strataFees: lot.strataFees?.toString() ?? "",
    councilMemberName: lot.councilMemberName ?? "",
    councilEmail: lot.councilEmail ?? "",
    isCouncilMember: lot.isCouncilMember,
    role: lot.role ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const set = <K extends keyof LotEdit>(key: K, value: LotEdit[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const input = (key: Exclude<keyof LotEdit, "isCouncilMember" | "ownerType" | "role">, label: string, type = "text") => (
    <div className="field">
      <label htmlFor={`lot-${lot.lotNumber}-${key}`}>{label}</label>
      <input
        id={`lot-${lot.lotNumber}-${key}`}
        type={type}
        value={form[key]}
        onChange={(e) => set(key, e.target.value)}
        data-testid={`lot-edit-${key}`}
      />
    </div>
  );

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await saveLot(corporationId, lot.lotNumber, form);
      if (result.ok) onClose();
      else setError(result.error);
    });
  }

  return (
    <form className="lot-editor" onSubmit={save} data-testid={`lot-editor-${lot.lotNumber}`}>
      <div className="role-editor__title">Edit {lot.lotNumber}</div>

      <fieldset className="lot-editor__section">
        <legend>Owner of record</legend>
        <div className="lot-editor__grid">
          {input("fullName", "Owner name")}
          {input("email", "Email", "email")}
          {input("unitNumber", "Unit number")}
          <div className="field">
            <label htmlFor={`lot-${lot.lotNumber}-ownerType`}>Owner type</label>
            <select
              id={`lot-${lot.lotNumber}-ownerType`}
              value={form.ownerType}
              onChange={(e) => set("ownerType", e.target.value)}
            >
              <option value="">&mdash;</option>
              {ownerTypes.map((t) => (
                <option key={t} value={t}>
                  {ownerTypeLabels[t]}
                </option>
              ))}
            </select>
          </div>
          {input("unitEntitlement", "Unit entitlement")}
          {input("strataFees", "Strata fees / month")}
          {input("parking", "Parking stall(s)")}
          {input("storage", "Storage locker(s)")}
          {input("bikeRack", "Bike rack(s)")}
        </div>
      </fieldset>

      <fieldset className="lot-editor__section">
        <legend>Council</legend>
        <p className="card__meta" style={{ margin: "0 0 0.75rem" }}>
          Set here only &mdash; a roster upload never changes these.
        </p>
        <div className="lot-editor__grid">
          <div className="field field--checkbox">
            <label>
              <input
                type="checkbox"
                checked={form.isCouncilMember}
                onChange={(e) => {
                  set("isCouncilMember", e.target.checked);
                  if (!e.target.checked) set("role", "");
                }}
                data-testid="lot-edit-isCouncilMember"
              />
              <span>On council</span>
            </label>
          </div>
          <div className="field">
            <label htmlFor={`lot-${lot.lotNumber}-role`}>Council role</label>
            <select
              id={`lot-${lot.lotNumber}-role`}
              value={form.role}
              disabled={!form.isCouncilMember}
              onChange={(e) => set("role", e.target.value)}
            >
              <option value="">Member at large</option>
              {Object.entries(roleLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          {input("councilMemberName", "Council delegate name")}
          {input("councilEmail", "Council delegate email", "email")}
        </div>
        <p className="card__meta" style={{ margin: 0 }}>
          A delegate is someone other than the owner of record who sits on
          council for this lot &mdash; leave blank if the owner sits themselves.
        </p>
      </fieldset>

      {error && <p className="roster-invites__error">{error}</p>}
      <div className="role-editor__actions">
        <button type="button" className="button button-secondary button-small" onClick={onClose} disabled={pending}>
          Cancel
        </button>
        <button type="submit" className="button button-primary button-small" disabled={pending} data-testid="lot-edit-save">
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

function RosterUpload({ corporationId }: { corporationId: string }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState<{ name: string; text: string } | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [applyErrors, setApplyErrors] = useState<string[] | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setCsv(null);
    setPreview(null);
    setApplyErrors(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function choose(file: File | undefined) {
    setNotice(null);
    setApplyErrors(null);
    setPreview(null);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setPreview({ ok: false, errors: ["Upload a .csv file. From Excel or Numbers, use Save As / Export → CSV."] });
      return;
    }
    const text = await file.text();
    setCsv({ name: file.name, text });
    startTransition(async () => {
      setPreview(await previewRosterUpload(corporationId, text));
    });
  }

  function apply() {
    if (!csv) return;
    startTransition(async () => {
      const result = await applyRosterUpload(corporationId, csv.text);
      if (result.ok) {
        reset();
        setNotice(
          result.lotsChanged === 0
            ? "Nothing to change — the roster already matches that file."
            : `Updated ${result.lotsChanged} ${result.lotsChanged === 1 ? "lot" : "lots"} (${result.fieldsChanged} ${
                result.fieldsChanged === 1 ? "field" : "fields"
              }).`
        );
      } else {
        setApplyErrors(result.errors);
      }
    });
  }

  const errors = applyErrors ?? (preview && !preview.ok ? preview.errors : null);

  return (
    <div className="card roster-upload" data-testid="roster-upload">
      <h3>Update the owner roster</h3>
      <p className="card__meta" style={{ marginTop: "-0.4rem" }}>
        Download the template (or the current roster), fill it in, and upload
        it here. Every lot on the Strata Plan is already listed &mdash; an
        upload only ever updates them. <strong>Blank cells leave existing
        values as they are</strong>; to clear a field, edit the lot directly.
        Council membership and roles are set below, never from a file.
      </p>

      <div className="roster-upload__actions">
        <a
          href={`/strata/${corporationId}/lots/export?template=1`}
          className="button button-secondary button-small"
          data-testid="roster-download-template"
        >
          Download template
        </a>
        <a
          href={`/strata/${corporationId}/lots/export`}
          className="button button-secondary button-small"
          data-testid="roster-download-current"
        >
          Download current roster
        </a>
        <label className="button button-primary button-small roster-upload__file">
          {pending && csv ? "Reading…" : "Upload CSV"}
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => choose(e.target.files?.[0])}
            disabled={pending}
            data-testid="roster-upload-input"
          />
        </label>
      </div>

      {notice && (
        <p className="card__meta" data-testid="roster-upload-notice">
          {notice}
        </p>
      )}

      {errors && (
        <div className="roster-upload__errors" data-testid="roster-upload-errors">
          <strong>Nothing was changed.</strong>
          <ul>
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {preview?.ok && csv && !applyErrors && (
        <div className="roster-upload__preview" data-testid="roster-upload-preview">
          {preview.changedLots.length === 0 ? (
            <p>
              <strong>{csv.name}</strong>: nothing to change &mdash; every
              filled-in cell already matches the roster.
            </p>
          ) : (
            <>
              <p>
                <strong>{csv.name}</strong>: {preview.changedLots.length} of{" "}
                {preview.lotsInFile} {preview.lotsInFile === 1 ? "lot" : "lots"} in the file will change (
                {preview.fieldCount} {preview.fieldCount === 1 ? "field" : "fields"}).
              </p>
              <details>
                <summary>Show changes</summary>
                <ul className="roster-upload__changes">
                  {preview.changedLots.map((lot) => (
                    <li key={lot.lotNumber}>
                      <strong>{lot.lotNumber}</strong>
                      <ul>
                        {lot.changes.map((c) => (
                          <li key={c.field}>
                            {c.label}: <span className="roster-upload__from">{c.from}</span> &rarr; {c.to}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </details>
            </>
          )}
          <div className="role-editor__actions" style={{ justifyContent: "flex-start" }}>
            <button className="button button-secondary button-small" onClick={reset} disabled={pending}>
              Cancel
            </button>
            {preview.changedLots.length > 0 && (
              <button
                className="button button-primary button-small"
                onClick={apply}
                disabled={pending}
                data-testid="roster-upload-apply"
              >
                {pending ? "Applying…" : "Apply changes"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
