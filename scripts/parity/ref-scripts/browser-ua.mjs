// Preload (node --import): the REF scripts call fetch() with node's own User-Agent and no
// Origin, which the Rust anti-scraping layer refuses. Present as a browser; scripts stay untouched.
const realFetch = globalThis.fetch;
globalThis.fetch = (url, init = {}) => {
  const headers = new Headers(init.headers ?? {});
  headers.set("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) parity-ref-scripts/1.0");
  if (!headers.has("Origin")) headers.set("Origin", process.env.TEST_BASE_URL ?? "http://localhost:3000");
  return realFetch(url, { ...init, headers });
};

// chat-flow-test.mjs opens two sockets and then awaits `once("open")` on each in turn: on a fast
// server the second one is already open by the time its listener is attached, and the script
// waits for an event that has come and gone. Replay `open` for a socket that is already open.
if (process.env.REF_WS_MODULE) {
  const { createRequire } = await import("node:module");
  const ws = createRequire(process.env.REF_WS_MODULE)("ws");
  const once = ws.prototype.once;
  ws.prototype.once = function (event, listener) {
    if (event === "open" && this.readyState === 1) {
      setImmediate(listener);
      return this;
    }
    return once.call(this, event, listener);
  };
}
