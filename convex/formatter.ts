"use node";

import { Agent, run } from "@openai/agents";
import { v } from "convex/values";
import { encode } from "gpt-tokenizer/encoding/o200k_base";
import { z } from "zod";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { computeCostUsd } from "./aiCosts";
import {
  type BookBlock,
  blocksToPlainText,
  fallbackBookFromTranscript,
} from "./lib";

// ---------------------------------------------------------------------------
// Structured output schema
//
// Every block carries `kind` + `text` (the verbatim/plain spoken content used
// for preservation scoring) plus an optional typed `data` payload for rich
// kinds. We use a discriminated union so the model is steered toward valid
// shapes for each block type.
// ---------------------------------------------------------------------------

const dialogueData = z.object({
  turns: z
    .array(z.object({ speaker: z.string(), text: z.string() }))
    .min(1),
});

const listData = z.object({
  ordered: z.boolean(),
  items: z
    .array(
      z.object({
        text: z.string(),
        subitems: z.array(z.string()).nullable(),
      }),
    )
    .min(1),
});

const stepsData = z.object({
  steps: z
    .array(z.object({ title: z.string().nullable(), text: z.string() }))
    .min(1),
});

const calloutData = z.object({
  variant: z.enum(["note", "key-insight", "definition", "warning", "tip"]),
});

const keyTermData = z.object({ term: z.string(), definition: z.string() });

const statData = z.object({
  value: z.string(),
  label: z.string(),
  context: z.string().nullable(),
});

const quoteData = z.object({ attribution: z.string().nullable() });

const paragraphData = z.object({ dropcap: z.boolean().nullable() });

const diagramData = z.discriminatedUnion("variant", [
  z.object({
    variant: z.literal("flow"),
    steps: z
      .array(z.object({ label: z.string(), detail: z.string().nullable() }))
      .min(2),
  }),
  z.object({
    variant: z.literal("comparison"),
    columns: z.array(z.string()).min(2),
    rows: z
      .array(z.object({ label: z.string(), cells: z.array(z.string()) }))
      .min(1),
  }),
  z.object({
    variant: z.literal("timeline"),
    events: z
      .array(
        z.object({
          when: z.string().nullable(),
          label: z.string(),
          detail: z.string().nullable(),
        }),
      )
      .min(2),
  }),
  z.object({
    variant: z.literal("hierarchy"),
    nodes: z
      .array(z.object({ label: z.string(), depth: z.number().int().min(0) }))
      .min(2),
  }),
  z.object({
    variant: z.literal("cycle"),
    nodes: z.array(z.object({ label: z.string() })).min(2),
  }),
  z.object({
    variant: z.literal("quadrant"),
    // OpenAI structured outputs reject JSON-schema tuples (`items` as an array
    // of schemas), so each axis is a fixed-key object instead of a [low, high]
    // tuple.
    axes: z.object({
      x: z.object({ low: z.string(), high: z.string() }),
      y: z.object({ low: z.string(), high: z.string() }),
    }),
    items: z
      .array(z.object({ label: z.string(), x: z.number(), y: z.number() }))
      .min(1),
  }),
]);

// Body blocks the per-chapter FILL pass may emit. `title`/`subtitle`/`chapter`
// are NOT here — those are produced by the OUTLINE pass and assembled in code,
// so the fill model only ever generates content blocks within a chapter.
const bodyBlock = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("section"), text: z.string() }),
  z.object({
    kind: z.literal("paragraph"),
    text: z.string(),
    data: paragraphData.nullable(),
  }),
  z.object({
    kind: z.literal("quote"),
    text: z.string(),
    data: quoteData.nullable(),
  }),
  z.object({
    kind: z.literal("pullquote"),
    text: z.string(),
    data: quoteData.nullable(),
  }),
  z.object({
    kind: z.literal("epigraph"),
    text: z.string(),
    data: quoteData.nullable(),
  }),
  z.object({
    kind: z.literal("callout"),
    text: z.string(),
    data: calloutData,
  }),
  z.object({
    kind: z.literal("dialogue"),
    text: z.string(),
    data: dialogueData,
  }),
  z.object({ kind: z.literal("list"), text: z.string(), data: listData }),
  z.object({ kind: z.literal("steps"), text: z.string(), data: stepsData }),
  z.object({
    kind: z.literal("diagram"),
    text: z.string(),
    data: diagramData,
  }),
  z.object({
    kind: z.literal("keyTerm"),
    text: z.string(),
    data: keyTermData,
  }),
  z.object({ kind: z.literal("stat"), text: z.string(), data: statData }),
  z.object({ kind: z.literal("break"), text: z.string() }),
]);

