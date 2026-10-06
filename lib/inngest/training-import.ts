import { NonRetriableError } from "inngest";
import type Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import { askClaudeJson } from "@/lib/ai/claude";
import { extractDocumentText } from "@/lib/kb/extract";
import { stripForLibrary } from "@/lib/kb/privacy";
import { titleFromFileName } from "@/lib/legislation";
import { inngest, TRAINING_FACT_CHECK_EVENT, TRAINING_IMPORT_BUILD_EVENT, TRAINING_IMPORT_PLAN_EVENT } from "@/lib/inngest/client";
import {
  assembleModule,
  BUILDER_SYSTEM,
  curriculumPlanRequest,
  MAX_SOURCE_CHARS,
  normalizePlan,
  parseSources,
  pinToCurriculum,
  PLAN_INSTRUCTIONS,
  planSchema,
  SECTION_INSTRUCTIONS,
  sectionSchema,
  toScreens,
  TRACK_CODES,
  TRACK_DESCRIPTIONS,
  type CurriculumTarget,
  type ImportPlan,
  type PlannedModule,
} from "@/lib/training/ai";
import { normalizeModuleContent, type Screen } from "@/lib/training/content";
import { passagesAsSources } from "@/lib/training/library";
import { loadPassages } from "@/lib/training/library-server";

import { TRAINING_IMPORT_BUCKET } from "@/lib/training/ai";

/**
 * The AI module builder's background jobs (0034).
 *
 * Plan: read the document on our own servers, strip personal information
 * (the same rule as the Library), and have the AI break it into proposed
 * modules for a Super Admin to review.
 *
 * Build: write each chosen module one section at a time (each section is
 * its own step, so no single call runs long), then save the module as an
 * unpublished draft marked as AI-drafted.
 *
 * The document goes in the system prompt behind a cache breakpoint, so
 * every call for one import after the first reads it from the cache.
 */
