"use node";

import { webSearchTool } from "@openai/agents";
import { v } from "convex/values";
import { z } from "zod";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import {
  type Tokens,
  ZERO_TOKENS,
  addTokens,
  describeError,
  estimateFailedTokens,
  mapWithConcurrency,
  runStructured,
} from "./agentShared";
import { computeCostUsd, webSearchSurchargeUsd } from "./aiCosts";
import { type BookBlock, groupChapters } from "./lib";

// ---------------------------------------------------------------------------
// Post-formatting fact-check layer.
//
// Runs as its own async stage after a book completes. A three-step agent loop,
// with state persisted between steps so the reader can show progress and a run
// is debuggable:
//
//   1. EXTRACT  — per chapter, no web: pull every candidate verifiable claim.
//   2. PRUNE    — single call, no web: cut to the meaningful, distinct claims.
//   3. CHECK    — per surviving fact, WITH web_search: verdict + sources.
//
// Each step is itself an Agents-SDK run() with bounded turns, so the model
// loops internally (tool calls / refinement) within the step. A fact-check
// failure never touches the already-completed book.
// ---------------------------------------------------------------------------

// Hard cap on facts we web-search per book (cost + action-time bound). Override
// with READABOOK_FACTCHECK_MAX.
const DEFAULT_MAX_FACTS = 50;
// Concurrency for the per-chapter extract and per-fact check fan-outs.
const CONCURRENCY = 4;

const verdictEnum = z.enum([
  "supported",
  "refuted",
  "misleading",
  "unverifiable",
]);

// STEP 1 output — raw candidate claims from one chapter.
const extractSchema = z.object({
  candidates: z
    .array(
      z.object({
        statement: z.string().min(1),
        quote: z.string().min(1),
      }),
    )
    .max(60),
});

// STEP 2 output — the distilled, deduped set across the whole book. The model
// echoes back each kept fact with the chapter index it came from.
const pruneSchema = z.object({
  facts: z
    .array(
      z.object({
        chapterIndex: z.number().int().min(0),
        statement: z.string().min(1),
        quote: z.string().min(1),
      }),
    )
    .max(200),
});

// STEP 3 output — the verdict for a single fact.
const checkSchema = z.object({
  verdict: verdictEnum,
  confidence: z.number().min(0).max(1),
  explanation: z.string(),
  sources: z
    .array(z.object({ url: z.string(), title: z.string() }))
    .max(8),
});

const EXTRACT_INSTRUCTIONS = [
  "You are a fact-extraction assistant. You are given the text of ONE chapter of a book derived from a video transcript.",
  "Identify EVERY statement in this chapter that is a checkable FACT — a claim that could in principle be verified against external reality. Examples: dates, numbers/statistics, named historical events, attributions ('X said/invented/founded Y'), scientific or medical claims, causal claims, records, and concrete assertions about the world.",
  "Do NOT include: opinions, predictions about the future, hypotheticals, value judgments, jokes, rhetorical questions, or first-person feelings.",
  "For each fact return:",
  "- `statement`: the claim expressed as a single clear, self-contained declarative sentence (resolve pronouns using chapter context).",
  "- `quote`: the VERBATIM span of text from the chapter that the claim comes from (copy it exactly, do not paraphrase).",
  "Extract generously at this stage — a later step will prune. If the chapter contains no checkable facts, return an empty list.",
].join("\n");

const PRUNE_INSTRUCTIONS = [
  "You are curating a fact-check list for a book. You are given candidate factual claims gathered from every chapter, each tagged with its `chapterIndex`.",
  "Cut the list down to only the genuinely MEANINGFUL, checkable claims worth verifying. Apply these rules:",
  "- DROP trivial or self-evidently true claims ('the sun is hot', 'water is wet', common-knowledge truisms).",
  "- DROP vague or inherently unverifiable statements (no concrete, searchable assertion).",
  "- MERGE near-duplicates and claims that restate the same fact — keep ONE, with the clearest statement and the best supporting quote.",
  "- KEEP specific, consequential, or surprising claims: concrete numbers, dates, named events, attributions, scientific/historical/causal assertions.",
  "Preserve each kept fact's original `chapterIndex` and a verbatim `quote`. Order the result by chapterIndex.",
  "Return the strongest claims first; prefer quality over quantity.",
].join("\n");

const CHECK_INSTRUCTIONS = [
  "You are a rigorous fact-checker with web search. You are given a single factual claim and the verbatim quote it came from.",
  "Use the web_search tool to find authoritative, current evidence. Search more than once if needed to corroborate or challenge the claim.",
  "Then return a verdict:",
  "- `supported`: reliable sources confirm the claim as stated.",
  "- `refuted`: reliable sources contradict the claim.",
  "- `misleading`: partially true but missing context, exaggerated, or framed in a way that misleads.",
  "- `unverifiable`: you could not find sufficient reliable evidence either way.",
  "Also return:",
  "- `confidence`: 0-1, how confident you are in the verdict given the evidence found.",
  "- `explanation`: 1-3 sentences citing what the evidence shows.",
  "- `sources`: the URLs and titles of the most relevant pages you relied on (omit if none).",
  "Judge ONLY the factual claim, not the speaker's tone or opinions.",
].join("\n");

