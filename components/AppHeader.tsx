import { UserButton } from "@clerk/nextjs";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type AppHeaderProps = {
  backHref?: string;
  backLabel?: string;
  actions?: React.ReactNode;
};

export function AppHeader({ backHref, backLabel, actions }: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          {backHref ? (
            <Button asChild variant="ghost" size="icon" aria-label={backLabel ?? "Back"}>
              <Link href={backHref}>
                <ArrowLeft data-icon="inline-start" />
              </Link>
            </Button>
          ) : null}
          <Link href="/" className="flex min-w-0 items-center gap-2 font-heading font-semibold">
            <span className="grid size-10 place-items-center border bg-card font-sans text-sm font-semibold shadow-sm">
              rb
            </span>
            <span className="truncate text-xl">readabook</span>
          </Link>
        </div>
        <div className="flex items-center gap-3">
          {actions}
          <Badge variant="outline" className="hidden sm:inline-flex">
            Private shelf
          </Badge>
          <UserButton />
        </div>
      </div>
    </header>
  );
}
