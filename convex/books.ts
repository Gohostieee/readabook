import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalQuery,
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import {
  type BookBlock,
  blocksToPlainText,
  canonicalYoutubeUrl,
  checksum,
  extractYoutubeVideoId,
  getExistingUser,
  saveBookForUser,
  touchUser,
} from "./lib";

const blockKindValidator = v.union(
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

const statusValidator = v.union(
  v.literal("queued"),
  v.literal("fetchingTranscript"),
  v.literal("transcriptPending"),
  v.literal("formatting"),
  v.literal("validating"),
  v.literal("completed"),
  v.literal("failed"),
);

const contentCategoryValidator = v.union(
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

function buildSearchText(args: {
  title: string;
  subtitle: string | null;
  blocks: BookBlock[];
  topics: string[];
}) {
  return [
    args.title,
    args.subtitle ?? "",
    args.topics.join(" "),
    blocksToPlainText(args.blocks),
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 900_000);
}

export const submitVideo = mutation({
  args: {
    url: v.string(),
    preferredLang: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await touchUser(ctx);
    const youtubeVideoId = extractYoutubeVideoId(args.url);
    if (!youtubeVideoId) throw new Error("Enter a valid YouTube video URL.");

    const preferredLang = args.preferredLang?.trim() || "en";
    const canonicalUrl = canonicalYoutubeUrl(youtubeVideoId);
    const now = Date.now();

    let video = await ctx.db
      .query("videos")
      .withIndex("by_youtubeVideoId", (q) =>
        q.eq("youtubeVideoId", youtubeVideoId),
      )
      .unique();

    if (!video) {
      const videoId = await ctx.db.insert("videos", {
        youtubeVideoId,
        url: args.url,
        canonicalUrl,
        title: null,
        channelName: null,
        thumbnailUrl: null,
        durationSeconds: null,
        preferredLang,
      });
      video = await ctx.db.get(videoId);
    }

    if (!video) throw new Error("Unable to create video record.");

    const bookKey = `${youtubeVideoId}:${preferredLang}:verbatim-first:v1`;
    let book = await ctx.db
      .query("books")
      .withIndex("by_bookKey", (q) => q.eq("bookKey", bookKey))
      .unique();

    if (!book) {
      const bookId = await ctx.db.insert("books", {
        videoId: video._id,
        bookKey,
        status: "queued",
        title: video.title ?? "Queued Readabook",
        subtitle: null,
        markup: "",
        blocks: [],
        transcriptPreview: "",
        transcriptChecksum: null,
        language: preferredLang,
        category: video.category,
        topics: [],
        searchText: "",
        preservationScore: null,
        warnings: [],
        completedAt: null,
        failedAt: null,
        errorMessage: null,
      });
      book = await ctx.db.get(bookId);
    }

    if (!book) throw new Error("Unable to create book record.");

    if (book.status === "failed") {
      await ctx.db.patch(book._id, {
        status: "queued",
        title: video.title ?? "Queued Readabook",
        subtitle: null,
        markup: "",
        blocks: [],
        category: video.category,
        topics: [],
        searchText: "",
        preservationScore: null,
        warnings: [],
        completedAt: null,
        failedAt: null,
        errorMessage: null,
      });
      book = (await ctx.db.get(book._id)) ?? book;
    }

    await saveBookForUser(ctx, user._id, book._id, "submitted");

    let job = await ctx.db
      .query("bookJobs")
      .withIndex("by_bookId", (q) => q.eq("bookId", book._id))
      .unique();

    if (job && book.status !== "completed") {
      await ctx.db.patch(job._id, {
        status: "queued",
        supadataJobId: null,
        attempts: 0,
        transcriptChars: 0,
        errorMessage: null,
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(0, internal.transcripts.fetchTranscript, {
        jobId: job._id,
      });
    }

    if (!job && book.status !== "completed") {
      const jobId = await ctx.db.insert("bookJobs", {
        bookId: book._id,
        userId: user._id,
        status: book.status,
        supadataJobId: null,
        attempts: 0,
        transcriptChars: 0,
        errorMessage: null,
        createdAt: now,
        updatedAt: now,
      });
      job = await ctx.db.get(jobId);
      await ctx.scheduler.runAfter(0, internal.transcripts.fetchTranscript, {
        jobId,
      });
    }

    return {
      bookId: book._id,
      jobId: job?._id ?? null,
      status: book.status,
      reused: book.status === "completed",
    };
  },
});

export const getBook = mutation({
  args: { bookId: v.id("books") },
  handler: async (ctx, args) => {
    const user = await touchUser(ctx);
    await saveBookForUser(ctx, user._id, args.bookId, "opened");

    const book = await ctx.db.get(args.bookId);
    if (!book) throw new Error("Book not found.");
    const video = await ctx.db.get(book.videoId);
    const job = await ctx.db
      .query("bookJobs")
      .withIndex("by_bookId", (q) => q.eq("bookId", args.bookId))
      .unique();

    return { book, video, job };
  },
});

export const getBookReadonly = query({
  args: { bookId: v.id("books") },
  handler: async (ctx, args) => {
    await ctx.auth.getUserIdentity();
    const book = await ctx.db.get(args.bookId);
    if (!book) return null;
    const video = await ctx.db.get(book.videoId);
    const job = await ctx.db
      .query("bookJobs")
      .withIndex("by_bookId", (q) => q.eq("bookId", args.bookId))
      .unique();
    return { book, video, job };
  },
});

export const listMyBooks = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const user = await getExistingUser(ctx);
    if (!user) {
      return {
        page: [],
        isDone: true,
        continueCursor: args.paginationOpts.cursor ?? "",
      };
    }

    const page = await ctx.db
      .query("userBooks")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .order("desc")
      .paginate(args.paginationOpts);

    const books = await Promise.all(
      page.page.map(async (saved) => {
        const book = await ctx.db.get(saved.bookId);
        const video = book ? await ctx.db.get(book.videoId) : null;
        return { saved, book, video };
      }),
    );

    return { ...page, page: books.filter((item) => item.book !== null) };
  },
});

export const getJob = query({
  args: { jobId: v.id("bookJobs") },
  handler: async (ctx, args) => {
    const user = await getExistingUser(ctx);
    if (!user) return null;
    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== user._id) return null;
    const book = await ctx.db.get(job.bookId);
    return { job, book };
  },
});

