import type { StratasphereSource } from "@/lib/ai/stratasphere";

/**
 * Asks /api/stratasphere/chat and reads its answer as it's written
 * (newline-delimited JSON; see that route). For the browser: the floating
 * panel and Meeting Mode's Stratasphere both use it.
 */
export type AskResponse =
  | { ok: true; conversationId: string | null; messageId: string | null; text: string; sources: StratasphereSource[] }
  | { ok: false; error: string; demoLimit?: boolean };

export async function askStream(
  body: { corpId: string; conversationId: string | null; question: string; focus: unknown; live?: boolean },
  on: { start?: (conversationId: string) => void; text?: (soFar: string) => void }
): Promise<AskResponse> {
  let conversationId: string | null = null;
  try {
    const res = await fetch("/api/stratasphere/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) {
      const err = (await res.json().catch(() => null)) as { error?: string; demoLimit?: boolean } | null;
      return { ok: false, error: err?.error ?? "Stratasphere couldn't answer right now. Please try again.", demoLimit: err?.demoLimit };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let answer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const raw = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!raw) continue;
        const ev = JSON.parse(raw) as
          | { type: "start"; conversationId: string }
          | { type: "delta"; text: string }
          | { type: "done"; messageId: string | null; sources: StratasphereSource[] }
          | { type: "error"; error: string };
        if (ev.type === "start") {
          conversationId = ev.conversationId;
          on.start?.(ev.conversationId);
        } else if (ev.type === "delta") {
          answer += ev.text;
          on.text?.(answer);
        } else if (ev.type === "done") {
          return { ok: true, conversationId, messageId: ev.messageId, text: answer, sources: ev.sources };
        } else if (ev.type === "error") {
          return { ok: false, error: ev.error };
        }
      }
    }
    return { ok: false, error: "The answer was interrupted. Please try again." };
  } catch {
    return { ok: false, error: "Stratasphere couldn't answer right now. Please check your connection and try again." };
  }
}
