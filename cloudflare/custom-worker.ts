// @ts-ignore Generated at build time by `opennextjs-cloudflare build`:
// absent on a fresh clone, present after the first build — the expect-error
// flavor would lie in one of the two states, this one never does.
import { default as handler } from "./.open-next/worker.js";
import { ChatHub } from "./chat-hub";
import { CallHub } from "./call-hub";

/**
 * Custom OpenNext worker entry:
 *  - re-exports the generated Next.js handler
 *  - adds the `ChatHub` / `CallHub` Durable Objects that power the SPA's
 *    `/ws` chat socket and `/ws-call` audio signalling
 *  - adds a `scheduled` handler (Worker Cron Trigger, every minute) that runs
 *    the job executor in-process: it feeds a synthetic `POST /api/jobs/tick`
 *    through the Next.js handler, so the jobs run with the exact same
 *    bindings and request context as any API route. No container, no
 *    public round trip.
 *
 * Deploy-time wiring (wrangler.jsonc):
 *   main: "custom-worker.ts"
 *   durable_objects: ChatHub + CallHub
 *   triggers: { crons: ["* * * * *"] }
 */

export { ChatHub, CallHub };

export default {
  async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext) {
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

    return handler.fetch(request, env, ctx);
  },

  async scheduled(_event: ScheduledController, env: CloudflareEnv, ctx: ExecutionContext) {
    if (!env.CRON_SERVICE_TOKEN) {
      console.error("[cron] CRON_SERVICE_TOKEN is not set; skipping tick");
      return;
    }
    const res = await handler.fetch(
      new Request("https://internal.invalid/api/jobs/tick", {
        method: "POST",
        headers: { "x-cron-token": env.CRON_SERVICE_TOKEN },
      }),
      env,
      ctx,
    );
    const body = await res.text();
    if (!res.ok) {
      // Throwing marks the cron invocation as failed in Workers observability.
      throw new Error(`tick failed: HTTP ${res.status} ${body.slice(0, 300)}`);
    }
    console.info(`[cron] tick ok: ${body.slice(0, 300)}`);
  },
} satisfies ExportedHandler<CloudflareEnv>;
