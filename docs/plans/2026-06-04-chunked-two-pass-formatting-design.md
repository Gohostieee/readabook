# Chunked two-pass book formatting

**Date:** 2026-06-04
**Status:** Approved for implementation

## Problem

`formatBook` (`convex/formatter.ts`) transforms an entire YouTube transcript into
a fully structured book in a single model call. The instructions are
verbatim-first: nothing is summarized, so the JSON output reproduces the full
transcript text wrapped in block structure. That makes output tokens *larger*
than the input transcript (roughly 1.3–1.7× after JSON overhead).

For long videos this exceeds the model's single-response output cap:

| Video length | Transcript tokens | Expected JSON output tokens |
|---|---|---|
| 30 min | ~6k | ~8–10k |
| 1 hr | ~12k | ~16–20k |
| 2 hr | ~24k | ~32–40k |
| 3 hr | ~36k | ~48–60k |

When the cap is hit the output is truncated mid-JSON, `formattedBookSchema.parse`
throws, and the code silently degrades to the dumb full-transcript fallback while
still paying for the wasted tokens. The most valuable long-form content quietly
gets the worst formatting.

## Solution: two-pass formatting (all videos)

Replace the single call with two passes, applied to every video (no size gate —
one code path):

```
getFormattingPayload → numbered transcript chunks + joined text
        │
        ▼
PASS 1: outline   (whole transcript in, small structured metadata + boundaries out)
        │
        ▼
PASS 2: fill each chapter  (verbatim body blocks, bounded parallel ~4 at a time)
        │
        ▼
assemble blocks → validateBlocks (global preservation) → completeBook
```

The no-API-key and hard-failure fallback paths are unchanged.

### Pass 1 — outline

**Input:** the transcript rendered as numbered chunks from the existing
`transcriptChunks` table (indexed by `bookId` + `index`):

```
[0] So today I want to talk about...
[1] and the first thing you need to know...
```

plus the same video-metadata header the current `userInput` builds.

**Output (`outlineSchema`)** — book-level metadata + chapter boundaries, no
verbatim text (keeps the call cheap):

```ts
{
  title, subtitle, category, topics,
  chapters: [{
    title: string,
    act: string | null,
    summary: string | null,
    startChunk: number,  // inclusive index into transcriptChunks
    endChunk: number,    // inclusive
  }].min(1)
}
```

**Range hardening (in code, not trusted from the model):** after parsing, sort
chapters by `startChunk`, clamp indices to `[0, lastChunk]`, and repair
gaps/overlaps so every chunk index is covered exactly once — chapter N is
extended/trimmed to start where N-1 ended. Guarantees no transcript text is
dropped or duplicated. A warning is recorded when repair was needed.

`preservationScore` and `readingMinutes` are not requested from the model; both
are computed in code at the end.

### Pass 2 — per-chapter fill

For each chapter, slice verbatim text from `transcriptChunks[startChunk..endChunk]`
(joined with `\n\n`) and run a fill agent whose schema is body blocks only — the
existing `block` union minus `title`/`subtitle`:

```ts
fillSchema = z.object({ blocks: z.array(block).min(1) })
```

Fill instructions reuse the current verbatim-first rules, narrowed to "format
*this chapter's* span; do not invent a chapter heading — it is supplied." The
chapter title/summary is passed as context for coherence.

**Bounded parallel:** a concurrency pool of 4 (Promise-based limiter, no new
dependency). Each call returns `{ index, blocks, tokens, status }`.

**Per-chapter failure (parse fail / truncation / throw):**
1. Retry once.
2. Still failing → per-chapter fallback: emit the chapter's chunk range as plain
   `paragraph` blocks (same approach as `fallbackBookFromTranscript`, scoped to
   the range). Text fully preserved; only rich structure lost for that chapter.
3. Record a warning naming the degraded chapter.

**Assembly:** flatten in chapter order — `[title, subtitle?]` from pass 1, then
for each chapter a `chapter` block (carrying `act`/`summary` data) followed by its
body blocks. The assembled book runs through the existing `validateBlocks` global
preservation check, so a few degraded chapters still pass when the book overall
preserves wording.

## Cost logging (aggregated + breakdown)

Accumulate `readUsage()` across the outline call and every chapter call (including
retries). Write **one ledger row per book** with `operation: "formatBook"` and the
summed tokens/cost — the dashboard's row-per-book assumption and
`getCostSummary` are unchanged.

Add one optional column to `aiRequestLogs` for debugging:

```ts
callBreakdown: v.optional(v.array(v.object({
  phase: v.union(v.literal("outline"), v.literal("chapter"), v.literal("single")),
  index: v.optional(v.number()),
  status: v.union(
    v.literal("success"), v.literal("retried"),
    v.literal("fallback"), v.literal("failed"),
  ),
  inputTokens: v.number(),
  outputTokens: v.number(),
  durationMs: v.number(),
})))
```

`logAiRequest` gains a matching optional arg (optional → existing rows/callers
stay valid, no migration). The dashboard ignores it for now.

**Aggregate-row status mapping:** `success` if all chapters succeeded;
`fallback` if any chapter degraded to plain paragraphs but the book completed;
`failed` only if the whole run aborts to the full-transcript fallback.

## Known limitation

All fills run inside one `formatBook` action, so a pathologically long video
(very many chapters) could approach the Convex action time limit. Bounded
parallelism mitigates it. Escape hatch if it ever bites: scheduled per-chapter
actions with a staging table and finalizer.