export const planTrainingImport = inngest.createFunction(
  {
    id: "training-import-plan",
    triggers: [{ event: TRAINING_IMPORT_PLAN_EVENT }],
    retries: 2,
    concurrency: { key: "event.data.importId", limit: 1 },
    onFailure: async ({ event, error }) => markFailed((event.data.event.data as { importId?: string }).importId, error),
  },
  async ({ event, step }) => {
    const id = (event.data as { importId: string }).importId;

    const read = await step.run("read", async () => {
      const admin = createAdminClient();
      const { data: imp } = await admin.from("training_imports").select("id, sources, reference_chunk_ids").eq("id", id).maybeSingle();
      if (!imp) return { status: "gone" as const };
      await setStatus(id, "reading");

      const sources = parseSources(imp.sources);
      const referenceIds = (imp.reference_chunk_ids as string[] | null) ?? [];
      if (!sources.length && !referenceIds.length) {
        await setStatus(id, "not_readable", "No documents were attached.");
        return { status: "stopped" as const };
      }
      const parts: string[] = [];
      for (const src of sources) {
        let title = "";
        let text = "";
        let kind = "guidance";
        if (src.kind === "library") {
          const { data: doc } = await admin
            .from("legislation_documents")
            .select("title, kind, document_text")
            .eq("id", src.legislationId)
            .maybeSingle();
          if (!doc?.document_text) {
            await setStatus(id, "needs_text", `"${src.title}" has no text yet. Index it in the Legislation library first, then try again.`);
            return { status: "stopped" as const };
          }
          title = doc.title;
          kind = doc.kind;
          // Acts and regulations are public law and go as written; guidance is stripped (stripForLibrary).
          text = doc.kind === "guidance" ? stripForLibrary(doc.document_text) : doc.document_text;
        } else {
          const { data, error } = await admin.storage.from(TRAINING_IMPORT_BUCKET).download(src.path);
          if (error || !data) throw new Error(`Couldn't read ${src.fileName}: ${error?.message ?? "missing"}`);
          const result = await extractDocumentText(new Uint8Array(await data.arrayBuffer()), src.fileName, src.mimeType);
          if (result.status === "needs_text") {
            await setStatus(id, "needs_text", `${src.fileName} looks like a scanned document with no text layer. Upload a version with selectable text.`);
            return { status: "stopped" as const };
          }
          if (result.status === "unsupported") {
            await setStatus(id, "not_readable", `${src.fileName}: ${result.reason}`);
            return { status: "stopped" as const };
          }
          title = titleFromFileName(src.fileName);
          text = stripForLibrary(result.text);
        }
        if (text.trim()) parts.push(`<source_document title="${title.replace(/"/g, "'")}" kind="${kind}">\n${text}\n</source_document>`);
      }
      // Library passages (0037): Act and Regulation sections as written; guidance was stripped when it was indexed.
      if (referenceIds.length) {
        const passages = await loadPassages(referenceIds);
        if (!passages.length && !parts.length) {
          await setStatus(id, "not_readable", "The library passages chosen for this build are no longer in the library.");
          return { status: "stopped" as const };
        }
        if (passages.length) parts.unshift(passagesAsSources(passages));
      }
      const combined = parts.join("\n\n");
      if (!combined.trim()) {
        await setStatus(id, "needs_text", "No text could be read from these documents.");
        return { status: "stopped" as const };
      }
      if (combined.length > MAX_SOURCE_CHARS) {
        await setStatus(id, "not_readable", "These documents are too long to build from in one go. Split them into smaller imports.");
        return { status: "stopped" as const };
      }
      await admin.from("training_imports").update({ source_text: combined, status: "planning", error: null, updated_at: now() }).eq("id", id);
      return { status: "ok" as const };
    });
    if (read.status !== "ok") return read;

    return step.run("plan", async () => {
      const imp = await loadImport(id);
      const target = imp.moduleId ? await curriculumTarget(imp.moduleId) : null;
      const trackNote = imp.trackCode
        ? `Put every module in the ${imp.trackCode} track (${TRACK_DESCRIPTIONS[imp.trackCode as keyof typeof TRACK_DESCRIPTIONS] ?? ""}).`
        : "Choose the best track for each module.";
      const request = target
        ? curriculumPlanRequest(target.target, target.others, imp.instructions)
        : [PLAN_INSTRUCTIONS, trackNote, imp.instructions ? `Notes from the author:\n${imp.instructions}` : ""].filter(Boolean).join("\n\n");
      const raw = await askClaudeJson<unknown>({
        system: systemFor(imp),
        messages: [{ role: "user", content: request }],
        schema: planSchema,
        effort: "high",
        maxTokens: 32000,
      });
      let plan = normalizePlan(raw);
      if (!plan.modules.length) throw new NonRetriableError("The AI didn't find anything to build modules from in this document.");
      if (target) plan = pinToCurriculum(plan, target.target);
      else if (imp.trackCode) plan.modules = plan.modules.map((m) => ({ ...m, trackCode: imp.trackCode as PlannedModule["trackCode"] }));
      await createAdminClient()
        .from("training_imports")
        .update({ plan, status: "planned", error: null, updated_at: now() })
        .eq("id", id);
      return { status: "planned", modules: plan.modules.length };
    });
  }
);

