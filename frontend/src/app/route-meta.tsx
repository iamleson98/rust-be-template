import { useEffect } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { trackPageView } from '@/lib/analytics'
import { translate } from '@/lib/i18n'
import { usePrefs } from '@/stores/prefs'

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    /** `seo.<key>.title` / `seo.<key>.description` in the dictionaries. */
    seo?: string
    /** Not indexed, not tracked: admin, account, login. */
    private?: boolean
  }
}

function setMeta(name: string, content: string | null) {
  let tag = document.querySelector(`meta[name="${name}"]`)
  if (content === null) return tag?.remove()
  if (!tag) {
    tag = document.head.appendChild(document.createElement('meta'))
    tag.setAttribute('name', name)
  }
  tag.setAttribute('content', content)
}

/** Keeps `<title>`, the description, robots and page-view tracking in step with the active route's `staticData`. */
export function RouteMeta() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const seo = useRouterState({ select: (s) => s.matches.at(-1)?.staticData.seo }) ?? 'default'
  const isPrivate = useRouterState({ select: (s) => s.matches.some((m) => m.staticData.private) })
  const lang = usePrefs((s) => s.lang)

  useEffect(() => {
    document.documentElement.lang = lang
    const title = translate(lang, `seo.${seo}.title`)
    document.title = title
    const description = translate(
      lang,
      seo === 'default' ? 'seo.home.description' : `seo.${seo}.description`,
    )
    document.querySelector('meta[name="description"]')?.setAttribute('content', description)
    setMeta('robots', isPrivate ? 'noindex, nofollow' : null)
    // Private pages never reach analytics (PII + abuse protection).
    if (!isPrivate) trackPageView(pathname, title)
  }, [pathname, seo, isPrivate, lang])

  return null
}