const categoryEnum = z.enum([
  "fiction",
  "nonfiction",
  "education",
  "business",
  "science",
  "technology",
  "history",
  "biography",
  "philosophy",
  "health",
  "culture",
  "news",
  "tutorial",
  "conversation",
  "entertainment",
  "other",
]);

// PASS 1 output: book-level metadata + chapter boundaries referencing numbered
// transcript chunks. No verbatim body text, which keeps this call cheap.
const outlineSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().nullable(),
  category: categoryEnum,
  topics: z.array(z.string()).max(12),
  chapters: z
    .array(
      z.object({
        title: z.string().min(1),
        act: z.string().nullable(),
        summary: z.string().nullable(),
        startChunk: z.number().int().min(0),
        endChunk: z.number().int().min(0),
      }),
    )
    .min(1),
});

// PASS 2 output: the body blocks for a single chapter's transcript span.
const fillSchema = z.object({ blocks: z.array(bodyBlock).min(1) });

type FillOutput = z.infer<typeof fillSchema>;
type OutlineOutput = z.infer<typeof outlineSchema>;
type OutlineChapter = OutlineOutput["chapters"][number];

// Normalize the model output (which uses `null` for absent fields) into the
// loosely-typed BookBlock[] we persist. Strips nulls out of `data`.
function toBookBlocks(blocks: FillOutput["blocks"]): BookBlock[] {
  return blocks.map((b) => {
    const data = "data" in b ? b.data : undefined;
    return {
      kind: b.kind,
      text: b.text,
      ...(data ? { data: stripNulls(data) } : {}),
    };
  });
}

function stripNulls<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripNulls(item)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (val === null) continue;
      out[key] = stripNulls(val);
    }
    return out as T;
  }
  return value;
}

const PRESERVATION_THRESHOLD = 0.6;

function normalizeWords(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2);
}

function estimatePreservation(transcript: string, bookText: string) {
  const original = normalizeWords(transcript);
  if (original.length === 0) return 0;
  const generatedWords = new Set(normalizeWords(bookText));
  const sample = original.filter(
    (_, index) =>
      index % Math.max(1, Math.floor(original.length / 800)) === 0,
  );
  const matched = sample.filter((word) => generatedWords.has(word)).length;
  return matched / Math.max(1, sample.length);
}

function validateBlocks(transcript: string, blocks: BookBlock[]) {
  if (blocks.length < 3) throw new Error("Book output is too short.");
  const hasTitle = blocks.some((b) => b.kind === "title");
  const hasBody = blocks.some(
    (b) =>
      b.kind === "paragraph" ||
      b.kind === "dialogue" ||
      b.kind === "list" ||
      b.kind === "steps",
  );
  if (!hasTitle || !hasBody) {
    throw new Error("Book output must include a title and body content.");
  }

  const preservation = estimatePreservation(
    transcript,
    blocksToPlainText(blocks),
  );
  if (preservation < PRESERVATION_THRESHOLD) {
    throw new Error(
      `Book output changed too much transcript wording (${preservation.toFixed(2)} preservation).`,
    );
  }
  return { preservation };
}

