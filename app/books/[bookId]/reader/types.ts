// Frontend mirror of the block shapes persisted by the backend. Kept local to
// the client bundle so we don't import server-only Convex modules.

export type BookBlockKind =
  | "title"
  | "subtitle"
  | "chapter"
  | "section"
  | "quote"
  | "pullquote"
  | "epigraph"
  | "callout"
  | "paragraph"
  | "dialogue"
  | "list"
  | "steps"
  | "diagram"
  | "keyTerm"
  | "stat"
  | "break";

export type BookBlock = {
  kind: BookBlockKind;
  text: string;
  data?: unknown;
};

export type DialogueData = { turns: { speaker: string; text: string }[] };
export type ListData = {
  ordered: boolean;
  items: { text: string; subitems?: string[] }[];
};
export type StepsData = { steps: { title?: string; text: string }[] };
export type CalloutData = {
  variant: "note" | "key-insight" | "definition" | "warning" | "tip";
};
export type KeyTermData = { term: string; definition: string };
export type StatData = { value: string; label: string; context?: string };
export type QuoteData = { attribution?: string };
export type ChapterData = { act?: string; summary?: string };
export type ParagraphData = { dropcap?: boolean };

export type DiagramData =
  | { variant: "flow"; steps: { label: string; detail?: string }[] }
  | {
      variant: "comparison";
      columns: string[];
      rows: { label: string; cells: string[] }[];
    }
  | {
      variant: "timeline";
      events: { when?: string; label: string; detail?: string }[];
    }
  | { variant: "hierarchy"; nodes: { label: string; depth: number }[] }
  | { variant: "cycle"; nodes: { label: string }[] }
  | {
      variant: "quadrant";
      axes: {
        x: { low: string; high: string };
        y: { low: string; high: string };
      };
      items: { label: string; x: number; y: number }[];
    };

export type Chapter = { text: string; act?: string; summary?: string };

// Fact-check layer. Mirrors the `bookFacts` rows returned by getBookReadonly.
export type FactVerdict =
  | "pending"
  | "supported"
  | "refuted"
  | "misleading"
  | "unverifiable";

export type ReaderFact = {
  _id: string;
  chapterIndex: number;
  chapterTitle: string;
  statement: string;
  quote: string;
  verdict: FactVerdict;
  confidence: number | null;
  explanation: string | null;
  sources: { url: string; title: string }[];
};

export type FactCheckJob = {
  status: "extracting" | "pruning" | "checking" | "completed" | "failed";
  totalFacts: number;
  checkedFacts: number;
} | null;
