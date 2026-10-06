import { NonRetriableError } from "inngest";
import { createAdminClient } from "@/lib/supabase/admin";
import { askClaudeJson } from "@/lib/ai/claude";
import { inngest, TRAINING_FACT_CHECK_EVENT } from "@/lib/inngest/client";
import { normalizeModuleContent } from "@/lib/training/content";
import {
  FACT_CHECK_INSTRUCTIONS,
  factCheckSchema,
  mergeHits,
  normalizeFactCheck,
  normalizeIssues,
  passagesAsSources,
  screenFactText,
  type FactCheck,
  type FactIssue,
} from "@/lib/training/library";
import { passagesForCitations, searchLibrary } from "@/lib/training/library-server";

/**
 * Checks a module's facts and references against the Legislation Library
 * (0037), one section at a time: the library passages that match each
 * screen, plus the sections its references name, then the AI reports
 * statements the passages contradict or don't support. The result is
 * stored on training_module_drafts.fact_check for the builder to show. Nothing
 * is changed in the module.
 */
export const factCheckTrainingModule = inngest.createFunction(
  {
    id: "training-fact-check",
    triggers: [{ event: TRAINING_FACT_CHECK_EVENT }],
    retries: 1,
    concurrency: { key: "event.data.moduleId", limit: 1 },
    onFailure: async ({ event, error }) => {
      const moduleId = (event.data.event.data as { moduleId?: string }).moduleId;
      if (!moduleId) return;
      const current = await load(moduleId).catch(() => null);
      if (!current?.check) return;
      await save(moduleId, { ...current.check, status: "failed", error: error instanceof Error ? error.message.slice(0, 300) : "The check failed." });
    },
  },
  async ({ event, step }) => {
    const moduleId = (event.data as { moduleId: string }).moduleId;

    const start = await step.run("start", async () => {
      const m = await load(moduleId);
      const sections = m.content.sections.map((s) => s.id);
      await save(moduleId, {
        status: "checking",
        checkedAt: new Date().toISOString(),
        draftUpdatedAt: m.draftUpdatedAt,
        sectionsDone: 0,
        sectionsTotal: sections.length,
        issues: [],
      });
      return { sections };
    });

    for (let i = 0; i < start.sections.length; i++) {
      await step.run(`check-${i}`, async () => {
        const m = await load(moduleId);
        const section = m.content.sections.find((s) => s.id === start.sections[i]);
        const screens = (section?.screens ?? []).map((sc) => ({ id: sc.id, text: screenFactText(sc) }));
        let issues: FactIssue[] = [];
        if (screens.some((s) => s.text.includes("\n"))) {
          const [found, cited] = await Promise.all([
            // Each screen in a few short pieces, so every statement gets its own search.
            searchLibrary(screens.flatMap((s) => searchPieces(s.text)), { perQuery: 6, threshold: 0.3, limit: 45 }),
            // Any section a screen names, in its references, text or narration.
            passagesForCitations(screens.map((s) => s.text)),
          ]);
          const passages = mergeHits([cited, found]).slice(0, 60);
          if (passages.length) {
            const raw = await askClaudeJson<unknown>({
              system: [
                { type: "text", text: "You check training content for accuracy against British Columbia strata law and guidance." },
                { type: "text", text: passagesAsSources(passages) },
              ],
              messages: [
                {
                  role: "user",
                  content: `${FACT_CHECK_INSTRUCTIONS}\n\n${screens.map((s) => `<screen id="${s.id}">\n${s.text}\n</screen>`).join("\n\n")}`,
                },
              ],
              schema: factCheckSchema,
              effort: "medium",
              maxTokens: 16000,
            });
            issues = normalizeIssues(raw, new Set(screens.map((s) => s.id)));
          } else {
            // Nothing in the library to check against: say so rather than passing it silently.
            issues = screens
              .filter((s) => s.text.includes("\n"))
              .slice(0, 1)
              .map((s) => ({
                screenId: s.id,
                quote: "",
                kind: "unsupported" as const,
                note: "Nothing in the Legislation Library matched this section, so its facts couldn't be checked.",
                library: "",
              }));
          }
        }
        const latest = (await load(moduleId)).check;
        if (latest) await save(moduleId, { ...latest, sectionsDone: i + 1, issues: [...latest.issues, ...issues] });
      });
    }

    return step.run("finish", async () => {
      const latest = (await load(moduleId)).check;
      if (latest) await save(moduleId, { ...latest, status: "done" });
      return { issues: latest?.issues.length ?? 0 };
    });
  }
);

/** A screen's text in pieces of a few lines (at most four), for searching. */
function searchPieces(text: string): string[] {
  const pieces: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    if (current && current.length + line.length > 700) {
      pieces.push(current);
      current = "";
    }
    current = current ? `${current}\n${line}` : line;
  }
  if (current) pieces.push(current);
  return pieces.slice(0, 4);
}

async function load(moduleId: string) {
  const admin = createAdminClient();
  const { data: draft } = await admin.from("training_module_drafts").select("content, updated_at, fact_check").eq("module_id", moduleId).maybeSingle();
  if (!draft) throw new NonRetriableError("The module was deleted.");
  return {
    content: normalizeModuleContent(draft.content),
    draftUpdatedAt: (draft.updated_at as string | null) ?? null,
    check: normalizeFactCheck(draft.fact_check),
  };
}

async function save(moduleId: string, check: FactCheck) {
  // Leaves updated_at alone: the check isn't an edit.
  await createAdminClient().from("training_module_drafts").update({ fact_check: check }).eq("module_id", moduleId);
}
