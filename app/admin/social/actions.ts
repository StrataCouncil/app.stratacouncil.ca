"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { askClaudeJson, ClaudeRefusalError } from "@/lib/ai/claude";
import { requireSuperAdmin } from "@/lib/data/admin";
import { SOCIAL_BUCKET } from "@/lib/data/social";
import { PhotoError, searchPhotos, trackPhotoUse, type StockPhoto } from "@/lib/media/unsplash";
import { createAdminClient } from "@/lib/supabase/admin";
import { DRAFT_SYSTEM, draftRequest, draftSchema, slideRewriteRequest, slideRewriteSchema } from "@/lib/social/draft";
import {
  AUDIENCES,
  campaignSlug,
  DESTINATIONS,
  normalizeCaptions,
  normalizePostPatch,
  normalizeSlides,
  TEMPLATES,
  type Audience,
  type Destination,
  type SocialSlide,
  type Template,
} from "@/lib/social/post";

/**
 * The Social tab's writes (0068). Super Admins only (two-step verified,
 * requireSuperAdmin); everything goes through the service role after that
 * check. The AI sees only the topic and the post's own text.
 */

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const NOT_ALLOWED = { ok: false as const, error: "Only platform staff can do this." };
const isId = (id: string) => /^[0-9a-f-]{36}$/i.test(id);

async function staffId() {
  const ctx = await requireSuperAdmin();
  return ctx?.user.id ?? null;
}

function aiError(err: unknown, what: string) {
  console.error(`[${what}]`, err instanceof Error ? err.message : err);
  if (err instanceof ClaudeRefusalError) return { ok: false as const, error: "The AI wouldn't write that. Try rewording the topic." };
  return { ok: false as const, error: "The AI didn't finish. Try again in a moment." };
}

/** Draft a new post with the AI from a topic, and save it. */
export async function createSocialPost(input: {
  topic: string;
  audience: Audience;
  template: Template;
  slideCount: number;
  destination: Destination;
}): Promise<Result<{ id: string }>> {
  const userId = await staffId();
  if (!userId) return NOT_ALLOWED;
  const topic = String(input.topic ?? "").trim().slice(0, 2000);
  if (topic.length < 5) return { ok: false, error: "Describe what the post is about." };
  const audience: Audience = (AUDIENCES as readonly string[]).includes(input.audience) ? input.audience : "council";
  const template: Template = (TEMPLATES as readonly string[]).includes(input.template) ? input.template : "list";
  const destination: Destination = input.destination in DESTINATIONS ? input.destination : "home";

  let draft: { title: string; campaign: string; slides: unknown[]; captions: Record<string, string>; hashtags: Record<string, string[]> };
  try {
    draft = await askClaudeJson({
      system: DRAFT_SYSTEM,
      messages: [{ role: "user", content: draftRequest({ topic, audience, template, slideCount: input.slideCount, destination }) }],
      schema: draftSchema,
      effort: "medium",
      maxTokens: 8000,
    });
  } catch (err) {
    return aiError(err, "createSocialPost");
  }

  const id = randomUUID();
  const { error } = await createAdminClient()
    .from("social_posts")
    .insert({
      id,
      title: String(draft.title ?? "").slice(0, 120) || topic.slice(0, 120),
      campaign: campaignSlug(draft.campaign || draft.title || topic),
      template,
      theme: "paper",
      destination,
      topic,
      audience,
      slides: normalizeSlides(draft.slides, id),
      captions: normalizeCaptions({ text: draft.captions, hashtags: draft.hashtags }),
      created_by: userId,
    });
  if (error) {
    console.error("[createSocialPost] insert", error.message);
    return { ok: false, error: "The draft was written but couldn't be saved. Try again." };
  }
  revalidatePath("/admin/social");
  return { ok: true, id };
}

/** Save the editor's changes. */
export async function saveSocialPost(id: string, patch: unknown): Promise<Result<{ updatedAt: string }>> {
  if (!(await staffId()) || !isId(id)) return NOT_ALLOWED;
  const changes = normalizePostPatch(patch, id);
  if (changes.campaign !== undefined && !changes.campaign) return { ok: false, error: "Give the post a campaign name." };
  const updatedAt = new Date().toISOString();
  const { error, count } = await createAdminClient()
    .from("social_posts")
    .update({ ...changes, updated_at: updatedAt }, { count: "exact" })
    .eq("id", id);
  if (error) {
    console.error("[saveSocialPost]", error.message);
    return { ok: false, error: "Couldn't save. Your changes are kept on this screen; try again." };
  }
  if (!count) return { ok: false, error: "This post no longer exists." };
  return { ok: true, updatedAt };
}

