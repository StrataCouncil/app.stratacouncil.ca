/**
 * The zone as people say it: "PT", never "PDT" or "PST". The strata's own
 * zone (from its address); anything outside the table falls back to the
 * generic short name the browser knows ("PT", "GMT+1").
 */
export function zoneLabel(timezone: string): string {
  const known: Record<string, string> = {
    "America/Vancouver": "PT",
    "America/Edmonton": "MT",
    "America/Regina": "CST",
    "America/Winnipeg": "CT",
    "America/Toronto": "ET",
    "America/Halifax": "AT",
    "America/St_Johns": "NT",
  };
  if (known[timezone]) return known[timezone];
  try {
    const part = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, timeZoneName: "shortGeneric" })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName");
    return part?.value ?? timezone;
  } catch {
    return timezone;
  }
}

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
  return `${date} · ${time} ${zoneLabel(m.timezone)}`;
}
