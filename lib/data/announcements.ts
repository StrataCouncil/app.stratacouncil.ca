import { createClient } from "@/lib/supabase/server";
import { requireSuperAdmin } from "@/lib/data/admin";
import { isAnnouncementCategory, type AnnouncementCategory } from "@/lib/announcement-categories";

export interface Announcement {
  id: string;
  title: string;
  body: string;
  linkUrl: string | null;
  linkLabel: string | null;
  audience: "everyone" | "admins";
  category: AnnouncementCategory;
  publishedAt: string;
  expiresAt: string | null;
}

const columns = "id, title, body, link_url, link_label, audience, category, published_at, expires_at";

type Row = {
  id: string;
  title: string;
  body: string;
  link_url: string | null;
  link_label: string | null;
  audience: string;
  category: string | null;
  published_at: string;
  expires_at: string | null;
};

const toAnnouncement = (r: Row): Announcement => ({
  id: r.id,
  title: r.title,
  body: r.body,
  linkUrl: r.link_url,
  linkLabel: r.link_label,
  audience: r.audience === "admins" ? "admins" : "everyone",
  category: isAnnouncementCategory(r.category) ? r.category : "general",
  publishedAt: r.published_at,
  expiresAt: r.expires_at,
});

/**
 * The newest announcements for the signed-in person (RLS: current, and
 * meant for them). Shown on the home page and on every strata's Overview.
 */
export async function getCurrentAnnouncements(limit = 3): Promise<Announcement[]> {
  const supabase = await createClient();
  const now = new Date().toISOString();
  // RLS already limits this to current announcements, except for Super
  // Admins, who can read them all; the home page shows only current ones.
  const { data, error } = await supabase
    .from("announcements")
    .select(columns)
    .lte("published_at", now)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .order("published_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[announcements]", error.message);
    return [];
  }
  return (data as Row[]).map(toAnnouncement);
}

/** Every announcement, current or ended, for the Super Admin page. Null for anyone else. */
export async function listAllAnnouncements(): Promise<Announcement[] | null> {
  const auth = await requireSuperAdmin();
  if (!auth) return null;
  const { data, error } = await auth.supabase.from("announcements").select(columns).order("published_at", { ascending: false }).limit(100);
  if (error) {
    console.error("[announcements]", error.message);
    return [];
  }
  return (data as Row[]).map(toAnnouncement);
}
