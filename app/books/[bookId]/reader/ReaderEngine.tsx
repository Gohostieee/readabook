"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ShieldCheck } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Block } from "./Block";
import { CoverPage } from "./CoverPage";
import { FactCheckPanel } from "./FactCheckPanel";
import { IndexPage } from "./IndexPage";
import { PageView } from "./PageView";
import { ReaderControls } from "./ReaderControls";
import { paginate, type PaginateBlock } from "./paginate";
import type {
  BookBlock,
  Chapter,
  ChapterData,
  FactCheckJob,
  ReaderFact,
} from "./types";

// Shared page-frame styling for the deck, measurer, and metrics probe.
const FRAME_CLASS =
  "book-page border bg-reader text-reader-foreground px-6 py-8 sm:px-10 sm:py-12 shadow-sm";

type ReaderEngineProps = {
  blocks: BookBlock[];
  title: string;
  subtitle?: string | null;
  channel?: string | null;
  thumbnailUrl?: string | null;
  language: string;
  readingMinutes?: number | null;
  preservationScore?: number | null;
  facts?: ReaderFact[];
  factCheckJob?: FactCheckJob;
};

export function ReaderEngine(props: ReaderEngineProps) {
  // Title/subtitle live on the cover; everything else is paginated content.
  const contentBlocks = useMemo(
    () =>
      props.blocks.filter(
        (b) => b.kind !== "title" && b.kind !== "subtitle",
      ),
    [props.blocks],
  );

  const facts = useMemo(() => props.facts ?? [], [props.facts]);

  // Chapter index for each content block: incremented at every `chapter` block
  // (so the Nth chapter block is chapterIndex N — matching the backend's
  // grouping). Blocks before the first chapter map to -1.
  const blockChapterIndex = useMemo(() => {
    const indices: number[] = [];
    let chapterIndex = -1;
    for (const b of contentBlocks) {
      if (b.kind === "chapter") chapterIndex += 1;
      indices.push(chapterIndex);
    }
    return indices;
  }, [contentBlocks]);

  const factsByChapter = useMemo(() => {
    const map = new Map<number, ReaderFact[]>();
    for (const fact of facts) {
      const arr = map.get(fact.chapterIndex);
      if (arr) arr.push(fact);
      else map.set(fact.chapterIndex, [fact]);
    }
    return map;
  }, [facts]);

  const factsForBlock = useCallback(
    (blockIndex: number) =>
      factsByChapter.get(blockChapterIndex[blockIndex] ?? -1) ?? [],
    [factsByChapter, blockChapterIndex],
  );

  const [panelOpen, setPanelOpen] = useState(false);
  const [activeFactId, setActiveFactId] = useState<string | null>(null);
  const onFactClick = useCallback((factId: string) => {
    setActiveFactId(factId);
    setPanelOpen(true);
  }, []);

  const chapters = useMemo<Chapter[]>(
    () =>
      contentBlocks
        .filter((b) => b.kind === "chapter")
        .map((b) => {
          const data = b.data as ChapterData | undefined;
          return { text: b.text, act: data?.act, summary: data?.summary };
        }),
    [contentBlocks],
  );

  const deckRef = useRef<HTMLDivElement>(null);
  const metricsRef = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState<{ w: number; h: number } | null>(null);
  const [heights, setHeights] = useState<number[] | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [turn, setTurn] = useState<"none" | "next" | "prev">("none");

  // Measure the page content box from the live deck.
  useLayoutEffect(() => {
    const el = metricsRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) {
        setMetrics((prev) =>
          prev && prev.w === w && prev.h === h ? prev : { w, h },
        );
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Re-measure block heights whenever the content width changes or fonts load.
  const measureWidth = metrics?.w ?? 0;

  const paginateBlocks = useMemo<PaginateBlock[]>(
    () =>
      contentBlocks.map((b) => ({ kind: b.kind, textLength: b.text.length })),
    [contentBlocks],
  );

  // Content pages reserve room for the page-number footer (mt-4 + line ≈ 32px).
  const FOOTER_RESERVE = 32;

  const { pages, chapterStartPages } = useMemo(() => {
    if (!heights || !metrics) return { pages: [], chapterStartPages: [] };
    return paginate(
      paginateBlocks,
      heights,
      Math.max(120, metrics.h - FOOTER_RESERVE),
    );
  }, [heights, metrics, paginateBlocks]);

  // Deck = cover + index + content pages.
  const COVER = 0;
  const INDEX = 1;
  const CONTENT_OFFSET = 2;
  const totalPages = pages.length + CONTENT_OFFSET;

  // Display page numbers for the index (1-based across the whole deck).
  const chapterPageNumbers = useMemo(
    () => chapterStartPages.map((p) => p + CONTENT_OFFSET + 1),
    [chapterStartPages],
  );

  const goTo = useCallback(
    (next: number) => {
      setCurrentPage((prev) => {
        const clamped = Math.min(Math.max(next, 0), totalPages - 1);
        if (clamped === prev) return prev;
        setTurn(clamped > prev ? "next" : "prev");
        return clamped;
      });
    },
    [totalPages],
  );

  const goNext = useCallback(
    () => goTo(currentPage + 1),
    [currentPage, goTo],
  );
  const goPrev = useCallback(
    () => goTo(currentPage - 1),
    [currentPage, goTo],
  );

  // Keyboard navigation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "PageDown") goNext();
      else if (e.key === "ArrowLeft" || e.key === "PageUp") goPrev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goNext, goPrev]);

  // Touch swipe.
  const touchX = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    touchX.current = e.touches[0].clientX;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    if (Math.abs(dx) > 50) (dx < 0 ? goNext : goPrev)();
    touchX.current = null;
  };

  // Clear the turn flag after the animation so it can replay.
  useEffect(() => {
    if (turn === "none") return;
    const t = window.setTimeout(() => setTurn("none"), 360);
    return () => window.clearTimeout(t);
  }, [turn, currentPage]);

  const jumpToChapter = useCallback(
    (chapterIndex: number) => {
      const start = chapterStartPages[chapterIndex];
      if (typeof start === "number") goTo(start + CONTENT_OFFSET);
    },
    [chapterStartPages, goTo],
  );

  const ready = heights !== null && metrics !== null && pages.length > 0;

  let body: React.ReactNode;
  if (currentPage === COVER) {
    body = (
      <CoverPage
        title={props.title}
        subtitle={props.subtitle}
        channel={props.channel}
        thumbnailUrl={props.thumbnailUrl}
        language={props.language}
        readingMinutes={props.readingMinutes}
        preservationScore={props.preservationScore}
      />
    );
  } else if (currentPage === INDEX) {
    body = (
      <IndexPage
        chapters={chapters}
        pageNumbers={chapterPageNumbers}
        onJump={jumpToChapter}
      />
    );
  } else if (ready) {
    const page = pages[currentPage - CONTENT_OFFSET];
    body = page ? (
      <PageView
        page={page}
        blocks={contentBlocks}
        pageNumber={currentPage + 1}
        factsForBlock={factsForBlock}
        onFactClick={onFactClick}
      />
    ) : null;
  } else {
    body = (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div
        ref={deckRef}
        className="relative"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div
          key={currentPage}
          className={`${FRAME_CLASS} book-page-deck ${
            turn === "next"
              ? "animate-page-next"
              : turn === "prev"
                ? "animate-page-prev"
                : ""
          }`}
        >
          {/* Invisible probe that mirrors the content box for measurement. */}
          <div
            ref={metricsRef}
            aria-hidden
            className="pointer-events-none invisible absolute inset-x-6 inset-y-8 sm:inset-x-10 sm:inset-y-12"
          />
          {body}
        </div>
      </div>

      <ReaderControls
        current={currentPage}
        total={totalPages}
        onPrev={goPrev}
        onNext={goNext}
      />

      {props.factCheckJob || facts.length > 0 ? (
        <div className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={() => {
              setActiveFactId(null);
              setPanelOpen(true);
            }}
            className="inline-flex items-center gap-2 rounded-full border bg-card px-4 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ShieldCheck className="size-4 text-primary" />
            <span>
              Fact check
              {props.factCheckJob &&
              props.factCheckJob.status === "checking" &&
              props.factCheckJob.totalFacts > 0
                ? ` · ${props.factCheckJob.checkedFacts}/${props.factCheckJob.totalFacts}`
                : facts.length > 0
                  ? ` · ${facts.length}`
                  : props.factCheckJob &&
                      props.factCheckJob.status !== "completed" &&
                      props.factCheckJob.status !== "failed"
                    ? " · working…"
                    : ""}
            </span>
          </button>
        </div>
      ) : null}

      {/* Offscreen measurer: renders every content block at the true width. */}
      {measureWidth > 0 ? (
        <Measurer
          key={measureWidth}
          blocks={contentBlocks}
          width={measureWidth}
          onMeasured={setHeights}
          factsForBlock={factsForBlock}
        />
      ) : null}

      <FactCheckPanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        facts={facts}
        job={props.factCheckJob ?? null}
        activeFactId={activeFactId}
      />
    </div>
  );
}

