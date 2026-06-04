"use node";

import { Supadata } from "@supadata/js";
import { v } from "convex/values";
import { fetchTranscript as fetchYoutubeTranscript } from "youtube-transcript";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { cleanTranscriptText } from "./lib";

type SupadataTranscriptChunk = {
  text: string;
  offset?: number;
  duration?: number;
  lang?: string;
};

type ContentCategory =
  | "fiction"
  | "nonfiction"
  | "education"
  | "business"
  | "science"
  | "technology"
  | "history"
  | "biography"
  | "philosophy"
  | "health"
  | "culture"
  | "news"
  | "tutorial"
  | "conversation"
  | "entertainment"
  | "other";

type SupadataMetadata = {
  platform?: string;
  type?: string;
  id?: string;
  url?: string;
  title?: string | null;
  description?: string | null;
  author?: {
    username?: string | null;
    displayName?: string | null;
    avatarUrl?: string | null;
    verified?: boolean | null;
  };
  stats?: {
    views?: number | null;
    likes?: number | null;
    comments?: number | null;
    shares?: number | null;
  };
  media?: {
    type?: string;
    duration?: number;
    width?: number;
    height?: number;
    thumbnailUrl?: string;
    items?: Array<{ thumbnailUrl?: string; width?: number; height?: number }>;
  };
  tags?: string[];
  createdAt?: string | null;
  thumbnail?: string;
  thumbnailUrl?: string;
  duration?: number;
  channel?: { id?: string | null; name?: string | null };
  additionalData?: Record<string, unknown>;
};

const categoryKeywords: Array<[ContentCategory, string[]]> = [
  ["tutorial", ["how to", "tutorial", "guide", "lesson", "walkthrough"]],
  ["technology", ["ai", "software", "coding", "programming", "computer", "tech"]],
  ["science", ["science", "physics", "biology", "chemistry", "space"]],
  ["business", ["business", "startup", "marketing", "sales", "money"]],
  ["history", ["history", "ancient", "war", "empire", "century"]],
  ["biography", ["biography", "memoir", "life of", "interview with"]],
  ["philosophy", ["philosophy", "meaning", "ethics", "stoic"]],
  ["health", ["health", "fitness", "nutrition", "medical", "therapy"]],
  ["news", ["news", "breaking", "politics", "election", "today"]],
  ["conversation", ["podcast", "interview", "conversation", "q&a"]],
  ["education", ["education", "learn", "course", "lecture", "explained"]],
  ["fiction", ["story", "novel", "fiction", "fantasy", "sci-fi"]],
  ["culture", ["culture", "society", "art", "music", "film"]],
  ["entertainment", ["comedy", "reaction", "review", "gaming", "show"]],
];

function inferCategory(meta: SupadataMetadata): ContentCategory {
  const haystack = [
    meta.title ?? "",
    meta.description ?? "",
    ...(meta.tags ?? []),
  ]
    .join(" ")
    .toLowerCase();

  for (const [category, keywords] of categoryKeywords) {
    if (keywords.some((keyword) => haystack.includes(keyword))) {
      return category;
    }
  }
  return "other";
}

function jsonSafe(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? null)) as unknown;
}

function getSupadataClient() {
  const apiKey = process.env.SUPADATA_API_KEY;
  if (!apiKey) throw new Error("SUPADATA_API_KEY is not configured.");
  return new Supadata({ apiKey });
}

function normalizeTranscript(result: unknown, fallbackLang: string) {
  const transcript = result as {
    content?: string | SupadataTranscriptChunk[];
    lang?: string;
  };

  if (Array.isArray(transcript.content)) {
    return {
      language: transcript.lang ?? fallbackLang,
      chunks: transcript.content
        .map((chunk) => ({
          text: cleanTranscriptText(chunk.text),
          offset: typeof chunk.offset === "number" ? chunk.offset : null,
          duration: typeof chunk.duration === "number" ? chunk.duration : null,
          lang: chunk.lang ?? transcript.lang ?? fallbackLang,
        }))
        .filter((chunk) => chunk.text.length > 0),
    };
  }

  const content = typeof transcript.content === "string" ? transcript.content : "";
  return {
    language: transcript.lang ?? fallbackLang,
    chunks: content
      .split(/\n{2,}/)
      .map((text) => text.trim())
      .filter(Boolean)
      .map((text) => ({
        text: cleanTranscriptText(text),
        offset: null,
        duration: null,
        lang: transcript.lang ?? fallbackLang,
      }))
      .filter((chunk) => chunk.text.length > 0),
  };
}

async function fetchTranscriptFallback(videoId: string, lang: string) {
  const transcript = await fetchYoutubeTranscript(videoId, { lang });
  return {
    language: lang,
    chunks: transcript
      .map((chunk) => ({
        text: cleanTranscriptText(chunk.text),
        offset: typeof chunk.offset === "number" ? chunk.offset : null,
        duration: typeof chunk.duration === "number" ? chunk.duration : null,
        lang,
      }))
      .filter((chunk) => chunk.text.length > 0),
  };
}

