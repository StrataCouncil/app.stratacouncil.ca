"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { claimAgenda, releaseAgenda, requestAgendaTakeover } from "@/app/strata/[corpId]/meetings/actions";

/**
 * Editing an agenda (0074, 0077): one editor at a time. Edit agenda opens
 * this; it takes the agenda, renews the hold every 20 seconds and lets go
 * on leaving. Save agenda in the builder saves and goes back to the
 * Meetings tab. While someone else has it, a person who runs meetings can
 * take it over: the editor's screen saves their changes and hands it over
 * (or, if that screen has gone, it passes after a minute).
 */

type Editing = {
  /** The builder registers how to save its changes (true when saved, or nothing to save). */
  setSaver: (save: (() => Promise<boolean>) | null) => void;
  /** Done editing: let go of the agenda and go back to the Meetings tab. */
  exit: () => Promise<void>;
};
const EditingContext = createContext<Editing | null>(null);
export const useAgendaEditing = () => useContext(EditingContext);

export function AgendaCheckout({
  corpId,
  meetingId,
  editor,
  viewer,
}: {
  corpId: string;
  meetingId: string;
  editor: React.ReactNode;
  viewer: React.ReactNode;
}) {
  const router = useRouter();
  type State =
    | { kind: "checking" }
    | { kind: "mine" }
    | { kind: "theirs"; editor: string; since: string; requested: boolean }
    | { kind: "error"; error: string };
  const [state, setState] = useState<State>({ kind: "checking" });
  const [asking, setAsking] = useState(false);
  const holding = useRef(false);
  const saver = useRef<(() => Promise<boolean>) | null>(null);
  const handingOver = useRef(false);
  const meetingPage = `/strata/${corpId}/meetings/${meetingId}`;

  const release = useCallback(() => {
    if (holding.current) void releaseAgenda(meetingId);
    holding.current = false;
  }, [meetingId]);

  const claim = useCallback(async () => {
    const r = await claimAgenda(meetingId).catch(() => ({ ok: false as const, error: "Couldn't open the agenda for editing. Try again." }));
    if (!r.ok) {
      holding.current = false;
      return setState({ kind: "error", error: r.error });
    }
    if (r.mine) {
      holding.current = true;
      setState({ kind: "mine" });
      // Someone asked for it: save what's here, hand it over, and say who has it.
      if (r.takeover && !handingOver.current) {
        handingOver.current = true;
        await (saver.current?.() ?? Promise.resolve(true)).catch(() => false);
        release();
        router.push(`${meetingPage}?takenOver=${encodeURIComponent(r.takeover)}`);
      }
      return;
    }
    holding.current = false;
    setState({ kind: "theirs", editor: r.editor, since: r.since, requested: r.requested });
  }, [meetingId, meetingPage, release, router]);

  useEffect(() => {
    void claim();
    window.addEventListener("pagehide", release);
    return () => {
      window.removeEventListener("pagehide", release);
      release();
    };
  }, [claim, release]);

  // Renew while editing; check back often while waiting for a handover.
  const waiting = state.kind === "theirs" && state.requested;
  useEffect(() => {
    if (state.kind !== "mine" && !waiting) return;
    const t = setInterval(() => void claim(), waiting ? 5000 : 20000);
    return () => clearInterval(t);
  }, [state.kind, waiting, claim]);

  const editing: Editing = {
    setSaver: (save) => {
      saver.current = save;
    },
    exit: async () => {
      holding.current = false;
      await releaseAgenda(meetingId).catch(() => undefined);
      router.push(`/strata/${corpId}/meetings`);
    },
  };

  async function takeOver() {
    setAsking(true);
    const r = await requestAgendaTakeover(meetingId).catch(() => ({ ok: false as const, error: "Couldn't ask for the agenda. Try again." }));
    setAsking(false);
    if (!r.ok) return setState({ kind: "error", error: r.error });
    await claim();
  }

  if (state.kind === "mine") return <EditingContext.Provider value={editing}>{editor}</EditingContext.Provider>;
  return (
    <>
      {state.kind !== "checking" && (
        <div className="agenda-lock" data-state={state.kind} role="status" data-testid="agenda-lock">
          <span>
            {state.kind === "theirs"
              ? state.requested
                ? `Asking ${state.editor} to hand over the agenda. Their changes are saved first; if their screen doesn't answer, it passes to you within a minute.`
                : `${state.editor} is editing this agenda (since ${new Date(state.since).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" })}). It's read-only for you until they're done.`
              : state.error}
          </span>
          {state.kind === "theirs" && !state.requested && (
            <button type="button" className="button button-secondary button-small" onClick={() => void takeOver()} disabled={asking} data-testid="agenda-take-over">
              Take over editing
            </button>
          )}
          {state.kind === "error" && (
            <button type="button" className="button button-secondary button-small" onClick={() => void claim()} data-testid="agenda-check-again">
              Try again
            </button>
          )}
        </div>
      )}
      {viewer}
    </>
  );
}