function Measurer({
  blocks,
  width,
  onMeasured,
  factsForBlock,
}: {
  blocks: BookBlock[];
  width: number;
  onMeasured: (heights: number[]) => void;
  factsForBlock?: (blockIndex: number) => ReaderFact[];
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const children = Array.from(el.children) as HTMLElement[];
      if (children.length === 0) {
        onMeasured([]);
        return;
      }
      // Measure the true flow height each block consumes, *including* the
      // vertical margins between blocks. offsetHeight excludes margins (and
      // they collapse through a wrapper), which made pagination pack too many
      // blocks per page — overflowing the fixed-height page. Using the gap
      // between successive block tops captures (collapsed) margins exactly.
      const tops = children.map((c) => c.getBoundingClientRect().top);
      const containerBottom = el.getBoundingClientRect().bottom;
      const heights = children.map((c, i) =>
        (i + 1 < children.length ? tops[i + 1] : containerBottom) - tops[i],
      );
      onMeasured(heights);
    };
    measure();
    // Re-measure once webfonts settle (serif metrics shift heights).
    let cancelled = false;
    if (typeof document !== "undefined" && document.fonts?.ready) {
      void document.fonts.ready.then(() => {
        if (!cancelled) measure();
      });
    }
    return () => {
      cancelled = true;
    };
  }, [blocks, width, onMeasured]);

  return (
    <div
      aria-hidden
      className="pointer-events-none invisible fixed left-0 top-0 -z-50"
      style={{ width }}
    >
      {/* Mirror PageView's container exactly (reader-flow + overflow-hidden
          establishes the same block-formatting context) so margins collapse
          identically and measured heights match what's rendered. Each Block
          renders a single root element, so children map 1:1 to blocks. */}
      <div ref={ref} className="reader-flow overflow-hidden">
        {blocks.map((block, i) => (
          <Block key={i} block={block} facts={factsForBlock?.(i)} />
        ))}
      </div>
    </div>
  );
}
