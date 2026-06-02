import { describe, expect, test } from "vitest";
import {
  blocksToMarkup,
  fallbackBookFromTranscript,
  parseBookMarkup,
} from "./lib";

describe("book markup helpers", () => {
  test("parses readabook markers into typed blocks", () => {
    const blocks = parseBookMarkup([
      "###TITLE",
      "A Book",
      "",
      "###CHAPTER Opening",
      "",
      "###PARA",
      "These are the words from the transcript.",
      "",
      "###QUOTE",
      "A line worth emphasizing.",
    ].join("\n"));

    expect(blocks).toEqual([
      { kind: "title", text: "A Book" },
      { kind: "chapter", text: "Opening" },
      { kind: "paragraph", text: "These are the words from the transcript." },
      { kind: "quote", text: "A line worth emphasizing." },
    ]);
  });

  test("round-trips fallback transcript formatting", () => {
    const transcript = [
      "First paragraph keeps the original spoken words.",
      "Second paragraph also keeps the original spoken words.",
    ].join("\n\n");

    const book = fallbackBookFromTranscript("Video Title", transcript);
    const parsed = parseBookMarkup(book.markup);

    expect(parsed[0]).toEqual({ kind: "title", text: "Video Title" });
    expect(blocksToMarkup(parsed)).toContain(
      "First paragraph keeps the original spoken words.",
    );
    expect(blocksToMarkup(parsed)).toContain(
      "Second paragraph also keeps the original spoken words.",
    );
  });
});
