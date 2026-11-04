"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { claimAgenda, releaseAgenda } from "@/app/strata/[corpId]/meetings/actions";

/**
 * One editor at a time (0074). Opening the agenda takes it for editing; while
 * someone else has it, everyone else sees it read-only and can check again.
 * The checkout is kept alive while the page is open and handed back on
 * leaving, or with Done editing; one left untouched for 15 minutes can be taken.
 */
export function AgendaCheckout({ meetingId, editor, viewer }: { meetingId: string; editor: React.ReactNode; viewer: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<{ kind: "checking" } | { kind: "mine" } | { kind: "theirs"; editor: string; since: string } | { kind: "error"; error: string } | { kind: "done" }>({
    kind: "checking",
  });
  const holding = useRef(false);

  const claim = useCallback(async () => {
    const r = await claimAgenda(meetingId).catch(() => ({ ok: false as const, error: "Couldn't open the agenda for editing. Try again." }));
    if (!r.ok) {
      holding.current = false;
      return setState({ kind: "error", error: r.error });
    }
    holding.current = r.mine;
    setState(r.mine ? { kind: "mine" } : { kind: "theirs", editor: r.editor, since: r.since });
  }, [meetingId]);

  useEffect(() => {
    void claim();
    const release = () => {
      if (holding.current) void releaseAgenda(meetingId);
      holding.current = false;
    };
    window.addEventListener("pagehide", release);
    return () => {
      window.removeEventListener("pagehide", release);
      release();
    };
  }, [claim, meetingId]);

  // Keeps the checkout alive while editing.
  const mine = state.kind === "mine";
  useEffect(() => {
    if (!mine) return;
    const t = setInterval(() => void claim(), 2 * 60 * 1000);
    return () => clearInterval(t);
  }, [mine, claim]);

  async function done() {
    if (!window.confirm("Done editing? Anything you haven't saved is lost, and someone else can edit the agenda.")) return;
    holding.current = false;
    await releaseAgenda(meetingId).catch(() => undefined);
    setState({ kind: "done" });
    router.refresh();
  }

  if (state.kind === "mine") {
    return (
      <>
        <div className="agenda-lock" data-state="mine" data-testid="agenda-lock">
          <span>You&rsquo;re editing this agenda. Others who run meetings see it read-only until you&rsquo;re done.</span>
          <button type="button" className="button button-secondary button-small" onClick={done} data-testid="agenda-done-editing">
            Done editing
          </button>
        </div>
        {editor}
      </>
    );
  }
  return (
    <>
      {state.kind !== "checking" && (
        <div className="agenda-lock" data-state={state.kind} role="status" data-testid="agenda-lock">
          <span>
            {state.kind === "theirs"
              ? `${state.editor} is editing this agenda (since ${new Date(state.since).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" })}). It's read-only for you until they're done.`
              : state.kind === "done"
                ? "You're done editing. Someone else who runs meetings can edit the agenda now."
                : state.error}
          </span>
          <button type="button" className="button button-secondary button-small" onClick={() => void claim()} data-testid="agenda-check-again">
            {state.kind === "done" ? "Edit agenda" : "Check again"}
          </button>
        </div>
      )}
      {viewer}
    </>
  );
}