export const buildTrainingImport = inngest.createFunction(
  {
    id: "training-import-build",
    triggers: [{ event: TRAINING_IMPORT_BUILD_EVENT }],
    retries: 2,
    concurrency: { key: "event.data.importId", limit: 1 },
    onFailure: async ({ event, error }) => markFailed((event.data.event.data as { importId?: string }).importId, error),
  },
  async ({ event, step }) => {
    const id = (event.data as { importId: string }).importId;
    const start = await step.run("start", async () => {
      const imp = await loadImport(id);
      const plan = normalizePlan(imp.plan);
      return { modules: plan.modules.filter((m) => m.include && m.status !== "done").map((m) => m.key) };
    });

    for (const key of start.modules) {
      const planned = await step.run(`outline-${key}`, async () => {
        const imp = await loadImport(id);
        const plan = normalizePlan(imp.plan);
        const m = plan.modules.find((x) => x.key === key);
        if (!m) throw new NonRetriableError("A module in the plan went missing.");
        await savePlan(id, plan, key, { status: "building", error: undefined });
        return m;
      });

      const sectionScreens: Screen[][] = [];
      for (let i = 0; i < planned.sections.length; i++) {
        const screens = await step.run(`write-${key}-${i}`, async () => {
          const imp = await loadImport(id);
          const raw = await askClaudeJson<unknown>({
            system: systemFor(imp),
            messages: [{ role: "user", content: sectionRequest(planned, i, sectionScreens, imp.instructions) }],
            schema: sectionSchema,
            effort: "medium",
            maxTokens: 32000,
          });
          return toScreens(raw);
        });
        sectionScreens.push(screens as Screen[]);
      }

      await step.run(`save-${key}`, async () => {
        const admin = createAdminClient();
        const imp = await loadImport(id);
        const content = assembleModule(planned, sectionScreens);
        if (imp.moduleId) {
          // A curriculum module: replace its sections and objectives, keep its voice and further reading.
          const { data: existing } = await admin.from("training_module_drafts").select("content").eq("module_id", imp.moduleId).maybeSingle();
          const before = normalizeModuleContent(existing?.content);
          const merged = { ...content, voice: before.voice ?? null, furtherReading: before.furtherReading ?? [] };
          const { error: modErr } = await admin
            .from("training_modules")
            .update({ summary: planned.summary, estimated_minutes: planned.estimatedMinutes, ai_drafted: true, source_import_id: id })
            .eq("id", imp.moduleId);
          if (modErr) throw new Error(`Saving the module failed: ${modErr.message}`);
          const { error: draftErr } = await admin
            .from("training_module_drafts")
            .upsert({ module_id: imp.moduleId, content: merged, updated_by: imp.createdBy, updated_at: now() });
          if (draftErr) throw new Error(`Saving the module's content failed: ${draftErr.message}`);
          await savePlan(id, normalizePlan(imp.plan), key, { status: "done", moduleId: imp.moduleId, error: undefined });
          return;
        }
        const { data: track } = await admin.from("training_tracks").select("id").eq("code", planned.trackCode).maybeSingle();
        if (!track) throw new NonRetriableError(`The ${planned.trackCode} track doesn't exist.`);
        const { data: last } = await admin
          .from("training_modules")
          .select("order_index")
          .eq("track_id", track.id)
          .order("order_index", { ascending: false })
          .limit(1)
          .maybeSingle();
        const { data: mod, error } = await admin
          .from("training_modules")
          .insert({
            track_id: track.id,
            order_index: (last?.order_index ?? 0) + 1,
            title: planned.title,
            summary: planned.summary,
            estimated_minutes: planned.estimatedMinutes,
            ai_drafted: true,
            source_import_id: id,
          })
          .select("id")
          .single();
        if (error || !mod) throw new Error(`Saving the module failed: ${error?.message}`);
        const { error: draftErr } = await admin
          .from("training_module_drafts")
          .insert({ module_id: mod.id, content, updated_by: imp.createdBy });
        if (draftErr) {
          // Don't leave a module with no content behind; the retry starts this save again.
          await admin.from("training_modules").delete().eq("id", mod.id);
          throw new Error(`Saving the module's content failed: ${draftErr.message}`);
        }
        await savePlan(id, normalizePlan(imp.plan), key, { status: "done", moduleId: mod.id, error: undefined });
      });
    }

    const built = await step.run("finish", async () => {
      await setStatus(id, "built");
      const imp = await loadImport(id);
      return normalizePlan(imp.plan)
        .modules.filter((m) => start.modules.includes(m.key) && m.status === "done" && m.moduleId)
        .map((m) => m.moduleId as string);
    });
    // Check every module just written against the Legislation Library (0037).
    if (built.length) await step.sendEvent("fact-check", built.map((moduleId) => ({ name: TRAINING_FACT_CHECK_EVENT, data: { moduleId } })));
    return { status: "built", modules: built.length };
  }
);

// ── Helpers ────────────────────────────────────────────────────────────

const now = () => new Date().toISOString();

async function loadImport(id: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("training_imports")
    .select("id, title, source_text, plan, instructions, created_by, module_id, training_tracks(code)")
    .eq("id", id)
    .maybeSingle();
  if (!data) throw new NonRetriableError("The import was deleted.");
  const track = data.training_tracks as unknown as { code: string } | null;
  return {
    title: data.title as string,
    sourceText: (data.source_text as string | null) ?? "",
    plan: data.plan as ImportPlan | null,
    instructions: (data.instructions as string) ?? "",
    createdBy: data.created_by as string | null,
    trackCode: track?.code ?? null,
    moduleId: (data.module_id as string | null) ?? null,
  };
}

