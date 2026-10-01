/** "Tue, Nov 4, 2026 · 7:00 p.m. PT" — the meeting's own date, time and zone, no conversion. */
export function formatMeetingWhen(m: { meetingDate: string; startTime: string | null; timezone: string }) {
  const [y, mo, d] = m.meetingDate.split("-").map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d)).toLocaleDateString("en-CA", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  if (!m.startTime) return date;
  const [h, min] = m.startTime.split(":").map(Number);
  const time = `${((h + 11) % 12) + 1}:${String(min).padStart(2, "0")} ${h < 12 ? "a.m." : "p.m."}`;
  const zone = { "America/Vancouver": "PT", "America/Edmonton": "MT", "America/Winnipeg": "CT", "America/Toronto": "ET", "America/Halifax": "AT", "America/St_Johns": "NT" }[m.timezone] ?? m.timezone;
  return `${date} · ${time} ${zone}`;
}
