//! The `<head>` the server writes into the SPA shell: what crawlers and link
//! previews (Zalo, Facebook) read before any script runs.
//!
//! The shell (`index.html`, and the prerendered `privacy.html` / `terms.html`)
//! holds a [`PLACEHOLDER`]; every response replaces it with the page's own
//! title, description, canonical URL, robots rule, Open Graph and Twitter
//! card, the `hreflang` alternates and the structured data. The home page
//! alone carries the FAQ structured data and the preload of its hero image
//! (its largest paint); a page with content of its own (breadcrumbs, a list of
//! routes) adds that as further structured data.

use once_cell::sync::Lazy;
use serde_json::{json, Value};

use super::seo::SITE_URL;

/// Where `index.html` says the per-request head goes.
pub const PLACEHOLDER: &str = "<!--app-head-->";
/// Where it says the page's text goes, inside the app's root.
pub const APP_HTML: &str = "<!--app-html-->";

/// The hero photo per screen: a phone gets the small file, the rest the wide one.
pub const HERO_DESKTOP: &str = "/hero-vietnam-bus.avif";
pub const HERO_MOBILE: &str = "/hero-vietnam-bus-mobile.avif";
/// Where a phone's screen ends and a tablet's begins (`sm` + 1px).
pub const HERO_BREAKPOINT_PX: u32 = 640;
const OG_IMAGE: &str = "/og-image.png";

/// What one response's head says.
#[derive(Debug)]
pub struct Head<'a> {
    pub title: &'a str,
    /// Absent on the 404 page.
    pub description: Option<&'a str>,
    /// Only indexable pages have one; they alone get the link-preview tags.
    pub canonical: Option<&'a str>,
    pub robots: &'a str,
    pub home: bool,
    /// Structured data of the page itself (breadcrumbs, lists).
    pub structured: &'a [Value],
}

/// Text inside an element or an attribute value.
pub fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#x27;"),
            c => out.push(c),
        }
    }
    out
}

/// JSON for a `<script>` body: `<` is written `\u003c` so no value can close the tag.
pub fn script_json(value: &Value) -> String {
    value.to_string().replace('<', "\\u003c")
}

/// A JSON-LD `<script>`.
fn ld_script(value: &Value) -> String {
    format!(
        "<script type=\"application/ld+json\">{}</script>",
        script_json(value)
    )
}

/// On every page: who runs the site.
static SITE_JSON_LD: Lazy<String> = Lazy::new(|| {
    [
        json!({
            "@context": "https://schema.org",
            "@type": "WebSite",
            "name": "DatXeVui",
            "url": SITE_URL,
            "description": "Đặt vé xe khách trực tuyến — limousine, giường nằm, ghế ngồi toàn Việt Nam.",
            "inLanguage": "vi-VN",
        }),
        json!({
            "@context": "https://schema.org",
            "@type": "Organization",
            "name": "DatXeVui",
            "url": SITE_URL,
            "logo": format!("{SITE_URL}/logo.svg"),
            "description": "Nền tảng đặt vé xe khách trực tuyến toàn Việt Nam — limousine, giường nằm, ghế ngồi.",
            "foundingDate": "2024",
            "areaServed": "VN",
            "knowsLanguage": ["vi", "en"],
            "contactPoint": {
                "@type": "ContactPoint",
                "telephone": "+84-1900-6067",
                "contactType": "customer service",
                "areaServed": "VN",
                "availableLanguage": ["vi", "en"],
            },
        }),
    ]
    .iter()
    .map(ld_script)
    .collect::<Vec<_>>()
    .join("\n")
});

