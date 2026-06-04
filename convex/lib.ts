import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

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

// Structured payloads for rich block kinds. `text` on the block always holds the
// flattened spoken content (used for preservation scoring and previews); `data`
// holds the renderable structure.
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

export type BookBlock = {
  kind: BookBlockKind;
  text: string;
  data?: unknown;
};

const markerToKind: Record<string, BookBlockKind> = {
  "###TITLE": "title",
  "###SUBTITLE": "subtitle",
  "###CHAPTER": "chapter",
  "###SECTION": "section",
  "###QUOTE": "quote",
  "###CALLOUT": "callout",
  "###PARA": "paragraph",
  "###BREAK": "break",
};

export function extractYoutubeVideoId(url: string) {
  try {
    const parsed = new URL(url.trim());
    const host = parsed.hostname.replace(/^www\./, "");

    if (host === "youtu.be") {
      return parsed.pathname.split("/").filter(Boolean)[0] ?? null;
    }

    if (host.endsWith("youtube.com")) {
      if (parsed.pathname === "/watch") return parsed.searchParams.get("v");
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (["embed", "shorts", "live"].includes(parts[0])) return parts[1] ?? null;
    }
  } catch {
    return null;
  }

  return null;
}

export function canonicalYoutubeUrl(videoId: string) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function checksum(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function cleanTranscriptText(text: string) {
  return text
    .replace(/\s*>>\s*/g, "\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function parseBookMarkup(markup: string): BookBlock[] {
  const blocks: BookBlock[] = [];
  let activeKind: BookBlockKind | null = null;
  let activeText: string[] = [];

  const flush = () => {
    if (!activeKind) return;
    const text = activeKind === "break" ? "" : activeText.join("\n").trim();
    if (activeKind === "break" || text.length > 0) {
      blocks.push({ kind: activeKind, text });
    }
    activeKind = null;
    activeText = [];
  };

  for (const rawLine of markup.replace(/\r\n/g, "\n").split("\n")) {
    const trimmed = rawLine.trim();
    const marker = Object.keys(markerToKind).find((candidate) =>
      trimmed.startsWith(candidate),
    );

    if (marker) {
      flush();
      activeKind = markerToKind[marker];
      const inline = trimmed.slice(marker.length).trim();
      if (activeKind === "break") {
        flush();
      } else if (inline.length > 0) {
        activeText.push(inline);
      }
      continue;
    }

    if (!activeKind && trimmed.length > 0) {
      activeKind = "paragraph";
    }
    if (activeKind) activeText.push(rawLine);
  }

  flush();
  return blocks;
}

export function blocksToMarkup(blocks: BookBlock[]) {
  const kindToMarker: Record<BookBlockKind, string> = Object.fromEntries(
    Object.entries(markerToKind).map(([marker, kind]) => [kind, marker]),
  ) as Record<BookBlockKind, string>;

  return blocks
    .map((block) =>
      block.kind === "break"
        ? kindToMarker[block.kind]
        : `${kindToMarker[block.kind]}\n${block.text.trim()}`,
    )
    .join("\n\n");
}

// Flattens every block (including structured `data`) into a single plain-text
// string of spoken content. Used for verbatim preservation scoring and previews
// so that restructuring into lists/dialogue/diagrams does not lose coverage.
export function blocksToPlainText(blocks: BookBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.text) parts.push(block.text);
    const data = block.data as Record<string, unknown> | undefined;
    if (!data) continue;

    switch (block.kind) {
      case "dialogue": {
        const turns = (data.turns as DialogueData["turns"]) ?? [];
        for (const turn of turns) parts.push(turn.text);
        break;
      }
      case "list": {
        const items = (data.items as ListData["items"]) ?? [];
        for (const item of items) {
          parts.push(item.text);
          if (item.subitems) parts.push(...item.subitems);
        }
        break;
      }
      case "steps": {
        const steps = (data.steps as StepsData["steps"]) ?? [];
        for (const step of steps) {
          if (step.title) parts.push(step.title);
          parts.push(step.text);
        }
        break;
      }
      case "keyTerm": {
        const term = data as unknown as KeyTermData;
        if (term.term) parts.push(term.term);
        if (term.definition) parts.push(term.definition);
        break;
      }
      case "stat": {
        const stat = data as unknown as StatData;
        if (stat.label) parts.push(stat.label);
        if (stat.context) parts.push(stat.context);
        break;
      }
      case "diagram": {
        const diagram = data as unknown as DiagramData;
        switch (diagram.variant) {
          case "flow":
            for (const s of diagram.steps)
              parts.push(s.label, s.detail ?? "");
            break;
          case "comparison":
            parts.push(...diagram.columns);
            for (const row of diagram.rows)
              parts.push(row.label, ...row.cells);
            break;
          case "timeline":
            for (const e of diagram.events)
              parts.push(e.when ?? "", e.label, e.detail ?? "");
            break;
          case "cycle":
            for (const n of diagram.nodes) parts.push(n.label);
            break;
          case "quadrant":
            for (const i of diagram.items) parts.push(i.label);
            break;
          case "hierarchy":
            for (const n of diagram.nodes) parts.push(n.label);
            break;
        }
        break;
      }
    }
  }
  return parts.filter(Boolean).join("\n\n");
}

