"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { deleteMeeting, launchMeeting, type MeetingDetailsInput } from "@/app/strata/[corpId]/meetings/actions";
import { MeetingDetailsForm } from "@/components/meetings/MeetingDetailsForm";
import type { ChairCandidate } from "@/lib/data/meetings";
import { RequestSubscriptionButton } from "@/components/RequestSubscriptionButton";

function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("button, input, select")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={ref} className={`modal${wide ? " modal--wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/**
 * Launch: the one launch. A subscribed corporation just launches; an
 * unsubscribed one is told this uses its free meeting first.
 */
export function LaunchMeetingButton({
  corpId,
  meetingId,
  subscribed,
  trialAvailable,
  isAdmin,
  agendaSaved,
}: {
  corpId: string;
  meetingId: string;
  subscribed: boolean;
  trialAvailable: boolean;
  isAdmin: boolean;
  agendaSaved: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsSubscription, setNeedsSubscription] = useState(false);
  const [pending, startTransition] = useTransition();

  function launch() {
    setError(null);
    startTransition(async () => {
      const result = await launchMeeting(corpId, meetingId);
      if (!result.ok) {
        setNeedsSubscription(Boolean(result.subscriptionRequired));
        return setError(result.error);
      }
      router.push(`/strata/${corpId}/meetings/${meetingId}/run`);
    });
  }

  const blocked = !subscribed && !trialAvailable;
  return (
    <>
      <button
        type="button"
        className={`button ${agendaSaved ? "button-primary" : "button-secondary"}`}
        onClick={() => setOpen(true)}
        disabled={!agendaSaved}
        title={agendaSaved ? undefined : "Save the agenda first."}
        data-testid="launch-meeting"
      >
        Launch Meeting Mode
      </button>
      {open && (
        <Dialog title="Launch Meeting Mode?" onClose={() => setOpen(false)}>
          {blocked ? (
            <p>
              Your free meeting has been used. Running another meeting needs a Stratasphere&trade; subscription.
            </p>
          ) : subscribed ? (
            <p>
              You&rsquo;ll run this meeting from here on. While it&rsquo;s launched, only you can change it or see its private notes.
            </p>
          ) : (
            <p>
              This uses your strata&rsquo;s <strong>one free meeting</strong>. It&rsquo;s the full product, with Stratasphere&trade;
              AI and every document you&rsquo;ve uploaded. You can set up as many draft meetings as you like, but only one can be
              launched before subscribing. While it&rsquo;s launched, only you can change it or see its private notes.
            </p>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="role-editor__actions">
            <button type="button" className="button button-secondary" onClick={() => setOpen(false)} disabled={pending}>
              Not now
            </button>
            {blocked || needsSubscription ? (
              isAdmin ? (
                <Link href={`/strata/${corpId}/billing`} className="button button-primary">
                  See plans
                </Link>
              ) : (
                <RequestSubscriptionButton corpId={corpId} />
              )
            ) : (
              <button type="button" className="button button-primary" onClick={launch} disabled={pending} data-testid="launch-confirm">
                {pending ? "Launching…" : subscribed ? "Launch" : "Use my free meeting"}
              </button>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}

export function EditMeetingDetailsButton({
  corpId,
  meetingId,
  initial,
  chairOptions,
}: {
  corpId: string;
  meetingId: string;
  initial: MeetingDetailsInput;
  chairOptions: ChairCandidate[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="button button-secondary button-small" onClick={() => setOpen(true)} data-testid="edit-meeting-details">
        Edit details
      </button>
      {open && (
        <Dialog title="Meeting details" onClose={() => setOpen(false)} wide>
          <MeetingDetailsForm corpId={corpId} meetingId={meetingId} initial={initial} chairOptions={chairOptions} onDone={() => setOpen(false)} />
        </Dialog>
      )}
    </>
  );
}

export function DeleteMeetingButton({ corpId, meetingId }: { corpId: string; meetingId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <>
      <button type="button" className="link-button agenda-danger" onClick={() => setOpen(true)} data-testid="delete-meeting">
        Delete meeting
      </button>
      {open && (
        <Dialog title="Delete this meeting?" onClose={() => setOpen(false)}>
          <p>
            This deletes the whole meeting: its date and details and its agenda. It can&rsquo;t be undone. Files attached to
            agenda items stay in Documents.
          </p>
          <p className="card__meta">To start the agenda over instead, edit or delete its items; the meeting stays.</p>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="role-editor__actions">
            <button type="button" className="button button-secondary" onClick={() => setOpen(false)} disabled={pending}>
              Keep it
            </button>
            <button
              type="button"
              className="button button-danger"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await deleteMeeting(corpId, meetingId);
                  if (!result.ok) return setError(result.error);
                  router.push(`/strata/${corpId}/meetings`);
                })
              }
              data-testid="delete-meeting-confirm"
            >
              Delete meeting
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
