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
const CLAUDE_MODEL = "claude-opus-5-5";

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
    cacheWrite1h: u.cache_creation?.ephemeral_1h_input_tokens ?? 0,
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

/**
 * A tool Claude may call while answering (a client tool: this app runs it).
 * `run` gets the parsed input, validates it itself (eager input streaming
 * skips the server's check), and returns the result as text; throwing a
 * ToolInputError sends the message back to Claude as an error to fix.
 */
export interface ClientTool {
  definition: Anthropic.Beta.BetaTool;
  run: (input: unknown) => string | Promise<string>;
}

export class ToolInputError extends Error {}

/** Rounds of tool calls before Claude is asked to finish without them: a guard against a loop, never reached in practice. */
const MAX_TOOL_ROUNDS = 12;

type TextOptions = Omit<AskOptions, "schema"> & {
  tools?: ClientTool[];
  /** Told of each tool call and its result (the recall check records the calculations). */
  onToolCall?: (call: { name: string; input: unknown; result: string }) => void;
};

/**
 * One answer, in as many rounds as Claude needs: each time it calls a tool,
 * the tool runs here and its result goes back, until it finishes writing.
 * Text is handed to `onText` as it's written, when given. Usage is the sum
 * of every round.
 */
async function converse(opts: TextOptions, onText?: (delta: string) => void) {
  const tools = opts.tools ?? [];
  const messages = [...opts.messages];
  const usage: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 };
  let text = "";
  let jsonRetries = 0;

  for (let round = 0; ; round++) {
    const lastRound = round >= MAX_TOOL_ROUNDS;
    const params = {
      model: CLAUDE_MODEL,
      max_tokens: opts.maxTokens ?? 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: opts.system,
      messages,
      ...(tools.length ? { tools: tools.map((t) => ({ ...t.definition, eager_input_streaming: true })) } : {}),
      ...(tools.length && lastRound ? { tool_choice: { type: "none" } } : {}),
      ...(opts.cache ? { cache_control: { type: "ephemeral" } } : {}),
      output_config: { effort: opts.effort ?? "medium" },
    } as Anthropic.Beta.Messages.MessageCreateParamsStreaming;

    const stream = anthropic().beta.messages.stream(params);
    // A new round's text starts a new paragraph after the last round's.
    let started = false;
    stream.on("text", (delta) => {
      if (!started && text && !text.endsWith("\n")) {
        text += "\n\n";
        onText?.("\n\n");
      }
      started = true;
      text += delta;
      onText?.(delta);
    });

    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await stream.finalMessage();
      jsonRetries = 0;
    } catch (err) {
      // With eager input streaming, a tool input that isn't JSON at all
      // rejects here; re-ask that round (twice at most). API errors go up.
      if (err instanceof Anthropic.APIError || jsonRetries++ >= 2 || !tools.length) throw err;
      console.error("[claude] a tool input wasn't readable JSON; asking again");
      continue;
    }
    if (opts.cache) logCache(message);
    const u = usageOf(message);
    usage.input += u.input;
    usage.output += u.output;
    usage.cacheRead += u.cacheRead;
    usage.cacheWrite += u.cacheWrite;
    usage.cacheWrite1h = (usage.cacheWrite1h ?? 0) + (u.cacheWrite1h ?? 0);

    // A refusal can cut a tool call off mid-input: never run that round's tools.
    if (message.stop_reason === "refusal") throw new ClaudeRefusalError("Claude declined this request.");
    if (message.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: message.content });
      continue;
    }
    const calls = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (message.stop_reason !== "tool_use" || !calls.length) {
      return { text: text.trim(), truncated: message.stop_reason === "max_tokens", usage };
    }

    messages.push({ role: "assistant", content: message.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const call of calls) {
      const tool = tools.find((t) => t.definition.name === call.name);
      try {
        if (!tool) throw new ToolInputError(`There's no tool called ${call.name}.`);
        const content = await tool.run(call.input);
        results.push({ type: "tool_result", tool_use_id: call.id, content });
        opts.onToolCall?.({ name: call.name, input: call.input, result: content });
      } catch (err) {
        if (!(err instanceof ToolInputError)) throw err;
        results.push({ type: "tool_result", tool_use_id: call.id, is_error: true, content: err.message });
        opts.onToolCall?.({ name: call.name, input: call.input, result: `ERROR ${err.message}` });
      }
    }
    messages.push({ role: "user", content: results });
  }
}

export async function askClaudeText(opts: TextOptions) {
  return converse(opts);
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
export async function streamClaudeText(opts: TextOptions, onText: (delta: string) => void) {
  return converse(opts, onText);
}
