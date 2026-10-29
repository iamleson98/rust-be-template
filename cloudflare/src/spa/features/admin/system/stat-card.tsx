"use client";

/**
 * The one card shape of the admin system page: icon + title, a headline,
 * an optional usage bar, and detail lines. A status dot marks health.
 */

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@spa/components/ui/card";
import { barTone } from "./metric-helpers";

export type Health = "ok" | "warn" | "down" | "idle";

const DOT: Record<Health, string> = {
  ok: "bg-green-500",
  warn: "bg-amber-500",
  down: "bg-red-500",
  idle: "bg-slate-300 dark:bg-slate-600",
};

export function StatCard({
  icon: Icon,
  title,
  health,
  headline,
  percent,
  children,
  testId,
}: {
  icon: LucideIcon;
  title: string;
  health?: Health;
  headline: ReactNode;
  /** Usage bar; omitted when the value is unknown. */
  percent?: number | null;
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <Card data-testid={testId} className="gap-3">
      <CardHeader className="pb-0">
        <CardTitle className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon className="size-4" aria-hidden />
          <span className="flex-1">{title}</span>
          {health && <span className={`size-2.5 rounded-full ${DOT[health]}`} aria-hidden />}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="text-2xl font-semibold tabular-nums">{headline}</div>
        {percent != null && (
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full transition-all ${barTone(percent)}`}
              style={{ width: `${Math.max(percent, 1)}%` }}
            />
          </div>
        )}
        {children && <div className="space-y-0.5 text-xs text-muted-foreground">{children}</div>}
      </CardContent>
    </Card>
  );
}
