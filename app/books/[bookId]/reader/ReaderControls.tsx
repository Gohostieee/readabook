import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

export function ReaderControls({
  current,
  total,
  onPrev,
  onNext,
}: {
  current: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  const progress = total <= 1 ? 100 : (current / (total - 1)) * 100;
  return (
    <div className="mt-4 flex items-center gap-4">
      <Button
        variant="outline"
        size="sm"
        onClick={onPrev}
        disabled={current <= 0}
        aria-label="Previous page"
      >
        <ChevronLeft data-icon="inline-start" />
        <span className="hidden sm:inline">Prev</span>
      </Button>

      <div className="flex flex-1 items-center gap-3">
        <Progress value={progress} className="h-1.5" />
        <span className="call-number shrink-0 text-xs text-worm">
          <span className="hud-label mr-1 text-muted-foreground">pg</span>
          {String(current + 1).padStart(3, "0")} / {String(total).padStart(3, "0")}
        </span>
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={onNext}
        disabled={current >= total - 1}
        aria-label="Next page"
      >
        <span className="hidden sm:inline">Next</span>
        <ChevronRight data-icon="inline-end" />
      </Button>
    </div>
  );
}