export const removeFromLibrary = mutation({
  args: { bookId: v.id("books") },
  handler: async (ctx, args) => {
    const user = await touchUser(ctx);
    const saved = await ctx.db
      .query("userBooks")
      .withIndex("by_userId_and_bookId", (q) =>
        q.eq("userId", user._id).eq("bookId", args.bookId),
      )
      .unique();

    if (saved) await ctx.db.delete(saved._id);
    return { removed: Boolean(saved) };
  },
});

export const markJobStatus = internalMutation({
  args: {
    jobId: v.id("bookJobs"),
    status: statusValidator,
    supadataJobId: v.optional(v.union(v.string(), v.null())),
    errorMessage: v.optional(v.union(v.string(), v.null())),
    transcriptChars: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return null;
    const now = Date.now();
    await ctx.db.patch(job.bookId, {
      status: args.status,
      errorMessage: args.errorMessage ?? null,
      failedAt: args.status === "failed" ? now : null,
    });
    await ctx.db.patch(args.jobId, {
      status: args.status,
      supadataJobId:
        args.supadataJobId === undefined ? job.supadataJobId : args.supadataJobId,
      errorMessage: args.errorMessage ?? null,
      transcriptChars: args.transcriptChars ?? job.transcriptChars,
      updatedAt: now,
    });
    return job;
  },
});

