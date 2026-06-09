import { describe, expect, test } from "vitest";
import {
  type BookBlock,
  blocksToMarkup,
  blocksToPlainText,
  cleanTranscriptText,
  fallbackBookFromTranscript,
  groupChapters,
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

  test("removes transcript turn markers from fallback paragraphs", () => {
    const transcript =
      "Would you criticize President Biden? >> Look, we put the image on all kinds of things. >> Typically, no.";

    const book = fallbackBookFromTranscript("Video Title", transcript);

    expect(blocksToPlainText(book.blocks)).not.toContain(">>");
    expect(book.blocks).toEqual([
      { kind: "title", text: "Video Title" },
      { kind: "subtitle", text: "A transcript-formatted book" },
      { kind: "chapter", text: "Transcript" },
      { kind: "paragraph", text: "Would you criticize President Biden?" },
      {
        kind: "paragraph",
        text: "Look, we put the image on all kinds of things.",
      },
      { kind: "paragraph", text: "Typically, no." },
    ]);
  });
});

describe("groupChapters", () => {
  test("groups body blocks under chapters, indexed by chapter order", () => {
    const blocks: BookBlock[] = [
      { kind: "title", text: "A Book" },
      { kind: "subtitle", text: "Subtitle" },
      { kind: "chapter", text: "One" },
      { kind: "paragraph", text: "First chapter body." },
      { kind: "paragraph", text: "More of chapter one." },
      { kind: "chapter", text: "Two" },
      { kind: "paragraph", text: "Second chapter body." },
    ];

    const chapters = groupChapters(blocks);
    expect(chapters).toHaveLength(2);
    expect(chapters[0]).toMatchObject({ chapterIndex: 0, title: "One" });
    expect(chapters[0].text).toContain("First chapter body.");
    expect(chapters[0].text).toContain("More of chapter one.");
    expect(chapters[1]).toMatchObject({ chapterIndex: 1, title: "Two" });
    expect(chapters[1].text).toContain("Second chapter body.");
  });

  test("ignores content before the first chapter and drops empty chapters", () => {
    const blocks: BookBlock[] = [
      { kind: "title", text: "A Book" },
      { kind: "paragraph", text: "Orphan text before any chapter." },
      { kind: "chapter", text: "Empty" },
      { kind: "chapter", text: "Real" },
      { kind: "paragraph", text: "Has body." },
    ];

    const chapters = groupChapters(blocks);
    // The empty chapter is dropped, but the real chapter keeps its original
    // index (1) so it stays aligned with the reader's chapter numbering.
    expect(chapters).toHaveLength(1);
    expect(chapters[0]).toMatchObject({ chapterIndex: 1, title: "Real" });
    expect(chapters[0].text).not.toContain("Orphan text");
  });
});

describe("cleanTranscriptText", () => {
  test("turns transcript speaker markers into paragraph boundaries", () => {
    expect(cleanTranscriptText("First line. >> Second line.")).toBe(
      "First line.\n\nSecond line.",
    );
  });
});

describe("blocksToPlainText", () => {
  test("flattens spoken content from every rich block kind", () => {
    const blocks: BookBlock[] = [
      { kind: "title", text: "My Book" },
      { kind: "paragraph", text: "A spoken sentence." },
      {
        kind: "dialogue",
        text: "",
        data: {
          turns: [
            { speaker: "Host", text: "How are you?" },
            { speaker: "Guest", text: "Doing great." },
          ],
        },
      },
      {
        kind: "list",
        text: "",
        data: {
          ordered: false,
          items: [{ text: "first item", subitems: ["nested item"] }],
        },
      },
      {
        kind: "diagram",
        text: "",
        data: {
          variant: "flow",
          steps: [{ label: "Start here" }, { label: "Then finish" }],
        },
      },
      { kind: "keyTerm", text: "", data: { term: "Latency", definition: "The delay before transfer." } },
    ];

    const plain = blocksToPlainText(blocks);
    for (const phrase of [
      "My Book",
      "A spoken sentence.",
      "How are you?",
      "Doing great.",
      "first item",
      "nested item",
      "Start here",
      "Then finish",
      "Latency",
      "The delay before transfer.",
    ]) {
      expect(plain).toContain(phrase);
    }
  });
});
