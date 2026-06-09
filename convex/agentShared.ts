"use node";

import { Agent, run, type Tool } from "@openai/agents";
import { encode } from "gpt-tokenizer/encoding/o200k_base";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared OpenAI Agents SDK helpers used by both the two-pass formatter
// (convex/formatter.ts) and the post-formatting fact-checker
// (convex/factChecker.ts). Keeping these in one place means token accounting,
// usage/tokenizer fallback, error flattening and concurrency behave identically
// across every layer that calls the model.
// ---------------------------------------------------------------------------

export type Tokens = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export const ZERO_TOKENS: Tokens = {
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
};

export function addTokens(into: Tokens, more: Tokens) {
  into.inputTokens += more.inputTokens;
  into.cachedInputTokens += more.cachedInputTokens;
  into.outputTokens += more.outputTokens;
  into.totalTokens += more.totalTokens;
}

// Pull a normalized token breakdown out of the Agents SDK usage object. Cached
// tokens live in `inputTokensDetails` under the `cached_tokens` key.
export function readUsage(usage: {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputTokensDetails?: Array<Record<string, number>>;
}): Tokens {
  const cachedInputTokens = (usage.inputTokensDetails ?? []).reduce(
    (sum, details) => sum + (details.cached_tokens ?? 0),
    0,
  );
  return {
    inputTokens: usage.inputTokens,
    cachedInputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
  };
}

// Run one structured agent call and return its parsed output plus a token count
// (preferring the SDK's reported usage, falling back to a local tokenizer
// estimate when usage is missing/zero). Optionally attach hosted tools (e.g.
// the built-in web_search tool) so the model can loop over tool calls within
// `maxTurns`. Throws if the model output fails schema validation — e.g. a
// truncated response from hitting the output cap.
export async function runStructured<S extends z.ZodObject<z.ZodRawShape>>(opts: {
  name: string;
  model: string;
  instructions: string;
  schema: S;
  input: string;
  tools?: Tool[];
  maxTurns?: number;
}): Promise<{
  output: z.infer<S>;
  tokens: Tokens;
  tokenSource: "usage" | "tokenizer";
  durationMs: number;
}> {
  const startedAt = Date.now();
  const agent = new Agent({
    name: opts.name,
    model: opts.model,
    outputType: opts.schema,
    instructions: opts.instructions,
    ...(opts.tools ? { tools: opts.tools } : {}),
  });
  const result = await run(agent, opts.input, { maxTurns: opts.maxTurns ?? 8 });

  const usage = readUsage(result.runContext.usage);
  const hasUsage = usage.totalTokens > 0 || usage.inputTokens > 0;
  const tokens = hasUsage
    ? usage
    : (() => {
        const inputTokens = encode(
          `${opts.instructions}\n\n${opts.input}`,
        ).length;
        const outputTokens = encode(
          JSON.stringify(result.finalOutput ?? ""),
        ).length;
        return {
          inputTokens,
          cachedInputTokens: 0,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
        };
      })();

  // Parse last so a truncated/invalid response still surfaces as a thrown error
  // for the caller's retry/fallback handling.
  const output = opts.schema.parse(result.finalOutput);
  return {
    output,
    tokens,
    tokenSource: hasUsage ? "usage" : "tokenizer",
    durationMs: Date.now() - startedAt,
  };
}

// Flatten an unknown thrown value into a single rich line that surfaces the
// detail the SDK normally buries: the OpenAI/Agents API error carries the real
// reason (e.g. a 400 schema rejection) under `status`/`error`/`response`, and a
// wrapping Error often hides it under `cause`. `Error.message` alone usually
// loses all of that — so we walk every useful field.
export function describeError(error: unknown, depth = 0): string {
  if (depth > 4) return "…";
  if (!(error instanceof Error)) {
    if (typeof error === "string") return error;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  const parts: string[] = [`${error.name}: ${error.message}`];
  const extra = error as unknown as Record<string, unknown>;

  // Scalar API-error fields (openai/@openai/agents APIError shape).
  for (const key of [
    "status",
    "code",
    "type",
    "param",
    "requestID",
    "request_id",
  ]) {
    const value = extra[key];
    if (value != null) parts.push(`${key}=${String(value)}`);
  }

  // The response body holds the human-readable reason for 4xx errors.
  const body = extra.error ?? extra.response ?? extra.body;
  if (body != null && body !== error) {
    try {
      parts.push(`body=${JSON.stringify(body)}`);
    } catch {
      /* non-serializable body — skip */
    }
  }

  if (error.cause != null && error.cause !== error) {
    parts.push(`cause=(${describeError(error.cause, depth + 1)})`);
  }

  return parts.join(" | ");
}

// Estimate the cost of a model call that threw before we could read usage (the
// request usually completed and billed before a parse/validate step failed).
export function estimateFailedTokens(
  instructions: string,
  input: string,
): Tokens {
  const inputTokens = encode(`${instructions}\n\n${input}`).length;
  return {
    inputTokens,
    cachedInputTokens: 0,
    outputTokens: 0,
    totalTokens: inputTokens,
  };
}

// Map over items with bounded concurrency, preserving input order in the result.
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  };
  const workers = Array.from(
    { length: Math.min(Math.max(1, limit), items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}