/// On the home page only, which is where these questions are answered.
static FAQ_JSON_LD: Lazy<String> = Lazy::new(|| {
    let question = |name: &str, text: &str| {
        json!({
            "@type": "Question",
            "name": name,
            "acceptedAnswer": { "@type": "Answer", "text": text },
        })
    };
    ld_script(&json!({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
            question(
                "Làm thế nào để đặt vé xe trên DatXeVui?",
                "Chỉ với 4 bước: (1) Tìm chuyến xe phù hợp theo điểm đi/đến và ngày giờ. (2) Chọn ghế yêu thích trên sơ đồ ghế trực quan. (3) Thanh toán qua MoMo, VNPay, ZaloPay hoặc thẻ ngân hàng. (4) Nhận vé điện tử qua SMS và email ngay sau khi thanh toán thành công.",
            ),
            question(
                "Tôi có thể đổi hoặc hoàn vé không?",
                "Có. Bạn được đổi vé miễn phí trước 24 giờ so với giờ khởi hành. Với hoàn vé: thu phí 10% nếu hoàn trước 24 giờ, thu phí 30% nếu hoàn trong vòng 24 giờ, và không hoàn vé sau giờ khởi hành.",
            ),
            question(
                "Những phương thức thanh toán nào được hỗ trợ?",
                "DatXeVui hỗ trợ MoMo, VNPay, ZaloPay, Visa, Mastercard và chuyển khoản ngân hàng. Tất cả giao dịch đều được mã hoá SSL 256-bit.",
            ),
            question(
                "Vé điện tử có hợp lệ không?",
                "Có. Vé điện tử trên DatXeVui có mã QR và được Bộ GTVT cấp phép hoạt động. Bạn chỉ cần xuất trình mã QR trên điện thoại khi lên xe.",
            ),
            question(
                "Trẻ em có được giảm giá không?",
                "Có: trẻ dưới 2 tuổi đi miễn phí, trẻ từ 2-5 tuổi được giảm 50% giá vé, trẻ từ 6 tuổi trở lên mua vé như người lớn.",
            ),
        ],
    }))
});

