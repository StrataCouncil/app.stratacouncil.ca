"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  meetingFormatLabels,
  meetingFormats,
  meetingTimezones,
  meetingTypeLabels,
  meetingTypes,
} from "@/lib/meetings/agenda";
import { createMeeting, updateMeetingDetails, type MeetingDetailsInput } from "@/app/strata/[corpId]/meetings/actions";
import type { ChairCandidate } from "@/lib/data/meetings";

const ELECT = "__elect";
const OTHER = "__other";

/** Type, date, time, time zone, format, location, chair label. Create or edit. */
export function MeetingDetailsForm({
  corpId,
  meetingId,
  initial,
  onDone,
  chairOptions = [],
}: {
  corpId: string;
  meetingId?: string;
  initial?: MeetingDetailsInput;
  onDone?: () => void;
  chairOptions?: ChairCandidate[];
}) {
  const router = useRouter();
  const [form, setForm] = useState<MeetingDetailsInput>(
    initial ?? {
      type: "council",
      meetingDate: "",
      startTime: "19:00",
      timezone: "America/Vancouver",
      format: "in_person",
      location: "",
      chairName: chairOptions[0]?.name ?? "",
    }
  );
  // Chair: one of the usual office holders, elected at the meeting, or
  // someone else typed in.
  const [chairChoice, setChairChoice] = useState(() => {
    const name = initial ? initial.chairName : (chairOptions[0]?.name ?? "");
    if (!name) return ELECT;
    return chairOptions.some((c) => c.name === name) ? name : OTHER;
  });
  function chooseChair(value: string) {
    setChairChoice(value);
    setForm((f) => ({ ...f, chairName: value === ELECT ? "" : value === OTHER ? "" : value }));
  }
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Browser time zone for a new meeting — after mount, so the server and
  // client render the same form first.
  useEffect(() => {
    if (!initial) setForm((f) => ({ ...f, timezone: guessTimezone() }));
  }, [initial]);
  const set = (key: keyof MeetingDetailsInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      if (meetingId) {
        const result = await updateMeetingDetails(corpId, meetingId, form);
        if (!result.ok) return setError(result.error);
        router.refresh();
        onDone?.();
      } else {
        const result = await createMeeting(corpId, form);
        if (!result.ok) return setError(result.error);
        router.push(`/strata/${corpId}/meetings/${result.id}`);
      }
    });
  }

  return (
    <form onSubmit={submit} data-testid="meeting-details-form">
      <div className="field-grid">
        <label className="field field--wide">
          <span>Meeting type</span>
          <select value={form.type} onChange={set("type")} required data-testid="meeting-type">
            {meetingTypes.map((t) => (
              <option key={t} value={t}>
                {meetingTypeLabels[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Date</span>
          <input type="date" value={form.meetingDate} onChange={set("meetingDate")} required data-testid="meeting-date" />
        </label>
        <label className="field">
          <span>Start time</span>
          <input type="time" value={form.startTime} onChange={set("startTime")} data-testid="meeting-time" />
        </label>
        <label className="field">
          <span>Time zone</span>
          <select value={form.timezone} onChange={set("timezone")}>
            {meetingTimezones.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Format</span>
          <select value={form.format} onChange={set("format")}>
            {meetingFormats.map((f) => (
              <option key={f} value={f}>
                {meetingFormatLabels[f]}
              </option>
            ))}
          </select>
        </label>
        <label className="field field--wide">
          <span>Location or meeting link</span>
          <input
            value={form.location}
            onChange={set("location")}
            placeholder="e.g. Amenity room, or a Zoom link"
            maxLength={500}
            data-testid="meeting-location"
          />
        </label>
        <label className="field field--wide">
          <span>Chair</span>
          <select value={chairChoice} onChange={(e) => chooseChair(e.target.value)} data-testid="meeting-chair">
            {chairOptions.map((c) => (
              <option key={`${c.office}-${c.name}`} value={c.name}>
                {c.name} ({c.office})
              </option>
            ))}
            <option value={ELECT}>Elected at the meeting</option>
            <option value={OTHER}>Someone else…</option>
          </select>
          {chairChoice === OTHER && (
            <input
              value={form.chairName}
              onChange={set("chairName")}
              maxLength={200}
              placeholder="Chair's name"
              required
              style={{ marginTop: "0.5rem" }}
              data-testid="meeting-chair-other"
            />
          )}
          <span className="field__hint">
            {chairChoice === ELECT
              ? "The meeting nominates and votes on a chair in Meeting Mode. "
              : "Usually the President, or the Vice President or Manager when they can't. "}
            Shown on the agenda and minutes. Running the meeting is a separate permission.
          </span>
        </label>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="role-editor__actions">
        {onDone && (
          <button type="button" className="button button-secondary" onClick={onDone} disabled={pending}>
            Cancel
          </button>
        )}
        <button type="submit" className="button button-primary" disabled={pending} data-testid="meeting-details-submit">
          {pending ? "Saving…" : meetingId ? "Save details" : "Create and build agenda"}
        </button>
      </div>
    </form>
  );
}

function guessTimezone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return meetingTimezones.some(([v]) => v === tz) ? tz : "America/Vancouver";
  } catch {
    return "America/Vancouver";
  }
}
