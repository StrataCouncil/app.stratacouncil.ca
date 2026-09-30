/**
 * SendOtpState's type and initial value, split out from lib/auth/actions.ts.
 *
 * Next.js 15.5 enforces that a "use server" file may only export async
 * functions — nothing else, not even a plain constant or a type. actions.ts
 * is a "use server" file (it exports real Server Actions), so
 * initialSendOtpState — a plain object, not a function — can't live there
 * any more; it broke the login/signup pages with "A 'use server' file can
 * only export async functions, found object." This file has no "use server"
 * directive, so it's free to export whatever plain values client components
 * need alongside the actual Server Actions in actions.ts.
 */
export type SendOtpState = {
  status: "idle" | "sent" | "error";
  email?: string;
  message?: string;
};

export const initialSendOtpState: SendOtpState = { status: "idle" };