export const storeTranscript = internalMutation({
  args: {
    jobId: v.id("bookJobs"),
    language: v.string(),
    chunks: v.array(
      v.object({
        text: v.string(),
        offset: v.union(v.number(), v.null()),
        duration: v.union(v.number(), v.null()),
        lang: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Job not found.");
    const transcriptText = args.chunks.map((chunk) => chunk.text).join("\n\n");
    const preview = transcriptText.slice(0, 1800);

    const existing = await ctx.db
      .query("transcriptChunks")
      .withIndex("by_bookId_and_index", (q) => q.eq("bookId", job.bookId))
      .take(200);
    for (const chunk of existing) await ctx.db.delete(chunk._id);

    for (let index = 0; index < args.chunks.length; index += 1) {
      const chunk = args.chunks[index];
      await ctx.db.insert("transcriptChunks", {
        bookId: job.bookId,
        index,
        text: chunk.text,
        offset: chunk.offset,
        duration: chunk.duration,
        lang: chunk.lang,
      });
    }

    await ctx.db.patch(job.bookId, {
      status: "formatting",
      language: args.language,
      transcriptPreview: preview,
      transcriptChecksum: checksum(transcriptText),
      errorMessage: null,
    });
    await ctx.db.patch(args.jobId, {
      status: "formatting",
      // Reset the attempt counter now that the transcript stage succeeded so
      // the formatting stage gets its own fresh retry budget.
      attempts: 0,
      transcriptChars: transcriptText.length,
      errorMessage: null,
      updatedAt: Date.now(),
    });

    return { bookId: job.bookId, transcriptText };
  },
});

export const getFormattingPayload = internalQuery({
  args: { jobId: v.id("bookJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return null;
    const book = await ctx.db.get(job.bookId);
    if (!book) return null;
    const video = await ctx.db.get(book.videoId);
    const chunks = await ctx.db
      .query("transcriptChunks")
      .withIndex("by_bookId_and_index", (q) => q.eq("bookId", book._id))
      .order("asc")
      .take(8192);
    return {
      job,
      book,
      video,
      transcriptText: chunks.map((chunk) => chunk.text).join("\n\n"),
      // Ordered, numbered transcript chunks. The two-pass formatter feeds these
      // to the outline pass (numbered) and slices verbatim text by index for the
      // per-chapter fill pass.
      transcriptChunks: chunks.map((chunk) => ({
        index: chunk.index,
        text: chunk.text,
      })),
    };
  },
});

export const completeBook = internalMutation({
  args: {
    jobId: v.id("bookJobs"),
    title: v.string(),
    subtitle: v.union(v.string(), v.null()),
    blocks: v.array(
      v.object({
        kind: blockKindValidator,
        text: v.string(),
        data: v.optional(v.any()),
      }),
    ),
    readingMinutes: v.optional(v.number()),
    category: contentCategoryValidator,
    topics: v.array(v.string()),
    preservationScore: v.number(),
    warnings: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Job not found.");
    const blocks = args.blocks as BookBlock[];
    if (blocks.length === 0) throw new Error("Formatted book has no content.");

    await ctx.db.patch(job.bookId, {
      status: "completed",
      title: args.title,
      subtitle: args.subtitle,
      // Flattened plain text kept for back-compat / search / preview.
      markup: blocksToPlainText(blocks),
      blocks: args.blocks,
      readingMinutes: args.readingMinutes,
      category: args.category,
      topics: args.topics,
      searchText: buildSearchText({
        title: args.title,
        subtitle: args.subtitle,
        blocks,
        topics: args.topics,
      }),
      preservationScore: args.preservationScore,
      warnings: args.warnings,
      completedAt: Date.now(),
      failedAt: null,
      errorMessage: null,
    });

    await ctx.db.patch(args.jobId, {
      status: "completed",
      errorMessage: null,
      updatedAt: Date.now(),
    });

    return job.bookId;
  },
});

export const failOrRetryFormatting = internalMutation({
  args: {
    jobId: v.id("bookJobs"),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return null;
    const attempts = job.attempts + 1;
    const shouldRetry = attempts < 3;
    const status = shouldRetry ? "formatting" : "failed";
    const now = Date.now();

    await ctx.db.patch(args.jobId, {
      attempts,
      status,
      errorMessage: args.errorMessage,
      updatedAt: now,
    });
    await ctx.db.patch(job.bookId, {
      status,
      errorMessage: args.errorMessage,
      failedAt: shouldRetry ? null : now,
    });

    if (shouldRetry) {
      await ctx.scheduler.runAfter(1000, internal.formatter.formatBook, {
        jobId: args.jobId,
      });
    }

    return { shouldRetry, attempts };
  },
});

// YouTube intermittently rate-limits / captcha-walls the fallback transcript
// scraper, and Supadata can transiently fail too. Rather than surfacing a hard
// failure to the user, retry the whole transcript stage with exponential
// backoff for a generous number of attempts before giving up.
const MAX_TRANSCRIPT_ATTEMPTS = 500;

function transcriptRetryDelayMs(_attempts: number): number {
  // Retry quickly on a fixed interval.
  return 500;
}

export const failOrRetryTranscript = internalMutation({
  args: {
    jobId: v.id("bookJobs"),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return null;
    const attempts = job.attempts + 1;
    const shouldRetry = attempts < MAX_TRANSCRIPT_ATTEMPTS;
    const status = shouldRetry ? "fetchingTranscript" : "failed";
    const now = Date.now();

    await ctx.db.patch(args.jobId, {
      attempts,
      status,
      // Clear any stale Supadata job id so the retry starts the flow fresh.
      supadataJobId: null,
      errorMessage: args.errorMessage,
      updatedAt: now,
    });
    await ctx.db.patch(job.bookId, {
      status,
      errorMessage: args.errorMessage,
      failedAt: shouldRetry ? null : now,
    });

    if (shouldRetry) {
      await ctx.scheduler.runAfter(
        transcriptRetryDelayMs(attempts),
        internal.transcripts.fetchTranscript,
        { jobId: args.jobId },
      );
    }

    return { shouldRetry, attempts };
  },
});

export const updateVideoMetadata = internalMutation({
  args: {
    videoId: v.id("videos"),
    title: v.union(v.string(), v.null()),
    description: v.union(v.string(), v.null()),
    channelName: v.union(v.string(), v.null()),
    channelId: v.union(v.string(), v.null()),
    authorUsername: v.union(v.string(), v.null()),
    authorAvatarUrl: v.union(v.string(), v.null()),
    authorVerified: v.union(v.boolean(), v.null()),
    thumbnailUrl: v.union(v.string(), v.null()),
    durationSeconds: v.union(v.number(), v.null()),
    width: v.union(v.number(), v.null()),
    height: v.union(v.number(), v.null()),
    platform: v.union(v.string(), v.null()),
    sourceType: v.union(v.string(), v.null()),
    viewCount: v.union(v.number(), v.null()),
    likeCount: v.union(v.number(), v.null()),
    commentCount: v.union(v.number(), v.null()),
    shareCount: v.union(v.number(), v.null()),
    tags: v.array(v.string()),
    category: contentCategoryValidator,
    publishedAt: v.union(v.string(), v.null()),
    rawMetadata: v.any(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.videoId, {
      title: args.title,
      description: args.description,
      channelName: args.channelName,
      channelId: args.channelId,
      authorUsername: args.authorUsername,
      authorAvatarUrl: args.authorAvatarUrl,
      authorVerified: args.authorVerified,
      thumbnailUrl: args.thumbnailUrl,
      durationSeconds: args.durationSeconds,
      width: args.width,
      height: args.height,
      platform: args.platform ?? undefined,
      sourceType: args.sourceType ?? undefined,
      viewCount: args.viewCount,
      likeCount: args.likeCount,
      commentCount: args.commentCount,
      shareCount: args.shareCount,
      tags: args.tags,
      category: args.category,
      publishedAt: args.publishedAt,
      rawMetadata: args.rawMetadata,
    });

    if (args.title) {
      const books = await ctx.db
        .query("books")
        .withIndex("by_videoId", (q) => q.eq("videoId", args.videoId))
        .take(50);
      for (const book of books) {
        if (
          book.status !== "completed" &&
          (book.title === "Queued Readabook" || !book.title.trim())
        ) {
          await ctx.db.patch(book._id, {
            title: args.title,
            category: args.category,
          });
        }
      }
    }
  },
});

export const getBookForAction = internalQuery({
  args: { bookId: v.id("books") },
  handler: async (ctx, args) => await ctx.db.get(args.bookId),
});

export const getJobForAction = internalQuery({
  args: { jobId: v.id("bookJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return null;
    const book = await ctx.db.get(job.bookId);
    const video = book ? await ctx.db.get(book.videoId) : null;
    return { job, book, video };
  },
});
