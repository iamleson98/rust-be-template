/**
 * The site-wide link-preview fields and structured data. Next.js merges a
 * page's `openGraph` / `twitter` over the layout's whole, not field by field,
 * so a page that sets its own title spreads these first.
 */
import type { Metadata } from "next";
import { SITE_URL } from "@spa/lib/seo";

export const SITE_OPEN_GRAPH = {
  siteName: "DatXeVui",
  locale: "vi_VN",
  type: "website",
  images: [{ url: "/og-image.png", width: 1200, height: 630 }],
} satisfies Metadata["openGraph"];

export const SITE_TWITTER = {
  card: "summary_large_image",
  images: ["/og-image.png"],
} satisfies Metadata["twitter"];

/** On every page: who runs the site. */
export const SITE_JSON_LD = [
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "DatXeVui",
    url: SITE_URL,
    description: "Đặt vé xe khách trực tuyến — limousine, giường nằm, ghế ngồi toàn Việt Nam.",
    inLanguage: "vi-VN",
  },
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "DatXeVui",
    url: SITE_URL,
    logo: `${SITE_URL}/logo.svg`,
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
];

/** On the home page only, which is where these questions are answered. */
export const FAQ_JSON_LD = {
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
};
