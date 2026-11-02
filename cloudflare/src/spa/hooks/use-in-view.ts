import { useEffect, useRef, useState } from "react";

/**
 * `true` once the element behind the returned ref has come within `margin` of
 * the viewport, and for good after. Content nobody scrolls to never asks the
 * server for its data: on the Free plan every `/api` call is a Worker request.
 * Without an IntersectionObserver (very old browsers) it is `true` at once.
 */
export function useInView<T extends Element = HTMLDivElement>(margin = "300px") {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const observer = new IntersectionObserver(([entry]) => entry?.isIntersecting && setSeen(true), {
      rootMargin: margin,
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [seen, margin]);

  return [ref, seen] as const;
}
