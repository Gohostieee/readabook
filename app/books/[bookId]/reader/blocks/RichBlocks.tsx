import {
  AlertTriangle,
  BookOpen,
  Lightbulb,
  ListChecks,
  Sparkles,
  StickyNote,
} from "lucide-react";
import type {
  CalloutData,
  DialogueData,
  KeyTermData,
  ListData,
  StatData,
  StepsData,
} from "../types";

export function Dialogue({ data }: { data: DialogueData }) {
  return (
    <div className="my-7 flex flex-col gap-4">
      {data.turns.map((turn, i) => (
        <div key={i} className="flex gap-3">
          <div className="flex w-24 shrink-0 flex-col items-end pt-0.5">
            <span className="font-sans text-xs font-semibold uppercase tracking-wide text-primary">
              {turn.speaker}
            </span>
          </div>
          <p className="flex-1 border-l-2 border-border pl-3 leading-8">
            {turn.text}
          </p>
        </div>
      ))}
    </div>
  );
}

export function BulletList({ data }: { data: ListData }) {
  const ListTag = data.ordered ? "ol" : "ul";
  return (
    <ListTag
      className={`my-6 flex flex-col gap-2 pl-6 leading-8 ${
        data.ordered ? "list-decimal" : "list-disc"
      }`}
    >
      {data.items.map((item, i) => (
        <li key={i} className="pl-1">
          {item.text}
          {item.subitems && item.subitems.length > 0 ? (
            <ul className="mt-1 flex flex-col gap-1 pl-5 list-[circle]">
              {item.subitems.map((sub, j) => (
                <li key={j}>{sub}</li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ListTag>
  );
}

export function Steps({ data }: { data: StepsData }) {
  return (
    <ol className="my-7 flex flex-col gap-4">
      {data.steps.map((step, i) => (
        <li key={i} className="flex gap-4">
          <span className="flex size-8 shrink-0 items-center justify-center border bg-primary font-heading text-sm font-bold text-primary-foreground">
            {i + 1}
          </span>
          <div className="flex-1 pt-0.5">
            {step.title ? (
              <span className="block font-heading font-semibold">
                {step.title}
              </span>
            ) : null}
            <span className="leading-8">{step.text}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

const CALLOUT_META: Record<
  CalloutData["variant"],
  { label: string; Icon: typeof StickyNote }
> = {
  note: { label: "Note", Icon: StickyNote },
  "key-insight": { label: "Key insight", Icon: Sparkles },
  definition: { label: "Definition", Icon: BookOpen },
  warning: { label: "Watch out", Icon: AlertTriangle },
  tip: { label: "Tip", Icon: Lightbulb },
};

export function Callout({
  data,
  text,
}: {
  data: CalloutData;
  text: string;
}) {
  const meta = CALLOUT_META[data.variant] ?? CALLOUT_META.note;
  const { Icon } = meta;
  return (
    <aside className="my-7 border-l-4 border-primary bg-card/70 p-4">
      <div className="mb-1.5 flex items-center gap-2 font-sans text-xs font-semibold uppercase tracking-wide text-primary">
        <Icon className="size-4" />
        {meta.label}
      </div>
      <p className="leading-7">{text}</p>
    </aside>
  );
}

export function KeyTerm({ data }: { data: KeyTermData }) {
  return (
    <dl className="my-6 border bg-card/50 p-4">
      <dt className="flex items-center gap-2 font-heading text-lg font-semibold">
        <ListChecks className="size-4 text-primary" />
        {data.term}
      </dt>
      <dd className="mt-1 leading-7 text-muted-foreground">
        {data.definition}
      </dd>
    </dl>
  );
}

export function Stat({ data }: { data: StatData }) {
  return (
    <div className="my-7 flex items-baseline gap-4 border-y py-5">
      <span className="font-heading text-5xl font-bold leading-none text-primary">
        {data.value}
      </span>
      <div>
        <span className="block font-sans text-sm font-semibold uppercase tracking-wide">
          {data.label}
        </span>
        {data.context ? (
          <span className="block font-sans text-sm text-muted-foreground">
            {data.context}
          </span>
        ) : null}
      </div>
    </div>
  );
}
