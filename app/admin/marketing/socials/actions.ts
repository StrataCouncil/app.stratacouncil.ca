"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { askClaudeJson, ClaudeRefusalError } from "@/lib/ai/claude";
import { requireSuperAdmin } from "@/lib/data/admin";
import { SOCIAL_BUCKET } from "@/lib/data/social";
import { PhotoError, searchPhotos, trackPhotoUse, type StockPhoto } from "@/lib/media/unsplash";
import { downloadClip, getClip, searchClips, VideoError, type StockClip } from "@/lib/media/pixabay";
import { builtInTemplate, builtInTemplates, isBuiltInRef, slidesFromTemplate, type PostTemplate } from "@/lib/social/templates";
import { createAdminClient } from "@/lib/supabase/admin";
import { DRAFT_SYSTEM, draftRequest, draftSchema, slideRewriteRequest, slideRewriteSchema, textRewriteRequest, textRewriteSchema } from "@/lib/social/draft";
import { cloneDesign, normalizeDesign, type SlideDesign } from "@/lib/social/design";
import {
  AUDIENCES,
  campaignSlug,
  DESTINATIONS,
  normalizeCaptions,
  normalizePhoto,
  normalizePostPatch,
  normalizeSlides,
  TEMPLATES,
  type Audience,
  type Destination,
  type SocialClip,
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
  revalidatePath("/admin/marketing/socials");
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

/** Rewrite one text box with the AI ("Rewrite with AI" in the editor). Nothing is saved until the editor saves. */
export async function rewriteSocialText(id: string, slides: unknown, index: number, text: string, instruction: string): Promise<Result<{ text: string }>> {
  if (!(await staffId()) || !isId(id)) return NOT_ALLOWED;
  const words = String(text ?? "").slice(0, 600);
  if (!words.trim()) return { ok: false, error: "There's no text to rewrite." };
  const { data } = await createAdminClient().from("social_posts").select("topic").eq("id", id).maybeSingle();
  if (!data) return { ok: false, error: "This post no longer exists." };
  const list = normalizeSlides(slides, id);
  try {
    const raw = await askClaudeJson<{ text: unknown }>({
      system: DRAFT_SYSTEM,
      messages: [{ role: "user", content: textRewriteRequest({ topic: data.topic as string, slides: list, index, text: words, instruction: String(instruction ?? "").slice(0, 500) }) }],
      schema: textRewriteSchema,
      effort: "low",
      maxTokens: 800,
    });
    const out = String(raw.text ?? "").replace(/\r\n?/g, "\n").trim().slice(0, 600);
    if (!out) return { ok: false, error: "The AI didn't return any text. Try again." };
    return { ok: true, text: out };
  } catch (err) {
    return aiError(err, "rewriteSocialText");
  }
}

// ── Saved layouts (0087) ───────────────────────────────────────────────

const NO_POST = "00000000-0000-0000-0000-000000000000";

export interface SocialLayout {
  id: string;
  name: string;
  design: SlideDesign;
}

/** Saved layouts, newest first. Uploaded photos aren't kept in a layout (they belong to one post). */
export async function listSocialLayouts(): Promise<Result<{ layouts: SocialLayout[] }>> {
  if (!(await staffId())) return NOT_ALLOWED;
  const { data, error } = await createAdminClient().from("social_layouts").select("id, name, design").order("created_at", { ascending: false }).limit(100);
  if (error) {
    console.error("[listSocialLayouts]", error.message);
    return { ok: false, error: "Couldn't load the saved layouts. Run migration 0087 if it hasn't been run." };
  }
  const layouts = (data ?? []).flatMap((r) => {
    const design = normalizeDesign(r.design, () => null);
    return design ? [{ id: r.id as string, name: r.name as string, design }] : [];
  });
  return { ok: true, layouts };
}

export async function saveSocialLayout(name: string, design: unknown): Promise<Result<{ layout: SocialLayout }>> {
  const userId = await staffId();
  if (!userId) return NOT_ALLOWED;
  const clean = String(name ?? "").trim().slice(0, 60);
  if (!clean) return { ok: false, error: "Give the layout a name." };
  // Unsplash photos come along (they're links); uploads stay with their
  // post (no post's folder matches the empty id, so they're dropped).
  const checked = normalizeDesign(design, (p) => normalizePhoto(p, NO_POST));
  if (!checked || checked.layers.length === 0) return { ok: false, error: "There's nothing on this slide to save." };
  const { data, error } = await createAdminClient().from("social_layouts").insert({ name: clean, design: cloneDesign(checked), created_by: userId }).select("id").single();
  if (error || !data) {
    console.error("[saveSocialLayout]", error?.message);
    return { ok: false, error: "Couldn't save the layout. Run migration 0087 if it hasn't been run." };
  }
  return { ok: true, layout: { id: data.id as string, name: clean, design: checked } };
}

export async function deleteSocialLayout(id: string): Promise<Result> {
  if (!(await staffId()) || !isId(id)) return NOT_ALLOWED;
  const { error } = await createAdminClient().from("social_layouts").delete().eq("id", id);
  if (error) return { ok: false, error: "Couldn't delete the layout." };
  return { ok: true };
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
const VIDEO_TYPES: Record<string, string> = { "video/mp4": "mp4", "video/quicktime": "mov" };
const MAX_PICTURE = 20 * 1024 * 1024;
/** The bucket's own limit (0088). */
const MAX_VIDEO = 200 * 1024 * 1024;

/** A one-time upload link into the post's folder: a picture (PNGs keep their transparency for cut-outs) or a video (MP4 or MOV). */
export async function createSocialUpload(id: string, file: { type: string; size: number }): Promise<Result<{ path: string; token: string }>> {
  if (!(await staffId()) || !isId(id)) return NOT_ALLOWED;
  const video = file.type in VIDEO_TYPES;
  const ext = PICTURE_TYPES[file.type] ?? VIDEO_TYPES[file.type];
  if (!ext) return { ok: false, error: "Use a PNG, JPEG, or WebP picture, or an MP4 or MOV video." };
  if (!(file.size > 0) || file.size > (video ? MAX_VIDEO : MAX_PICTURE)) return { ok: false, error: video ? "Videos can be up to 200 MB." : "Pictures can be up to 20 MB." };
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

// ── Stock video (Pixabay) ──────────────────────────────────────────────

export async function searchSocialClips(query: string, page: number): Promise<Result<{ clips: StockClip[]; totalPages: number }>> {
  if (!(await staffId())) return NOT_ALLOWED;
  try {
    return { ok: true, ...(await searchClips(query, Math.max(1, Math.min(25, Math.floor(page) || 1)))) };
  } catch (err) {
    if (err instanceof VideoError) return { ok: false, error: err.message };
    console.error("[searchSocialClips]", err instanceof Error ? err.message : err);
    return { ok: false, error: "Video search didn't work. Try again." };
  }
}

/**
 * Put a Pixabay clip on a slide: asked of Pixabay again by its id (the
 * browser only says which one), downloaded, and copied into the post's
 * folder, so the post never links to Pixabay's files.
 */
export async function copySocialClip(id: string, clipId: number): Promise<Result<{ clip: SocialClip }>> {
  if (!(await staffId()) || !isId(id)) return NOT_ALLOWED;
  const admin = createAdminClient();
  const { data: post } = await admin.from("social_posts").select("id").eq("id", id).maybeSingle();
  if (!post) return { ok: false, error: "This post no longer exists." };
  try {
    const stock = await getClip(Number(clipId));
    const file = await downloadClip(stock);
    const path = `${id}/${randomUUID()}.mp4`;
    const { error } = await admin.storage.from(SOCIAL_BUCKET).upload(path, file, { contentType: "video/mp4", upsert: false });
    if (error) {
      console.error("[copySocialClip] upload", error.message);
      return { ok: false, error: "Couldn't keep a copy of the clip. Run migration 0088 if it hasn't been run." };
    }
    const { data: signed } = await admin.storage.from(SOCIAL_BUCKET).createSignedUrl(path, 6 * 60 * 60);
    return {
      ok: true,
      clip: {
        path,
        src: signed?.signedUrl ?? "",
        duration: stock.duration,
        width: stock.width,
        height: stock.height,
        credit: { source: "pixabay", name: stock.user, pageUrl: stock.pageUrl },
      },
    };
  } catch (err) {
    if (err instanceof VideoError) return { ok: false, error: err.message };
    console.error("[copySocialClip]", err instanceof Error ? err.message : err);
    return { ok: false, error: "Couldn't use that clip. Try again." };
  }
}

// ── Post templates (0088) ──────────────────────────────────────────────

/** The template library: the built-in templates, then saved ones, newest first. */
export async function listSocialTemplates(): Promise<Result<{ templates: PostTemplate[]; savedError?: string }>> {
  if (!(await staffId())) return NOT_ALLOWED;
  const builtIns = builtInTemplates();
  const { data, error } = await createAdminClient()
    .from("social_templates")
    .select("id, name, description, slides, show_slide_numbers")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    console.error("[listSocialTemplates]", error.message);
    return { ok: true, templates: builtIns, savedError: "Couldn't load the saved templates. Run migration 0088 if it hasn't been run." };
  }
  const saved = (data ?? []).map((r) => ({
    ref: r.id as string,
    name: r.name as string,
    description: (r.description as string) ?? "",
    slides: normalizeSlides(r.slides, NO_POST),
    showSlideNumbers: (r.show_slide_numbers as boolean | null) ?? null,
    builtIn: false,
  }));
  return { ok: true, templates: [...builtIns, ...saved] };
}

/** Save a post's slides as a template. Uploaded photos and videos stay with their post (no post's folder matches the empty id). */
export async function saveSocialTemplate(input: { name: string; description: string; slides: unknown; showSlideNumbers: unknown }): Promise<Result<{ id: string }>> {
  const userId = await staffId();
  if (!userId) return NOT_ALLOWED;
  const name = String(input.name ?? "").trim().slice(0, 60);
  if (!name) return { ok: false, error: "Give the template a name." };
  const slides = normalizeSlides(input.slides, NO_POST);
  if (!slides.length) return { ok: false, error: "There are no slides to save." };
  const { data, error } = await createAdminClient()
    .from("social_templates")
    .insert({
      name,
      description: String(input.description ?? "").trim().slice(0, 200),
      slides: slidesFromTemplate(slides),
      show_slide_numbers: typeof input.showSlideNumbers === "boolean" ? input.showSlideNumbers : null,
      created_by: userId,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[saveSocialTemplate]", error?.message);
    return { ok: false, error: "Couldn't save the template. Run migration 0088 if it hasn't been run." };
  }
  revalidatePath("/admin/marketing/socials");
  return { ok: true, id: data.id as string };
}

export async function deleteSocialTemplate(id: string): Promise<Result> {
  if (!(await staffId()) || !isId(id)) return NOT_ALLOWED;
  const { error } = await createAdminClient().from("social_templates").delete().eq("id", id);
  if (error) return { ok: false, error: "Couldn't delete the template." };
  revalidatePath("/admin/marketing/socials");
  return { ok: true };
}

/** Start a post from a template: a copy with fresh ids, so editing the post leaves the template as it was. */
export async function createSocialPostFromTemplate(ref: string, destination: Destination): Promise<Result<{ id: string }>> {
  const userId = await staffId();
  if (!userId) return NOT_ALLOWED;
  let template: Pick<PostTemplate, "name" | "slides" | "showSlideNumbers"> | null = null;
  const builtIn = isBuiltInRef(String(ref ?? ""));
  if (builtIn) template = builtInTemplate(builtIn);
  else if (isId(String(ref ?? ""))) {
    const { data } = await createAdminClient().from("social_templates").select("name, slides, show_slide_numbers").eq("id", ref).maybeSingle();
    if (data) template = { name: data.name as string, slides: normalizeSlides(data.slides, NO_POST), showSlideNumbers: (data.show_slide_numbers as boolean | null) ?? null };
  }
  if (!template) return { ok: false, error: "That template no longer exists." };
  const id = randomUUID();
  const { error } = await createAdminClient()
    .from("social_posts")
    .insert({
      id,
      title: template.name.slice(0, 120),
      campaign: campaignSlug(template.name),
      template: "list",
      theme: "paper",
      destination: destination in DESTINATIONS ? destination : "home",
      topic: `From the template "${template.name}"`,
      audience: "council",
      slides: slidesFromTemplate(template.slides),
      captions: normalizeCaptions({}),
      show_slide_numbers: template.showSlideNumbers,
      created_by: userId,
    });
  if (error) {
    console.error("[createSocialPostFromTemplate]", error.message);
    return { ok: false, error: "Couldn't start the post. Try again." };
  }
  revalidatePath("/admin/marketing/socials");
  return { ok: true, id };
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
  revalidatePath("/admin/marketing/socials");
  return { ok: true };
}
