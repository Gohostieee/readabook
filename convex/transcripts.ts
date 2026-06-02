"use node";

import { Supadata } from "@supadata/js";
import { v } from "convex/values";
import { fetchTranscript as fetchYoutubeTranscript } from "youtube-transcript";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

type SupadataTranscriptChunk = {
  text: string;
  offset?: number;
  duration?: number;
  lang?: string;
};

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
          text: chunk.text.trim(),
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
        text,
        offset: null,
        duration: null,
        lang: transcript.lang ?? fallbackLang,
      })),
  };
}

async function fetchTranscriptFallback(videoId: string, lang: string) {
  const transcript = await fetchYoutubeTranscript(videoId, { lang });
  return {
    language: lang,
    chunks: transcript
      .map((chunk) => ({
        text: chunk.text.trim(),
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
        const meta = metadata as {
          title?: string;
          author?: { displayName?: string; username?: string };
          thumbnail?: string;
          thumbnailUrl?: string;
          duration?: number;
        };
        await ctx.runMutation(internal.books.updateVideoMetadata, {
          videoId: video._id,
          title: meta.title ?? null,
          channelName:
            meta.author?.displayName ?? meta.author?.username ?? null,
          thumbnailUrl: meta.thumbnailUrl ?? meta.thumbnail ?? null,
          durationSeconds:
            typeof meta.duration === "number" ? meta.duration : null,
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
        await ctx.runMutation(internal.books.markJobStatus, {
          jobId: args.jobId,
          status: "failed",
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
      await ctx.runMutation(internal.books.markJobStatus, {
        jobId: args.jobId,
        status: "failed",
        errorMessage:
          error instanceof Error ? error.message : "Transcript polling failed.",
      });
      return null;
    }
  },
});
