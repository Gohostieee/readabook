import { ArrowRight, RotateCw } from "lucide-react";
import type { DiagramData } from "../types";

function Caption({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 text-center font-sans text-xs uppercase tracking-widest text-muted-foreground">
      {children}
    </p>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <figure className="my-8 border bg-card/60 p-5">{children}</figure>
  );
}

export function Diagram({ data }: { data: DiagramData }) {
  switch (data.variant) {
    case "flow":
      return (
        <Frame>
          <div className="flex flex-wrap items-stretch gap-2">
            {data.steps.map((step, i) => (
              <div key={i} className="flex items-stretch gap-2">
                <div className="flex min-w-32 flex-1 flex-col border bg-background p-3">
                  <span className="font-heading text-sm font-semibold">
                    {step.label}
                  </span>
                  {step.detail ? (
                    <span className="mt-1 font-sans text-xs text-muted-foreground">
                      {step.detail}
                    </span>
                  ) : null}
                </div>
                {i < data.steps.length - 1 ? (
                  <ArrowRight className="size-4 self-center text-primary" />
                ) : null}
              </div>
            ))}
          </div>
          <Caption>Process</Caption>
        </Frame>
      );

    case "comparison":
      return (
        <Frame>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse font-sans text-sm">
              <thead>
                <tr>
                  <th className="border bg-muted p-2 text-left" />
                  {data.columns.map((col, i) => (
                    <th
                      key={i}
                      className="border bg-muted p-2 text-left font-heading"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, r) => (
                  <tr key={r}>
                    <th className="border bg-muted/50 p-2 text-left font-medium">
                      {row.label}
                    </th>
                    {row.cells.map((cell, c) => (
                      <td key={c} className="border p-2 align-top">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Caption>Comparison</Caption>
        </Frame>
      );

    case "timeline":
      return (
        <Frame>
          <ol className="relative ml-3 border-l-2 border-primary/40">
            {data.events.map((event, i) => (
              <li key={i} className="ml-5 pb-5 last:pb-0">
                <span className="absolute -left-[7px] mt-1 size-3 border-2 border-primary bg-background" />
                {event.when ? (
                  <span className="font-sans text-xs uppercase tracking-wide text-primary">
                    {event.when}
                  </span>
                ) : null}
                <p className="font-heading text-sm font-semibold">
                  {event.label}
                </p>
                {event.detail ? (
                  <p className="font-sans text-xs text-muted-foreground">
                    {event.detail}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
          <Caption>Timeline</Caption>
        </Frame>
      );

    case "hierarchy":
      return (
        <Frame>
          <ul className="flex flex-col gap-1.5 font-sans text-sm">
            {data.nodes.map((node, i) => (
              <li
                key={i}
                className="border-l-2 border-primary/30 py-1"
                style={{ marginLeft: `${node.depth * 1.25}rem` }}
              >
                <span
                  className={
                    node.depth === 0
                      ? "font-heading font-semibold"
                      : "text-muted-foreground"
                  }
                >
                  <span className="pl-2">{node.label}</span>
                </span>
              </li>
            ))}
          </ul>
          <Caption>Structure</Caption>
        </Frame>
      );

    case "cycle":
      return (
        <Frame>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {data.nodes.map((node, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="border bg-background px-3 py-2 font-heading text-sm font-semibold">
                  {node.label}
                </div>
                <RotateCw className="size-4 text-primary" />
              </div>
            ))}
          </div>
          <Caption>Cycle</Caption>
        </Frame>
      );

    case "quadrant": {
      const { low: xLo, high: xHi } = data.axes.x;
      const { low: yLo, high: yHi } = data.axes.y;
      return (
        <Frame>
          <div className="relative">
            <div className="relative aspect-square w-full border bg-background">
              {/* axes */}
              <div className="absolute left-1/2 top-0 h-full w-px bg-border" />
              <div className="absolute left-0 top-1/2 h-px w-full bg-border" />
              {data.items.map((item, i) => (
                <div
                  key={i}
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                  style={{
                    left: `${clamp(item.x) * 100}%`,
                    top: `${(1 - clamp(item.y)) * 100}%`,
                  }}
                >
                  <span className="block size-2 bg-primary" />
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 whitespace-nowrap font-sans text-xs">
                    {item.label}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex justify-between font-sans text-xs text-muted-foreground">
              <span>{xLo}</span>
              <span>{xHi}</span>
            </div>
            <span className="absolute -left-1 top-0 origin-top-left font-sans text-xs text-muted-foreground">
              {yHi}
            </span>
            <span className="absolute bottom-6 -left-1 font-sans text-xs text-muted-foreground">
              {yLo}
            </span>
          </div>
          <Caption>Tradeoffs</Caption>
        </Frame>
      );
    }

    default:
      return null;
  }
}

function clamp(value: number) {
  if (Number.isNaN(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}
