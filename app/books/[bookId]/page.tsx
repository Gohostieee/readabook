"use client";

import { useEffect, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { AlertCircle, Check, Copy } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ReaderEngine } from "./reader/ReaderEngine";
import type { BookBlock, FactCheckJob, ReaderFact } from "./reader/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";

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

const statusCopy = {
  queued: "Queued",
  fetchingTranscript: "Gathering transcript",
  transcriptPending: "Reading the lines",
  formatting: "Shaping chapters",
  validating: "Tidying pages",
  completed: "Ready to read",
  failed: "Needs attention",
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

  async function copyId() {
    if (!bookId) return;
    await navigator.clipboard.writeText(bookId);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <main className="min-h-screen text-foreground">
      <AppHeader
        backHref="/"
        backLabel="Back to shelf"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void copyId()}
            disabled={!bookId}
          >
            {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
            <span className="hud-label hidden sm:inline">call number</span>
          </Button>
        }
      />

      {isAuthLoading || !book ? (
        <section className="mx-auto flex max-w-3xl px-4 py-20">
          <Empty className="border bg-card/85">
            <EmptyHeader>
              <EmptyMedia>
                <div className="grid size-16 place-items-center border bg-muted font-terminal text-2xl font-bold text-worm worm-cursor">
                  rb
                </div>
              </EmptyMedia>
              <EmptyTitle>
                <span className="call-number text-worm">&gt; accessing archive…</span>
              </EmptyTitle>
              <EmptyDescription>
                Opening this volume and adding it to your private shelf.
              </EmptyDescription>
            </EmptyHeader>
            <Spinner />
          </Empty>
        </section>
      ) : status !== "completed" ? (
        <section className="mx-auto max-w-3xl px-4 py-16">
          <Card>
            <CardHeader>
              <span className="hud-label text-worm">accession log</span>
              <CardTitle className="font-heading text-3xl">{book.title}</CardTitle>
              <CardDescription>
                This volume is still being stitched together from the transcript.
              </CardDescription>
              <CardAction>
                <Badge className="hud-label">{statusCopy[book.status]}</Badge>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <Progress value={progressByStatus[book.status]} className="h-2" />
              {book.errorMessage ? (
                <Alert variant="destructive">
                  <AlertCircle />
                  <AlertTitle>The book could not be finished</AlertTitle>
                  <AlertDescription>{book.errorMessage}</AlertDescription>
                </Alert>
              ) : null}
            </CardContent>
          </Card>
        </section>
      ) : (
        <section className="px-4 py-8 sm:px-6">
          <ReaderEngine
            blocks={book.blocks as BookBlock[]}
            title={book.title}
            subtitle={book.subtitle}
            channel={video?.channelName}
            thumbnailUrl={video?.thumbnailUrl}
            language={book.language}
            readingMinutes={book.readingMinutes}
            preservationScore={book.preservationScore}
            facts={(data?.facts ?? []) as ReaderFact[]}
            factCheckJob={(data?.factCheckJob ?? null) as FactCheckJob}
          />
        </section>
      )}
    </main>
  );
}