// Plain-paragraph blocks for a span of transcript text. Used as the per-chapter
// fallback in the two-pass formatter when a chapter's fill call fails: the
// spoken words are fully preserved, only rich structure is lost. The caller is
// responsible for any surrounding chapter/section blocks.
export function paragraphBlocksFromText(text: string): BookBlock[] {
  return cleanTranscriptText(text)
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => ({ kind: "paragraph" as const, text: part }));
}

export function fallbackBookFromTranscript(title: string, transcript: string) {
  const blocks: BookBlock[] = [
    { kind: "title", text: title || "Untitled Readabook" },
    { kind: "subtitle", text: "A transcript-formatted book" },
    { kind: "chapter", text: "Transcript" },
    ...paragraphBlocksFromText(transcript),
  ];

  return {
    blocks,
    markup: blocksToMarkup(blocks),
  };
}

export async function requireUser(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Authentication required");

  const existing = await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();

  if (existing) return existing;

  if (!("insert" in ctx.db)) {
    throw new Error("User must be initialized before querying");
  }

  const now = Date.now();
  const userId = await ctx.db.insert("users", {
    tokenIdentifier: identity.tokenIdentifier,
    name: identity.name ?? null,
    email: identity.email ?? null,
    imageUrl: identity.pictureUrl ?? null,
    lastSeenAt: now,
  });

  return (await ctx.db.get(userId)) as Doc<"users">;
}

export async function getExistingUser(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Authentication required");

  return await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();
}

export async function touchUser(ctx: MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Authentication required");

  const existing = await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();

  const patch = {
    name: identity.name ?? null,
    email: identity.email ?? null,
    imageUrl: identity.pictureUrl ?? null,
    lastSeenAt: Date.now(),
  };

  if (existing) {
    await ctx.db.patch(existing._id, patch);
    return (await ctx.db.get(existing._id)) as Doc<"users">;
  }

  const userId = await ctx.db.insert("users", {
    tokenIdentifier: identity.tokenIdentifier,
    ...patch,
  });
  return (await ctx.db.get(userId)) as Doc<"users">;
}

export async function saveBookForUser(
  ctx: MutationCtx,
  userId: Id<"users">,
  bookId: Id<"books">,
  source: "submitted" | "opened" | "saved",
) {
  const now = Date.now();
  const existing = await ctx.db
    .query("userBooks")
    .withIndex("by_userId_and_bookId", (q) =>
      q.eq("userId", userId).eq("bookId", bookId),
    )
    .unique();

  if (existing) {
    await ctx.db.patch(existing._id, { lastOpenedAt: now });
    return existing._id;
  }

  return await ctx.db.insert("userBooks", {
    userId,
    bookId,
    savedAt: now,
    lastOpenedAt: now,
    source,
  });
}
