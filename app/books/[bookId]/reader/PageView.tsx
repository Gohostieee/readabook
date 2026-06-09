import { Block } from "./Block";
import type { Page } from "./paginate";
import type { BookBlock, ReaderFact } from "./types";

export function PageView({
  page,
  blocks,
  pageNumber,
  factsForBlock,
  onFactClick,
}: {
  page: Page;
  blocks: BookBlock[];
  pageNumber: number;
  factsForBlock?: (blockIndex: number) => ReaderFact[];
  onFactClick?: (factId: string) => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="reader-flow flex-1 overflow-hidden">
        {page.items.map((item, i) => {
          const block = blocks[item.blockIndex];
          if (!block) return null;
          return (
            <Block
              key={`${item.blockIndex}-${i}`}
              block={block}
              slice={item.slice}
              scale={item.scale}
              facts={factsForBlock?.(item.blockIndex)}
              onFactClick={onFactClick}
            />
          );
        })}
      </div>
      <div className="call-number mt-4 shrink-0 text-center text-xs text-worm/70">
        {String(pageNumber).padStart(3, "0")}
      </div>
    </div>
  );
}
