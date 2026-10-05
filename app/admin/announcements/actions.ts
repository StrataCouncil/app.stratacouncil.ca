"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/data/admin";
import { isAnnouncementCategory } from "@/lib/announcement-categories";

/**
 * Announcements on the Home page and/or every strata's Overview (0028,
 * 0031, 0032). Super Admins only; RLS enforces it too. Every action
 * returns a result the page shows, so nothing fails silently.
 */
export type AnnouncementResult = { ok: true } | { ok: false; error: string };

const clean = (v: FormDataEntryValue | null, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

type Fields = {
  title: string;
  body: string;
  link_url: string | null;
  link_label: string | null;
  audience: "everyone" | "admins";
  category: string;
  show_on_home: boolean;
  show_on_overview: boolean;
  expires_at: string | null;
};

/** The form's fields, checked. `allowPastEnd` lets an edit keep an ended announcement ended. */
function readFields(formData: FormData, allowPastEnd: boolean): { ok: true; fields: Fields } | { ok: false; error: string } {
  const title = clean(formData.get("title"), 120);
  const body = String(formData.get("body") ?? "").trim().slice(0, 600);
  const linkUrl = clean(formData.get("link_url"), 500);
  const linkLabel = clean(formData.get("link_label"), 40);
  const ends = clean(formData.get("expires_on"), 10);
  const rawCategory = formData.get("category");
  const showOnHome = formData.get("show_on_home") === "on";
  const showOnOverview = formData.get("show_on_overview") === "on";

  if (!title) return { ok: false, error: "Give it a title." };
  if (!body) return { ok: false, error: "Write the announcement." };
  if (!showOnHome && !showOnOverview) return { ok: false, error: "Choose where it shows: the Home page, Stratasphere Overview, or both." };
  // An outside address (https://) or a page in the app (/training).
  if (linkUrl && !/^(https:\/\/\S+|\/(?!\/)\S*)$/.test(linkUrl)) {
    return { ok: false, error: "Links start with https://, or with / for a page in the app (like /training)." };
  }
  if (ends && !/^\d{4}-\d{2}-\d{2}$/.test(ends)) return { ok: false, error: "Choose a valid end date." };
  const expiresAt = ends ? endOfDayInBC(ends).toISOString() : null;
  if (expiresAt && !allowPastEnd && new Date(expiresAt) <= new Date()) {
    return { ok: false, error: "The \"Show until\" date has to be today or later." };
  }
  return {
    ok: true,
    fields: {
      title,
      body,
      link_url: linkUrl || null,
      link_label: linkUrl ? linkLabel || "Read more" : null,
      audience: formData.get("audience") === "admins" ? "admins" : "everyone",
      category: isAnnouncementCategory(rawCategory) ? rawCategory : "general",
      show_on_home: showOnHome,
      show_on_overview: showOnOverview,
      expires_at: expiresAt,
    },
  };
}

function refresh() {
  revalidatePath("/admin/announcements");
  revalidatePath("/");
  revalidatePath("/strata/[corpId]", "page");
}

/** The database's own reason, for the Super Admin who's posting. */
const failed = (what: string, message: string): AnnouncementResult => ({ ok: false, error: `Couldn't ${what}: ${message}` });

export async function createAnnouncement(_prev: AnnouncementResult | null, formData: FormData): Promise<AnnouncementResult> {
  const auth = await requireSuperAdmin();
  if (!auth) return { ok: false, error: "Super Admins only. Try signing in again." };
  const read = readFields(formData, false);
  if (!read.ok) return read;

  const { error } = await auth.supabase.from("announcements").insert({ ...read.fields, created_by: auth.user.id });
  if (error) {
    console.error("[createAnnouncement]", error.message);
    return failed("post it", error.message);
  }
  refresh();
  return { ok: true };
}

export async function updateAnnouncement(id: string, _prev: AnnouncementResult | null, formData: FormData): Promise<AnnouncementResult> {
  const auth = await requireSuperAdmin();
  if (!auth) return { ok: false, error: "Super Admins only. Try signing in again." };
  const read = readFields(formData, true);
  if (!read.ok) return read;

  const { data, error } = await auth.supabase.from("announcements").update(read.fields).eq("id", id).select("id");
  if (error) {
    console.error("[updateAnnouncement]", error.message);
    return failed("save it", error.message);
  }
  if (!data?.length) return { ok: false, error: "That announcement no longer exists. Refresh the page." };
  refresh();
  return { ok: true };
}

/** 23:59:59 on that date in British Columbia, whether it's standard or daylight time. */
function endOfDayInBC(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  for (const offsetHours of [7, 8]) {
    const candidate = new Date(Date.UTC(y, m - 1, d, 23 + offsetHours, 59, 59));
    const hour = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver", hour: "2-digit", hourCycle: "h23" }).format(candidate);
    if (hour === "23") return candidate;
  }
  return new Date(Date.UTC(y, m - 1, d + 1, 7, 59, 59));
}

/** Take an announcement down now (kept, marked ended). */
export async function endAnnouncement(id: string): Promise<AnnouncementResult> {
  const auth = await requireSuperAdmin();
  if (!auth) return { ok: false, error: "Super Admins only. Try signing in again." };
  const { error } = await auth.supabase.from("announcements").update({ expires_at: new Date().toISOString() }).eq("id", id);
  if (error) return failed("take it down", error.message);
  refresh();
  return { ok: true };
}

/** Show an ended announcement again, with no end date. */
export async function restoreAnnouncement(id: string): Promise<AnnouncementResult> {
  const auth = await requireSuperAdmin();
  if (!auth) return { ok: false, error: "Super Admins only. Try signing in again." };
  const { error } = await auth.supabase.from("announcements").update({ expires_at: null }).eq("id", id);
  if (error) return failed("show it again", error.message);
  refresh();
  return { ok: true };
}

export async function deleteAnnouncement(id: string): Promise<AnnouncementResult> {
  const auth = await requireSuperAdmin();
  if (!auth) return { ok: false, error: "Super Admins only. Try signing in again." };
  const { error } = await auth.supabase.from("announcements").delete().eq("id", id);
  if (error) return failed("delete it", error.message);
  refresh();
  return { ok: true };
}
