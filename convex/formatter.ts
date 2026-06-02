"use node";

import { Agent, run } from "@openai/agents";
import { v } from "convex/values";
import { z } from "zod";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import {
  blocksToMarkup,
  fallbackBookFromTranscript,
  parseBookMarkup,
} from "./lib";

const formattedBookSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().nullable(),
  blocks: z
    .array(
      z.object({
        kind: z.enum([
          "title",
          "subtitle",
          "chapter",
          "section",
          "quote",
          "callout",
          "paragraph",
          "break",
        ]),
        text: z.string(),
      }),
    )
    .min(3),
  preservationScore: z.number().min(0).max(1),
  warnings: z.array(z.string()),
});

function normalizeWords(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2);
}

function estimatePreservation(transcript: string, markup: string) {
  const original = normalizeWords(transcript);
  if (original.length === 0) return 0;
  const generatedWords = new Set(normalizeWords(markup));
  const sample = original.filter((_, index) => index % Math.max(1, Math.floor(original.length / 800)) === 0);
  const matched = sample.filter((word) => generatedWords.has(word)).length;
  return matched / Math.max(1, sample.length);
}

function validateMarkup(transcript: string, markup: string) {
  const blocks = parseBookMarkup(markup);
  if (blocks.length < 3) throw new Error("Book output is too short.");
  const hasTitle = blocks.some((block) => block.kind === "title");
  const hasParagraph = blocks.some((block) => block.kind === "paragraph");
  if (!hasTitle || !hasParagraph) {
    throw new Error("Book output must include a title and paragraph content.");
  }

  const preservation = estimatePreservation(transcript, markup);
  if (preservation < 0.72) {
    throw new Error(
      `Book output changed too much transcript wording (${preservation.toFixed(2)} preservation).`,
    );
  }

  return { blocks, preservation };
}

export const formatBook = internalAction({
  args: { jobId: v.id("bookJobs") },
  handler: async (ctx, args) => {
    const payload = await ctx.runQuery(internal.books.getFormattingPayload, {
      jobId: args.jobId,
    });
    if (!payload) return null;

    const title = payload.video?.title ?? payload.book.title ?? "Untitled Readabook";
    const transcript = payload.transcriptText.trim();
    if (!transcript) {
      await ctx.runMutation(internal.books.failOrRetryFormatting, {
        jobId: args.jobId,
        errorMessage: "Transcript is empty.",
      });
      return null;
    }

    try {
      if (!process.env.OPENAI_API_KEY) {
        const fallback = fallbackBookFromTranscript(title, transcript);
        const validation = validateMarkup(transcript, fallback.markup);
        await ctx.runMutation(internal.books.completeBook, {
          jobId: args.jobId,
          title,
          subtitle: "A transcript-formatted book",
          markup: fallback.markup,
          preservationScore: validation.preservation,
          warnings: ["OPENAI_API_KEY is not configured; used transcript-preserving fallback formatting."],
        });
        return null;
      }

      const agent = new Agent({
        name: "Readabook transcript formatter",
        model: process.env.READABOOK_OPENAI_MODEL ?? "gpt-5.2",
        outputType: formattedBookSchema,
        instructions: [
          "You format YouTube transcripts into a polished book markup format for readabook.",
          "Do not summarize, paraphrase, reorder ideas, add facts, remove meaning, or invent content.",
          "Keep the transcript wording verbatim-first. You may add punctuation, line breaks, headings, and light filler cleanup only when the spoken content is preserved.",
          "Use these block kinds: title, subtitle, chapter, section, quote, callout, paragraph, break.",
          "Every meaningful spoken passage must appear in the book. Prefer many paragraph blocks over compressing content.",
          "Use quote/callout only for words or ideas clearly present in the transcript.",
        ].join("\n"),
      });

      const result = await run(
        agent,
        [
          `Video title: ${title}`,
          `Language: ${payload.book.language}`,
          "Return structured blocks only. Preserve the transcript wording.",
          "Transcript:",
          transcript,
        ].join("\n\n"),
        { maxTurns: 4 },
      );

      const output = formattedBookSchema.parse(result.finalOutput);
      const markup = blocksToMarkup(output.blocks);
      const validation = validateMarkup(transcript, markup);

      await ctx.runMutation(internal.books.completeBook, {
        jobId: args.jobId,
        title: output.title,
        subtitle: output.subtitle,
        markup,
        preservationScore: Math.max(output.preservationScore, validation.preservation),
        warnings: output.warnings,
      });
      return null;
    } catch (error) {
      const fallback = fallbackBookFromTranscript(title, transcript);
      const validation = validateMarkup(transcript, fallback.markup);
      await ctx.runMutation(internal.books.completeBook, {
        jobId: args.jobId,
        title,
        subtitle: "A transcript-formatted book",
        markup: fallback.markup,
        preservationScore: validation.preservation,
        warnings: [
          `OpenAI formatting failed; used transcript-preserving fallback. ${
            error instanceof Error ? error.message : "Book formatting failed."
          }`,
        ],
      });
      return null;
    }
  },
});
