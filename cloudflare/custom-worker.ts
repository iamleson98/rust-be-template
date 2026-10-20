// @ts-ignore Generated at build time by `opennextjs-cloudflare build`:
// absent on a fresh clone, present after the first build — the expect-error
// flavor would lie in one of the two states, this one never does.
import { default as handler } from "./.open-next/worker.js";
import { DurableObject } from "cloudflare:workers";
import { ChatHub } from "./chat-hub";
import { CallHub } from "./call-hub";

/**
 * Custom OpenNext worker entry:
 *  - re-exports the generated Next.js handler
 *  - adds the `CronContainer` Durable Object that wraps the cron container
 *  - adds the `ChatHub` Durable Object that powers the SPA's `/ws` chat
 *    socket (messages, typing, presence fan-out — see chat-hub.ts)
 *  - adds a `scheduled` handler (Worker Cron Trigger) that acts as a HEARTBEAT:
 *    it pings the container's /health endpoint once a minute so the container
 *    never sleeps, letting its internal node-cron timers remain the OWNER of
 *    the schedule (per the migration plan: cron jobs live in the container).
 *
 * Deploy-time wiring (wrangler.jsonc):
 *   main: "custom-worker.ts"
 *   containers: [{ class_name: "CronContainer", image: "./container/Dockerfile" }]
 *   durable_objects: CronContainer + ChatHub
 *   triggers: { crons: ["* * * * *"] }
 */

interface ContainerLike {
  running: boolean;
  start: (options?: { env?: Record<string, string>; enableInternet?: boolean }) => void;
  setInactivityTimeout: (ms: number) => Promise<void>;
  getTcpPort: (port: number) => { fetch: (req: Request) => Promise<Response> };
}

export class CronContainer extends DurableObject<CloudflareEnv> {
  async fetch(request: Request): Promise<Response> {
    const container = (this.ctx as unknown as { container: ContainerLike }).container;
    if (!container) {
      return new Response("container unavailable", { status: 500 });
    }
    await container.setInactivityTimeout(10 * 60 * 1000);
    if (!container.running) {
      // Containers have no dashboard env: everything the cron driver needs
      // must be handed over here, from the Worker's own vars/secrets.
      const { APP_URL, CRON_SERVICE_TOKEN } = this.env;
      if (!APP_URL || !CRON_SERVICE_TOKEN) {
        return new Response("APP_URL and CRON_SERVICE_TOKEN must be set on the Worker", {
          status: 500,
        });
      }
      container.start({
        env: { APP_URL, CRON_SERVICE_TOKEN },
        enableInternet: true,
      });
    }
    const port = container.getTcpPort(8080);

    // Poll the health endpoint until the app inside is ready.
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const res = await port.fetch(new Request("http://container/health"));
        if (!res.ok) throw new Error(`health check returned ${res.status}`);
        break;
      } catch (e) {
        lastError = e;
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    if (lastError) {
      return new Response(`container did not become ready: ${String(lastError)}`, {
        status: 503,
      });
    }

    // Forward the original request to the container.
    const url = new URL(request.url);
    url.protocol = "http:";
    url.host = "container";
    const forwarded = new Request(url, request);
    forwarded.headers.delete("host");
    return port.fetch(forwarded);
  }
}

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
        const id = ns.idFromName("global");
        return ns.get(id).fetch(request);
      }
    }

    return handler.fetch(request, env, ctx);
  },
  async scheduled(_event: ScheduledController, env: CloudflareEnv, _ctx: ExecutionContext) {
    // Heartbeat: keep the cron container awake (it owns the schedules).
    const id = (
      env as unknown as { CRON_CONTAINER: DurableObjectNamespace }
    ).CRON_CONTAINER.idFromName("singleton");
    const stub = (env as unknown as { CRON_CONTAINER: DurableObjectNamespace }).CRON_CONTAINER.get(
      id,
    );
    await stub.fetch(new Request("http://container/health"));
  },
} satisfies ExportedHandler<CloudflareEnv>;
