import "server-only";
import { askClaudeJson, ClaudeRefusalError } from "@/lib/ai/claude";
import { loadStripContext } from "@/lib/kb/privacy";
import { pseudonymize } from "@/lib/pii";
import { createAdminClient } from "@/lib/supabase/admin";

const MOTION_SCHEMA = {
  type: "object",
  properties: { motionText: { type: "string" } },
  required: ["motionText"],
  additionalProperties: false,
};

/**
 * Drafts motion wording for an agenda item or a council discussion. Only the
 * item's own text goes out, with names and other personal details swapped
 * for numbered references first and swapped back in the reply. Nothing is
 * saved: the draft lands in an editable motion field.
 */
export async function draftMotionText(
  corpId: string,
  /** "council meeting", "council discussion between meetings" */
  setting: string,
  input: { label: string; text: string; background: string; financial: string; risks: string; decisionType: string }
): Promise<{ ok: true; motionText: string } | { ok: false; error: string }> {
  const ctx = await loadStripContext(createAdminClient(), corpId);
  const p = pseudonymize(
    [
      `${input.label}: ${input.text.slice(0, 500)}`,
      input.background.trim() && `Background: ${input.background.slice(0, 4000)}`,
      input.financial.trim() && `Financial implications: ${input.financial.slice(0, 2000)}`,
      input.risks.trim() && `Risks / compliance: ${input.risks.slice(0, 2000)}`,
      `Decision type: ${input.decisionType}`,
    ]
      .filter(Boolean)
      .join("\n"),
    ctx.people,
    ctx.identity
  );
  try {
    const out = await askClaudeJson<{ motionText: string }>({
      effort: "low",
      maxTokens: 1000,
      system:
        `You draft motions for a BC strata corporation's ${setting}, in the form minutes record them. ` +
        "Write one motion as a single sentence starting with \"THAT\" (or \"BE IT RESOLVED by a 3/4 vote of the owners that\" for a 3/4 resolution, and the matching wording for 80% or unanimous resolutions). " +
        "Be specific to the item, use plain language, and cite the Strata Property Act only where the item clearly calls for it. " +
        "Placeholders like [REF-3] stand for names and other details; copy them exactly. Use [square brackets] for anything the item doesn't say, such as an amount or date. " +
        "Never invent facts.",
      messages: [{ role: "user", content: p.text }],
      schema: MOTION_SCHEMA,
    });
    const motionText = p.restore(out.motionText ?? "").trim();
    if (!motionText) return { ok: false, error: "Stratasphere couldn't draft a motion for that. Write it by hand." };
    return { ok: true, motionText };
  } catch (err) {
    console.error("[draftMotion]", err instanceof Error ? err.message : err);
    return {
      ok: false,
      error:
        err instanceof ClaudeRefusalError
          ? "Stratasphere couldn't draft a motion for that. Write it by hand."
          : "Couldn't draft a motion. Try again, or write it by hand.",
    };
  }
}