type CallBreakdownEntry = {
  phase: "extract" | "prune" | "check";
  index?: number;
  status: "success" | "retried" | "fallback" | "failed";
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
};

export const factCheckBook = internalAction({
  args: { bookId: v.id("books") },
  handler: async (ctx, args) => {
    const begin = await ctx.runMutation(internal.facts.beginFactCheck, {
      bookId: args.bookId,
    });
    if (!begin) return null;
    const { jobId, userId, blocks, language } = begin;

    const model = process.env.READABOOK_OPENAI_MODEL ?? "gpt-5.5";
    const maxFacts = Number(
      process.env.READABOOK_FACTCHECK_MAX ?? DEFAULT_MAX_FACTS,
    );
    const startedAt = Date.now();

    // Aggregated spend across all steps, plus per-call detail and the estimated
    // web_search surcharge (one search per checked fact). Declared up front so
    // the catch can report partial spend.
    const agg: Tokens = { ...ZERO_TOKENS };
    const breakdown: CallBreakdownEntry[] = [];
    let usedTokenizer = false;
    let webSearches = 0;

    const logRequest = async (
      status: "success" | "failed",
      errorMessage?: string | null,
    ) => {
      await ctx.runMutation(internal.aiCosts.logAiRequest, {
        model,
        operation: "factCheck",
        status,
        inputTokens: agg.inputTokens,
        cachedInputTokens: agg.cachedInputTokens,
        outputTokens: agg.outputTokens,
        totalTokens: agg.totalTokens,
        tokenSource: usedTokenizer ? "tokenizer" : "usage",
        costUsd:
          status === "failed" && agg.outputTokens === 0
            ? 0
            : computeCostUsd({ model, ...agg }) +
              webSearchSurchargeUsd(webSearches),
        durationMs: Date.now() - startedAt,
        errorMessage: errorMessage ?? null,
        bookId: args.bookId,
        jobId: null,
        userId,
        callBreakdown: breakdown.length > 0 ? breakdown : undefined,
      });
    };

    if (!process.env.OPENAI_API_KEY) {
      await logRequest("failed", "OPENAI_API_KEY is not configured.");
      await ctx.runMutation(internal.facts.failFactCheck, {
        jobId,
        errorMessage: "Fact-checking is unavailable right now.",
      });
      return null;
    }

    try {
      const chapters = groupChapters(blocks as BookBlock[]);
      if (chapters.length === 0) {
        await logRequest("success");
        await ctx.runMutation(internal.facts.completeFactCheck, { jobId });
        return null;
      }

      // STEP 1 — EXTRACT candidate claims per chapter (bounded concurrency).
      // A single chapter's failure is tolerated (it just contributes no
      // candidates); only a total wipeout fails the job below.
      let extractErrors = 0;
      const perChapter = await mapWithConcurrency(
        chapters,
        CONCURRENCY,
        async (chapter, index) => {
          const input = [
            `Chapter title: ${chapter.title}`,
            `Book language: ${language}`,
            "Chapter text:",
            chapter.text,
          ].join("\n\n");
          try {
            const res = await runStructured({
              name: `Readabook fact extractor ch${index + 1}`,
              model,
              instructions: EXTRACT_INSTRUCTIONS,
              schema: extractSchema,
              input,
            });
            addTokens(agg, res.tokens);
            if (res.tokenSource === "tokenizer") usedTokenizer = true;
            breakdown.push({
              phase: "extract",
              index,
              status: "success",
              inputTokens: res.tokens.inputTokens,
              outputTokens: res.tokens.outputTokens,
              durationMs: res.durationMs,
            });
            return res.output.candidates.map((c) => ({
              chapterIndex: chapter.chapterIndex,
              statement: c.statement,
              quote: c.quote,
            }));
          } catch (err) {
            extractErrors += 1;
            const detail = describeError(err);
            console.error(
              `[factCheck] extract chapter ${index + 1} failed (book=${args.bookId}): ${detail}`,
              err,
            );
            addTokens(agg, estimateFailedTokens(EXTRACT_INSTRUCTIONS, input));
            breakdown.push({
              phase: "extract",
              index,
              status: "failed",
              inputTokens: estimateFailedTokens(EXTRACT_INSTRUCTIONS, input)
                .inputTokens,
              outputTokens: 0,
              durationMs: 0,
            });
            return [];
          }
        },
      );
      const candidates = perChapter.flat();

      // Every chapter failed to extract → genuine failure, not "no facts".
      if (candidates.length === 0 && extractErrors === chapters.length) {
        throw new Error("Fact extraction failed for every chapter.");
      }

      const chapterTitleByIndex = new Map(
        chapters.map((c) => [c.chapterIndex, c.title]),
      );

      // STEP 2 — PRUNE/REFINE to the meaningful, distinct claims.
      let pruned: Array<{
        chapterIndex: number;
        statement: string;
        quote: string;
      }> = [];
      if (candidates.length > 0) {
        await ctx.runMutation(internal.facts.setFactCheckStatus, {
          jobId,
          status: "pruning",
        });
        const pruneInput = [
          "Candidate claims (one per line as JSON):",
          ...candidates.map((c) =>
            JSON.stringify({
              chapterIndex: c.chapterIndex,
              statement: c.statement,
              quote: c.quote,
            }),
          ),
        ].join("\n");
        const pruneRes = await runStructured({
          name: "Readabook fact pruner",
          model,
          instructions: PRUNE_INSTRUCTIONS,
          schema: pruneSchema,
          input: pruneInput,
        });
        addTokens(agg, pruneRes.tokens);
        if (pruneRes.tokenSource === "tokenizer") usedTokenizer = true;
        breakdown.push({
          phase: "prune",
          status: "success",
          inputTokens: pruneRes.tokens.inputTokens,
          outputTokens: pruneRes.tokens.outputTokens,
          durationMs: pruneRes.durationMs,
        });
        // Keep only facts the model tied to a real chapter, then apply the cap.
        pruned = pruneRes.output.facts
          .filter((f) => chapterTitleByIndex.has(f.chapterIndex))
          .slice(0, maxFacts);
      }

      // Persist the pruned facts as `pending` and move into the checking phase.
      const factIds: Id<"bookFacts">[] = await ctx.runMutation(
        internal.facts.insertFacts,
        {
          jobId,
          facts: pruned.map((f) => ({
            chapterIndex: f.chapterIndex,
            chapterTitle: chapterTitleByIndex.get(f.chapterIndex) ?? "",
            statement: f.statement,
            quote: f.quote,
          })),
        },
      );

      // STEP 3 — CHECK each fact with web search (bounded concurrency). A single
      // fact's failure is recorded as `unverifiable`, never sinks the run.
      await mapWithConcurrency(pruned, CONCURRENCY, async (fact, index) => {
        const factId = factIds[index];
        const input = [
          `Claim: ${fact.statement}`,
          `Original quote: "${fact.quote}"`,
        ].join("\n");
        webSearches += 1;
        try {
          const res = await runStructured({
            name: `Readabook fact checker ${index + 1}`,
            model,
            instructions: CHECK_INSTRUCTIONS,
            schema: checkSchema,
            input,
            tools: [webSearchTool({ searchContextSize: "medium" })],
            maxTurns: 6,
          });
          addTokens(agg, res.tokens);
          if (res.tokenSource === "tokenizer") usedTokenizer = true;
          breakdown.push({
            phase: "check",
            index,
            status: "success",
            inputTokens: res.tokens.inputTokens,
            outputTokens: res.tokens.outputTokens,
            durationMs: res.durationMs,
          });
          await ctx.runMutation(internal.facts.recordFactVerdict, {
            jobId,
            factId,
            verdict: res.output.verdict,
            confidence: res.output.confidence,
            explanation: res.output.explanation,
            sources: res.output.sources,
          });
        } catch (err) {
          const detail = describeError(err);
          console.error(
            `[factCheck] check fact ${index + 1} failed (book=${args.bookId}): ${detail}`,
            err,
          );
          addTokens(agg, estimateFailedTokens(CHECK_INSTRUCTIONS, input));
          breakdown.push({
            phase: "check",
            index,
            status: "failed",
            inputTokens: estimateFailedTokens(CHECK_INSTRUCTIONS, input)
              .inputTokens,
            outputTokens: 0,
            durationMs: 0,
          });
          await ctx.runMutation(internal.facts.recordFactVerdict, {
            jobId,
            factId,
            verdict: "unverifiable",
            confidence: null,
            explanation: "Automated fact-check could not complete for this claim.",
            sources: [],
          });
        }
      });

      await logRequest("success");
      await ctx.runMutation(internal.facts.completeFactCheck, { jobId });
      return null;
    } catch (error) {
      const detail = describeError(error);
      console.error(
        `[factCheck] FAILED (book=${args.bookId}, model=${model}): ${detail}`,
        error,
      );
      await logRequest("failed", detail);
      await ctx.runMutation(internal.facts.failFactCheck, {
        jobId,
        errorMessage: "Fact-checking failed.",
      });
      return null;
    }
  },
});
