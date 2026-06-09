"use client";

import { useEffect, useMemo, useRef } from "react";
import { ExternalLink } from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Progress } from "@/components/ui/progress";
import { VERDICT_META } from "./factStyles";
import type { FactCheckJob, ReaderFact } from "./types";

const PHASE_COPY: Record<string, string> = {
  extracting: "Finding factual claims…",
  pruning: "Selecting the meaningful ones…",
  checking: "Fact-checking against the web…",
  failed: "Fact-check could not complete.",
};

export function FactCheckPanel({
  open,
  onOpenChange,
  facts,
  job,
  activeFactId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  facts: ReaderFact[];
  job: FactCheckJob;
  activeFactId: string | null;
}) {
  // Group facts by chapter, preserving chapter order.
  const groups = useMemo(() => {
    const byChapter = new Map<
      number,
      { title: string; facts: ReaderFact[] }
    >();
    for (const fact of facts) {
      const g = byChapter.get(fact.chapterIndex);
      if (g) g.facts.push(fact);
      else
        byChapter.set(fact.chapterIndex, {
          title: fact.chapterTitle,
          facts: [fact],
        });
    }
    return [...byChapter.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([chapterIndex, g]) => ({ chapterIndex, ...g }));
  }, [facts]);

  const itemRefs = useRef<Map<string, HTMLLIElement>>(new Map());

  // Scroll the selected fact into view when the panel opens onto it.
  useEffect(() => {
    if (!open || !activeFactId) return;
    const el = itemRefs.current.get(activeFactId);
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [open, activeFactId]);

  const inProgress =
    job != null &&
    (job.status === "extracting" ||
      job.status === "pruning" ||
      job.status === "checking");
  const progressValue =
    job && job.status === "checking" && job.totalFacts > 0
      ? Math.round((job.checkedFacts / job.totalFacts) * 100)
      : job && job.status === "extracting"
        ? 15
        : job && job.status === "pruning"
          ? 40
          : 0;

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      <DrawerContent className="data-[vaul-drawer-direction=right]:sm:max-w-md">
        <DrawerHeader className="border-b">
          <DrawerTitle>Fact check</DrawerTitle>
          <DrawerDescription>
            {inProgress
              ? (PHASE_COPY[job!.status] ?? "Working…")
              : job?.status === "failed"
                ? PHASE_COPY.failed
                : facts.length === 0
                  ? "No checkable claims were found in this book."
                  : `${facts.length} claim${facts.length === 1 ? "" : "s"} checked.`}
          </DrawerDescription>
          {inProgress ? (
            <div className="mt-2">
              <Progress value={progressValue} className="h-1.5" />
              {job!.status === "checking" ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {job!.checkedFacts}/{job!.totalFacts}
                </p>
              ) : null}
            </div>
          ) : null}
        </DrawerHeader>

        <div className="flex-1 overflow-y-auto p-4">
          {groups.length === 0 && !inProgress ? (
            <p className="text-sm text-muted-foreground">
              Nothing to show yet.
            </p>
          ) : null}

          <div className="flex flex-col gap-6">
            {groups.map((group) => (
              <section key={group.chapterIndex}>
                <h3 className="mb-2 font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.title}
                </h3>
                <ul className="flex flex-col gap-3">
                  {group.facts.map((fact) => {
                    const meta = VERDICT_META[fact.verdict];
                    return (
                      <li
                        key={fact._id}
                        ref={(el) => {
                          if (el) itemRefs.current.set(fact._id, el);
                          else itemRefs.current.delete(fact._id);
                        }}
                        className={`rounded-md border p-3 transition-colors ${
                          activeFactId === fact._id
                            ? "border-primary bg-muted/40"
                            : "border-border"
                        }`}
                      >
                        <div className="mb-1.5 flex items-center gap-2">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${meta.badge}`}
                          >
                            <span
                              className={`size-1.5 rounded-full ${meta.dot}`}
                            />
                            {meta.label}
                          </span>
                          {typeof fact.confidence === "number" ? (
                            <span className="text-xs text-muted-foreground">
                              {Math.round(fact.confidence * 100)}% confident
                            </span>
                          ) : null}
                        </div>
                        <p className="text-sm font-medium text-foreground">
                          {fact.statement}
                        </p>
                        {fact.explanation ? (
                          <p className="mt-1 text-sm text-muted-foreground">
                            {fact.explanation}
                          </p>
                        ) : null}
                        {fact.sources.length > 0 ? (
                          <ul className="mt-2 flex flex-col gap-1">
                            {fact.sources.map((src, i) => (
                              <li key={`${fact._id}-src-${i}`}>
                                <a
                                  href={src.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                >
                                  <ExternalLink className="size-3 shrink-0" />
                                  <span className="truncate">
                                    {src.title || src.url}
                                  </span>
                                </a>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
