import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, query } from "./_generated/server";

// ---------------------------------------------------------------------------
// Database functions for the post-formatting fact-check stage. These live in a
// non-"use node" file so they can touch the DB; the agent orchestration that
// calls the model lives in convex/factChecker.ts ("use node").
// ---------------------------------------------------------------------------

const factCheckStatusValidator = v.union(
  v.literal("extracting"),
  v.literal("pruning"),
  v.literal("checking"),
  v.literal("completed"),
  v.literal("failed"),
);

const verdictValidator = v.union(
  v.literal("supported"),
  v.literal("refuted"),
  v.literal("misleading"),
  v.literal("unverifiable"),
);

const sourceValidator = v.object({ url: v.string(), title: v.string() });

// Create (or reset) the fact-check job for a book and hand the action everything
// it needs to run: the job id and the book's blocks/language. Idempotent — a
// re-run reuses the existing job row and clears any prior facts so the stage can
// safely be retried.
export const beginFactCheck = internalMutation({
  args: { bookId: v.id("books") },
  handler: async (ctx, args) => {
    const book = await ctx.db.get(args.bookId);
    if (!book) return null;

    // userId is needed for the cost ledger / ownership; pull it from the book's
    // formatting job (every book has one).
    const bookJob = await ctx.db
      .query("bookJobs")
      .withIndex("by_bookId", (q) => q.eq("bookId", args.bookId))
      .order("desc")
      .first();
    if (!bookJob) return null;

    // Clear any facts from a previous run so progress counts start clean.
    const prior = await ctx.db
      .query("bookFacts")
      .withIndex("by_bookId", (q) => q.eq("bookId", args.bookId))
      .take(1000);
    for (const fact of prior) await ctx.db.delete(fact._id);

    const now = Date.now();
    const existing = await ctx.db
      .query("factCheckJobs")
      .withIndex("by_bookId", (q) => q.eq("bookId", args.bookId))
      .first();

    let jobId: Id<"factCheckJobs">;
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "extracting",
        totalFacts: 0,
        checkedFacts: 0,
        attempts: existing.attempts + 1,
        errorMessage: null,
        updatedAt: now,
      });
      jobId = existing._id;
    } else {
      jobId = await ctx.db.insert("factCheckJobs", {
        bookId: args.bookId,
        userId: bookJob.userId,
        status: "extracting",
        totalFacts: 0,
        checkedFacts: 0,
        attempts: 0,
        errorMessage: null,
        createdAt: now,
        updatedAt: now,
      });
    }

    await ctx.db.patch(args.bookId, { factCheckStatus: "extracting" });

    return {
      jobId,
      userId: bookJob.userId,
      blocks: book.blocks,
      language: book.language,
    };
  },
});

// Move the job (and the book's quick-status mirror) to a new step status.
export const setFactCheckStatus = internalMutation({
  args: {
    jobId: v.id("factCheckJobs"),
    status: factCheckStatusValidator,
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return null;
    await ctx.db.patch(args.jobId, {
      status: args.status,
      updatedAt: Date.now(),
    });
    await ctx.db.patch(job.bookId, { factCheckStatus: args.status });
    return null;
  },
});

// Persist the pruned facts as `pending` rows and move the job into the checking
// phase with the total count. Returns the new fact ids in input order so the
// action can patch each verdict as its check lands.
export const insertFacts = internalMutation({
  args: {
    jobId: v.id("factCheckJobs"),
    facts: v.array(
      v.object({
        chapterIndex: v.number(),
        chapterTitle: v.string(),
        statement: v.string(),
        quote: v.string(),
      }),
    ),
  },
  handler: async (ctx, args): Promise<Id<"bookFacts">[]> => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Fact-check job not found.");

    const now = Date.now();
    const ids: Id<"bookFacts">[] = [];
    for (const fact of args.facts) {
      const id = await ctx.db.insert("bookFacts", {
        bookId: job.bookId,
        chapterIndex: fact.chapterIndex,
        chapterTitle: fact.chapterTitle,
        statement: fact.statement,
        quote: fact.quote,
        verdict: "pending",
        confidence: null,
        explanation: null,
        sources: [],
        checkedAt: null,
        createdAt: now,
      });
      ids.push(id);
    }

    await ctx.db.patch(args.jobId, {
      status: "checking",
      totalFacts: args.facts.length,
      checkedFacts: 0,
      updatedAt: now,
    });
    await ctx.db.patch(job.bookId, { factCheckStatus: "checking" });

    return ids;
  },
});

// Patch one fact with its verdict and bump the job's progress counter. Runs as
// its own transaction per fact; concurrent calls contend only on the job row,
// which Convex resolves with OCC retries.
export const recordFactVerdict = internalMutation({
  args: {
    jobId: v.id("factCheckJobs"),
    factId: v.id("bookFacts"),
    verdict: verdictValidator,
    confidence: v.union(v.number(), v.null()),
    explanation: v.union(v.string(), v.null()),
    sources: v.array(sourceValidator),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.factId, {
      verdict: args.verdict,
      confidence: args.confidence,
      explanation: args.explanation,
      sources: args.sources,
      checkedAt: Date.now(),
    });
    const job = await ctx.db.get(args.jobId);
    if (job) {
      await ctx.db.patch(args.jobId, {
        checkedFacts: job.checkedFacts + 1,
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});

export const completeFactCheck = internalMutation({
  args: { jobId: v.id("factCheckJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return null;
    await ctx.db.patch(args.jobId, {
      status: "completed",
      errorMessage: null,
      updatedAt: Date.now(),
    });
    await ctx.db.patch(job.bookId, { factCheckStatus: "completed" });
    return null;
  },
});

export const failFactCheck = internalMutation({
  args: { jobId: v.id("factCheckJobs"), errorMessage: v.string() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return null;
    await ctx.db.patch(args.jobId, {
      status: "failed",
      errorMessage: args.errorMessage,
      updatedAt: Date.now(),
    });
    await ctx.db.patch(job.bookId, { factCheckStatus: "failed" });
    return null;
  },
});

// Facts for a book, ordered by chapter then creation — used by the reader to
// render highlights and the fact-check panel. Bounded read keeps it efficient.
export const listFacts = query({
  args: { bookId: v.id("books") },
  handler: async (ctx, args) => {
    const facts = await ctx.db
      .query("bookFacts")
      .withIndex("by_bookId_and_chapterIndex", (q) =>
        q.eq("bookId", args.bookId),
      )
      .take(500);
    return facts;
  },
});
