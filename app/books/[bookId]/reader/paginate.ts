// Pure pagination engine: packs measured, variable-height blocks into
// fixed-height pages. No DOM access — fully unit-testable.

export type PaginateBlock = {
  kind: string;
  /** Plain text length, used to slice splittable blocks across pages. */
  textLength: number;
};

export type PageItem = {
  blockIndex: number;
  /**
   * For a split paragraph, the [start, end) character range of this fragment.
   * Absent when the whole block is on the page.
   */
  slice?: [number, number];
  /** Scale factor (<1) applied when a single atomic block is taller than a page. */
  scale?: number;
};

export type Page = { items: PageItem[] };

export type PaginateResult = {
  pages: Page[];
  /** chapterStartPages[i] = content page index where the i-th chapter begins. */
  chapterStartPages: number[];
};

// Only paragraphs are split across page boundaries. Everything else is atomic
// and is moved whole to the next page (or scaled to fit if taller than a page).
const SPLITTABLE = new Set(["paragraph"]);

// Headings should never dangle as the last item on a page.
const HEADING = new Set(["chapter", "section", "title", "subtitle"]);

export function paginate(
  blocks: PaginateBlock[],
  heights: number[],
  pageHeight: number,
): PaginateResult {
  const pages: Page[] = [];
  const chapterStartPages: number[] = [];

  let current: PageItem[] = [];
  let remaining = pageHeight;

  const newPage = () => {
    if (current.length > 0) {
      pages.push({ items: current });
      current = [];
      remaining = pageHeight;
    }
  };

  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    const height = Math.max(0, heights[i] ?? 0);

    if (block.kind === "chapter") {
      // Chapters always begin a fresh page for a strong opener.
      newPage();
      chapterStartPages.push(pages.length);
    }

    if (block.kind === "break") {
      // Soft page break.
      newPage();
      continue;
    }

    // Heading glue: if a heading would be the last thing that fits, push it to
    // the next page so it stays with its following content.
    if (HEADING.has(block.kind) && height > remaining && current.length > 0) {
      newPage();
    }

    if (height <= remaining) {
      current.push({ blockIndex: i });
      remaining -= height;
      continue;
    }

    // Does not fit in the remaining space.
    if (block.kind !== "" && SPLITTABLE.has(block.kind) && block.textLength > 0) {
      // Split the paragraph across as many pages as needed using a proportional
      // characters-per-pixel model.
      const charsPerPx = block.textLength / Math.max(1, height);
      let cursor = 0;
      // First, fill the remainder of the current page if it can hold a useful chunk.
      while (cursor < block.textLength) {
        if (remaining < pageHeight * 0.12 && current.length > 0) {
          // Too little room left to be worth a fragment — turn the page.
          newPage();
        }
        const capacityChars = Math.max(
          1,
          Math.floor(remaining * charsPerPx),
        );
        const end = Math.min(block.textLength, cursor + capacityChars);
        current.push({ blockIndex: i, slice: [cursor, end] });
        const usedPx = (end - cursor) / charsPerPx;
        remaining -= usedPx;
        cursor = end;
        if (cursor < block.textLength) newPage();
      }
      continue;
    }

    // Atomic block that doesn't fit here.
    if (height > pageHeight) {
      // Taller than a whole page even when alone: give it its own page, scaled.
      newPage();
      current.push({ blockIndex: i, scale: pageHeight / height });
      newPage();
      continue;
    }

    // Move whole block to the next page.
    newPage();
    current.push({ blockIndex: i });
    remaining -= height;
  }

  newPage();

  // Guarantee at least one page so the reader always has something to show.
  if (pages.length === 0) pages.push({ items: [] });

  return { pages, chapterStartPages };
}
