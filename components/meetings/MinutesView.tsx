"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { attendanceLines, clockTime, voteLine, type MinutesContent } from "@/lib/meetings/minutes";
import { finalizeMeetingMinutes, saveMinutesSummaries } from "@/app/strata/[corpId]/meetings/[meetingId]/minutes/actions";

/**
 * Minutes, as the record reads. In draft, whoever can run meetings edits
 * each item's summary (votes and motions are the record and stay as
 * decided) and finalizes — irreversibly.
 */
export function MinutesView({
  corpId,
  meetingId,
  minutes,
  editable,
  final,
}: {
  corpId: string;
  meetingId: string;
  minutes: MinutesContent;
  editable: boolean;
  final: boolean;
}) {
  const router = useRouter();
  const [summaries, setSummaries] = useState<Record<string, string>>(() =>
    Object.fromEntries(minutes.sections.flatMap((s) => s.items.map((i) => [i.id, i.summary])))
  );
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const tz = minutes.meeting.timezone;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function save(then?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await saveMinutesSummaries(corpId, meetingId, summaries);
      if (!result.ok) return setError(result.error);
      setDirty(false);
      setStatus("Saved.");
      if (then) then();
      else router.refresh();
    });
  }

  function finalize() {
    const run = () =>
      startTransition(async () => {
        const result = await finalizeMeetingMinutes(corpId, meetingId);
        setConfirming(false);
        if (!result.ok) return setError(result.error);
        router.refresh();
      });
    if (dirty) save(run);
    else run();
  }

  return (
    <article className="minutes" data-testid="minutes">
      {editable && (
        <div className="agenda-builder__bar">
          <span className="agenda-builder__state" role="status">
            {pending ? "Saving…" : dirty ? "Unsaved changes" : status}
          </span>
          <button type="button" className="button button-secondary" onClick={() => save()} disabled={pending || !dirty} data-testid="minutes-save">
            Save draft
          </button>
          <button type="button" className="button button-primary" onClick={() => setConfirming(true)} disabled={pending} data-testid="minutes-finalize">
            Finalize minutes
          </button>
        </div>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}

      <header className="minutes__head">
        {!final && <p className="minutes__draft">Draft — not yet final</p>}
        <h2>{minutes.corporation.name}</h2>
        <p className="card__meta">Strata Plan {minutes.corporation.planNumber}</p>
        <h3>Minutes of the {minutes.meeting.typeLabel}</h3>
        <dl className="minutes__facts">
          <dt>Date</dt>
          <dd>{minutes.meeting.date}</dd>
          <dt>Time</dt>
          <dd>
            {clockTime(minutes.meeting.calledToOrderAt, tz)} – {clockTime(minutes.meeting.adjournedAt, tz)}
          </dd>
          <dt>Format</dt>
          <dd>
            {minutes.meeting.format}
            {minutes.meeting.location ? ` · ${minutes.meeting.location}` : ""}
          </dd>
          {minutes.meeting.chair && (
            <>
              <dt>Chair</dt>
              <dd>{minutes.meeting.chair}</dd>
            </>
          )}
        </dl>
      </header>

      <section>
        <h4>Attendance</h4>
        {attendanceLines(minutes).map((l) => (
          <p key={l}>{l}</p>
        ))}
      </section>
      <section>
        <h4>Call to order</h4>
        <p>
          {minutes.calledToOrder
            ? `The meeting was called to order at ${clockTime(minutes.meeting.calledToOrderAt, tz)}.`
            : "Quorum was not achieved and the meeting was not called to order."}
        </p>
      </section>

      {minutes.sections.map((s) => (
        <section key={s.name + s.items[0]?.id}>
          <h4>{s.name}</h4>
          {s.items.map((it) => (
            <div className="minutes__item" key={it.id}>
              <p className="minutes__title">
                {it.num}. {it.title}
                {it.deferred && <span className="pill">Deferred</span>}
              </p>
              {editable ? (
                <textarea
                  className="minutes__edit"
                  rows={Math.max(2, Math.ceil((summaries[it.id]?.length ?? 0) / 90))}
                  value={summaries[it.id] ?? ""}
                  onChange={(e) => {
                    setSummaries((m) => ({ ...m, [it.id]: e.target.value }));
                    setDirty(true);
                    setStatus(null);
                  }}
                  aria-label={`Minutes for ${it.title}`}
                  placeholder={it.motion?.outcome ? "Optional: anything to record beyond the motion and vote" : "Summary for the minutes"}
                />
              ) : (
                it.summary && <p className="minutes__summary">{it.summary}</p>
              )}
              {it.motion?.text && (
                <div className="minutes__motion">
                  <p className="card__meta">
                    Moved by {it.motion.mover || "—"}, seconded by {it.motion.seconder || "—"}:
                  </p>
                  <p>&ldquo;{it.motion.text}&rdquo;</p>
                </div>
              )}
              {it.motion?.outcome && (
                <p className="minutes__outcome" data-outcome={it.motion.outcome}>
                  {it.motion.outcome} — {voteLine(it.motion)}
                </p>
              )}
              {it.nextMeeting && (
                <p>Next meeting: {[it.nextMeeting.date, it.nextMeeting.time, it.nextMeeting.location].filter(Boolean).join(" · ")}</p>
              )}
            </div>
          ))}
        </section>
      ))}

      <section>
        <h4>Adjournment</h4>
        <p>There being no further business, the meeting was adjourned at {clockTime(minutes.meeting.adjournedAt, tz)}.</p>
      </section>

      {confirming && (
        <div className="modal-backdrop" onClick={() => !pending && setConfirming(false)}>
          <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="finalize-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="finalize-title">Finalize these minutes?</h2>
            <p>Once finalized, the minutes are locked and can&rsquo;t be edited. The meeting&rsquo;s private notes are deleted for good.</p>
            <p className="card__meta">The final PDF is saved to your strata&rsquo;s records.</p>
            <div className="role-editor__actions">
              <button type="button" className="button button-secondary" onClick={() => setConfirming(false)} disabled={pending}>
                Not yet
              </button>
              <button type="button" className="button button-primary" onClick={finalize} disabled={pending} data-testid="minutes-finalize-confirm">
                {pending ? "Finalizing…" : "Finalize"}
              </button>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}
