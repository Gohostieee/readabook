import { describe, expect, test } from "vitest";
import { paginate, type PaginateBlock } from "./paginate";

const PAGE = 1000;

function b(kind: string, textLength = 0): PaginateBlock {
  return { kind, textLength };
}

describe("paginate", () => {
  test("packs blocks that fit onto one page", () => {
    const blocks = [b("paragraph", 100), b("paragraph", 100)];
    const { pages } = paginate(blocks, [400, 400], PAGE);
    expect(pages).toHaveLength(1);
    expect(pages[0].items.map((i) => i.blockIndex)).toEqual([0, 1]);
  });

  test("overflows onto a new page when full", () => {
    const blocks = [b("paragraph", 100), b("quote", 100)];
    // quote is atomic; 700 + 400 > 1000 so quote moves to page 2.
    const { pages } = paginate(blocks, [700, 400], PAGE);
    expect(pages).toHaveLength(2);
    expect(pages[0].items[0].blockIndex).toBe(0);
    expect(pages[1].items[0].blockIndex).toBe(1);
  });

  test("never splits an atomic block (diagram moves whole)", () => {
    const blocks = [b("paragraph", 100), b("diagram", 0)];
    const { pages } = paginate(blocks, [600, 600], PAGE);
    expect(pages).toHaveLength(2);
    expect(pages[1].items).toHaveLength(1);
    expect(pages[1].items[0].slice).toBeUndefined();
  });

  test("chapters start a fresh page and are recorded", () => {
    const blocks = [
      b("paragraph", 100),
      b("chapter"),
      b("paragraph", 100),
      b("chapter"),
      b("paragraph", 100),
    ];
    const { pages, chapterStartPages } = paginate(
      blocks,
      [200, 80, 200, 80, 200],
      PAGE,
    );
    // Two chapters, each opening its own page.
    expect(chapterStartPages).toHaveLength(2);
    // The page recorded for a chapter actually contains that chapter block.
    for (let c = 0; c < chapterStartPages.length; c += 1) {
      const pageIndex = chapterStartPages[c];
      const containsChapter = pages[pageIndex].items.some(
        (item) => blocks[item.blockIndex].kind === "chapter",
      );
      expect(containsChapter).toBe(true);
    }
  });

  test("splits a paragraph taller than a page across multiple pages", () => {
    const blocks = [b("paragraph", 3000)];
    const { pages } = paginate(blocks, [2500], PAGE);
    expect(pages.length).toBeGreaterThanOrEqual(3);
    // Slices are contiguous and cover the whole text.
    const slices = pages
      .flatMap((p) => p.items)
      .filter((i) => i.blockIndex === 0)
      .map((i) => i.slice!);
    expect(slices[0][0]).toBe(0);
    expect(slices[slices.length - 1][1]).toBe(3000);
    for (let i = 1; i < slices.length; i += 1) {
      expect(slices[i][0]).toBe(slices[i - 1][1]);
    }
  });

  test("scales an oversized atomic block to fit its own page", () => {
    const blocks = [b("diagram")];
    const { pages } = paginate(blocks, [2000], PAGE);
    expect(pages).toHaveLength(1);
    expect(pages[0].items[0].scale).toBeCloseTo(0.5);
  });

  test("a break forces a page turn", () => {
    const blocks = [b("paragraph", 100), b("break"), b("paragraph", 100)];
    const { pages } = paginate(blocks, [200, 0, 200], PAGE);
    expect(pages).toHaveLength(2);
  });

  test("always returns at least one page", () => {
    const { pages } = paginate([], [], PAGE);
    expect(pages).toHaveLength(1);
  });
});
