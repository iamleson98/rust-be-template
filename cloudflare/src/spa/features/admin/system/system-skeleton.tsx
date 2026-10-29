"use client";

import { memo } from "react";
import { Shimmer } from "@spa/components/ui/shimmer";

/* ─── Admin system page skeleton ───
 * Mirrors the loaded layout: the overview row of four cards, then the VPS
 * resource row of three. Shown while the first report loads.
 */
export const SystemSkeleton = memo(function SystemSkeleton() {
  const card = (key: number, fade: number) => (
    <div key={key} className="rounded-xl border bg-card py-6">
      <div className="space-y-3 px-6">
        <Shimmer className="h-4 w-28" />
        <Shimmer className="h-7 w-36" />
        <Shimmer className="h-2 w-full rounded-full" />
        <Shimmer className="h-3.5 w-2/3" style={{ opacity: 1 - fade * 0.12 }} />
      </div>
    </div>
  );
  return (
    <div className="space-y-6" aria-hidden data-testid="system-skeleton">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => card(i, i))}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => card(i, i))}
      </div>
    </div>
  );
});