function estimateReadingMinutes(blocks: BookBlock[]) {
  const words = blocksToPlainText(blocks).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

const INSTRUCTIONS = [
  "You are the readabook book editor. You transform a raw YouTube transcript into a richly structured, beautifully readable book WITHOUT changing what was said.",
  "",
  "VERBATIM-FIRST (non-negotiable):",
  "- Never summarize, paraphrase, reorder ideas, invent facts, or remove meaning.",
  "- Preserve the speaker's wording. You may only add punctuation, capitalization, paragraph breaks, and remove pure filler ('um', 'uh', false starts) when meaning is unchanged.",
  "- Every meaningful spoken passage must survive somewhere in the book.",
  "",
  "STRUCTURE THE BOOK (this is the real value you add):",
  "- Segment the transcript into a sequence of chapters that follow the natural 'acts' of the video (setup, exploration, turning points, conclusion). Give each chapter a short evocative title, an optional `act` label (e.g. 'Act I', 'The Setup'), and a one-line `summary` for the table of contents.",
  "- Within chapters, use `section` headings to mark sub-topics.",
  "",
  "READ THE CONTENT AND CHOOSE THE RIGHT FORM. Detect what is actually happening and represent it faithfully:",
  "- A back-and-forth, interview, or Q&A => `dialogue` with speaker-labeled turns (use real names if stated, otherwise 'Host'/'Guest'/'Speaker').",
  "- An enumeration of items => `list` (ordered when sequence matters).",
  "- A described procedure or how-to => `steps`.",
  "- A described process/pipeline => `diagram` variant 'flow'; an explicit comparison => 'comparison'; chronological events => 'timeline'; a structure/taxonomy => 'hierarchy' (use depth 0,1,2 for nesting); a repeating loop => 'cycle'; a two-axis tradeoff => 'quadrant'. Only emit a diagram when the transcript genuinely describes that structure; every label must come from spoken content.",
  "- A memorable, quotable line => `pullquote`. An opening line that sets a chapter's tone => `epigraph`. A direct attributed quotation => `quote`.",
  "- A definition of a term => `keyTerm`. A notable number/metric => `stat`. A key takeaway or aside worth highlighting => `callout` (pick the best variant: note, key-insight, definition, warning, tip).",
  "- Everything else => `paragraph`. Set data.dropcap=true on the first paragraph of a chapter.",
  "",
  "BALANCE: Prefer many faithful blocks over compression. Use rich kinds when the content supports them, but do not force structure onto plain narration — most blocks will be paragraphs. The `text` field of every block MUST contain the spoken words for that block (for dialogue/list/diagram, concatenate the spoken content).",
  "",
  "Also return an honest `preservationScore` (0-1) estimate and any `warnings`. Estimate `readingMinutes`.",
  "",
  "DISCOVERY METADATA:",
  "- Return exactly one broad `category` from the provided enum.",
  "- Return up to 12 concise `topics` that future search can match against. Prefer named people, books, concepts, methods, genres, and subject areas that are actually present in the source.",
].join("\n");

// Pull a normalized token breakdown out of the Agents SDK usage object. Cached
// tokens live in `inputTokensDetails` under the `cached_tokens` key.
function readUsage(usage: {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputTokensDetails?: Array<Record<string, number>>;
}) {
  const cachedInputTokens = (usage.inputTokensDetails ?? []).reduce(
    (sum, details) => sum + (details.cached_tokens ?? 0),
    0,
  );
  return {
    inputTokens: usage.inputTokens,
    cachedInputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
  };
}

export const formatBook = internalAction({
  args: { jobId: v.id("bookJobs") },
  handler: async (ctx, args) => {
    const payload = await ctx.runQuery(internal.books.getFormattingPayload, {
      jobId: args.jobId,
    });
    if (!payload) return null;

    const model = process.env.READABOOK_OPENAI_MODEL ?? "gpt-5.5";
    const bookId = payload.book._id;
    const userId = payload.job.userId;

    const title =
      payload.video?.title ?? payload.book.title ?? "Untitled Readabook";
    const transcript = payload.transcriptText.trim();

    // Records exactly one cost-ledger row per formatting run.
    const logRequest = async (entry: {
      status: "success" | "fallback" | "failed";
      tokens: {
        inputTokens: number;
        cachedInputTokens: number;
        outputTokens: number;
        totalTokens: number;
      };
      tokenSource: "usage" | "tokenizer";
      durationMs: number;
      errorMessage?: string | null;
    }) => {
      await ctx.runMutation(internal.aiCosts.logAiRequest, {
        model,
        operation: "formatBook",
        status: entry.status,
        inputTokens: entry.tokens.inputTokens,
        cachedInputTokens: entry.tokens.cachedInputTokens,
        outputTokens: entry.tokens.outputTokens,
        totalTokens: entry.tokens.totalTokens,
        tokenSource: entry.tokenSource,
        // A failed request was rejected/aborted before billing, so the tokens
        // above are only a tokenizer estimate for visibility — record $0 spend
        // so the dashboard totals reflect what was actually charged.
        costUsd:
          entry.status === "failed"
            ? 0
            : computeCostUsd({ model, ...entry.tokens }),
        durationMs: entry.durationMs,
        errorMessage: entry.errorMessage ?? null,
        bookId,
        jobId: args.jobId,
        userId,
      });
    };

    if (!transcript) {
      await ctx.runMutation(internal.books.failOrRetryFormatting, {
        jobId: args.jobId,
        errorMessage: "Transcript is empty.",
      });
      return null;
    }

    const completeWithFallback = async (warning: string) => {
      const fallback = fallbackBookFromTranscript(title, transcript);
      const validation = validateBlocks(transcript, fallback.blocks);
      await ctx.runMutation(internal.books.completeBook, {
        jobId: args.jobId,
        title,
        subtitle: "A transcript-formatted book",
        blocks: fallback.blocks,
        readingMinutes: estimateReadingMinutes(fallback.blocks),
        category: payload.video?.category ?? "other",
        topics: payload.video?.tags?.slice(0, 12) ?? [],
        preservationScore: validation.preservation,
        warnings: [warning],
      });
    };

    const userInput = [
      `Video title: ${title}`,
      `Video description: ${payload.video?.description ?? ""}`,
      `Video tags: ${(payload.video?.tags ?? []).join(", ")}`,
      `Video channel: ${payload.video?.channelName ?? ""}`,
      `Existing metadata category: ${payload.video?.category ?? "other"}`,
      `Language: ${payload.book.language}`,
      "Format the transcript below into a structured readabook. Preserve the wording; choose the right block kinds for what is actually happening.",
      "Transcript:",
      transcript,
    ].join("\n\n");

    const startedAt = Date.now();

    if (!process.env.OPENAI_API_KEY) {
      // No request is made, so cost is zero — but we still record the run.
      await logRequest({
        status: "fallback",
        tokens: {
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        },
        tokenSource: "tokenizer",
        durationMs: Date.now() - startedAt,
        errorMessage: "OPENAI_API_KEY is not configured.",
      });
      await completeWithFallback(
        "OPENAI_API_KEY is not configured; used transcript-preserving fallback formatting.",
      );
      return null;
    }

    try {
      const agent = new Agent({
        name: "Readabook book editor",
        model,
        outputType: formattedBookSchema,
        instructions: INSTRUCTIONS,
      });

      const result = await run(agent, userInput, { maxTurns: 8 });

      // Prefer the SDK's reported usage; fall back to a local tokenizer
      // estimate only when usage is missing/zero (e.g. older SDK responses).
      const usage = readUsage(result.runContext.usage);
      const hasUsage = usage.totalTokens > 0 || usage.inputTokens > 0;
      const tokens = hasUsage
        ? usage
        : (() => {
            const inputTokens = encode(`${INSTRUCTIONS}\n\n${userInput}`).length;
            const outputTokens = encode(
              JSON.stringify(result.finalOutput ?? ""),
            ).length;
            return {
              inputTokens,
              cachedInputTokens: 0,
              outputTokens,
              totalTokens: inputTokens + outputTokens,
            };
          })();
      const tokenSource: "usage" | "tokenizer" = hasUsage
        ? "usage"
        : "tokenizer";

      const output = formattedBookSchema.parse(result.finalOutput);
      const blocks = toBookBlocks(output.blocks);
      const validation = validateBlocks(transcript, blocks);

      await logRequest({
        status: "success",
        tokens,
        tokenSource,
        durationMs: Date.now() - startedAt,
      });

      await ctx.runMutation(internal.books.completeBook, {
        jobId: args.jobId,
        title: output.title,
        subtitle: output.subtitle,
        blocks,
        readingMinutes:
          output.readingMinutes ?? estimateReadingMinutes(blocks),
        category: output.category,
        topics: output.topics.map((topic) => topic.trim()).filter(Boolean),
        preservationScore: Math.max(
          output.preservationScore,
          validation.preservation,
        ),
        warnings: output.warnings,
      });
      return null;
    } catch (error) {
      // The request may have completed (and cost money) before a parse/validate
      // step threw. Estimate token usage with the tokenizer so the spend is
      // still captured.
      const inputTokens = encode(`${INSTRUCTIONS}\n\n${userInput}`).length;
      await logRequest({
        status: "failed",
        tokens: {
          inputTokens,
          cachedInputTokens: 0,
          outputTokens: 0,
          totalTokens: inputTokens,
        },
        tokenSource: "tokenizer",
        durationMs: Date.now() - startedAt,
        errorMessage:
          error instanceof Error ? error.message : "Book formatting failed.",
      });
      await completeWithFallback(
        `OpenAI formatting failed; used transcript-preserving fallback. ${error instanceof Error ? error.message : "Book formatting failed."
        }`,
      );
      return null;
    }
  },
});
