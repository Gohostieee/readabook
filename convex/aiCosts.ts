import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

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

// Password for the internal cost dashboard. Configurable via env var; defaults
// to the agreed-upon password.
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD ?? "muttley";

/**
 * Aggregated cost data for the internal /dashboard route. The password is
 * verified server-side, so without it no cost data is ever returned.
 */
export const getCostSummary = query({
  args: { password: v.string() },
  handler: async (ctx, args) => {
    if (args.password !== DASHBOARD_PASSWORD) {
      return { authorized: false as const };
    }

    // Most recent requests first. Bounded read keeps this efficient as the
    // ledger grows; widen the cap (or paginate) if the table gets large.
    const logs = await ctx.db
      .query("aiRequestLogs")
      .withIndex("by_createdAt")
      .order("desc")
      .take(500);

    let totalCostUsd = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const byStatus = { success: 0, fallback: 0, failed: 0 };

    for (const log of logs) {
      totalCostUsd += log.costUsd;
      totalInputTokens += log.inputTokens;
      totalOutputTokens += log.outputTokens;
      byStatus[log.status] += 1;
    }

    return {
      authorized: true as const,
      totals: {
        requests: logs.length,
        costUsd: Math.round(totalCostUsd * 1_000_000) / 1_000_000,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        byStatus,
      },
      recent: logs.slice(0, 100).map((log) => ({
        id: log._id,
        createdAt: log.createdAt,
        model: log.model,
        operation: log.operation,
        status: log.status,
        inputTokens: log.inputTokens,
        cachedInputTokens: log.cachedInputTokens,
        outputTokens: log.outputTokens,
        totalTokens: log.totalTokens,
        tokenSource: log.tokenSource,
        costUsd: log.costUsd,
        durationMs: log.durationMs,
        errorMessage: log.errorMessage,
        bookId: log.bookId,
        userId: log.userId,
      })),
    };
  },
});

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
    callBreakdown: v.optional(
      v.array(
        v.object({
          phase: v.union(
            v.literal("outline"),
            v.literal("chapter"),
            v.literal("single"),
          ),
          index: v.optional(v.number()),
          status: v.union(
            v.literal("success"),
            v.literal("retried"),
            v.literal("fallback"),
            v.literal("failed"),
          ),
          inputTokens: v.number(),
          outputTokens: v.number(),
          durationMs: v.number(),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("aiRequestLogs", {
      ...args,
      createdAt: Date.now(),
    });
    return null;
  },
});
