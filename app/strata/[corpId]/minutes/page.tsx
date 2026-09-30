import { StrataSphereNav } from "@/components/StrataSphereNav";
import {
  meetingTypeLabels,
  minutesRecords,
} from "@/lib/placeholder-data";

/**
 * Minutes — every finalized minutes record in one place, however it got
 * here. Meeting Mode drops a record here automatically the moment
 * minutes are Finalized (an explicit, irreversible action distinct from
 * the editable DRAFT state — doc01 §4/§5a); "Upload historic minutes"
 * lets a strata backfill records from before it used the platform.
 * Neither path routes through the generic Documents repository — minutes
 * are a structured record (`meetings.minutes_state`/`minutes_content`),
 * not just an uploaded file, even when a historic one starts as a PDF.
 */
export default function MinutesPage() {
  const sorted = [...minutesRecords].sort(
    (a, b) => new Date(b.meetingDate).getTime() - new Date(a.meetingDate).getTime()
  );

  return (
    <>
      <StrataSphereNav active="minutes" />
      <h2 style={{ marginBottom: "1rem" }}>Minutes</h2>

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <h3>Upload historic minutes</h3>
        <p>
          Minutes from before this strata used Stratasphere&trade; &mdash;
          scanned or typed, council meetings, AGMs or SGMs. They&rsquo;re
          indexed the same as anything generated in Meeting Mode, so the
          assistant and decision ledger can draw on them too.
        </p>
        <button
          className="button button-secondary"
          style={{ alignSelf: "flex-start" }}
          data-testid="upload-historic-minutes"
        >
          Upload historic minutes
        </button>
      </div>

      <div className="module-list" data-testid="minutes-list">
        {sorted.map((m) => (
          <div className="module-row" key={m.id}>
            <div>
              <div className="module-row__title">{m.title}</div>
              <div className="module-row__meta">
                <span className="pill" style={{ marginRight: "0.5em" }}>
                  {meetingTypeLabels[m.meetingType]}
                </span>
                {m.meetingDate}
                {" · "}
                {m.source === "meeting_mode"
                  ? "Finalized in Meeting Mode"
                  : `Uploaded by ${m.uploadedBy}, ${m.uploadedAt}`}
              </div>
            </div>
            <button
              className="button button-secondary button-small"
              data-testid={`view-minutes-${m.id}`}
            >
              View PDF
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
