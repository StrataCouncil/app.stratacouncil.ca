/**
 * The demo strata's calendar, worked out from the day the visitor arrives
 * so the strata never looks stale: last spring's AGM, two council meetings
 * already held (with minutes), and the next one coming up. Pure.
 */

const DAY = 86_400_000;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** A calendar date (no time zone): "2026-10-13". */
export type IsoDate = string;

function bcToday(now: Date): Date {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver" }).format(now).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

const iso = (d: Date): IsoDate => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const firstOfMonth = (d: Date, monthsLater = 0) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + monthsLater, 1));

/** The Tuesday on or before (direction -1) or on or after (+1) a date. */
function tuesday(d: Date, direction: -1 | 1): Date {
  let out = d;
  while (out.getUTCDay() !== 2) out = addDays(out, direction);
  return out;
}

export interface KitDates {
  today: IsoDate;
  /** The fiscal year the AGM budget covers. */
  fiscalStart: IsoDate;
  fiscalEnd: IsoDate;
  previousFiscalStart: IsoDate;
  agm: IsoDate;
  /** Council meetings already held, oldest first, and the next one. */
  meeting1: IsoDate;
  meeting2: IsoDate;
  upcoming: IsoDate;
  /** The meeting before meeting1, whose minutes it approved. */
  meeting0: IsoDate;
  /** Roof special levy instalments. */
  levyDue1: IsoDate;
  levyDue2: IsoDate;
  /** The month the latest financial statement covers (the last full month). */
  statementMonthStart: IsoDate;
  statementMonthEnd: IsoDate;
  /** The leak from unit 304 into 204. */
  leak: IsoDate;
  roofAssessment: IsoDate;
  tenderClose: IsoDate;
  depreciationReport: IsoDate;
  insuranceStart: IsoDate;
  insuranceEnd: IsoDate;
  parkingComplaint: IsoDate;
  parkingWarning: IsoDate;
  parkingResponse: IsoDate;
  barkingComplaint: IsoDate;
  evRequest: IsoDate;
  hearingRequest: IsoDate;
}

export function kitDates(now: Date = new Date()): KitDates {
  const today = bcToday(now);
  const agm = tuesday(addDays(today, -150), -1);
  const fiscalStart = firstOfMonth(agm, -1);
  const fiscalEnd = addDays(firstOfMonth(fiscalStart, 12), -1);
  const meeting2 = tuesday(addDays(today, -21), -1);
  const meeting1 = tuesday(addDays(today, -84), -1);
  const lastMonthStart = firstOfMonth(today, -1);
  return {
    today: iso(today),
    fiscalStart: iso(fiscalStart),
    fiscalEnd: iso(fiscalEnd),
    previousFiscalStart: iso(firstOfMonth(fiscalStart, -12)),
    agm: iso(agm),
    meeting0: iso(tuesday(addDays(meeting1, -35), -1)),
    meeting1: iso(meeting1),
    meeting2: iso(meeting2),
    upcoming: iso(tuesday(addDays(today, 6), 1)),
    levyDue1: iso(firstOfMonth(agm, 2)),
    levyDue2: iso(firstOfMonth(agm, 8)),
    statementMonthStart: iso(lastMonthStart),
    statementMonthEnd: iso(addDays(firstOfMonth(today), -1)),
    leak: iso(addDays(meeting2, -16)),
    roofAssessment: iso(addDays(agm, -70)),
    tenderClose: iso(addDays(meeting2, -9)),
    depreciationReport: iso(firstOfMonth(agm, -18)),
    insuranceStart: iso(firstOfMonth(today, -7)),
    insuranceEnd: iso(addDays(firstOfMonth(today, 5), -1)),
    parkingComplaint: iso(addDays(meeting1, -12)),
    parkingWarning: iso(addDays(meeting1, 3)),
    parkingResponse: iso(addDays(meeting2, 6)),
    barkingComplaint: iso(addDays(meeting2, -10)),
    evRequest: iso(addDays(meeting2, -5)),
    hearingRequest: iso(addDays(meeting2, 8)),
  };
}

/** "October 13, 2026" */
export function longDate(date: IsoDate): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** "October 2026" */
export function monthYear(date: IsoDate): string {
  const [y, m] = date.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** "2026" */
export const yearOf = (date: IsoDate) => date.slice(0, 4);

/** Whole months from one date to another (for "month 7 of 12"). */
export function monthsBetween(from: IsoDate, to: IsoDate): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}
