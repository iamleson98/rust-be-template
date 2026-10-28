import type { Metadata, Viewport } from "next";
import { GoogleMeasurement } from "./google-measurement";
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
  alternates: { canonical: "https://datxevui.com" },
  openGraph: {
    title: "DatXeVui — Đặt vé xe khách online toàn Việt Nam",
    description:
      "So sánh giá từ hàng chục hãng xe uy tín. Chọn ghế trực quan, thanh toán an toàn, hỗ trợ 24/7.",
    url: "https://datxevui.com",
    siteName: "DatXeVui",
    locale: "vi_VN",
    type: "website",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "DatXeVui — Đặt vé xe khách online",
    description: "Đặt vé xe khách toàn Việt Nam — limousine, giường nằm, ghế ngồi",
    images: ["/og-image.png"],
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

/** JSON-LD structured data — identical to the deployed index.html. */
const jsonLd = [
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "DatXeVui",
    url: "https://datxevui.com",
    description: "Đặt vé xe khách trực tuyến — limousine, giường nằm, ghế ngồi toàn Việt Nam.",
    inLanguage: "vi-VN",
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: "https://datxevui.com/search?from={from}&to={to}&date={date}",
      },
      "query-input": "required name=from",
    },
  },
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "DatXeVui",
    url: "https://datxevui.com",
    logo: "https://datxevui.com/logo.svg",
    description:
      "Nền tảng đặt vé xe khách trực tuyến toàn Việt Nam — limousine, giường nằm, ghế ngồi.",
    foundingDate: "2024",
    areaServed: "VN",
    knowsLanguage: ["vi", "en"],
    contactPoint: {
      "@type": "ContactPoint",
      telephone: "+84-1900-6067",
      contactType: "customer service",
      areaServed: "VN",
      availableLanguage: ["vi", "en"],
    },
  },
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Làm thế nào để đặt vé xe trên DatXeVui?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Chỉ với 4 bước: (1) Tìm chuyến xe phù hợp theo điểm đi/đến và ngày giờ. (2) Chọn ghế yêu thích trên sơ đồ ghế trực quan. (3) Thanh toán qua MoMo, VNPay, ZaloPay hoặc thẻ ngân hàng. (4) Nhận vé điện tử qua SMS và email ngay sau khi thanh toán thành công.",
        },
      },
      {
        "@type": "Question",
        name: "Tôi có thể đổi hoặc hoàn vé không?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Có. Bạn được đổi vé miễn phí trước 24 giờ so với giờ khởi hành. Với hoàn vé: thu phí 10% nếu hoàn trước 24 giờ, thu phí 30% nếu hoàn trong vòng 24 giờ, và không hoàn vé sau giờ khởi hành.",
        },
      },
      {
        "@type": "Question",
        name: "Những phương thức thanh toán nào được hỗ trợ?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "DatXeVui hỗ trợ MoMo, VNPay, ZaloPay, Visa, Mastercard và chuyển khoản ngân hàng. Tất cả giao dịch đều được mã hoá SSL 256-bit.",
        },
      },
      {
        "@type": "Question",
        name: "Vé điện tử có hợp lệ không?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Có. Vé điện tử trên DatXeVui có mã QR và được Bộ GTVT cấp phép hoạt động. Bạn chỉ cần xuất trình mã QR trên điện thoại khi lên xe.",
        },
      },
      {
        "@type": "Question",
        name: "Trẻ em có được giảm giá không?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Có: trẻ dưới 2 tuổi đi miễn phí, trẻ từ 2-5 tuổi được giảm 50% giá vé, trẻ từ 6 tuổi trở lên mua vé như người lớn.",
        },
      },
    ],
  },
];

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
        <link
          rel="preload"
          as="image"
          href="/hero-vietnam-bus.avif"
          type="image/avif"
          fetchPriority="high"
        />
        <link rel="preconnect" href="https://tile.openstreetmap.org" crossOrigin="" />
        <link rel="dns-prefetch" href="https://unpkg.com" />
        <style
          href="critical-shell"
          precedence="high"
          dangerouslySetInnerHTML={{
            __html: `:root{--font-geist-sans:'Geist Variable',ui-sans-serif,system-ui,-apple-system,sans-serif;--font-geist-mono:'Geist Mono',ui-monospace,SFMono-Regular,monospace}html{-webkit-tap-highlight-color:transparent;-webkit-text-size-adjust:100%;text-size-adjust:100%}body{overscroll-behavior-y:none;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right)}button,a,[role='button'],input,select,textarea{touch-action:manipulation}button,[role='button']{-webkit-touch-callout:none;user-select:none}@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:0.001ms !important;animation-iteration-count:1 !important;transition-duration:0.001ms !important;scroll-behavior:auto !important}}`,
          }}
        />
        {jsonLd.map((data, i) => (
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
