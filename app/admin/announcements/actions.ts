"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/data/admin";
import { isAnnouncementCategory } from "@/lib/announcement-categories";

/** Announcements on the home page and every strata's Overview (0028, 0031). Super Admins only; RLS enforces it too. */
export type AnnouncementResult = { ok: true } | { ok: false; error: string };

const clean = (v: FormDataEntryValue | null, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export async function createAnnouncement(_prev: AnnouncementResult | null, formData: FormData): Promise<AnnouncementResult> {
  const auth = await requireSuperAdmin();
  if (!auth) return { ok: false, error: "Super Admins only." };

  const title = clean(formData.get("title"), 120);
  const body = String(formData.get("body") ?? "").trim().slice(0, 600);
  const linkUrl = clean(formData.get("link_url"), 500);
  const linkLabel = clean(formData.get("link_label"), 40);
  const audience = formData.get("audience") === "admins" ? "admins" : "everyone";
  const ends = clean(formData.get("expires_on"), 10);
  const rawCategory = formData.get("category");
  const category = isAnnouncementCategory(rawCategory) ? rawCategory : "general";

  if (!title) return { ok: false, error: "Give it a title." };
  if (!body) return { ok: false, error: "Write the announcement." };
  // An outside address (https://) or a page in the app (/training).
  if (linkUrl && !/^(https:\/\/\S+|\/(?!\/)\S*)$/.test(linkUrl)) {
    return { ok: false, error: "Links start with https://, or with / for a page in the app (like /training)." };
  }
  if (ends && !/^\d{4}-\d{2}-\d{2}$/.test(ends)) return { ok: false, error: "Choose a valid end date." };
  const expiresAt = ends ? endOfDayInBC(ends).toISOString() : null;
  if (expiresAt && new Date(expiresAt) <= new Date()) return { ok: false, error: "The end date has to be in the future." };

  const { error } = await auth.supabase.from("announcements").insert({
    title,
    body,
    link_url: linkUrl || null,
    link_label: linkUrl ? linkLabel || "Read more" : null,
    audience,
    category,
    expires_at: expiresAt,
    created_by: auth.user.id,
  });
  if (error) {
    console.error("[createAnnouncement]", error.message);
    return { ok: false, error: "Couldn't post the announcement. Please try again." };
  }
  revalidatePath("/admin/announcements");
  revalidatePath("/");
  revalidatePath("/strata/[corpId]", "page");
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
export async function endAnnouncement(id: string) {
  const auth = await requireSuperAdmin();
  if (!auth) return;
  await auth.supabase.from("announcements").update({ expires_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/admin/announcements");
  revalidatePath("/");
  revalidatePath("/strata/[corpId]", "page");
}

export async function deleteAnnouncement(id: string) {
  const auth = await requireSuperAdmin();
  if (!auth) return;
  await auth.supabase.from("announcements").delete().eq("id", id);
  revalidatePath("/admin/announcements");
  revalidatePath("/");
  revalidatePath("/strata/[corpId]", "page");
}
