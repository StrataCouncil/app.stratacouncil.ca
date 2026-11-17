import "server-only";
import { askClaudeJson, ClaudeRefusalError } from "@/lib/ai/claude";
import { loadStripContext } from "@/lib/kb/privacy";
import { pseudonymize } from "@/lib/pii";
import { createAdminClient } from "@/lib/supabase/admin";

const SCHEMA = {
  type: "object",
  properties: { title: { type: "string" }, detail: { type: "string" } },
  required: ["title", "detail"],
  additionalProperties: false,
};

/**
 * Clearer wording for a directive (0097): an imperative task that says what
 * to do, plus any amounts, limits, or timing it already states. Names and
 * other personal details are swapped for numbered references before it
 * leaves, and swapped back in the reply. Nothing is saved.
 */
export async function suggestDirectiveWording(
  corpId: string,
  title: string,
  detail: string
): Promise<{ ok: true; title: string; detail: string } | { ok: false; error: string }> {
  const ctx = await loadStripContext(createAdminClient(), corpId);
  const p = pseudonymize(`Task: ${title}\nDetail: ${detail || "(none)"}`, ctx.people, ctx.identity);
  try {
    const out = await askClaudeJson<{ title: string; detail: string }>({
      effort: "low",
      maxTokens: 800,
      system:
        "You tidy the wording of a follow-up task for a BC strata council. " +
        "Return title: one imperative sentence under 120 characters saying exactly what to do (\"Get three quotes for the roof membrane replacement\"). " +
        "Return detail: one or two plain sentences with who does it, by when, and any spending limit, but only what the task already says; an empty string if there's nothing to add. " +
        "Use [square brackets] for something the task clearly needs but doesn't say, such as [amount] or [date]. " +
        "Placeholders like [REF-3] stand for names and other details; copy them exactly. Never invent facts. Plain text, Canadian spelling.",
      messages: [{ role: "user", content: p.text }],
      schema: SCHEMA,
    });
    const t = p.restore(out.title ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
    if (!t) return { ok: false, error: "Stratasphere couldn't suggest wording for that. Edit it by hand." };
    return { ok: true, title: t, detail: p.restore(out.detail ?? "").trim().slice(0, 4000) };
  } catch (err) {
    console.error("[suggestDirectiveWording]", err instanceof Error ? err.message : err);
    return {
      ok: false,
      error:
        err instanceof ClaudeRefusalError ? "Stratasphere couldn't suggest wording for that. Edit it by hand." : "Couldn't suggest wording. Try again, or edit it by hand.",
    };
  }
}
