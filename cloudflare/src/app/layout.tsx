import type { Metadata, Viewport } from "next";
import { GoogleMeasurement } from "./google-measurement";
import { SITE_JSON_LD, SITE_OPEN_GRAPH, SITE_TWITTER } from "./structured-data";
import "@spa/styles.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://datxevui.com"),
  title: "DatXeVui — Đặt vé xe khách online toàn Việt Nam",
  description:
    "Đặt vé xe khách trực tuyến: limousine, giường nằm, ghế ngồi. So sánh giá từ Phương Trang, Thanh Bình, Limousine Việt. Chọn ghế trực quan, thanh toán an toàn, hỗ trợ 24/7.",
  keywords:
    "đặt vé xe, vé xe khách, xe limousine, giường nằm, Phương Trang, Thanh Bình, vé xe online, DatXeVui, vé xe Hà Nội Đà Nẵng, vé xe Hồ Chí Minh Đà Lạt",
  authors: [{ name: "DatXeVui" }],
  applicationName: "DatXeVui",
  category: "Travel",
  // Each page sets its own canonical URL, title and robots rule (`[[...slug]]/page.tsx`).
  openGraph: {
    ...SITE_OPEN_GRAPH,
    title: "DatXeVui — Đặt vé xe khách online toàn Việt Nam",
    description:
      "So sánh giá từ hàng chục hãng xe uy tín. Chọn ghế trực quan, thanh toán an toàn, hỗ trợ 24/7.",
  },
  twitter: {
    ...SITE_TWITTER,
    title: "DatXeVui — Đặt vé xe khách online",
    description: "Đặt vé xe khách toàn Việt Nam — limousine, giường nằm, ghế ngồi",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "DatXeVui",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#ffffff" }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body className="antialiased bg-background text-foreground">
        {/* Self-hosted Geist fonts + PWA manifest + icons — same as the deployed SPA shell. */}
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" href="/favicon.ico" sizes="32x32" />
        <link rel="icon" type="image/svg+xml" href="/logo.svg" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        <link rel="mask-icon" href="/logo-mask.svg" color="#147cd3" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="application-name" content="DatXeVui" />
        <meta name="format-detection" content="telephone=no" />
        {/* Static @font-face sheet served from /public with long-lived caching. */}
        {/* eslint-disable-next-line @next/next/no-css-tags */}
        <link rel="stylesheet" href="/fonts/geist.css" />
        <link rel="preconnect" href="https://tile.openstreetmap.org" crossOrigin="" />
        <link rel="dns-prefetch" href="https://unpkg.com" />
        <style
          href="critical-shell"
          precedence="high"
          dangerouslySetInnerHTML={{
            __html: `:root{--font-geist-sans:'Geist Variable',ui-sans-serif,system-ui,-apple-system,sans-serif;--font-geist-mono:'Geist Mono',ui-monospace,SFMono-Regular,monospace}html{-webkit-tap-highlight-color:transparent;-webkit-text-size-adjust:100%;text-size-adjust:100%}body{overscroll-behavior-y:none;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right)}button,a,[role='button'],input,select,textarea{touch-action:manipulation}button,[role='button']{-webkit-touch-callout:none;user-select:none}@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:0.001ms !important;animation-iteration-count:1 !important;transition-duration:0.001ms !important;scroll-behavior:auto !important}}`,
          }}
        />
        {SITE_JSON_LD.map((data, i) => (
          <script
            key={i}
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
          />
        ))}
        {/* GA4 + Google Ads gtag bootstrap — injected only when configured
            (NEXT_PUBLIC_GA4_ID / _GOOGLE_ADS_ID / _GOOGLE_ADS_CONVERSIONS). */}
        <GoogleMeasurement />
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-9999 focus:px-3 focus:py-2 focus:bg-blue-600 focus:text-white focus:rounded-md"
        >
          Bỏ qua tới nội dung chính
        </a>
        {children}
      </body>
    </html>
  );
}
