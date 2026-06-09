import type { ReactNode } from "react";
import type { FactVerdict, ReaderFact } from "./types";

// Per-verdict presentation, shared by the inline highlights and the panel.
export const VERDICT_META: Record<
  FactVerdict,
  { label: string; underline: string; badge: string; dot: string }
> = {
  pending: {
    label: "Checking…",
    underline: "border-muted-foreground/40",
    badge: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground/50",
  },
  supported: {
    label: "Supported",
    underline: "border-emerald-500",
    badge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    dot: "bg-emerald-500",
  },
  refuted: {
    label: "Refuted",
    underline: "border-red-500",
    badge: "bg-red-500/15 text-red-700 dark:text-red-400",
    dot: "bg-red-500",
  },
  misleading: {
    label: "Misleading",
    underline: "border-amber-500",
    badge: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    dot: "bg-amber-500",
  },
  unverifiable: {
    label: "Unverifiable",
    underline: "border-muted-foreground/40 border-dashed",
    badge: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground/50",
  },
};

// Wrap any verbatim fact `quote` found in `text` with a verdict-colored,
// clickable underline. Best-effort case-insensitive substring match (per the
// quote+chapter anchoring decision); facts whose quote isn't found in this
// fragment simply aren't highlighted here — they still appear in the panel.
//
// Returns the original string when there are no matches so callers can render
// it directly (and so the offscreen measurer's heights are unaffected by the
// inline underline spans).
export function highlightFacts(
  text: string,
  facts: ReaderFact[] | undefined,
  onFactClick?: (factId: string) => void,
): ReactNode {
  if (!facts || facts.length === 0 || !text) return text;

  const lower = text.toLowerCase();
  type Range = { start: number; end: number; fact: ReaderFact };
  const ranges: Range[] = [];
  for (const fact of facts) {
    const q = fact.quote.trim().toLowerCase();
    if (q.length < 8) continue; // too short to anchor reliably
    const idx = lower.indexOf(q);
    if (idx === -1) continue;
    ranges.push({ start: idx, end: idx + q.length, fact });
  }
  if (ranges.length === 0) return text;

  // Sort and drop overlaps (keep the earliest, longest match).
  ranges.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Range[] = [];
  let lastEnd = -1;
  for (const r of ranges) {
    if (r.start >= lastEnd) {
      kept.push(r);
      lastEnd = r.end;
    }
  }

  const nodes: ReactNode[] = [];
  let cursor = 0;
  kept.forEach((r, i) => {
    if (r.start > cursor) nodes.push(text.slice(cursor, r.start));
    const meta = VERDICT_META[r.fact.verdict];
    nodes.push(
      <button
        key={`f-${r.fact._id}-${i}`}
        type="button"
        onClick={onFactClick ? () => onFactClick(r.fact._id) : undefined}
        className={`border-b-2 ${meta.underline} cursor-pointer bg-transparent p-0 text-left transition-colors hover:bg-muted/40`}
        title={`Fact-check: ${meta.label}`}
      >
        {text.slice(r.start, r.end)}
      </button>,
    );
    cursor = r.end;
  });
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}
