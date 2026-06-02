import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

export type BookBlockKind =
  | "title"
  | "subtitle"
  | "chapter"
  | "section"
  | "quote"
  | "callout"
  | "paragraph"
  | "break";

export type BookBlock = {
  kind: BookBlockKind;
  text: string;
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

export function fallbackBookFromTranscript(title: string, transcript: string) {
  const paragraphs = transcript
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  const blocks: BookBlock[] = [
    { kind: "title", text: title || "Untitled Readabook" },
    { kind: "subtitle", text: "A transcript-formatted book" },
    { kind: "chapter", text: "Transcript" },
    ...paragraphs.map((text) => ({ kind: "paragraph" as const, text })),
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
