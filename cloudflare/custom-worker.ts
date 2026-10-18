// @ts-ignore `.open-next/worker.ts` is generated at build time
import { default as handler } from "./.open-next/worker.js";
import { DurableObject } from "cloudflare:workers";

/**
 * Custom OpenNext worker entry:
 *  - re-exports the generated Next.js handler
 *  - adds the `CronContainer` Durable Object that wraps the cron container
 *  - adds a `scheduled` handler (Worker Cron Trigger) that acts as a HEARTBEAT:
 *    it pings the container's /health endpoint once a minute so the container
 *    never sleeps, letting its internal node-cron timers remain the OWNER of
 *    the schedule (per the migration plan: cron jobs live in the container).
 *
 * Deploy-time wiring (wrangler.jsonc):
 *   main: "custom-worker.ts"
 *   containers: [{ class_name: "CronContainer", image: "./container/Dockerfile" }]
 *   durable_objects: [{ class_name: "CronContainer", name: "CRON_CONTAINER" }]
 *   triggers: { crons: ["* * * * *"] }
 */

interface ContainerLike {
  running: boolean;
  start: () => void;
  setInactivityTimeout: (ms: number) => Promise<void>;
  getTcpPort: (port: number) => { fetch: (req: Request) => Promise<Response> };
}

export class CronContainer extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    const container = (this.ctx as unknown as { container: ContainerLike }).container;
    if (!container) {
      return new Response("container unavailable", { status: 500 });
    }
    await container.setInactivityTimeout(10 * 60 * 1000);
    if (!container.running) container.start();
    const port = container.getTcpPort(8080);

    // Poll the health endpoint until the app inside is ready.
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const res = await port.fetch("http://container/health");
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

export default {
  fetch: handler.fetch,
  async scheduled(_event: ScheduledController, env: CloudflareEnv, _ctx: ExecutionContext) {
    // Heartbeat: keep the cron container awake (it owns the schedules).
    const id = (env as unknown as { CRON_CONTAINER: DurableObjectNamespace }).CRON_CONTAINER.idFromName(
      "singleton",
    );
    const stub = (env as unknown as { CRON_CONTAINER: DurableObjectNamespace }).CRON_CONTAINER.get(id);
    await stub.fetch(new Request("http://container/health"));
  },
} satisfies ExportedHandler<CloudflareEnv>;
