"use client";

import { useEffect, useMemo, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { UserButton } from "@clerk/nextjs";
import {
  ArrowLeft,
  BookOpen,
  Check,
  Copy,
  Loader2,
  Quote,
} from "lucide-react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";

type PageProps = {
  params: Promise<{ bookId: string }>;
};

const progressByStatus = {
  queued: 8,
  fetchingTranscript: 28,
  transcriptPending: 42,
  formatting: 70,
  validating: 86,
  completed: 100,
  failed: 100,
} as const;

export default function BookPage({ params }: PageProps) {
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();
  const [bookId, setBookId] = useState<Id<"books"> | null>(null);
  const [copied, setCopied] = useState(false);
  const saveOnOpen = useMutation(api.books.getBook);
  const data = useQuery(
    api.books.getBookReadonly,
    isAuthenticated && bookId ? { bookId } : "skip",
  );

  useEffect(() => {
    void params.then((resolved) => setBookId(resolved.bookId as Id<"books">));
  }, [params]);

  useEffect(() => {
    if (!isAuthenticated || !bookId) return;
    void saveOnOpen({ bookId });
  }, [bookId, isAuthenticated, saveOnOpen]);

  const book = data?.book;
  const video = data?.video;
  const status = book?.status;
  const chapters = useMemo(
    () => book?.blocks.filter((block) => block.kind === "chapter") ?? [],
    [book?.blocks],
  );

  async function copyId() {
    if (!bookId) return;
    await navigator.clipboard.writeText(bookId);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="icon" aria-label="Back to library">
              <Link href="/">
                <ArrowLeft className="size-5" />
              </Link>
            </Button>
            <Link href="/" className="flex items-center gap-2 font-semibold">
              <BookOpen className="size-5" />
              readabook
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => void copyId()}
              disabled={!bookId}
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              <span className="hidden sm:inline">Book ID</span>
            </Button>
            <UserButton />
          </div>
        </div>
      </header>

      {isAuthLoading || !book ? (
        <section className="mx-auto flex max-w-3xl flex-col items-center px-4 py-24 text-center">
          <Loader2 className="mb-4 size-8 animate-spin text-muted-foreground" />
          <h1 className="text-2xl font-semibold">Opening book</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The reader is loading the canonical book and saving it to your library.
          </p>
        </section>
      ) : status !== "completed" ? (
        <section className="mx-auto max-w-3xl px-4 py-16">
          <Badge>{status}</Badge>
          <h1 className="mt-4 text-3xl font-semibold">{book.title}</h1>
          <p className="mt-3 text-muted-foreground">
            This book is not ready yet. Convex is still working through the transcript
            and formatting job.
          </p>
          <Progress value={progressByStatus[book.status]} className="mt-6 h-2" />
          {book.errorMessage ? (
            <p className="mt-4 text-sm text-destructive">{book.errorMessage}</p>
          ) : null}
        </section>
      ) : (
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="hidden lg:block">
            <div className="sticky top-24 space-y-5">
              {video?.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={video.thumbnailUrl}
                  alt=""
                  className="aspect-video w-full rounded-md border object-cover"
                />
              ) : null}
              <div>
                <Badge variant="outline">{book.language.toUpperCase()}</Badge>
                <p className="mt-3 text-sm text-muted-foreground">
                  {video?.channelName ?? "YouTube transcript"}
                </p>
              </div>
              <Separator />
              <nav className="space-y-2">
                {chapters.slice(0, 12).map((chapter, index) => (
                  <a
                    key={`${chapter.text}-${index}`}
                    href={`#chapter-${index}`}
                    className="block rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    {chapter.text}
                  </a>
                ))}
              </nav>
            </div>
          </aside>

          <article className="mx-auto w-full max-w-3xl">
            <div className="mb-10 rounded-md border bg-card p-5 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>Completed</Badge>
                {typeof book.preservationScore === "number" ? (
                  <Badge variant="outline">
                    {Math.round(book.preservationScore * 100)}% preservation
                  </Badge>
                ) : null}
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                Saved to your library. Canonical source: {video?.canonicalUrl}
              </p>
            </div>

            <div className="reader-flow">
              {book.blocks.map((block, index) => {
                if (block.kind === "title") {
                  return (
                    <h1
                      key={index}
                      className="mb-5 text-5xl font-semibold leading-tight tracking-normal sm:text-6xl"
                    >
                      {block.text}
                    </h1>
                  );
                }
                if (block.kind === "subtitle") {
                  return (
                    <p
                      key={index}
                      className="mb-12 text-xl leading-8 text-muted-foreground"
                    >
                      {block.text}
                    </p>
                  );
                }
                if (block.kind === "chapter") {
                  const chapterIndex = book.blocks
                    .slice(0, index + 1)
                    .filter((candidate) => candidate.kind === "chapter").length - 1;
                  return (
                    <h2
                      id={`chapter-${chapterIndex}`}
                      key={index}
                      className="mb-6 mt-16 border-t pt-10 text-3xl font-semibold leading-tight"
                    >
                      {block.text}
                    </h2>
                  );
                }
                if (block.kind === "section") {
                  return (
                    <h3
                      key={index}
                      className="mb-4 mt-10 text-xl font-semibold leading-8"
                    >
                      {block.text}
                    </h3>
                  );
                }
                if (block.kind === "quote") {
                  return (
                    <blockquote
                      key={index}
                      className="my-8 border-l-2 pl-5 text-xl leading-9 text-foreground"
                    >
                      <Quote className="mb-3 size-5 text-muted-foreground" />
                      {block.text}
                    </blockquote>
                  );
                }
                if (block.kind === "callout") {
                  return (
                    <div
                      key={index}
                      className="my-8 rounded-md border bg-muted/50 p-5 text-lg leading-8"
                    >
                      {block.text}
                    </div>
                  );
                }
                if (block.kind === "break") {
                  return <Separator key={index} className="my-10" />;
                }
                return (
                  <p
                    key={index}
                    className="mb-6 text-[1.06rem] leading-8 text-foreground first-letter:text-4xl first-letter:font-semibold"
                  >
                    {block.text}
                  </p>
                );
              })}
            </div>
          </article>
        </div>
      )}
    </main>
  );
}
