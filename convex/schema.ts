import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const bookStatus = v.union(
  v.literal("queued"),
  v.literal("fetchingTranscript"),
  v.literal("transcriptPending"),
  v.literal("formatting"),
  v.literal("validating"),
  v.literal("completed"),
  v.literal("failed"),
);

const bookBlockKind = v.union(
  v.literal("title"),
  v.literal("subtitle"),
  v.literal("chapter"),
  v.literal("section"),
  v.literal("quote"),
  v.literal("pullquote"),
  v.literal("epigraph"),
  v.literal("callout"),
  v.literal("paragraph"),
  v.literal("dialogue"),
  v.literal("list"),
  v.literal("steps"),
  v.literal("diagram"),
  v.literal("keyTerm"),
  v.literal("stat"),
  v.literal("break"),
);

const factCheckStatus = v.union(
  v.literal("extracting"),
  v.literal("pruning"),
  v.literal("checking"),
  v.literal("completed"),
  v.literal("failed"),
);

const factVerdict = v.union(
  v.literal("pending"),
  v.literal("supported"),
  v.literal("refuted"),
  v.literal("misleading"),
  v.literal("unverifiable"),
);

const contentCategory = v.union(
  v.literal("fiction"),
  v.literal("nonfiction"),
  v.literal("education"),
  v.literal("business"),
  v.literal("science"),
  v.literal("technology"),
  v.literal("history"),
  v.literal("biography"),
  v.literal("philosophy"),
  v.literal("health"),
  v.literal("culture"),
  v.literal("news"),
  v.literal("tutorial"),
  v.literal("conversation"),
  v.literal("entertainment"),
  v.literal("other"),
);

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(),
    name: v.union(v.string(), v.null()),
    email: v.union(v.string(), v.null()),
    imageUrl: v.union(v.string(), v.null()),
    lastSeenAt: v.number(),
  }).index("by_tokenIdentifier", ["tokenIdentifier"]),

  videos: defineTable({
    youtubeVideoId: v.string(),
    url: v.string(),
    canonicalUrl: v.string(),
    platform: v.optional(v.string()),
    sourceType: v.optional(v.string()),
    title: v.union(v.string(), v.null()),
    description: v.optional(v.union(v.string(), v.null())),
    channelName: v.union(v.string(), v.null()),
    channelId: v.optional(v.union(v.string(), v.null())),
    authorUsername: v.optional(v.union(v.string(), v.null())),
    authorAvatarUrl: v.optional(v.union(v.string(), v.null())),
    authorVerified: v.optional(v.union(v.boolean(), v.null())),
    thumbnailUrl: v.union(v.string(), v.null()),
    durationSeconds: v.union(v.number(), v.null()),
    width: v.optional(v.union(v.number(), v.null())),
    height: v.optional(v.union(v.number(), v.null())),
    viewCount: v.optional(v.union(v.number(), v.null())),
    likeCount: v.optional(v.union(v.number(), v.null())),
    commentCount: v.optional(v.union(v.number(), v.null())),
    shareCount: v.optional(v.union(v.number(), v.null())),
    tags: v.optional(v.array(v.string())),
    category: v.optional(contentCategory),
    publishedAt: v.optional(v.union(v.string(), v.null())),
    rawMetadata: v.optional(v.any()),
    preferredLang: v.string(),
  }).index("by_youtubeVideoId", ["youtubeVideoId"]),

  books: defineTable({
    videoId: v.id("videos"),
    bookKey: v.string(),
    status: bookStatus,
    title: v.string(),
    subtitle: v.union(v.string(), v.null()),
    markup: v.string(),
    blocks: v.array(
      v.object({
        kind: bookBlockKind,
        text: v.string(),
        // Optional structured payload for rich block kinds (dialogue turns,
        // list items, diagram specs, callout variants, etc.). The Zod schema in
        // convex/formatter.ts is the authoritative shape guard; we keep this
        // loose so block types can evolve without a schema migration.
        data: v.optional(v.any()),
      }),
    ),
    readingMinutes: v.optional(v.number()),
    transcriptPreview: v.string(),
    transcriptChecksum: v.union(v.string(), v.null()),
    language: v.string(),
    category: v.optional(contentCategory),
    topics: v.optional(v.array(v.string())),
    searchText: v.optional(v.string()),
    preservationScore: v.union(v.number(), v.null()),
    warnings: v.array(v.string()),
    // Status of the post-formatting fact-check stage. Optional: absent on books
    // formatted before this layer existed, and on books still being formatted.
    factCheckStatus: v.optional(factCheckStatus),
    completedAt: v.union(v.number(), v.null()),
    failedAt: v.union(v.number(), v.null()),
    errorMessage: v.union(v.string(), v.null()),
  })
    .index("by_videoId", ["videoId"])
    .index("by_bookKey", ["bookKey"])
    .index("by_status", ["status"])
    .index("by_category", ["category"])
    .searchIndex("search_books", {
      searchField: "searchText",
      filterFields: ["category", "status"],
    }),

  transcriptChunks: defineTable({
    bookId: v.id("books"),
    index: v.number(),
    text: v.string(),
    offset: v.union(v.number(), v.null()),
    duration: v.union(v.number(), v.null()),
    lang: v.string(),
  }).index("by_bookId_and_index", ["bookId", "index"]),

  // One row per fact-checked statement. Facts are an unbounded per-book list, so
  // they live in their own table (never an array on `books`). Verdict/sources
  // start empty (`pending`) after extraction+pruning and are filled in as each
  // fact's web-search check lands, so the reader updates progressively.
  bookFacts: defineTable({
    bookId: v.id("books"),
    chapterIndex: v.number(),
    chapterTitle: v.string(),
    statement: v.string(),
    quote: v.string(),
    verdict: factVerdict,
    confidence: v.union(v.number(), v.null()),
    explanation: v.union(v.string(), v.null()),
    sources: v.array(v.object({ url: v.string(), title: v.string() })),
    checkedAt: v.union(v.number(), v.null()),
    createdAt: v.number(),
  })
    .index("by_bookId", ["bookId"])
    .index("by_bookId_and_chapterIndex", ["bookId", "chapterIndex"]),

  // Orchestration + progress for the post-formatting fact-check stage. Mirrors
  // the bookJobs pattern; `checkedFacts`/`totalFacts` drive the reader's
  // progress UI while step 3 runs.
  factCheckJobs: defineTable({
    bookId: v.id("books"),
    userId: v.id("users"),
    status: factCheckStatus,
    totalFacts: v.number(),
    checkedFacts: v.number(),
    attempts: v.number(),
    errorMessage: v.union(v.string(), v.null()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_bookId", ["bookId"]),

  userBooks: defineTable({
    userId: v.id("users"),
    bookId: v.id("books"),
    savedAt: v.number(),
    lastOpenedAt: v.number(),
    source: v.union(v.literal("submitted"), v.literal("opened"), v.literal("saved")),
  })
    .index("by_userId", ["userId"])
    .index("by_bookId", ["bookId"])
    .index("by_userId_and_bookId", ["userId", "bookId"]),

  bookJobs: defineTable({
    bookId: v.id("books"),
    userId: v.id("users"),
    status: bookStatus,
    supadataJobId: v.union(v.string(), v.null()),
    attempts: v.number(),
    transcriptChars: v.number(),
    errorMessage: v.union(v.string(), v.null()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_bookId", ["bookId"])
    .index("by_userId", ["userId"])
    .index("by_status", ["status"]),

  // Internal cost ledger: one row per LLM request so we can see exactly how
  // much each formatting run cost. Token counts come from the Agents SDK usage
  // when available, falling back to a local tokenizer estimate.
  aiRequestLogs: defineTable({
    model: v.string(),
    operation: v.string(),
    // success = model produced output; fallback = we used transcript fallback
    // (no API key / parse failure); failed = request threw with no fallback.
    status: v.union(
      v.literal("success"),
      v.literal("fallback"),
      v.literal("failed"),
    ),
    inputTokens: v.number(),
    cachedInputTokens: v.number(),
    outputTokens: v.number(),
    totalTokens: v.number(),
    // How token counts were obtained: the SDK's reported usage or our local
    // tokenizer estimate.
    tokenSource: v.union(v.literal("usage"), v.literal("tokenizer")),
    costUsd: v.number(),
    durationMs: v.number(),
    errorMessage: v.union(v.string(), v.null()),
    bookId: v.union(v.id("books"), v.null()),
    jobId: v.union(v.id("bookJobs"), v.null()),
    userId: v.union(v.id("users"), v.null()),
    createdAt: v.number(),
    // Optional per-call breakdown for multi-call formatting runs (two-pass:
    // one outline call + N chapter fill calls). Absent on single-call runs and
    // older rows. The aggregated row above sums these; this is for debugging.
    callBreakdown: v.optional(
      v.array(
        v.object({
          phase: v.union(
            v.literal("outline"),
            v.literal("chapter"),
            v.literal("single"),
            v.literal("extract"),
            v.literal("prune"),
            v.literal("check"),
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
  })
    .index("by_bookId", ["bookId"])
    .index("by_jobId", ["jobId"])
    .index("by_userId", ["userId"])
    .index("by_createdAt", ["createdAt"]),
});
