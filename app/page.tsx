"use client";

import { FormEvent, useMemo, useState } from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { UserButton } from "@clerk/nextjs";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Clock,
  Library,
  Loader2,
  Sparkles,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";

const statusCopy = {
  queued: "Queued",
  fetchingTranscript: "Fetching transcript",
  transcriptPending: "Transcript processing",
  formatting: "Formatting book",
  validating: "Validating",
  completed: "Completed",
  failed: "Failed",
} as const;

const statusProgress = {
  queued: 8,
  fetchingTranscript: 28,
  transcriptPending: 42,
  formatting: 70,
  validating: 86,
  completed: 100,
  failed: 100,
} as const;

type SubmitResult = {
  bookId: Id<"books">;
  jobId: Id<"bookJobs"> | null;
  status: keyof typeof statusCopy;
  reused: boolean;
};

export default function Home() {
  const [url, setUrl] = useState("");
  const [preferredLang, setPreferredLang] = useState("en");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<SubmitResult | null>(null);
  const submitVideo = useMutation(api.books.submitVideo);
  const removeFromLibrary = useMutation(api.books.removeFromLibrary);
  const activeJob = useQuery(
    api.books.getJob,
    active?.jobId ? { jobId: active.jobId } : "skip",
  );
  const library = usePaginatedQuery(
    api.books.listMyBooks,
    {},
    { initialNumItems: 12 },
  );

  const visibleStatus = activeJob?.job?.status ?? active?.status ?? null;
  const activeBookId = activeJob?.book?._id ?? active?.bookId ?? null;
  const activeTitle = activeJob?.book?.title ?? "Your book is being prepared";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitVideo({
        url,
        preferredLang: preferredLang.trim() || "en",
      });
      setActive(result);
      setUrl("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to submit video.");
    } finally {
      setSubmitting(false);
    }
  }

  const books = useMemo(
    () => library.results.filter((item) => item.book),
    [library.results],
  );

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="flex size-9 items-center justify-center rounded-md border bg-primary text-primary-foreground">
              <BookOpen className="size-5" />
            </span>
            <span className="text-lg">readabook</span>
          </Link>
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="hidden sm:inline-flex">
              Clerk enforced
            </Badge>
            <UserButton />
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="space-y-8">
          <div className="rounded-md border bg-card p-5 shadow-sm sm:p-7">
            <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h1 className="text-3xl font-semibold tracking-normal sm:text-4xl">
                  Turn a YouTube video into a readable book.
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                  Paste a video URL. Supadata pulls the transcript, and the OpenAI
                  agent formats it into a polished book while preserving the spoken words.
                </p>
              </div>
              <Sparkles className="mt-1 hidden size-7 text-muted-foreground sm:block" />
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_96px_auto]">
                <Input
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://www.youtube.com/watch?v=..."
                  required
                  aria-label="YouTube video URL"
                />
                <Input
                  value={preferredLang}
                  onChange={(event) => setPreferredLang(event.target.value)}
                  aria-label="Transcript language"
                  maxLength={8}
                />
                <Button type="submit" disabled={submitting} className="gap-2">
                  {submitting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <ArrowRight className="size-4" />
                  )}
                  Create
                </Button>
              </div>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
            </form>
          </div>

          {visibleStatus ? (
            <div className="rounded-md border bg-card p-5 shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <span className="mt-1 flex size-9 items-center justify-center rounded-md border bg-muted">
                    {visibleStatus === "completed" ? (
                      <CheckCircle2 className="size-5" />
                    ) : visibleStatus === "failed" ? (
                      <Clock className="size-5" />
                    ) : (
                      <Loader2 className="size-5 animate-spin" />
                    )}
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="font-semibold">{activeTitle}</h2>
                      <Badge>{statusCopy[visibleStatus]}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {active?.reused
                        ? "This video already had a canonical book, so it was added to your library."
                        : "The job keeps moving in Convex until the transcript is fetched and formatted."}
                    </p>
                  </div>
                </div>
                {activeBookId && visibleStatus === "completed" ? (
                  <Button asChild className="gap-2">
                    <Link href={`/books/${activeBookId}`}>
                      Open book
                      <BookOpen className="size-4" />
                    </Link>
                  </Button>
                ) : null}
              </div>
              <Progress
                value={statusProgress[visibleStatus]}
                className="mt-5 h-2"
              />
              {activeJob?.job?.errorMessage ? (
                <p className="mt-3 text-sm text-destructive">
                  {activeJob.job.errorMessage}
                </p>
              ) : null}
            </div>
          ) : null}

          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Library className="size-5" />
                <h2 className="text-xl font-semibold">Saved books</h2>
              </div>
              {library.status === "CanLoadMore" ? (
                <Button variant="outline" onClick={() => library.loadMore(12)}>
                  Load more
                </Button>
              ) : null}
            </div>

            {library.status === "LoadingFirstPage" ? (
              <div className="rounded-md border p-5 text-sm text-muted-foreground">
                Loading your library...
              </div>
            ) : books.length === 0 ? (
              <div className="rounded-md border p-8 text-center">
                <BookOpen className="mx-auto mb-3 size-8 text-muted-foreground" />
                <p className="font-medium">No books saved yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Submit a YouTube video to create your first readabook.
                </p>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {books.map((item) => {
                  const book = item.book!;
                  return (
                    <article
                      key={book._id}
                      className="rounded-md border bg-card p-4 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Badge variant="outline">
                            {statusCopy[book.status]}
                          </Badge>
                          <h3 className="mt-3 line-clamp-2 font-semibold">
                            {book.title}
                          </h3>
                          <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                            {item.video?.channelName ?? item.video?.canonicalUrl}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Remove from library"
                          onClick={() => void removeFromLibrary({ bookId: book._id })}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                      <Separator className="my-4" />
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs text-muted-foreground">
                          {book.language.toUpperCase()} · {book.blocks.length} blocks
                        </span>
                        <Button asChild size="sm" variant="outline" className="gap-2">
                          <Link href={`/books/${book._id}`}>
                            Read
                            <ArrowRight className="size-4" />
                          </Link>
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </section>

        <aside className="space-y-4">
          <div className="rounded-md border bg-card p-5 shadow-sm">
            <h2 className="font-semibold">Book markup</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              The formatter produces typed blocks from markers like `###TITLE`,
              `###CHAPTER`, `###QUOTE`, and `###PARA`, then the reader renders
              them with book typography.
            </p>
          </div>
          <div className="rounded-md border bg-card p-5 shadow-sm">
            <h2 className="font-semibold">Reuse model</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Completed books are canonical per video/language/settings. If another
              signed-in user submits the same video, Convex attaches the existing
              book to their private library.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}
