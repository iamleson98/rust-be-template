// @ts-ignore Generated at build time by `opennextjs-cloudflare build`:
// absent on a fresh clone, present after the first build — the expect-error
// flavor would lie in one of the two states, this one never does.
import { default as handler } from "./.open-next/worker.js";
// @ts-ignore Generated at build time too (same reason): OpenNext's request-context runner.
import { runWithCloudflareRequestContext } from "./.open-next/cloudflare/init.js";
import { ChatHub } from "./chat-hub";
import { CallHub } from "./call-hub";
import {
  cachedPublicRead,
  canonicalPlaceUrl,
  enforceIpLimit,
  enforceOrigin,
  isCacheablePublicRead,
  withSecurityHeaders,
} from "./src/lib/edge-guard";
import { cachedPage, isCacheablePage } from "./src/lib/page-cache";

/**
 * Place reads, answered without Next.js: search runs on every keystroke
 * pause, so it skips the framework's routing and rendering (CPU the Free
 * plan counts) and goes from the edge cache to the route handler directly.
 */
const PLACE_ROUTES: Record<string, () => Promise<{ GET: (req: Request) => Promise<Response> }>> = {
  "/api/places": () => import("./src/app/api/places/route"),
  "/api/places/search": () => import("./src/app/api/places/search/route"),
  "/api/places/reverse": () => import("./src/app/api/places/reverse/route"),
};

/**
 * Custom OpenNext worker entry:
 *  - re-exports the generated Next.js handler
 *  - adds the `ChatHub` / `CallHub` Durable Objects that power the SPA's
 *    `/ws` chat socket and `/ws-call` audio signalling
 *  - answers the place reads (`/api/places*`) from the edge cache or their
 *    route handlers, without a Next.js render
 *  - serves page HTML from the edge cache (`src/lib/page-cache.ts`)
 *  - answers `POST /api/jobs/tick` (the VPS service's cron driver) and a
 *    `scheduled` handler (Worker Cron Trigger, every minute, a safety net
 *    that only works while the VPS has stopped ticking) with the job
 *    executor in-process, in OpenNext's request context so it sees the exact
 *    same bindings as any API route. No Next.js render on the way (Free plan:
 *    10 ms CPU).
 *
 * Deploy-time wiring (wrangler.jsonc):
 *   main: "custom-worker.ts"
 *   durable_objects: ChatHub + CallHub
 *   triggers: { crons: ["* * * * *"] }
 */

export { ChatHub, CallHub };

export default {
  async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext) {
    // Cheap rejections first: a limited or cross-origin request never reaches
    // the socket hubs, Next.js, D1 or KV.
    const rejected = (await enforceIpLimit(request, env)) ?? enforceOrigin(request, env);
    if (rejected) return withSecurityHeaders(rejected);

    const url = new URL(request.url);

    // ── Chat socket upgrade — handled by the ChatHub DO, not Next.js ──
    if (
      (url.pathname === "/ws" || url.pathname === "/ws-call") &&
      request.headers.get("Upgrade")?.toLowerCase() === "websocket"
    ) {
      const binding = url.pathname === "/ws" ? "CHAT_HUB" : "CALL_HUB";
      const ns = (env as unknown as Record<string, DurableObjectNamespace | undefined>)[binding];
      if (ns) {
        // The edge knows the caller's country; the hub applies the policy.
        // Overwrite (never trust) any header the client sent itself.
        const headers = new Headers(request.headers);
        headers.set("x-call-country", String(request.cf?.country ?? ""));
        const id = ns.idFromName("global");
        return ns.get(id).fetch(new Request(request, { headers }));
      }
    }

    if (url.pathname === "/api/jobs/tick") {
      const { handleTickRequest } = await import("./src/lib/cron");
      return withSecurityHeaders(
        await runWithCloudflareRequestContext(request, env, ctx, () => handleTickRequest(request)),
      );
    }

    const placeRoute = request.method === "GET" ? PLACE_ROUTES[url.pathname] : undefined;
    if (placeRoute) {
      // Equivalent queries share one cache entry; the route sees the same form.
      const read = new Request(canonicalPlaceUrl(request.url), request);
      return withSecurityHeaders(
        await cachedPublicRead(read, ctx, async () => {
          const { GET } = await placeRoute();
          return runWithCloudflareRequestContext(read, env, ctx, () => GET(read));
        }),
      );
    }

    const dynamic = () => handler.fetch(request, env, ctx) as Promise<Response>;
    const version = env.CF_VERSION_METADATA?.id;
    const response = isCacheablePublicRead(request)
      ? await cachedPublicRead(request, ctx, dynamic)
      : version && isCacheablePage(request)
        ? await cachedPage(request, version, ctx, dynamic)
        : await dynamic();
    return withSecurityHeaders(response);
  },

  async scheduled(_event: ScheduledController, env: CloudflareEnv, ctx: ExecutionContext) {
    // Straight to the job executor (see `src/lib/cron.ts`), loaded lazily so a
    // normal request never pays for it.
    const { runScheduledCron } = await import("./src/lib/cron");
    const summary = await runWithCloudflareRequestContext(
      new Request("https://internal.invalid/cron"),
      env,
      ctx,
      runScheduledCron,
    );
    console.info(`[cron] ${summary}`);
  },
} satisfies ExportedHandler<CloudflareEnv>;
