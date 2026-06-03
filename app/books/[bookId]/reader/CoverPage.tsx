import { Badge } from "@/components/ui/badge";

export function CoverPage({
  title,
  subtitle,
  channel,
  thumbnailUrl,
  language,
  readingMinutes,
  preservationScore,
}: {
  title: string;
  subtitle?: string | null;
  channel?: string | null;
  thumbnailUrl?: string | null;
  language: string;
  readingMinutes?: number | null;
  preservationScore?: number | null;
}) {
  return (
    <div className="flex h-full flex-col justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{language.toUpperCase()}</Badge>
        {typeof readingMinutes === "number" ? (
          <Badge variant="outline">{readingMinutes} min read</Badge>
        ) : null}
        {typeof preservationScore === "number" ? (
          <Badge variant="outline">
            {Math.round(preservationScore * 100)}% verbatim
          </Badge>
        ) : null}
      </div>

      <div className="flex flex-col items-center text-center">
        {thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnailUrl}
            alt=""
            className="mb-8 aspect-video w-full max-w-sm border object-cover"
          />
        ) : null}
        <h1 className="font-heading text-4xl font-semibold leading-tight sm:text-5xl">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-4 font-sans text-lg italic text-muted-foreground">
            {subtitle}
          </p>
        ) : null}
      </div>

      <div className="text-center font-sans text-sm uppercase tracking-[0.3em] text-muted-foreground">
        {channel ?? "A readabook edition"}
      </div>
    </div>
  );
}
