import { useEffect, useRef } from "react";
import { useRouterState } from "@tanstack/react-router";
import { trackPageView } from "@spa/lib/analytics";
import { translate } from "@spa/lib/i18n";
import { pageSeo } from "@spa/lib/seo";
import { usePrefs } from "@spa/stores/prefs";

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /** `seo.<key>.title` / `seo.<key>.description` in the dictionaries. */
    seo?: string;
    /** Not indexed, not tracked: admin, account, login. */
    private?: boolean;
  }
}

function setMeta(name: string, content: string) {
  let tag = document.querySelector(`meta[name="${name}"]`);
  if (!tag) {
    tag = document.head.appendChild(document.createElement("meta"));
    tag.setAttribute("name", name);
  }
  tag.setAttribute("content", content);
}

function setCanonical(href: string | null) {
  let link = document.querySelector('link[rel="canonical"]');
  if (href === null) return link?.remove();
  if (!link) {
    link = document.head.appendChild(document.createElement("link"));
    link.setAttribute("rel", "canonical");
  }
  link.setAttribute("href", href);
}

/**
 * Keeps the head in step with the route after client-side navigation, from
 * the same rules the server wrote the landing page's head with
 * (`@spa/lib/seo`); staff and account pages keep their own titles
 * (`staticData.seo`). Also reports page views.
 *
 * The landing page's head is left as the server wrote it: it already holds
 * what only the server knows (a brand's name), and it is what crawlers read.
 */
export function RouteMeta() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const searchStr = useRouterState({ select: (s) => s.location.searchStr });
  const seo = useRouterState({ select: (s) => s.matches.at(-1)?.staticData.seo }) ?? "default";
  const isPrivate = useRouterState({ select: (s) => s.matches.some((m) => m.staticData.private) });
  const lang = usePrefs((s) => s.lang);
  const landing = useRef(true);

  useEffect(() => {
    document.documentElement.lang = lang;
    // The server writes Vietnamese; an English reader gets theirs from the first page on.
    const keepServerHead = landing.current && lang === "vi";
    landing.current = false;
    if (!keepServerHead) {
      const t = (key: string, params?: Record<string, string | number>) =>
        translate(lang, key, params);
      const page = pageSeo(pathname, new URLSearchParams(searchStr), t);
      const title = isPrivate || !page ? t(`seo.${seo}.title`) : page.title;
      document.title = title;
      setMeta(
        "description",
        isPrivate || !page
          ? t(seo === "default" ? "seo.home.description" : `seo.${seo}.description`)
          : page.description,
      );
      setMeta("robots", page?.robots ?? "noindex, follow");
      setCanonical(page?.canonical ?? null);
    }
  }, [pathname, searchStr, seo, isPrivate, lang]);

  // One view per page, not per filter change in its query; runs after the
  // effect above, so the title is the new page's.
  useEffect(() => {
    // Private pages never reach analytics (PII + abuse protection).
    if (!isPrivate) trackPageView(pathname, document.title);
  }, [pathname, isPrivate]);

  return null;
}