/** The curriculum module an import writes, and the rest of the curriculum for context. */
async function curriculumTarget(moduleId: string): Promise<{ target: CurriculumTarget; others: { title: string; track: string; summary: string }[] } | null> {
  const admin = createAdminClient();
  const [{ data: mod }, { data: draft }, { data: all }] = await Promise.all([
    admin.from("training_modules").select("id, title, summary, estimated_minutes, training_tracks(code)").eq("id", moduleId).maybeSingle(),
    admin.from("training_module_drafts").select("content").eq("module_id", moduleId).maybeSingle(),
    admin.from("training_modules").select("id, title, summary, order_index, training_tracks(title, order_index)"),
  ]);
  if (!mod) throw new NonRetriableError("The module this build was for was deleted.");
  const code = (mod.training_tracks as unknown as { code: string } | null)?.code;
  const trackCode = TRACK_CODES.find((c) => c === code) ?? "council_ready";
  const others = (all ?? [])
    .filter((m) => m.id !== moduleId)
    .map((m) => {
      const t = m.training_tracks as unknown as { title: string; order_index: number } | null;
      return { title: m.title as string, summary: (m.summary as string) ?? "", track: t?.title ?? "", order: (t?.order_index ?? 0) * 1000 + (m.order_index as number) };
    })
    .sort((a, b) => a.order - b.order)
    .map(({ title, track, summary }) => ({ title, track, summary }));
  return {
    target: {
      title: mod.title as string,
      trackCode,
      summary: (mod.summary as string) ?? "",
      estimatedMinutes: (mod.estimated_minutes as number | null) ?? null,
      objectives: normalizeModuleContent(draft?.content).objectives,
    },
    others,
  };
}

/** The fixed instructions, then the document, cached for an hour so every later call reuses it. */
function systemFor(imp: { sourceText: string }): Anthropic.Beta.BetaTextBlockParam[] {
  if (!imp.sourceText) throw new NonRetriableError("The document's text is missing.");
  return [
    { type: "text", text: BUILDER_SYSTEM },
    { type: "text", text: imp.sourceText, cache_control: { type: "ephemeral", ttl: "1h" } },
  ];
}

function sectionRequest(m: PlannedModule, index: number, earlier: Screen[][], instructions: string) {
  const outline = m.sections
    .map((s, i) => `${i + 1}. ${s.title}${i === index ? "  <- write this one" : ""}\n${s.keyPoints.map((p) => `   - ${p}`).join("\n")}`)
    .join("\n");
  const done = earlier
    .map((screens, i) => `Section ${i + 1} screens already written: ${screens.map((s) => `"${s.title}"`).join(", ") || "(none)"}`)
    .join("\n");
  return [
    SECTION_INSTRUCTIONS,
    `Module: ${m.title}\nSummary: ${m.summary}\nLearning objectives:\n${m.objectives.map((o) => `- ${o}`).join("\n")}`,
    `The module's sections:\n${outline}`,
    done ? `${done}\nDon't repeat what those screens cover.` : "",
    index === m.sections.length - 1 ? "This is the module's last section." : "",
    instructions ? `Notes from the author:\n${instructions}` : "",
    `Write section ${index + 1}, "${m.sections[index].title}".`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function savePlan(id: string, plan: ImportPlan, key: string, patch: Partial<PlannedModule>) {
  const modules = plan.modules.map((m) => (m.key === key ? { ...m, ...patch } : m));
  await createAdminClient()
    .from("training_imports")
    .update({ plan: { ...plan, modules }, updated_at: now() })
    .eq("id", id);
}

async function setStatus(id: string, status: string, error: string | null = null) {
  await createAdminClient().from("training_imports").update({ status, error, updated_at: now() }).eq("id", id);
}

async function markFailed(id: string | undefined, error: unknown) {
  if (!id) return;
  const message = error instanceof Error ? error.message : String(error);
  const friendly = message.includes("ANTHROPIC_API_KEY")
    ? "The AI isn't set up yet (missing API key)."
    : message.includes("declined")
      ? "The AI declined to work with this document."
      : message.slice(0, 300);
  await setStatus(id, "failed", friendly);
}
