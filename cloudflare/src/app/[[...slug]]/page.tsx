"use client";

/**
 * Catch-all page: hands every non-API route to the original DatXeVui SPA
 * (TanStack Router with browser history), which handles all client-side
 * navigation from here. API routes under `src/app/api/*` are matched by
 * Next.js before this catch-all, so `/api/*` never reaches the SPA.
 */
import dynamic from "next/dynamic";

const SpaMount = dynamic(() => import("@spa/spa-mount").then((m) => m.SpaMount), {
  ssr: false,
  // Same first-paint shell the prerendered Vite build served.
  loading: () => (
    <div className="flex min-h-screen items-center justify-center bg-canvas">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  ),
});

export default function CatchAllPage() {
  return <SpaMount />;
}
