/**
 * A WebSocket client for the hub tests that connects the way the mobile app
 * does (credential in `?token=`, no Origin header) and records every frame.
 */
import { env } from "cloudflare:test";

export type Frame = Record<string, unknown> & { type: string };

export interface Client {
  ws: WebSocket;
  frames: Frame[];
  send: (frame: Record<string, unknown>) => void;
  /** The first frame (from the `from`-th on) satisfying `match`; rejects after `ms`. */
  next: (match: (f: Frame) => boolean, ms?: number) => Promise<Frame>;
  /** True when nothing satisfying `match` arrives within `ms`. */
  silent: (match: (f: Frame) => boolean, ms?: number) => Promise<boolean>;
  close: () => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type Hub = "CHAT_HUB" | "CALL_HUB";

export interface ConnectOptions {
  /** Extra upgrade headers (e.g. `x-call-country`, as the edge sets it). */
  headers?: Record<string, string>;
  /** Put the credential in the query string (mobile) — the default. */
  query?: boolean;
  /** Which hub instance; production has one ("global"), tests take one each so state never leaks. */
  room?: string;
}

/** Open a socket on a hub; `null` when the upgrade is refused (with the status). */
export async function connect(
  hub: Hub,
  token: string,
  opts: ConnectOptions = {},
): Promise<Client | { refused: number }> {
  const path = hub === "CHAT_HUB" ? "/ws" : "/ws-call";
  const query = opts.query === false ? "" : `?token=${encodeURIComponent(token)}`;
  const headers: Record<string, string> = { upgrade: "websocket", ...opts.headers };
  if (opts.query === false) headers.authorization = `Bearer ${token}`;
  const ns = env[hub];
  const res = await ns
    .get(ns.idFromName(opts.room ?? "global"))
    .fetch(`https://app.test${path}${query}`, {
      headers,
    });
  if (res.status !== 101 || !res.webSocket) return { refused: res.status };

  const ws = res.webSocket;
  ws.accept();
  const frames: Frame[] = [];
  ws.addEventListener("message", (e) => {
    if (typeof e.data === "string") frames.push(JSON.parse(e.data) as Frame);
  });

  const find = (match: (f: Frame) => boolean, from: number) => {
    for (let i = from; i < frames.length; i++) if (match(frames[i])) return i;
    return -1;
  };
  // Each wait only looks at frames that arrive after the previous wait resolved,
  // so a test reads like the conversation it replays.
  let cursor = 0;

  return {
    ws,
    frames,
    send: (frame) => ws.send(JSON.stringify(frame)),
    next: async (match, ms = 2000) => {
      const until = Date.now() + ms;
      for (;;) {
        const i = find(match, cursor);
        if (i >= 0) {
          cursor = i + 1;
          return frames[i];
        }
        if (Date.now() > until) {
          throw new Error(`no matching frame; got ${JSON.stringify(frames.slice(cursor))}`);
        }
        await sleep(10);
      }
    },
    silent: async (match, ms = 250) => {
      await sleep(ms);
      return find(match, cursor) < 0;
    },
    close: () => {
      try {
        ws.close(1000, "test over");
      } catch {
        // already closed
      }
    },
  };
}

export const is =
  (type: string) =>
  (f: Frame): boolean =>
    f.type === type;

/** Narrow a `connect` result that must have succeeded. */
export function open(c: Client | { refused: number }): Client {
  if ("refused" in c) throw new Error(`upgrade refused with ${c.refused}`);
  return c;
}
