"use client";

/**
 * Google measurement bootstrap — the Next.js port of the Vite build's
 * prerender-time gtag injection (see `docs/GOOGLE_ADS.md`).
 *
 * Env (build-time, NEXT_PUBLIC_ so they inline into the client bundle):
 *   NEXT_PUBLIC_GA4_ID                — GA4 measurement id (G-…)
 *   NEXT_PUBLIC_GOOGLE_ADS_ID         — Google Ads conversion id (AW-…)
 *   NEXT_PUBLIC_GOOGLE_ADS_CONVERSIONS — JSON: { booking: 'AW-123/AbC…', … }
 *
 * Unconfigured ⇒ nothing is injected and every helper in
 * `spa/lib/analytics.ts` no-ops — same behavior as the old build with
 * unset VITE_ vars. Ids are public identifiers, never secrets.
 */
import Script from "next/script";

const GA4_ID = process.env.NEXT_PUBLIC_GA4_ID;
const ADS_ID = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;
const CONVERSIONS_JSON = process.env.NEXT_PUBLIC_GOOGLE_ADS_CONVERSIONS;

/** Parse the labels once; invalid JSON ⇒ no conversions (no crash). */
function parseConversions(): Record<string, string> | undefined {
  if (CONVERSIONS_JSON === undefined || CONVERSIONS_JSON.length === 0) return undefined;
  try {
    const parsed: unknown = JSON.parse(CONVERSIONS_JSON);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string" && v.length > 0) out[k] = v;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

export function GoogleMeasurement() {
  const conversions = parseConversions();
  if (GA4_ID === undefined || GA4_ID.length === 0) {
    // Still expose the labels if somehow set without GA4 — harmless.
    if (conversions === undefined) return null;
    return (
      <Script id="google-ads-conversions" strategy="afterInteractive">
        {`window.__GOOGLE_ADS_CONVERSIONS__=${JSON.stringify(conversions)};`}
      </Script>
    );
  }
  const setup = [
    "window.dataLayer=window.dataLayer||[];",
    "window.gtag=function(){dataLayer.push(arguments);}",
    "gtag('js',new Date());",
    `gtag('config',${JSON.stringify(GA4_ID)});`,
    ...(ADS_ID !== undefined && ADS_ID.length > 0
      ? [`gtag('config',${JSON.stringify(ADS_ID)});`]
      : []),
    ...(conversions !== undefined
      ? [`window.__GOOGLE_ADS_CONVERSIONS__=${JSON.stringify(conversions)};`]
      : []),
  ].join("");
  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`}
        strategy="afterInteractive"
      />
      <Script id="gtag-bootstrap" strategy="afterInteractive">
        {setup}
      </Script>
    </>
  );
}
