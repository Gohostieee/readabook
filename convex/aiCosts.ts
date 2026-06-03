import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

// ---------------------------------------------------------------------------
// Model pricing
//
// USD per 1,000,000 tokens. Source: OpenAI API pricing for gpt-5.5
// (https://openai.com/api/pricing/) — $5.00 input / $30.00 output, with
// cached input billed at $0.50 (a 90% discount).
// ---------------------------------------------------------------------------

type ModelPricing = {
  /** USD per 1M uncached input tokens. */
  input: number;
  /** USD per 1M cached input tokens. */
  cachedInput: number;
  /** USD per 1M output tokens. */
  output: number;
};

const PRICING: Record<string, ModelPricing> = {
  "gpt-5.5": { input: 5, cachedInput: 0.5, output: 30 },
  "gpt-5.5-pro": { input: 30, cachedInput: 30, output: 180 },
};

// Fall back to the base gpt-5.5 rate for unknown / dated model ids so a cost is
// always recorded rather than silently zeroed.
const DEFAULT_PRICING = PRICING["gpt-5.5"];

function pricingForModel(model: string): ModelPricing {
  if (PRICING[model]) return PRICING[model];
  const base = Object.keys(PRICING).find((id) => model.startsWith(id));
  return base ? PRICING[base] : DEFAULT_PRICING;
}

/**
 * Compute the USD cost of a request. `inputTokens` is the TOTAL input token
 * count; `cachedInputTokens` is the cached subset (billed at the cheaper rate).
 */
export function computeCostUsd(args: {
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}): number {
  const pricing = pricingForModel(args.model);
  const uncachedInput = Math.max(0, args.inputTokens - args.cachedInputTokens);
  const cost =
    (uncachedInput * pricing.input +
      args.cachedInputTokens * pricing.cachedInput +
      args.outputTokens * pricing.output) /
    1_000_000;
  // Round to 6 decimals (micro-dollars) to avoid float dust.
  return Math.round(cost * 1_000_000) / 1_000_000;
}

export const logAiRequest = internalMutation({
  args: {
    model: v.string(),
    operation: v.string(),
    status: v.union(
      v.literal("success"),
      v.literal("fallback"),
      v.literal("failed"),
    ),
    inputTokens: v.number(),
    cachedInputTokens: v.number(),
    outputTokens: v.number(),
    totalTokens: v.number(),
    tokenSource: v.union(v.literal("usage"), v.literal("tokenizer")),
    costUsd: v.number(),
    durationMs: v.number(),
    errorMessage: v.union(v.string(), v.null()),
    bookId: v.union(v.id("books"), v.null()),
    jobId: v.union(v.id("bookJobs"), v.null()),
    userId: v.union(v.id("users"), v.null()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("aiRequestLogs", {
      ...args,
      createdAt: Date.now(),
    });
    return null;
  },
});
