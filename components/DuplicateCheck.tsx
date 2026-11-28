"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { findDuplicateDocuments, removeDuplicateCopies } from "@/app/strata/[corpId]/documents/actions";
import { copiesToRemove, isRecord, type DuplicateGroup } from "@/lib/documents-duplicates";
import { folderLabel } from "@/lib/documents";

const date = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Vancouver", year: "numeric", month: "short", day: "numeric" });

/**
 * "Check for duplicates" on Documents (admins): lists each set of copies
 * of the same document, the same file or the same text (0103). For each
 * set, choose the one to keep and remove the others; agenda items that
 * attached a removed copy attach the kept one instead. Records (minutes,
 * the Strata Plan) are never removed.
 */
export function DuplicateCheck({ corpId }: { corpId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null);
  const [pending, setPending] = useState(false);
  const [keep, setKeep] = useState<Record<number, string>>({});
  const [done, setDone] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  function check() {
    setOpen(true);
    setError(null);
    setDone({});
    startTransition(async () => {
      const result = await findDuplicateDocuments(corpId);
      if (!result.ok) return setError(result.error);
      setGroups(result.groups);
      setPending(result.pending);
      setKeep(Object.fromEntries(result.groups.map((g, i) => [i, g.keepId])));
    });
  }

  function resolve(i: number, group: DuplicateGroup) {
    const keepId = keep[i] ?? group.keepId;
    const remove = copiesToRemove(group, keepId);
    if (!remove.length) return;
    const kept = group.copies.find((c) => c.id === keepId);
    if (!window.confirm(`Keep "${kept?.title}" in ${folderLabel(kept?.category)} and remove ${remove.length === 1 ? "the other copy" : `the other ${remove.length} copies`}? Agenda items that attach a removed copy will attach the kept one instead.`)) return;
    setError(null);
    startTransition(async () => {
      const result = await removeDuplicateCopies(corpId, keepId, remove.map((c) => c.id));
      if (!result.ok) return setError(result.error);
      const note =
        `Removed ${result.removed} ${result.removed === 1 ? "copy" : "copies"}.` + (result.problems.length ? ` Not removed: ${result.problems.join(" ")}` : "");
      setDone((d) => ({ ...d, [i]: note }));
      router.refresh();
    });
  }

  return (
    <div className="dup-check" data-testid="duplicate-check">
      <button type="button" className="button button-secondary button-small" onClick={check} disabled={busy} data-testid="duplicate-check-button">
        {busy && !groups ? "Checking…" : "Check for duplicates"}
      </button>
      {open && (
        <div className="dup-check__panel card" role="region" aria-label="Duplicates">
          {error && (
            <p className="dup-check__error" role="alert">
              {error}
            </p>
          )}
          {groups && groups.length === 0 && <p data-testid="duplicate-none">No duplicates found.</p>}
          {groups && groups.length > 0 && (
            <>
              <p className="card__meta">
                {groups.length === 1 ? "1 set of copies" : `${groups.length} sets of copies`}. For each, choose the one to keep. Agenda
                items that attach a removed copy will attach the kept one instead.
              </p>
              <ol className="dup-check__groups">
                {groups.map((g, i) => {
                  const keepId = keep[i] ?? g.keepId;
                  const remove = copiesToRemove(g, keepId);
                  return (
                    <li key={g.copies.map((c) => c.id).join("")} className="dup-check__group" data-testid={`duplicate-group-${i}`}>
                      <p className="dup-check__match">{g.match === "file" ? "The same file" : "The same text (different files)"}</p>
                      {done[i] ? (
                        <p role="status">{done[i]}</p>
                      ) : (
                        <>
                          <ul className="dup-check__copies">
                            {g.copies.map((c) => (
                              <li key={c.id}>
                                <label>
                                  <input
                                    type="radio"
                                    name={`keep-${i}`}
                                    checked={keepId === c.id}
                                    onChange={() => setKeep((k) => ({ ...k, [i]: c.id }))}
                                    disabled={busy}
                                  />
                                  <span>
                                    <strong>{c.title}</strong>
                                    <span className="card__meta">
                                      {" "}
                                      {folderLabel(c.category)} &middot; {date(c.uploadedAt)}
                                      {c.uses > 0 && <> &middot; on {c.uses === 1 ? "1 agenda item" : `${c.uses} agenda items`}</>}
                                      {isRecord(c) && <> &middot; a strata record, always kept</>}
                                    </span>
                                  </span>
                                </label>
                              </li>
                            ))}
                          </ul>
                          <button
                            type="button"
                            className="button button-primary button-small"
                            onClick={() => resolve(i, g)}
                            disabled={busy || remove.length === 0}
                            data-testid={`duplicate-resolve-${i}`}
                          >
                            {remove.length === 0
                              ? "Nothing to remove"
                              : `Keep the selected one, remove ${remove.length === 1 ? "the other" : `the other ${remove.length}`}`}
                          </button>
                        </>
                      )}
                    </li>
                  );
                })}
              </ol>
            </>
          )}
          {groups && pending && (
            <p className="card__meta">Some documents are still being read, so more copies may show up later. Check again then.</p>
          )}
          <button type="button" className="link-button" onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}
