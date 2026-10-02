import Anthropic from "@anthropic-ai/sdk";
import type { TokenUsage } from "@/lib/ai/pricing";

/**
 * The one way this app calls Claude. Every caller passes text that has
 * already been through lib/pii.ts — this module never sees raw roster data.
 *
 * Server-side fallbacks are on: if a safety classifier declines a request,
 * the API re-runs it on Anthropic's recommended fallback model inside the
 * same call instead of returning a refusal.
 */
export const CLAUDE_MODEL = "claude-opus-5-5";

let client: Anthropic | null = null;
function anthropic() {
  client ??= new Anthropic(); // ANTHROPIC_API_KEY, set in Vercel
  return client;
}

export class ClaudeRefusalError extends Error {}

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

interface AskOptions {
  system?: string | Anthropic.Beta.BetaTextBlockParam[];
  /** Cache the conversation as it grows (top-level automatic caching). */
  cache?: boolean;
  messages: Anthropic.Beta.BetaMessageParam[];
  maxTokens?: number;
  effort?: Effort;
  /** JSON Schema: the reply is constrained to it and parsed. */
  schema?: Record<string, unknown>;
}

async function create(opts: AskOptions) {
  const params = {
    model: CLAUDE_MODEL,
    max_tokens: opts.maxTokens ?? 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: opts.system,
    messages: opts.messages,
    ...(opts.cache ? { cache_control: { type: "ephemeral" } } : {}),
    output_config: {
      effort: opts.effort ?? "medium",
      ...(opts.schema ? { format: { type: "json_schema", schema: opts.schema } } : {}),
    },
  } as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
  // Long inputs (whole documents) stream so they can't hit request timeouts.
  const message = await anthropic().beta.messages.stream(params).finalMessage();
  if (opts.cache) logCache(message);
  if (message.stop_reason === "refusal") throw new ClaudeRefusalError("Claude declined this request.");
  return message;
}

function usageOf(message: Anthropic.Beta.BetaMessage): TokenUsage {
  const u = message.usage;
  return {
    input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
  };
}

/** One line per cached call, so cache hits (and cost) can be checked in the server logs. */
function logCache(message: Anthropic.Beta.BetaMessage) {
  const u = message.usage;
  console.info(
    `[claude cache] read=${u.cache_read_input_tokens ?? 0} written=${u.cache_creation_input_tokens ?? 0} uncached=${u.input_tokens} output=${u.output_tokens}`
  );
}

function textOf(message: Anthropic.Beta.BetaMessage) {
  return message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

export async function askClaudeText(opts: Omit<AskOptions, "schema">) {
  const message = await create(opts);
  return { text: textOf(message), truncated: message.stop_reason === "max_tokens", usage: usageOf(message) };
}

export async function askClaudeJson<T>(opts: AskOptions & { schema: Record<string, unknown> }): Promise<T> {
  const message = await create(opts);
  if (message.stop_reason === "max_tokens") throw new Error("Claude's reply was cut off.");
  return JSON.parse(textOf(message)) as T;
}

/**
 * Like askClaudeText, but hands each piece of text to `onText` as it's
 * written, for answers that should appear while they're being composed.
 */
export async function streamClaudeText(opts: Omit<AskOptions, "schema">, onText: (delta: string) => void) {
  const params = {
    model: CLAUDE_MODEL,
    max_tokens: opts.maxTokens ?? 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: opts.system,
    messages: opts.messages,
    ...(opts.cache ? { cache_control: { type: "ephemeral" } } : {}),
    output_config: { effort: opts.effort ?? "medium" },
  } as Anthropic.Beta.Messages.MessageCreateParamsStreaming;
  const stream = anthropic().beta.messages.stream(params);
  stream.on("text", (delta) => onText(delta));
  const message = await stream.finalMessage();
  if (opts.cache) logCache(message);
  if (message.stop_reason === "refusal") throw new ClaudeRefusalError("Claude declined this request.");
  return { text: textOf(message), truncated: message.stop_reason === "max_tokens", usage: usageOf(message) };
}
