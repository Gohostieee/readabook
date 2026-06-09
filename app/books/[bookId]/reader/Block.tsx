import { Quote } from "lucide-react";
import type {
  BookBlock,
  CalloutData,
  ChapterData,
  DiagramData,
  DialogueData,
  KeyTermData,
  ListData,
  ParagraphData,
  QuoteData,
  ReaderFact,
  StatData,
  StepsData,
} from "./types";
import { highlightFacts } from "./factStyles";
import { Diagram } from "./blocks/Diagram";
import {
  BulletList,
  Callout,
  Dialogue,
  KeyTerm,
  Stat,
  Steps,
} from "./blocks/RichBlocks";

type BlockProps = {
  block: BookBlock;
  /** Character range for a split paragraph fragment. */
  slice?: [number, number];
  /** Scale-to-fit factor for an oversized atomic block. */
  scale?: number;
  /** Fact-check facts whose chapter contains this block (for highlighting). */
  facts?: ReaderFact[];
  /** Open the fact-check panel scrolled to a fact. */
  onFactClick?: (factId: string) => void;
};

export function Block({ block, slice, scale, facts, onFactClick }: BlockProps) {
  const content = render(block, slice, facts, onFactClick);
  if (scale && scale < 1) {
    return (
      <div
        style={{
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          width: `${100 / scale}%`,
        }}
      >
        {content}
      </div>
    );
  }
  return content;
}

function render(
  block: BookBlock,
  slice?: [number, number],
  facts?: ReaderFact[],
  onFactClick?: (factId: string) => void,
) {
  switch (block.kind) {
    case "title":
      return (
        <h1 className="mb-5 font-heading text-5xl font-semibold leading-tight sm:text-6xl">
          {block.text}
        </h1>
      );

    case "subtitle":
      return (
        <p className="mb-12 font-sans text-xl leading-8 text-muted-foreground">
          {block.text}
        </p>
      );

    case "chapter": {
      const data = block.data as ChapterData | undefined;
      return (
        <header className="mb-8">
          {data?.act ? (
            <span className="font-sans text-xs uppercase tracking-[0.3em] text-primary">
              {data.act}
            </span>
          ) : null}
          <h2 className="mt-2 font-heading text-4xl font-semibold leading-tight">
            {block.text}
          </h2>
          {data?.summary ? (
            <p className="mt-3 font-sans text-base italic text-muted-foreground">
              {data.summary}
            </p>
          ) : null}
        </header>
      );
    }

    case "section":
      return (
        <h3 className="mb-4 mt-8 font-heading text-2xl font-semibold leading-8">
          {highlightFacts(block.text, facts, onFactClick)}
        </h3>
      );

    case "quote":
    case "pullquote":
    case "epigraph": {
      const data = block.data as QuoteData | undefined;
      const isPull = block.kind === "pullquote";
      return (
        <blockquote
          className={
            isPull
              ? "my-9 border-y py-6 text-center font-heading text-2xl leading-9 italic"
              : "my-8 border bg-card/70 p-5 font-reader text-xl leading-9"
          }
        >
          {!isPull ? <Quote className="mb-3 size-5 text-primary" /> : null}
          {highlightFacts(block.text, facts, onFactClick)}
          {data?.attribution ? (
            <footer className="mt-3 font-sans text-sm not-italic text-muted-foreground">
              — {data.attribution}
            </footer>
          ) : null}
        </blockquote>
      );
    }

    case "callout":
      return (
        <Callout data={block.data as CalloutData} text={block.text} />
      );

    case "dialogue":
      return <Dialogue data={block.data as DialogueData} />;

    case "list":
      return <BulletList data={block.data as ListData} />;

    case "steps":
      return <Steps data={block.data as StepsData} />;

    case "diagram":
      return <Diagram data={block.data as DiagramData} />;

    case "keyTerm":
      return <KeyTerm data={block.data as KeyTermData} />;

    case "stat":
      return <Stat data={block.data as StatData} />;

    case "break":
      return (
        <div className="my-10 text-center text-2xl text-muted-foreground">
          ❧
        </div>
      );

    case "paragraph":
    default: {
      const data = block.data as ParagraphData | undefined;
      const text = slice ? block.text.slice(slice[0], slice[1]) : block.text;
      const dropcap = data?.dropcap && (!slice || slice[0] === 0);
      return (
        <p
          className={
            dropcap
              ? "mb-6 first-letter:float-left first-letter:mr-2 first-letter:font-heading first-letter:text-6xl first-letter:font-semibold first-letter:leading-[0.8]"
              : "mb-6"
          }
        >
          {highlightFacts(text, facts, onFactClick)}
        </p>
      );
    }
  }
}
