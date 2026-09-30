import { StrataSphereNav } from "@/components/StrataSphereNav";

/**
 * Calendar — schema exists (doc01 §7 item 21) but the UI and AI context
 * wiring are explicitly deferred past V1. Locked placeholder, not a
 * subscribe prompt.
 */
export default function CalendarPage() {
  return (
    <>
      <StrataSphereNav active="calendar" />
      <h2 style={{ marginBottom: "1rem" }}>Calendar</h2>
      <div className="lock-panel">
        <h2>Coming soon</h2>
        <p>
          AGM dates, levy due dates, insurance renewals and depreciation
          report cycles, all in one place. Not yet available.
        </p>
      </div>
    </>
  );
}
