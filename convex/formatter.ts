"use node";

import { Agent, run } from "@openai/agents";
import { v } from "convex/values";
import { z } from "zod";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
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

const chapterData = z.object({
  act: z.string().nullable(),
  summary: z.string().nullable(),
});

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
    axes: z.object({
      x: z.tuple([z.string(), z.string()]),
      y: z.tuple([z.string(), z.string()]),
    }),
    items: z
      .array(z.object({ label: z.string(), x: z.number(), y: z.number() }))
      .min(1),
  }),
]);

const block = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("title"), text: z.string() }),
  z.object({ kind: z.literal("subtitle"), text: z.string() }),
  z.object({
    kind: z.literal("chapter"),
    text: z.string(),
    data: chapterData.nullable(),
  }),
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

const formattedBookSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().nullable(),
  readingMinutes: z.number().nullable(),
  blocks: z.array(block).min(3),
  preservationScore: z.number().min(0).max(1),
  warnings: z.array(z.string()),
});

type FormattedOutput = z.infer<typeof formattedBookSchema>;

// Normalize the model output (which uses `null` for absent fields) into the
// loosely-typed BookBlock[] we persist. Strips nulls out of `data`.
function toBookBlocks(blocks: FormattedOutput["blocks"]): BookBlock[] {
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
].join("\n");

export const formatBook = internalAction({
  args: { jobId: v.id("bookJobs") },
  handler: async (ctx, args) => {
    const payload = await ctx.runQuery(internal.books.getFormattingPayload, {
      jobId: args.jobId,
    });
    if (!payload) return null;

    const title =
      payload.video?.title ?? payload.book.title ?? "Untitled Readabook";
    const transcript = payload.transcriptText.trim();
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
        preservationScore: validation.preservation,
        warnings: [warning],
      });
    };

    try {
      if (!process.env.OPENAI_API_KEY) {
        await completeWithFallback(
          "OPENAI_API_KEY is not configured; used transcript-preserving fallback formatting.",
        );
        return null;
      }

      const agent = new Agent({
        name: "Readabook book editor",
        model: process.env.READABOOK_OPENAI_MODEL ?? "gpt-5.2",
        outputType: formattedBookSchema,
        instructions: INSTRUCTIONS,
      });

      const result = await run(
        agent,
        [
          `Video title: ${title}`,
          `Language: ${payload.book.language}`,
          "Format the transcript below into a structured readabook. Preserve the wording; choose the right block kinds for what is actually happening.",
          "Transcript:",
          transcript,
        ].join("\n\n"),
        { maxTurns: 8 },
      );

      const output = formattedBookSchema.parse(result.finalOutput);
      const blocks = toBookBlocks(output.blocks);
      const validation = validateBlocks(transcript, blocks);

      await ctx.runMutation(internal.books.completeBook, {
        jobId: args.jobId,
        title: output.title,
        subtitle: output.subtitle,
        blocks,
        readingMinutes:
          output.readingMinutes ?? estimateReadingMinutes(blocks),
        preservationScore: Math.max(
          output.preservationScore,
          validation.preservation,
        ),
        warnings: output.warnings,
      });
      return null;
    } catch (error) {
      await completeWithFallback(
        `OpenAI formatting failed; used transcript-preserving fallback. ${
          error instanceof Error ? error.message : "Book formatting failed."
        }`,
      );
      return null;
    }
  },
});
