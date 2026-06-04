"use client";

import { FormEvent, useState } from "react";
import { useQuery } from "convex/react";
import { Lock } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

const usd = (value: number) =>
  `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  })}`;

const num = (value: number) => value.toLocaleString("en-US");

const statusVariant: Record<string, "default" | "secondary" | "destructive"> = {
  success: "default",
  fallback: "secondary",
  failed: "destructive",
};

export default function DashboardPage() {
  const [input, setInput] = useState("");
  const [password, setPassword] = useState<string | null>(null);

  // Only runs once a password has been submitted. The server verifies it.
  const data = useQuery(
    api.aiCosts.getCostSummary,
    password === null ? "skip" : { password },
  );

  const authorized = data?.authorized === true;
  const wrongPassword = password !== null && data?.authorized === false;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPassword(input);
  }

  if (!authorized) {
    return (
      <main className="min-h-screen text-foreground">
        <AppHeader backHref="/" backLabel="Home" />
        <div className="mx-auto grid max-w-md gap-6 px-4 py-16 sm:px-6">
          <Card>
            <CardHeader>
              <div className="grid size-10 place-items-center border bg-muted text-primary">
                <Lock />
              </div>
              <CardTitle className="font-heading text-2xl">
                Cost dashboard
              </CardTitle>
              <CardDescription>
                This area is password protected.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit}>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="dashboard-password">Password</FieldLabel>
                    <Input
                      id="dashboard-password"
                      type="password"
                      value={input}
                      onChange={(event) => setInput(event.target.value)}
                      autoFocus
                      aria-invalid={wrongPassword}
                    />
                    {wrongPassword ? (
                      <FieldError>Incorrect password.</FieldError>
                    ) : null}
                  </Field>
                  <Button type="submit">Unlock</Button>
                </FieldGroup>
              </form>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  const { totals, recent } = data;

  return (
    <main className="min-h-screen text-foreground">
      <AppHeader backHref="/" backLabel="Home" />
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-3xl font-semibold">AI cost dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Spend across the last {num(totals.requests)} recorded requests.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card size="sm">
            <CardHeader>
              <CardDescription>Total cost</CardDescription>
              <CardTitle className="font-heading text-2xl">
                {usd(totals.costUsd)}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardDescription>Requests</CardDescription>
              <CardTitle className="font-heading text-2xl">
                {num(totals.requests)}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex gap-2">
              <Badge variant="default">{totals.byStatus.success} ok</Badge>
              <Badge variant="secondary">{totals.byStatus.fallback} fallback</Badge>
              <Badge variant="destructive">{totals.byStatus.failed} failed</Badge>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardDescription>Input tokens</CardDescription>
              <CardTitle className="font-heading text-2xl">
                {num(totals.inputTokens)}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardDescription>Output tokens</CardDescription>
              <CardTitle className="font-heading text-2xl">
                {num(totals.outputTokens)}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="font-heading">Recent requests</CardTitle>
            <CardDescription>Most recent {recent.length} requests.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Input</TableHead>
                    <TableHead className="text-right">Output</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                    <TableHead>Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recent.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {new Date(row.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{row.model}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant[row.status] ?? "secondary"}>
                          {row.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {num(row.inputTokens)}
                        {row.cachedInputTokens > 0 ? (
                          <span className="text-muted-foreground">
                            {" "}({num(row.cachedInputTokens)} cached)
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right">{num(row.outputTokens)}</TableCell>
                      <TableCell className="text-right font-medium">{usd(row.costUsd)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {num(row.durationMs)}ms
                      </TableCell>
                      <TableCell className="text-muted-foreground">{row.tokenSource}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
