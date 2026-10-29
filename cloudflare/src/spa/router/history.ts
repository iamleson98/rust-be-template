import { createBrowserHistory, type RouterHistory } from "@tanstack/react-router";

/**
 * The browser history for the SPA, which lives inside a Next.js app.
 *
 * Next's app router re-writes the URL with `history.replaceState` from a
 * `useInsertionEffect` after its own navigations. TanStack's browser history
 * patches `history.pushState/replaceState` to hear about writes it did not
 * make, and told the router at once: the router's stores then re-rendered
 * React while it was still inside that insertion effect ("useInsertionEffect
 * must not schedule updates").
 *
 * So a write made through `window.history` is announced one microtask later,
 * after React has finished committing. The router's own navigations are not
 * affected: they notify directly, outside these calls.
 */
export function createAppHistory(): RouterHistory {
  const history = createBrowserHistory();
  const notify = history.notify;
  let external = false;
  history.notify = (action) => {
    if (external) queueMicrotask(() => notify(action));
    else notify(action);
  };

  for (const method of ["pushState", "replaceState"] as const) {
    const patched = window.history[method];
    window.history[method] = function (this: History, ...args: Parameters<History[typeof method]>) {
      const outer = external;
      external = true;
      try {
        return patched.apply(this, args);
      } finally {
        external = outer;
      }
    };
  }
  return history;
}
