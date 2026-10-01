"use client";

import { useState } from "react";
import {
  meetingFormatLabels,
  meetingTypeLabels,
  type Meeting,
} from "@/lib/placeholder-data";

/**
 * One row, one action — which action depends entirely on `status` (and,
 * for an adjourned meeting, `minutesState`) — the meeting lifecycle from
 * doc01 §4:
 *
 * - `DRAFT` (Upcoming): Launch Meeting, plus Edit Agenda and Export —
 *   editing the agenda and exporting it both live beside the meeting
 *   before it starts, not just Launch alone.
 * - `LIVE` (Active): Resume Meeting — "Resume," not "Join" or "Open,"
 *   since Meeting Mode is chair-only/single-operator (doc01 §4): there's
 *   no one else who could be joining a session already in progress.
 * - `ADJOURNED`, minutes still `DRAFT`: Finalize Meeting.
 * - `ADJOURNED`, minutes `FINAL`: an "Adjourned" pill/tag, no action —
 *   the meeting is done and its record is locked (doc01 §4/§5a).
 *
 * Launch/Resume/Edit Agenda/Export all point at a real Meeting Mode
 * session or agenda editor, neither of which exists in this app yet
 * (doc02 describes MM SS but no client screen has been built for it) —
 * those stay honest disabled buttons rather than pretending to work, the
 * same pattern already used for the chat composer's Send button.
 * Finalizing, by contrast, is a real (client-side) state transition —
 * flipping `minutesState` to `FINAL` and swapping the button for the
 * Adjourned tag is something this mock can actually do honestly, the
 * same as Pin/Unpin or approving a join request elsewhere in the app.
 */
function MeetingRow({
  m,
  onFinalize,
}: {
  m: Meeting;
  onFinalize: () => void;
}) {
  return (
    <div className="module-row" data-testid={`meeting-${m.id}`}>
      <div>
        <div className="module-row__title">{m.title}</div>
        <div className="module-row__meta">
          <span className="pill" style={{ marginRight: "0.5em" }}>
            {meetingTypeLabels[m.type]}
          </span>
          {m.status === "ADJOURNED" ? m.adjournedAt : m.scheduledAt}
          {" · "}
          {meetingFormatLabels[m.format]}
          {" · "}
          Chair: {m.chair}
        </div>
      </div>

      <div className="meeting-row__actions">
        {m.status === "DRAFT" && (
          <>
            <button
              type="button"
              className="button button-secondary button-small"
              disabled
              title="Not wired up yet — UI preview only"
              data-testid={`edit-agenda-${m.id}`}
            >
              Edit Agenda
            </button>
            <button
              type="button"
              className="button button-secondary button-small"
              disabled
              title="Not wired up yet — UI preview only"
              data-testid={`export-agenda-${m.id}`}
            >
              Export
            </button>
            <button
              type="button"
              className="button button-primary button-small"
              disabled
              title="Not wired up yet — UI preview only"
              data-testid={`launch-meeting-${m.id}`}
            >
              Launch Meeting
            </button>
          </>
        )}

        {m.status === "LIVE" && (
          <button
            type="button"
            className="button button-primary button-small"
            disabled
            title="Not wired up yet — UI preview only"
            data-testid={`resume-meeting-${m.id}`}
          >
            Resume Meeting
          </button>
        )}

        {m.status === "ADJOURNED" && m.minutesState === "DRAFT" && (
          <button
            type="button"
            className="button button-primary button-small"
            onClick={onFinalize}
            data-testid={`finalize-meeting-${m.id}`}
          >
            Finalize Meeting
          </button>
        )}

        {m.status === "ADJOURNED" && m.minutesState === "FINAL" && (
          <span className="pill pill--locked" data-testid={`adjourned-${m.id}`}>
            Adjourned
          </span>
        )}
      </div>
    </div>
  );
}

export function MeetingsList({ initialMeetings }: { initialMeetings: Meeting[] }) {
  const [meetings, setMeetings] = useState(initialMeetings);

  function finalizeMeeting(id: string) {
    setMeetings((prev) =>
      prev.map((m) => (m.id === id ? { ...m, minutesState: "FINAL" } : m))
    );
  }

  const upcoming = meetings.filter((m) => m.status === "DRAFT");
  const active = meetings.filter((m) => m.status === "LIVE");
  const adjourned = meetings.filter((m) => m.status === "ADJOURNED");

  return (
    <div data-testid="meetings-list">
      {active.length > 0 && (
        <div style={{ marginBottom: "2rem" }}>
          <h3 style={{ marginBottom: "0.75rem" }}>
            Active
            <span className="pill pill--live" style={{ marginLeft: "0.6em" }}>
              Live
            </span>
          </h3>
          <div className="module-list">
            {active.map((m) => (
              <MeetingRow key={m.id} m={m} onFinalize={() => finalizeMeeting(m.id)} />
            ))}
          </div>
        </div>
      )}

      {upcoming.length > 0 && (
        <div style={{ marginBottom: "2rem" }}>
          <h3 style={{ marginBottom: "0.75rem" }}>Upcoming</h3>
          <div className="module-list">
            {upcoming.map((m) => (
              <MeetingRow key={m.id} m={m} onFinalize={() => finalizeMeeting(m.id)} />
            ))}
          </div>
        </div>
      )}

      {adjourned.length > 0 && (
        <div>
          <h3 style={{ marginBottom: "0.75rem" }}>Adjourned</h3>
          <div className="module-list">
            {adjourned.map((m) => (
              <MeetingRow key={m.id} m={m} onFinalize={() => finalizeMeeting(m.id)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
