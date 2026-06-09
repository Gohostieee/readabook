"use node";

import { v } from "convex/values";
import { z } from "zod";
import { internal } from "./_generated/api";
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
import { computeCostUsd } from "./aiCosts";
import { type BookBlock, blocksToPlainText } from "./lib";

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

// NOTE: `z.union` (not `z.discriminatedUnion`) — the OpenAI Agents SDK renders
// discriminated unions as JSON-schema `oneOf`, which OpenAI structured outputs
// reject ("'oneOf' is not permitted"). A plain union renders as `anyOf`, which
// is accepted; the `variant`/`kind` literals still steer the model correctly.
const diagramData = z.union([
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
// `z.union` rather than `z.discriminatedUnion` — see the diagramData note above.
const bodyBlock = z.union([
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

// Shared verbatim-first contract used (in slightly different framings) by both
// passes.
const VERBATIM_RULES = [
  "VERBATIM-FIRST (non-negotiable):",
  "- Never summarize, paraphrase, reorder ideas, invent facts, or remove meaning.",
  "- Preserve the speaker's wording. You may only add punctuation, capitalization, paragraph breaks, and remove pure filler ('um', 'uh', false starts) when meaning is unchanged.",
  "- Every meaningful spoken passage must survive somewhere in the output.",
].join("\n");

// PASS 1 — segment the transcript into chapters and extract discovery metadata.
// The transcript is supplied as numbered chunks; the model returns the chunk
// index range each chapter spans (it does NOT reproduce the text).
const OUTLINE_INSTRUCTIONS = [
  "You are the readabook book editor. You are given a raw YouTube transcript split into NUMBERED chunks (each line begins with its index like `[12]`). Your job in this pass is to design the book's CHAPTER STRUCTURE and discovery metadata — NOT to rewrite the text.",
  "",
  "Segment the transcript into a sequence of chapters that follow the natural 'acts' of the video (setup, exploration, turning points, conclusion). For each chapter return:",
  "- `title`: a short evocative chapter title.",
  "- `act`: an optional act label (e.g. 'Act I', 'The Setup') or null.",
  "- `summary`: a one-line table-of-contents summary or null.",
  "- `startChunk` and `endChunk`: the INCLUSIVE chunk index range this chapter covers.",
  "",
  "CHAPTER RANGE RULES (critical):",
  "- Ranges must be in order and CONTIGUOUS: chapter N+1 starts at chapter N's endChunk + 1.",
  "- Together the chapters must cover EVERY chunk from 0 to the last index — no gaps, no overlaps, nothing skipped.",
  "- Prefer a handful of substantial chapters over many tiny ones; aim for chapters of a few hundred to a couple thousand words each.",
  "",
  "DISCOVERY METADATA:",
  "- `title`/`subtitle`: the book's title and an optional subtitle (null if none fits).",
  "- `category`: exactly one broad category from the provided enum.",
  "- `topics`: up to 12 concise topics future search can match against — named people, books, concepts, methods, genres, subject areas actually present in the source.",
].join("\n");

// PASS 2 — format a single chapter's verbatim transcript span into body blocks.
// The chapter heading itself is supplied by pass 1, so this pass only emits the
// content blocks that live inside the chapter.
const FILL_INSTRUCTIONS = [
  "You are the readabook book editor. You are given the verbatim transcript of ONE chapter of a book, plus that chapter's title and summary for context. Format ONLY this chapter's content into structured body blocks.",
  "",
  VERBATIM_RULES,
  "",
  "Do NOT emit a chapter heading or the book title — those are already set. You only produce the body blocks within this chapter.",
  "",
  "READ THE CONTENT AND CHOOSE THE RIGHT FORM. Detect what is actually happening and represent it faithfully:",
  "- Use `section` headings to mark sub-topics within the chapter.",
  "- A back-and-forth, interview, or Q&A => `dialogue` with speaker-labeled turns (use real names if stated, otherwise 'Host'/'Guest'/'Speaker').",
  "- An enumeration of items => `list` (ordered when sequence matters).",
  "- A described procedure or how-to => `steps`.",
  "- A described process/pipeline => `diagram` variant 'flow'; an explicit comparison => 'comparison'; chronological events => 'timeline'; a structure/taxonomy => 'hierarchy' (use depth 0,1,2 for nesting); a repeating loop => 'cycle'; a two-axis tradeoff => 'quadrant'. Only emit a diagram when the transcript genuinely describes that structure; every label must come from spoken content.",
  "- A memorable, quotable line => `pullquote`. An opening line that sets the chapter's tone => `epigraph`. A direct attributed quotation => `quote`.",
  "- A definition of a term => `keyTerm`. A notable number/metric => `stat`. A key takeaway or aside worth highlighting => `callout` (pick the best variant: note, key-insight, definition, warning, tip).",
  "- Everything else => `paragraph`. Set data.dropcap=true on the FIRST paragraph of the chapter only.",
  "",
  "BALANCE: Prefer many faithful blocks over compression. Use rich kinds when the content supports them, but do not force structure onto plain narration — most blocks will be paragraphs. The `text` field of every block MUST contain the spoken words for that block (for dialogue/list/diagram, concatenate the spoken content).",
].join("\n");

// Per-call detail stored alongside the aggregated cost-ledger row.
type CallBreakdownEntry = {
  phase: "outline" | "chapter" | "single";
  index?: number;
  status: "success" | "retried" | "fallback" | "failed";
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
};

// Coerce the model's chapter list into contiguous, gap-free, in-order chunk
// ranges that cover [0, chunkCount-1] exactly once. The model's startChunk is
// not trusted: each chapter simply continues where the previous one ended, and
// only `endChunk` influences where to cut. Guarantees no transcript text is
// dropped or duplicated regardless of model output.
function buildChapterRanges(
  chapters: OutlineChapter[],
  chunkCount: number,
): {
  chapters: Array<{
    title: string;
    act: string | null;
    summary: string | null;
    start: number;
    end: number;
  }>;
  repaired: boolean;
} {
  const lastIndex = chunkCount - 1;
  if (chapters.length === 0) {
    return {
      chapters: [
        { title: "Transcript", act: null, summary: null, start: 0, end: lastIndex },
      ],
      repaired: true,
    };
  }

  const sorted = [...chapters].sort((a, b) => a.startChunk - b.startChunk);
  const out: Array<{
    title: string;
    act: string | null;
    summary: string | null;
    start: number;
    end: number;
  }> = [];
  let cursor = 0;
  let repaired = false;

  for (let i = 0; i < sorted.length; i += 1) {
    if (cursor > lastIndex) {
      // We've already covered the whole transcript; drop trailing chapters.
      repaired = true;
      break;
    }
    const ch = sorted[i];
    const isLast = i === sorted.length - 1;
    const start = cursor;
    const end = isLast
      ? lastIndex
      : Math.min(Math.max(ch.endChunk, start), lastIndex);
    if (start !== ch.startChunk || end !== ch.endChunk) repaired = true;
    out.push({ title: ch.title, act: ch.act, summary: ch.summary, start, end });
    cursor = end + 1;
  }

  // If chapters ran out before the end, extend the last one to cover the rest.
  const tail = out[out.length - 1];
  if (tail.end < lastIndex) {
    tail.end = lastIndex;
    repaired = true;
  }

  return { chapters: out, repaired };
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

    // Records exactly one cost-ledger row per formatting run, summing the
    // outline call and every chapter call. The optional `callBreakdown` carries
    // per-call detail for debugging without changing the row-per-book model.
    const logRequest = async (entry: {
      status: "success" | "fallback" | "failed";
      tokens: Tokens;
      tokenSource: "usage" | "tokenizer";
      durationMs: number;
      errorMessage?: string | null;
      callBreakdown?: CallBreakdownEntry[];
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
        // A run that produced no output (e.g. the outline call was rejected
        // before billing) records $0 — only a tokenizer estimate exists for
        // visibility. When output tokens were produced (paid chapter calls
        // before a later validation failure), record the real spend.
        costUsd:
          entry.status === "failed" && entry.tokens.outputTokens === 0
            ? 0
            : computeCostUsd({ model, ...entry.tokens }),
        durationMs: entry.durationMs,
        errorMessage: entry.errorMessage ?? null,
        bookId,
        jobId: args.jobId,
        userId,
        callBreakdown: entry.callBreakdown,
      });
    };

    if (!transcript) {
      await ctx.runMutation(internal.books.failOrRetryFormatting, {
        jobId: args.jobId,
        errorMessage: "Transcript is empty.",
      });
      return null;
    }

    const startedAt = Date.now();

    if (!process.env.OPENAI_API_KEY) {
      // No request is made, so cost is zero — but we still record the run.
      await logRequest({
        status: "failed",
        tokens: { ...ZERO_TOKENS },
        tokenSource: "tokenizer",
        durationMs: Date.now() - startedAt,
        errorMessage: "OPENAI_API_KEY is not configured.",
      });
      await ctx.runMutation(internal.books.failOrRetryFormatting, {
        jobId: args.jobId,
        errorMessage:
          "Book formatting is unavailable right now. Please try again.",
      });
      return null;
    }

    const chunkTexts = payload.transcriptChunks.map((chunk) => chunk.text);
    const metaHeader = [
      `Video title: ${title}`,
      `Video description: ${payload.video?.description ?? ""}`,
      `Video tags: ${(payload.video?.tags ?? []).join(", ")}`,
      `Video channel: ${payload.video?.channelName ?? ""}`,
      `Existing metadata category: ${payload.video?.category ?? "other"}`,
      `Language: ${payload.book.language}`,
    ];
    const outlineInput = [
      ...metaHeader,
      "Numbered transcript chunks (each line starts with its [index]):",
      chunkTexts.map((text, index) => `[${index}] ${text}`).join("\n"),
    ].join("\n\n");

    // Aggregated spend across the outline + all chapter calls, plus per-call
    // detail. Declared outside the try so the catch can report partial spend.
    const agg: Tokens = { ...ZERO_TOKENS };
    const breakdown: CallBreakdownEntry[] = [];
    let usedTokenizer = false;

    try {
      // PASS 1 — outline: metadata + chapter boundaries over numbered chunks.
      const outline = await runStructured({
        name: "Readabook outliner",
        model,
        instructions: OUTLINE_INSTRUCTIONS,
        schema: outlineSchema,
        input: outlineInput,
      });
      addTokens(agg, outline.tokens);
      if (outline.tokenSource === "tokenizer") usedTokenizer = true;
      breakdown.push({
        phase: "outline",
        status: "success",
        inputTokens: outline.tokens.inputTokens,
        outputTokens: outline.tokens.outputTokens,
        durationMs: outline.durationMs,
      });

      const { chapters, repaired } = buildChapterRanges(
        outline.output.chapters,
        chunkTexts.length,
      );
      const warnings: string[] = [];
      if (repaired) {
        warnings.push(
          "Chapter ranges were adjusted to cover the full transcript without gaps.",
        );
      }

      // PASS 2 — fill each chapter's verbatim span into body blocks, bounded to
      // 4 concurrent model calls. Each chapter retries once, then falls back to
      // plain paragraphs so one bad chapter never sinks the whole book.
      const fillResults = await mapWithConcurrency(
        chapters,
        4,
        async (ch, index) => {
          const chapterText = chunkTexts
            .slice(ch.start, ch.end + 1)
            .join("\n\n");
          const fillInput = [
            `Chapter title: ${ch.title}`,
            ch.summary ? `Chapter summary: ${ch.summary}` : "",
            `Book language: ${payload.book.language}`,
            "Format ONLY this chapter's transcript span into body blocks. Preserve the wording.",
            "Transcript:",
            chapterText,
          ]
            .filter(Boolean)
            .join("\n\n");

          const chTokens: Tokens = { ...ZERO_TOKENS };
          let lastError = "";
          for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
              const res = await runStructured({
                name: `Readabook chapter ${index + 1}`,
                model,
                instructions: FILL_INSTRUCTIONS,
                schema: fillSchema,
                input: fillInput,
              });
              addTokens(chTokens, res.tokens);
              return {
                chapter: ch,
                blocks: toBookBlocks(res.output.blocks),
                tokens: chTokens,
                status:
                  attempt === 0 ? ("success" as const) : ("retried" as const),
                durationMs: res.durationMs,
                tokenizer: res.tokenSource === "tokenizer",
                error: null as string | null,
              };
            } catch (err) {
              lastError = describeError(err);
              console.error(
                `[formatBook] chapter ${index + 1} attempt ${attempt + 1} failed (book=${bookId}, model=${model}): ${lastError}`,
                err,
              );
              // The failed attempt usually billed before parse threw; estimate.
              addTokens(chTokens, estimateFailedTokens(FILL_INSTRUCTIONS, fillInput));
            }
          }
          // Both attempts failed → abort the whole book. We surface the chapter
          // tokens spent so far so the outer catch can record partial spend.
          addTokens(agg, chTokens);
          throw new Error(
            `Chapter ${index + 1} ("${ch.title}") failed to format: ${lastError}`,
          );
        },
      );

      // Assemble: book title/subtitle, then each chapter heading followed by its
      // body blocks.
      const blocks: BookBlock[] = [
        { kind: "title", text: outline.output.title },
      ];
      if (outline.output.subtitle) {
        blocks.push({ kind: "subtitle", text: outline.output.subtitle });
      }
      fillResults.forEach((result, index) => {
        const chapterData = stripNulls({
          act: result.chapter.act,
          summary: result.chapter.summary,
        }) as Record<string, unknown>;
        blocks.push({
          kind: "chapter",
          text: result.chapter.title,
          ...(Object.keys(chapterData).length > 0 ? { data: chapterData } : {}),
        });
        blocks.push(...result.blocks);

        addTokens(agg, result.tokens);
        if (result.tokenizer) usedTokenizer = true;
        breakdown.push({
          phase: "chapter",
          index,
          status: result.status,
          inputTokens: result.tokens.inputTokens,
          outputTokens: result.tokens.outputTokens,
          durationMs: result.durationMs,
        });
      });

      const validation = validateBlocks(transcript, blocks);

      await logRequest({
        status: "success",
        tokens: agg,
        tokenSource: usedTokenizer ? "tokenizer" : "usage",
        durationMs: Date.now() - startedAt,
        callBreakdown: breakdown,
      });

      await ctx.runMutation(internal.books.completeBook, {
        jobId: args.jobId,
        title: outline.output.title,
        subtitle: outline.output.subtitle,
        blocks,
        readingMinutes: estimateReadingMinutes(blocks),
        category: outline.output.category,
        topics: outline.output.topics.map((topic) => topic.trim()).filter(Boolean),
        preservationScore: validation.preservation,
        warnings,
      });
      return null;
    } catch (error) {
      // Any failure — the outline pass, a chapter, assembly, or the global
      // preservation check — aborts the whole book. Capture any spend accrued
      // so far (the outline estimate at minimum), then fail the job so the
      // user is told to try again rather than getting a degraded fallback.
      if (agg.totalTokens === 0) {
        addTokens(agg, estimateFailedTokens(OUTLINE_INSTRUCTIONS, outlineInput));
      }
      const detail = describeError(error);
      // Emit the full reason to the Convex log stream so it's visible in the
      // dashboard logs, not just buried in the cost ledger's errorMessage.
      console.error(
        `[formatBook] FAILED (job=${args.jobId}, book=${bookId}, model=${model}, phase=${
          breakdown.length === 0 ? "outline" : "assembly"
        }): ${detail}`,
        error,
      );
      await logRequest({
        status: "failed",
        tokens: agg,
        tokenSource: usedTokenizer ? "tokenizer" : "usage",
        durationMs: Date.now() - startedAt,
        errorMessage: detail,
        callBreakdown: breakdown.length > 0 ? breakdown : undefined,
      });
      await ctx.runMutation(internal.books.failOrRetryFormatting, {
        jobId: args.jobId,
        errorMessage: "Book formatting failed. Please try again.",
      });
      return null;
    }
  },
});
