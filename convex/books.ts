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
  canonicalYoutubeUrl,
  checksum,
  extractYoutubeVideoId,
  parseBookMarkup,
  requireUser,
  saveBookForUser,
  touchUser,
} from "./lib";

const statusValidator = v.union(
  v.literal("queued"),
  v.literal("fetchingTranscript"),
  v.literal("transcriptPending"),
  v.literal("formatting"),
  v.literal("validating"),
  v.literal("completed"),
  v.literal("failed"),
);

const blockValidator = v.object({
  kind: v.union(
    v.literal("title"),
    v.literal("subtitle"),
    v.literal("chapter"),
    v.literal("section"),
    v.literal("quote"),
    v.literal("callout"),
    v.literal("paragraph"),
    v.literal("break"),
  ),
  text: v.string(),
});

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
        preservationScore: null,
        warnings: [],
        completedAt: null,
        failedAt: null,
        errorMessage: null,
      });
      book = await ctx.db.get(bookId);
    }

    if (!book) throw new Error("Unable to create book record.");

    await saveBookForUser(ctx, user._id, book._id, "submitted");

    let job = await ctx.db
      .query("bookJobs")
      .withIndex("by_bookId", (q) => q.eq("bookId", book._id))
      .unique();

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
    await requireUser(ctx);
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
    const user = await requireUser(ctx);
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
    const user = await requireUser(ctx);
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
    };
  },
});

export const completeBook = internalMutation({
  args: {
    jobId: v.id("bookJobs"),
    title: v.string(),
    subtitle: v.union(v.string(), v.null()),
    markup: v.string(),
    preservationScore: v.number(),
    warnings: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Job not found.");
    const blocks = parseBookMarkup(args.markup);
    if (blocks.length === 0) throw new Error("Formatted book has no content.");

    await ctx.db.patch(job.bookId, {
      status: "completed",
      title: args.title,
      subtitle: args.subtitle,
      markup: args.markup,
      blocks,
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

export const updateVideoMetadata = internalMutation({
  args: {
    videoId: v.id("videos"),
    title: v.union(v.string(), v.null()),
    channelName: v.union(v.string(), v.null()),
    thumbnailUrl: v.union(v.string(), v.null()),
    durationSeconds: v.union(v.number(), v.null()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.videoId, {
      title: args.title,
      channelName: args.channelName,
      thumbnailUrl: args.thumbnailUrl,
      durationSeconds: args.durationSeconds,
    });
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
