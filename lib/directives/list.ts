/**
 * The Directives list (0097): order, filters, and labels. Pure, shared by
 * server and browser; unit-tested in tests/directives.test.ts.
 */

export type ListFilter = "open" | "done" | "all" | "mine";

export interface ListDirective {
  id: string;
  title: string;
  detail: string;
  status: "open" | "done" | "cancelled";
  dueDate: string | null;
  createdAt: string;
  closedAt: string | null;
  assigneeKind: "none" | "manager" | "person";
  assigneeUserId: string | null;
  assigneeName: string;
}

/** Open and past its due date, by today's date in PT (YYYY-MM-DD). */
export function isOverdue(d: Pick<ListDirective, "status" | "dueDate">, today: string): boolean {
  return d.status === "open" && d.dueDate !== null && d.dueDate < today;
}

/** Open first (overdue, then by due date, undated last, newest first among those); then closed, latest first. */
export function sortDirectives<T extends ListDirective>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const ao = a.status === "open" ? 0 : 1;
    const bo = b.status === "open" ? 0 : 1;
    if (ao !== bo) return ao - bo;
    if (ao === 0) {
      if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
      if (a.dueDate && !b.dueDate) return -1;
      if (!a.dueDate && b.dueDate) return 1;
      return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
    }
    const ac = a.closedAt ?? a.createdAt;
    const bc = b.closedAt ?? b.createdAt;
    return ac < bc ? 1 : ac > bc ? -1 : 0;
  });
}

/** Assigned to me: by name, or "the manager" when I'm a manager. */
export function isMine(d: ListDirective, me: { userId: string; isManager: boolean }): boolean {
  return (d.assigneeKind === "person" && d.assigneeUserId === me.userId) || (d.assigneeKind === "manager" && me.isManager);
}

export function filterDirectives<T extends ListDirective>(list: T[], filter: ListFilter, me: { userId: string; isManager: boolean }, query = ""): T[] {
  const q = query.trim().toLowerCase();
  return list.filter((d) => {
    if (filter === "open" && d.status !== "open") return false;
    if (filter === "done" && d.status === "open") return false;
    if (filter === "mine" && (d.status !== "open" || !isMine(d, me))) return false;
    if (q && !`${d.title} ${d.detail} ${d.assigneeName}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

export function assigneeLabel(d: Pick<ListDirective, "assigneeKind" | "assigneeName">): string {
  if (d.assigneeKind === "manager") return "The manager";
  if (d.assigneeKind === "person") return d.assigneeName || "A member";
  return "Not assigned";
}

/** "2026-03-04" to "Mar 4, 2026", without any time zone shift. */
export function dayLabel(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return date;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}
