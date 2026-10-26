import { requireSuperAdmin } from "@/lib/data/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { toPost, type SocialPost } from "@/lib/social/post";

/**
 * Social posts for the Super Admin console (0068). Service role, after
 * requireSuperAdmin(). Uploaded photos are private; a post is loaded with
 * short-lived signed links for them, never saved.
 */

export const SOCIAL_BUCKET = "social-media";
export const SOCIAL_COLUMNS = "id, title, campaign, template, theme, destination, topic, audience, slides, captions, created_at, updated_at";
/** Signed links last long enough for an editing session; the editor asks again when it reloads. */
const SIGNED_SECONDS = 6 * 60 * 60;

export interface SocialPostSummary {
  id: string;
  title: string;
  campaign: string;
  slideCount: number;
  updatedAt: string;
}

export async function getSocialPosts(): Promise<SocialPostSummary[]> {
  if (!(await requireSuperAdmin())) return [];
  const { data, error } = await createAdminClient()
    .from("social_posts")
    .select("id, title, campaign, slides, updated_at")
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) console.error("[getSocialPosts]", error.message);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    title: (r.title as string) || "Untitled post",
    campaign: r.campaign as string,
    slideCount: Array.isArray(r.slides) ? r.slides.length : 0,
    updatedAt: r.updated_at as string,
  }));
}

export async function getSocialPost(id: string): Promise<SocialPost | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id) || !(await requireSuperAdmin())) return null;
  const admin = createAdminClient();
  const { data } = await admin.from("social_posts").select(SOCIAL_COLUMNS).eq("id", id).maybeSingle();
  if (!data) return null;
  return withSignedPhotos(toPost(data));
}

/** Fill in signed links for uploaded photos. */
export async function withSignedPhotos(post: SocialPost): Promise<SocialPost> {
  const paths = post.slides.map((s) => s.photo?.path).filter((p): p is string => Boolean(p));
  if (!paths.length) return post;
  const { data } = await createAdminClient().storage.from(SOCIAL_BUCKET).createSignedUrls(paths, SIGNED_SECONDS);
  const urls = new Map((data ?? []).filter((d) => d.signedUrl && d.path).map((d) => [d.path as string, d.signedUrl]));
  return {
    ...post,
    slides: post.slides.map((s) => (s.photo?.path ? { ...s, photo: { ...s.photo, src: urls.get(s.photo.path) ?? "" } } : s)),
  };
}
