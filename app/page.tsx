"use client";

import { FormEvent, useMemo, useState } from "react";
import {
  useConvexAuth,
  useMutation,
  usePaginatedQuery,
  useQuery,
} from "convex/react";
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Clock,
  Library,
  Sparkles,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

const statusCopy = {
  queued: "Queued",
  fetchingTranscript: "Gathering transcript",
  transcriptPending: "Reading the lines",
  formatting: "Shaping chapters",
  validating: "Tidying pages",
  completed: "Ready to read",
  failed: "Needs attention",
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
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();
  const [url, setUrl] = useState("");
  const [preferredLang, setPreferredLang] = useState("en");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<SubmitResult | null>(null);
  const submitVideo = useMutation(api.books.submitVideo);
  const removeFromLibrary = useMutation(api.books.removeFromLibrary);
  const activeJob = useQuery(
    api.books.getJob,
    isAuthenticated && active?.jobId ? { jobId: active.jobId } : "skip",
  );
  const library = usePaginatedQuery(
    api.books.listMyBooks,
    isAuthenticated ? {} : "skip",
    { initialNumItems: 12 },
  );

  const visibleStatus = activeJob?.job?.status ?? active?.status ?? null;
  const activeBookId = activeJob?.book?._id ?? active?.bookId ?? null;
  const activeTitle = activeJob?.book?.title ?? "Your next little book";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isAuthenticated) {
      setError(
        isAuthLoading
          ? "Your shelf is still opening. Please try again in a moment."
          : "Sign in before making a book.",
      );
      return;
    }
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
      setError(caught instanceof Error ? caught.message : "Unable to make this book.");
    } finally {
      setSubmitting(false);
    }
  }

  const books = useMemo(
    () => library.results.filter((item) => item.book),
    [library.results],
  );

  return (
    <main className="min-h-screen text-foreground">
      <AppHeader />

      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:py-8">
        <section className="flex flex-col gap-6">
          <Card className="relative overflow-hidden border-primary/15 bg-card/95 shadow-sm">
            <CardHeader className="gap-4 sm:grid-cols-[1fr_auto]">
              <div className="flex flex-col gap-3">
                <Badge variant="secondary" className="w-fit">
                  <Sparkles data-icon="inline-start" />
                  Cozy transcript magic
                </Badge>
                <div className="flex flex-col gap-3">
                  <CardTitle className="max-w-3xl font-heading text-4xl leading-tight sm:text-5xl">
                    Turn a video into a cozy little book.
                  </CardTitle>
                  <CardDescription className="max-w-2xl text-base leading-7">
                    Paste a YouTube link. readabook gathers the transcript, tidies
                    the chapters, and saves the finished story to your private shelf.
                  </CardDescription>
                </div>
              </div>
              <CardAction className="hidden sm:block">
                <div className="grid size-24 place-items-center border bg-muted font-heading text-4xl font-bold text-primary">
                  rb
                </div>
              </CardAction>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit}>
                <FieldGroup>
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_8rem_auto]">
                    <Field>
                      <FieldLabel htmlFor="video-url">YouTube link</FieldLabel>
                      <Input
                        id="video-url"
                        value={url}
                        onChange={(event) => setUrl(event.target.value)}
                        placeholder="https://www.youtube.com/watch?v=..."
                        required
                        aria-invalid={Boolean(error)}
                      />
                      <FieldDescription>
                        Public videos with transcripts work best.
                      </FieldDescription>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="language">Language</FieldLabel>
                      <Input
                        id="language"
                        value={preferredLang}
                        onChange={(event) => setPreferredLang(event.target.value)}
                        maxLength={8}
                      />
                      <FieldDescription>Short code, like en.</FieldDescription>
                    </Field>
                    <Field className="justify-end">
                      <Button
                        type="submit"
                        size="lg"
                        disabled={submitting || isAuthLoading || !isAuthenticated}
                      >
                        {submitting ? <Spinner data-icon="inline-start" /> : null}
                        Make my book
                        {!submitting ? <ArrowRight data-icon="inline-end" /> : null}
                      </Button>
                    </Field>
                  </div>
                  {error ? <FieldError>{error}</FieldError> : null}
                </FieldGroup>
              </form>
            </CardContent>
          </Card>

          {visibleStatus ? (
            <Card className="border-primary/15">
              <CardHeader>
                <div className="flex items-start gap-3">
                  <div className="grid size-10 shrink-0 place-items-center border bg-muted text-primary">
                    {visibleStatus === "completed" ? (
                      <CheckCircle2 />
                    ) : visibleStatus === "failed" ? (
                      <Clock />
                    ) : (
                      <Spinner />
                    )}
                  </div>
                  <div className="min-w-0">
                    <CardTitle className="font-heading text-xl">{activeTitle}</CardTitle>
                    <CardDescription>
                      {active?.reused
                        ? "This video already had a finished book, so it joined your shelf."
                        : "The formatter is gathering lines, shaping chapters, and smoothing the pages."}
                    </CardDescription>
                  </div>
                </div>
                <CardAction>
                  <Badge>{statusCopy[visibleStatus]}</Badge>
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <Progress value={statusProgress[visibleStatus]} className="h-2" />
                {activeJob?.job?.errorMessage ? (
                  <Alert variant="destructive">
                    <AlertCircle />
                    <AlertTitle>The book could not be finished</AlertTitle>
                    <AlertDescription>{activeJob.job.errorMessage}</AlertDescription>
                  </Alert>
                ) : null}
              </CardContent>
              {activeBookId && visibleStatus === "completed" ? (
                <CardFooter>
                  <Button asChild>
                    <Link href={`/books/${activeBookId}`}>
                      Open book
                      <BookOpen data-icon="inline-end" />
                    </Link>
                  </Button>
                </CardFooter>
              ) : null}
            </Card>
          ) : null}

          <section className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Library className="text-primary" />
                <h2 className="font-heading text-2xl font-semibold">Your little shelf</h2>
              </div>
              {library.status === "CanLoadMore" ? (
                <Button variant="outline" onClick={() => library.loadMore(12)}>
                  Load more
                </Button>
              ) : null}
            </div>

            {isAuthLoading || library.status === "LoadingFirstPage" ? (
              <div className="grid gap-3 md:grid-cols-2">
                {Array.from({ length: 4 }).map((_, index) => (
                  <Card key={index}>
                    <CardHeader>
                      <Skeleton className="h-5 w-20" />
                      <Skeleton className="h-6 w-3/4" />
                      <Skeleton className="h-4 w-1/2" />
                    </CardHeader>
                    <CardContent>
                      <Skeleton className="h-8 w-full" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : books.length === 0 ? (
              <Empty className="border bg-card/80">
                <EmptyHeader>
                  <EmptyMedia>
                    <div className="grid size-16 place-items-center border bg-muted font-heading text-2xl font-bold text-primary">
                      rb
                    </div>
                  </EmptyMedia>
                  <EmptyTitle>Your shelf is waiting.</EmptyTitle>
                  <EmptyDescription>
                    Add a YouTube link above and your first readable book will land here.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Badge variant="outline">No books yet</Badge>
                </EmptyContent>
              </Empty>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {books.map((item) => {
                  const book = item.book!;
                  return (
                    <Card key={book._id} size="sm" className="transition-shadow hover:shadow-md">
                      <CardHeader>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <Badge variant="outline">{statusCopy[book.status]}</Badge>
                            <CardTitle className="mt-3 line-clamp-2 font-heading text-lg">
                              {book.title}
                            </CardTitle>
                            <CardDescription className="line-clamp-2">
                              {item.video?.channelName ?? item.video?.canonicalUrl}
                            </CardDescription>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Remove from shelf"
                            disabled={!isAuthenticated}
                            onClick={() => {
                              if (!isAuthenticated) return;
                              void removeFromLibrary({ bookId: book._id });
                            }}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <Separator />
                      </CardContent>
                      <CardFooter className="justify-between gap-3">
                        <span className="truncate text-xs text-muted-foreground">
                          {book.language.toUpperCase()} / {book.blocks.length} blocks
                        </span>
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/books/${book._id}`}>
                            Read
                            <ArrowRight data-icon="inline-end" />
                          </Link>
                        </Button>
                      </CardFooter>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>
        </section>

        <aside className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="font-heading">How chapters appear</CardTitle>
              <CardDescription>
                The formatter recognizes titles, chapters, quotes, sections, and
                paragraphs, then gives each one proper book typography.
              </CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="font-heading">Shared source, private shelf</CardTitle>
              <CardDescription>
                Finished books are canonical per video and language. Your saved shelf
                stays private, even when the same source is reused.
              </CardDescription>
            </CardHeader>
          </Card>
          <Card className="bg-primary text-primary-foreground">
            <CardHeader>
              <CardTitle className="font-heading">Reading note</CardTitle>
              <CardDescription className="text-primary-foreground/80">
                Longer talks make better chaptered books. Short clips usually become
                quick notes.
              </CardDescription>
            </CardHeader>
          </Card>
        </aside>
      </div>
    </main>
  );
}