impl Head<'_> {
    /// The HTML that replaces [`PLACEHOLDER`].
    pub fn render(&self) -> String {
        let title = escape(self.title);
        let mut tags = vec![format!("<title>{title}</title>")];
        let description = self.description.map(escape);
        if let Some(description) = &description {
            tags.push(format!(
                "<meta name=\"description\" content=\"{description}\" />"
            ));
        }
        tags.push(format!(
            "<meta name=\"robots\" content=\"{}\" />",
            escape(self.robots)
        ));
        if let Some(canonical) = self.canonical {
            let url = escape(canonical);
            tags.push(format!("<link rel=\"canonical\" href=\"{url}\" />"));
            // One address per page, in Vietnamese: the app switches language
            // without changing the URL, so no other alternate exists.
            for lang in ["vi", "x-default"] {
                tags.push(format!(
                    "<link rel=\"alternate\" hreflang=\"{lang}\" href=\"{url}\" />"
                ));
            }
            let meta = |attr: &str, name: &str, content: &str| {
                format!("<meta {attr}=\"{name}\" content=\"{content}\" />")
            };
            tags.extend([
                meta("property", "og:site_name", "DatXeVui"),
                meta("property", "og:locale", "vi_VN"),
                meta("property", "og:type", "website"),
                meta("property", "og:title", &title),
                meta("property", "og:url", &url),
                meta("property", "og:image", &format!("{SITE_URL}{OG_IMAGE}")),
                meta("property", "og:image:width", "1200"),
                meta("property", "og:image:height", "630"),
                meta("name", "twitter:card", "summary_large_image"),
                meta("name", "twitter:title", &title),
                meta("name", "twitter:image", &format!("{SITE_URL}{OG_IMAGE}")),
            ]);
            if let Some(description) = &description {
                tags.push(meta("property", "og:description", description));
                tags.push(meta("name", "twitter:description", description));
            }
        }
        if self.home {
            let wide = HERO_BREAKPOINT_PX + 1;
            tags.push(format!(
                "<link rel=\"preload\" as=\"image\" href=\"{HERO_DESKTOP}\" type=\"image/avif\" media=\"(min-width: {wide}px)\" fetchpriority=\"high\" />"
            ));
            tags.push(format!(
                "<link rel=\"preload\" as=\"image\" href=\"{HERO_MOBILE}\" type=\"image/avif\" media=\"(max-width: {HERO_BREAKPOINT_PX}px)\" fetchpriority=\"high\" />"
            ));
        }
        tags.push(SITE_JSON_LD.clone());
        if self.home {
            tags.push(FAQ_JSON_LD.clone());
        }
        tags.extend(self.structured.iter().map(ld_script));
        tags.join("\n    ")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn head<'a>(title: &'a str, canonical: Option<&'a str>, home: bool) -> Head<'a> {
        Head {
            title,
            description: Some("d"),
            canonical,
            robots: "index, follow",
            home,
            structured: &[],
        }
    }

    #[test]
    fn text_is_escaped_in_elements_and_attributes() {
        let html = head("A & B <\"x\">", Some("https://x/?a=1&b=2"), false).render();
        assert!(html.contains("<title>A &amp; B &lt;&quot;x&quot;&gt;</title>"));
        assert!(html.contains("href=\"https://x/?a=1&amp;b=2\""));
        assert!(!html.contains("A & B"));
    }

    #[test]
    fn faq_and_preload_belong_to_the_home_page_alone() {
        let home = head("t", Some("https://datxevui.com/"), true).render();
        assert!(home.contains("\"FAQPage\""));
        assert!(home.contains("rel=\"preload\" as=\"image\" href=\"/hero-vietnam-bus.avif\""));
        assert!(home.contains("href=\"/hero-vietnam-bus-mobile.avif\""));
        assert!(home.contains("media=\"(max-width: 640px)\""));
        let other = head("t", Some("https://datxevui.com/search"), false).render();
        assert!(!other.contains("FAQPage"));
        assert!(!other.contains("preload"));
    }

    #[test]
    fn site_structured_data_is_on_every_page() {
        for html in [
            head("t", Some("https://datxevui.com/"), true).render(),
            head("t", None, false).render(),
            Head {
                title: "404",
                description: None,
                canonical: None,
                robots: "noindex, follow",
                home: false,
                structured: &[],
            }
            .render(),
        ] {
            assert!(html.contains("\"@type\":\"WebSite\""), "{html}");
            assert!(html.contains("\"@type\":\"Organization\""), "{html}");
        }
    }

    #[test]
    fn link_previews_are_for_indexable_pages_only() {
        let private = head("t", None, false).render();
        assert!(!private.contains("canonical"));
        assert!(!private.contains("og:title"));
        assert!(!private.contains("twitter:card"));
        let public = head("t", Some("https://datxevui.com/search"), false).render();
        assert!(public.contains("rel=\"canonical\" href=\"https://datxevui.com/search\""));
        assert!(
            public.contains("property=\"og:image\" content=\"https://datxevui.com/og-image.png\"")
        );
        assert!(public.contains("name=\"twitter:description\" content=\"d\""));
    }

    #[test]
    fn json_ld_cannot_close_its_script_tag() {
        let json = ld_script(&json!({"name": "</script><b>"}));
        assert_eq!(json.matches("</script>").count(), 1);
        assert!(json.contains("\\u003c/script>"));
    }

    #[test]
    fn an_indexable_page_names_its_one_language_and_its_own_data() {
        let crumbs = json!({"@type": "BreadcrumbList", "name": "</script>"});
        let html = Head {
            structured: std::slice::from_ref(&crumbs),
            ..head("t", Some("https://datxevui.com/brands/x"), false)
        }
        .render();
        for lang in ["vi", "x-default"] {
            assert!(html.contains(&format!(
                "<link rel=\"alternate\" hreflang=\"{lang}\" href=\"https://datxevui.com/brands/x\" />"
            )));
        }
        assert!(html.contains("\"@type\":\"BreadcrumbList\""));
        assert_eq!(
            html.matches("</script>").count(),
            3,
            "site data x2 + page data"
        );
        let private = head("t", None, false).render();
        assert!(!private.contains("hreflang"));
    }
}