/** Rewrite one slide with the AI, keeping the rest. Nothing is saved until the editor saves. */
export async function redraftSocialSlide(id: string, slides: unknown, index: number, instruction: string): Promise<Result<{ slide: SocialSlide }>> {
  if (!(await staffId()) || !isId(id)) return NOT_ALLOWED;
  const { data } = await createAdminClient().from("social_posts").select("topic, template").eq("id", id).maybeSingle();
  if (!data) return { ok: false, error: "This post no longer exists." };
  const list = normalizeSlides(slides, id);
  const current = list[index];
  if (!current) return { ok: false, error: "That slide no longer exists." };
  try {
    const raw = await askClaudeJson<{ slide: unknown }>({
      system: DRAFT_SYSTEM,
      messages: [
        {
          role: "user",
          content: slideRewriteRequest({
            topic: data.topic as string,
            template: data.template as Template,
            slides: list,
            index,
            instruction: String(instruction ?? "").slice(0, 500),
          }),
        },
      ],
      schema: slideRewriteSchema,
      effort: "low",
      maxTokens: 2000,
    });
    const [rewritten] = normalizeSlides([raw.slide], id);
    if (!rewritten) return { ok: false, error: "The AI didn't return a slide. Try again." };
    // Same slide, same photo: only the words change.
    return { ok: true, slide: { ...rewritten, id: current.id, kind: current.kind, photo: current.photo } };
  } catch (err) {
    return aiError(err, "redraftSocialSlide");
  }
}

export async function searchSocialPhotos(query: string, page: number): Promise<Result<{ photos: StockPhoto[]; totalPages: number }>> {
  if (!(await staffId())) return NOT_ALLOWED;
  try {
    return { ok: true, ...(await searchPhotos(query, Math.max(1, Math.min(50, Math.floor(page) || 1)))) };
  } catch (err) {
    if (err instanceof PhotoError) return { ok: false, error: err.message };
    console.error("[searchSocialPhotos]", err instanceof Error ? err.message : err);
    return { ok: false, error: "Photo search didn't work. Try again." };
  }
}

/** A photo was put on a slide: Unsplash asks to be told. */
export async function noteSocialPhotoUse(downloadLocation: string): Promise<Result> {
  if (!(await staffId())) return NOT_ALLOWED;
  try {
    await trackPhotoUse(downloadLocation);
    return { ok: true };
  } catch (err) {
    if (err instanceof PhotoError) return { ok: false, error: err.message };
    return { ok: false, error: "Couldn't use that photo." };
  }
}

const PICTURE_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const MAX_PICTURE = 20 * 1024 * 1024;

/** A one-time upload link into the post's folder; PNGs keep their transparency for cut-outs. */
export async function createSocialUpload(id: string, file: { type: string; size: number }): Promise<Result<{ path: string; token: string }>> {
  if (!(await staffId()) || !isId(id)) return NOT_ALLOWED;
  const ext = PICTURE_TYPES[file.type];
  if (!ext) return { ok: false, error: "Use a PNG, JPEG or WebP picture." };
  if (!(file.size > 0) || file.size > MAX_PICTURE) return { ok: false, error: "Pictures can be up to 20 MB." };
  const admin = createAdminClient();
  const { data: post } = await admin.from("social_posts").select("id").eq("id", id).maybeSingle();
  if (!post) return { ok: false, error: "This post no longer exists." };
  const { data, error } = await admin.storage.from(SOCIAL_BUCKET).createSignedUploadUrl(`${id}/${randomUUID()}.${ext}`);
  if (error || !data) {
    console.error("[createSocialUpload]", error?.message);
    return { ok: false, error: "Couldn't start the upload." };
  }
  return { ok: true, path: data.path, token: data.token };
}

/** A signed link to show a just-uploaded picture. */
export async function signSocialUpload(id: string, path: string): Promise<Result<{ src: string }>> {
  if (!(await staffId()) || !isId(id)) return NOT_ALLOWED;
  if (!path.startsWith(`${id}/`) || path.includes("..")) return { ok: false, error: "That file isn't in this post's folder." };
  const { data, error } = await createAdminClient().storage.from(SOCIAL_BUCKET).createSignedUrl(path, 6 * 60 * 60);
  if (error || !data) return { ok: false, error: "Couldn't load the picture." };
  return { ok: true, src: data.signedUrl };
}

/** Delete a post for good: its uploaded pictures, then its row. */
export async function deleteSocialPost(id: string): Promise<Result> {
  if (!(await staffId()) || !isId(id)) return NOT_ALLOWED;
  const admin = createAdminClient();
  const bucket = admin.storage.from(SOCIAL_BUCKET);
  for (let round = 0; round < 20; round++) {
    const { data: files, error } = await bucket.list(id, { limit: 100 });
    if (error) {
      console.error("[deleteSocialPost] list", error.message);
      return { ok: false, error: "Couldn't delete the post's pictures. Try again." };
    }
    if (!files?.length) break;
    const { error: removeError } = await bucket.remove(files.map((f) => `${id}/${f.name}`));
    if (removeError) {
      console.error("[deleteSocialPost] remove", removeError.message);
      return { ok: false, error: "Couldn't delete the post's pictures. Try again." };
    }
  }
  const { error } = await admin.from("social_posts").delete().eq("id", id);
  if (error) {
    console.error("[deleteSocialPost]", error.message);
    return { ok: false, error: "The pictures are gone, but the post couldn't be deleted. Try again." };
  }
  revalidatePath("/admin/social");
  return { ok: true };
}
