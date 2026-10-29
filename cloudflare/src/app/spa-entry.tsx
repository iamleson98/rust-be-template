"use client";

/**
 * Hands the page to the original DatXeVui SPA (TanStack Router with browser
 * history), which handles all client-side navigation from here. The server
 * page around it (`[[...slug]]/page.tsx`) has already written the page's
 * head; API routes under `src/app/api/*` never reach here.
 */
import dynamic from "next/dynamic";

export const SpaEntry = dynamic(() => import("@spa/spa-mount").then((m) => m.SpaMount), {
  ssr: false,
  // Same first-paint shell the prerendered Vite build served.
  loading: () => (
    <div className="flex min-h-screen items-center justify-center bg-canvas">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  ),
});
