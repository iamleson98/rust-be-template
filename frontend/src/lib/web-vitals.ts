/**
 * Web Vitals RUM — collects LCP / INP / CLS / TTFB / FCP from real
 * users and POSTs them to `/api/vitals` via `navigator.sendBeacon`.
 *
 * Lighthouse gives synthetic metrics; RUM gives real-user metrics.
 * The 80/20 of perf work: measure RUM → fix P75 of each metric.
 */

interface WebVitalMetric {
  name: 'LCP' | 'INP' | 'CLS' | 'TTFB' | 'FCP'
  value: number
  rating: 'good' | 'needs-improvement' | 'poor'
  delta: number
  entries: PerformanceEntry[]
  id: string
  navigationType: string
}

function rate(name: WebVitalMetric['name'], value: number): WebVitalMetric['rating'] {
  switch (name) {
    case 'LCP':
      if (value <= 2500) return 'good'
      if (value <= 4000) return 'needs-improvement'
      return 'poor'
    case 'INP':
      if (value <= 200) return 'good'
      if (value <= 500) return 'needs-improvement'
      return 'poor'
    case 'CLS':
      if (value <= 0.1) return 'good'
      if (value <= 0.25) return 'needs-improvement'
      return 'poor'
    case 'TTFB':
      if (value <= 800) return 'good'
      if (value <= 1800) return 'needs-improvement'
      return 'poor'
    case 'FCP':
      if (value <= 1800) return 'good'
      if (value <= 3000) return 'needs-improvement'
      return 'poor'
  }
}

function report(metric: WebVitalMetric): void {
  const payload = {
    name: metric.name,
    value: Math.round(metric.value * 100) / 100,
    rating: metric.rating,
    id: metric.id,
    delta: metric.delta,
    navigationType: metric.navigationType,
    path: typeof location !== 'undefined' ? location.pathname : '',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    connection:
      typeof navigator !== 'undefined' && 'connection' in navigator
        ? (navigator as any).connection?.effectiveType ?? ''
        : '',
    deviceMemory:
      typeof navigator !== 'undefined' && 'deviceMemory' in navigator
        ? (navigator as any).deviceMemory
        : 0,
    timestamp: Date.now(),
  }

  if (typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
    if (navigator.sendBeacon('/api/vitals', blob)) return
  }

  if (typeof fetch !== 'undefined') {
    fetch('/api/vitals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
      credentials: 'omit',
    }).catch(() => {})
  }
}

export async function bootstrapWebVitals(): Promise<void> {
  if (typeof window === 'undefined') return
  try {
    const webVitals = await import('web-vitals')
    const reportBound = () => (metric: any) =>
      report({
        name: metric.name,
        value: metric.value,
        rating: rate(metric.name, metric.value),
        delta: metric.delta,
        entries: metric.entries,
        id: metric.id,
        navigationType: metric.navigationType,
      })

    if (typeof webVitals.onCLS === 'function') webVitals.onCLS(reportBound())
    if (typeof webVitals.onFCP === 'function') webVitals.onFCP(reportBound())
    if (typeof webVitals.onINP === 'function') webVitals.onINP(reportBound())
    if (typeof webVitals.onLCP === 'function') webVitals.onLCP(reportBound())
    if (typeof webVitals.onTTFB === 'function') webVitals.onTTFB(reportBound())
  } catch (err) {
    console.warn('[web-vitals] failed to bootstrap', err)
  }
}