export const fetchTranscript = internalAction({
  args: { jobId: v.id("bookJobs") },
  handler: async (ctx, args) => {
    const jobPayload = await ctx.runQuery(internal.books.getJobForAction, {
      jobId: args.jobId,
    });
    if (!jobPayload?.book || !jobPayload.video) {
      await ctx.runMutation(internal.books.markJobStatus, {
        jobId: args.jobId,
        status: "failed",
        errorMessage: "Job not found.",
      });
      return null;
    }

    const book = jobPayload.book;
    const video = jobPayload.video;

    await ctx.runMutation(internal.books.markJobStatus, {
      jobId: args.jobId,
      status: "fetchingTranscript",
    });

    try {
      const supadata = getSupadataClient();
      const [transcriptOrJob, metadata] = await Promise.all([
        supadata.transcript({
          url: video.canonicalUrl,
          lang: book.language,
          text: false,
          mode: "auto",
          chunkSize: 800,
        }),
        supadata.metadata({ url: video.canonicalUrl }).catch(() => null),
      ]);

      if (metadata) {
        const meta = metadata as SupadataMetadata;
        const media =
          meta.media?.type === "carousel" ? meta.media.items?.[0] : meta.media;
        const mediaDuration =
          meta.media?.type === "video" &&
          typeof meta.media.duration === "number"
            ? meta.media.duration
            : null;
        await ctx.runMutation(internal.books.updateVideoMetadata, {
          videoId: video._id,
          title: meta.title ?? null,
          description: meta.description ?? null,
          channelName:
            meta.author?.displayName ??
            meta.channel?.name ??
            meta.author?.username ??
            null,
          channelId: meta.channel?.id ?? null,
          authorUsername: meta.author?.username ?? null,
          authorAvatarUrl: meta.author?.avatarUrl ?? null,
          authorVerified:
            typeof meta.author?.verified === "boolean"
              ? meta.author.verified
              : null,
          thumbnailUrl:
            media?.thumbnailUrl ?? meta.thumbnailUrl ?? meta.thumbnail ?? null,
          durationSeconds:
            mediaDuration ??
            (typeof meta.duration === "number"
                ? meta.duration
                : null),
          width: typeof media?.width === "number" ? media.width : null,
          height: typeof media?.height === "number" ? media.height : null,
          platform: meta.platform ?? null,
          sourceType: meta.type ?? null,
          viewCount:
            typeof meta.stats?.views === "number" ? meta.stats.views : null,
          likeCount:
            typeof meta.stats?.likes === "number" ? meta.stats.likes : null,
          commentCount:
            typeof meta.stats?.comments === "number"
              ? meta.stats.comments
              : null,
          shareCount:
            typeof meta.stats?.shares === "number" ? meta.stats.shares : null,
          tags: meta.tags ?? [],
          category: inferCategory(meta),
          publishedAt: meta.createdAt ?? null,
          rawMetadata: jsonSafe(meta),
        });
      }

      if ("jobId" in transcriptOrJob) {
        await ctx.runMutation(internal.books.markJobStatus, {
          jobId: args.jobId,
          status: "transcriptPending",
          supadataJobId: transcriptOrJob.jobId,
        });
        await ctx.scheduler.runAfter(5000, internal.transcripts.pollTranscript, {
          jobId: args.jobId,
        });
        return null;
      }

      const normalized = normalizeTranscript(transcriptOrJob, book.language);
      if (normalized.chunks.length === 0) {
        throw new Error("Supadata returned an empty transcript.");
      }

      await ctx.runMutation(internal.books.storeTranscript, {
        jobId: args.jobId,
        language: normalized.language,
        chunks: normalized.chunks,
      });
      await ctx.scheduler.runAfter(0, internal.formatter.formatBook, {
        jobId: args.jobId,
      });
      return null;
    } catch (error) {
      try {
        const normalized = await fetchTranscriptFallback(
          video.youtubeVideoId,
          book.language,
        );
        if (normalized.chunks.length === 0) {
          throw new Error("Fallback transcript returned no chunks.");
        }
        await ctx.runMutation(internal.books.storeTranscript, {
          jobId: args.jobId,
          language: normalized.language,
          chunks: normalized.chunks,
        });
        await ctx.scheduler.runAfter(0, internal.formatter.formatBook, {
          jobId: args.jobId,
        });
      } catch (fallbackError) {
        const primaryMessage =
          error instanceof Error ? error.message : "Transcript fetch failed.";
        const fallbackMessage =
          fallbackError instanceof Error
            ? fallbackError.message
            : "Fallback transcript fetch failed.";
        await ctx.runMutation(internal.books.failOrRetryTranscript, {
          jobId: args.jobId,
          errorMessage: `${primaryMessage}; fallback failed: ${fallbackMessage}`,
        });
      }
      return null;
    }
  },
});

export const pollTranscript = internalAction({
  args: { jobId: v.id("bookJobs") },
  handler: async (ctx, args) => {
    const jobPayload = await ctx.runQuery(internal.books.getJobForAction, {
      jobId: args.jobId,
    });
    const job = jobPayload?.job;
    const book = jobPayload?.book;
    if (!job || !book || !job.supadataJobId) return null;

    try {
      const supadata = getSupadataClient();
      const result = await supadata.transcript.getJobStatus(job.supadataJobId);

      if (result.status === "queued" || result.status === "active") {
        await ctx.scheduler.runAfter(5000, internal.transcripts.pollTranscript, {
          jobId: args.jobId,
        });
        return null;
      }

      if (result.status !== "completed" || !result.result) {
        throw new Error(result.error?.message ?? "Transcript job failed.");
      }

      const normalized = normalizeTranscript(result.result, book.language);
      if (normalized.chunks.length === 0) {
        throw new Error("Supadata completed with an empty transcript.");
      }

      await ctx.runMutation(internal.books.storeTranscript, {
        jobId: args.jobId,
        language: normalized.language,
        chunks: normalized.chunks,
      });
      await ctx.scheduler.runAfter(0, internal.formatter.formatBook, {
        jobId: args.jobId,
      });
      return null;
    } catch (error) {
      await ctx.runMutation(internal.books.failOrRetryTranscript, {
        jobId: args.jobId,
        errorMessage:
          error instanceof Error ? error.message : "Transcript polling failed.",
      });
      return null;
    }
  },
});
