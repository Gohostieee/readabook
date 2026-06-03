import { Block } from "./Block";
import type { Page } from "./paginate";
import type { BookBlock } from "./types";

export function PageView({
  page,
  blocks,
  pageNumber,
}: {
  page: Page;
  blocks: BookBlock[];
  pageNumber: number;
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
            />
          );
        })}
      </div>
      <div className="mt-4 shrink-0 text-center font-sans text-xs text-muted-foreground">
        {pageNumber}
      </div>
    </div>
  );
}
