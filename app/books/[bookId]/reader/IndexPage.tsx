import type { Chapter } from "./types";

export function IndexPage({
  chapters,
  pageNumbers,
  onJump,
}: {
  chapters: Chapter[];
  /** Display page number (1-based, in the full deck) for each chapter. */
  pageNumbers: number[];
  onJump: (chapterIndex: number) => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <span className="hud-label text-worm">stacks index</span>
      <h2 className="mb-6 mt-1 font-heading text-3xl font-semibold">Contents</h2>
      {chapters.length === 0 ? (
        <p className="font-sans text-sm text-muted-foreground">
          This book reads as one continuous passage.
        </p>
      ) : (
        <ol className="flex flex-col gap-1 overflow-hidden">
          {chapters.map((chapter, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => onJump(i)}
                className="group flex w-full items-baseline gap-2 py-2 text-left transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span className="call-number text-xs text-worm/70">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="font-heading text-base">
                  {chapter.act ? (
                    <span className="hud-label mr-2 text-primary">
                      {chapter.act}
                    </span>
                  ) : null}
                  {chapter.text}
                </span>
                <span className="mx-2 flex-1 self-end border-b border-dotted border-border" />
                <span className="call-number text-sm text-worm">
                  {String(pageNumbers[i] ?? "").padStart(3, "0")}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
