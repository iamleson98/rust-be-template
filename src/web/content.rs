//! The text of a public page, written into the HTML so a crawler (or a visitor
//! whose script has not run yet) reads it without running the app.
//!
//! Each function returns the markup that goes inside `<div id="root">`, plus
//! the page's structured data. The app's `createRoot().render` replaces that
//! markup when it mounts, so there is no hydration to mismatch: what matters
//! is that the first paint (header, hero, headline) occupies the same space the
//! app's own will, which is why the home page reuses the app's class names
//! (the stylesheet scans this file, see `styles.css`). Everything that comes
//! from the database or the URL is escaped.
//!
//! Every figure is read from the same service calls the JSON API uses; what
//! is missing is left out, never filled with a zero.

use std::collections::HashSet;

use serde_json::{json, Value};

use super::head::{escape, script_json, HERO_BREAKPOINT_PX, HERO_DESKTOP, HERO_MOBILE};
use super::seo::{corridor_canonical, corridor_path, Strings, SITE_URL};
use crate::dto::public::{
    BrandListResponse, BrandProfile, RouteListResponse, StatsResponse, TripResult,
    TripSearchResponse,
};

/// Popular corridors listed on the home and search pages.
const POPULAR_ROUTES: usize = 12;
/// Trips listed per day on a corridor page.
pub const CORRIDOR_TRIPS_PER_DAY: usize = 20;
/// The `id` of the JSON the app reads its first data from.
pub const INITIAL_DATA_ID: &str = "initial-data";

/// What a page contributes beyond the shell.
#[derive(Debug, Default)]
pub struct Content {
    /// Goes inside `<div id="root">`.
    pub html: String,
    /// JSON-LD blocks for the `<head>`.
    pub structured: Vec<Value>,
}

/// What the home page shows, as far as the database could be read.
#[derive(Debug, Default)]
pub struct HomeData {
    pub routes: Option<RouteListResponse>,
    pub brands: Option<BrandListResponse>,
    pub stats: Option<StatsResponse>,
    pub recommendations: Option<TripSearchResponse>,
    /// When the data was read (ms since the epoch), so the app knows how old it is.
    pub generated_at_ms: i64,
}

/// One day of departures on a corridor.
#[derive(Debug)]
pub struct CorridorDay {
    /// `YYYY-MM-DD`.
    pub date: String,
    pub trips: Vec<TripResult>,
}

/// The trips of the corridor a search page names.
#[derive(Debug)]
pub struct CorridorData {
    /// The cities' own names where the text named them, else as written.
    pub from: String,
    pub to: String,
    /// Today, then tomorrow (Vietnam), as `YYYY-MM-DD`.
    pub today: String,
    pub days: Vec<CorridorDay>,
}

/// The text keys this module reads from the build's `seo-strings.json`:
/// strings the app shows too (so the first paint reads like the app), then
/// those only the server writes.
pub const TEXT_KEYS: [&str; 38] = [
    "nav.home",
    "nav.searchTrips",
    "trips.imageTagline",
    "hero.title",
    "hero.titleHighlight",
    "hero.subtitle",
    "home.statBrands",
    "home.statRoutes",
    "home.statTrips",
    "home.popularRoutesTitle",
    "home.popularRoutesSubtitle",
    "home.priceFrom",
    "home.viewAllRoutes",
    "home.recommendationsTitle",
    "home.recommendationsSubtitle",
    "home.featureCompare",
    "home.featureCompareBody",
    "home.featureSeats",
    "home.featureSeatsBody",
    "home.featureTicket",
    "home.featureTicketBody",
    "home.featurePay",
    "home.featurePayBody",
    "brandDetail.partnersTitle",
    "brandDetail.partnersSubtitle",
    "brandPage.routesTitle",
    "brandPage.tripsTitle",
    "brandPage.locationsTitle",
    "brandPage.today",
    "brandPage.tomorrow",
    "brandPage.seatsLeft",
    "brandPage.soldOut",
    "brandPage.noPrice",
    "common.seatsAvailable",
    "layout.footer.privacyPolicy",
    "layout.footer.termsOfUse",
    "seo.page.corridorHeading",
    "seo.page.corridorIntro",
];

/// The rest of the server-only text.
pub const SERVER_TEXT_KEYS: [&str; 5] = [
    "seo.page.corridorNoTrips",
    "seo.page.searchHeading",
    "seo.page.rating",
    "seo.page.phone",
    "seo.page.timetable",
];

// ── Building blocks ─────────────────────────────────────────────────────

/// A VND amount as the app writes it: `1.250.000 ₫`.
fn vnd(amount: i64) -> String {
    let digits = amount.unsigned_abs().to_string();
    let mut out = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push('.');
        }
        out.push(c);
    }
    format!("{}{out}\u{a0}₫", if amount < 0 { "-" } else { "" })
}

/// `2026-12-01` as `01/12/2026`; anything else as it came.
fn dmy(date: &str) -> String {
    match date.split('-').collect::<Vec<_>>().as_slice() {
        [y, m, d] if y.len() == 4 => format!("{d}/{m}/{y}"),
        _ => date.to_owned(),
    }
}

fn link(href: &str, class: &str, text: &str) -> String {
    format!(
        "<a href=\"{}\" class=\"{class}\">{}</a>",
        escape(href),
        escape(text)
    )
}

const LINK: &str = "font-medium text-primary hover:underline";
const SECTION: &str = "page-x py-8 md:py-11";
const H2: &str = "text-xl font-bold tracking-tight text-balance text-slate-900 md:text-2xl";
const CARD: &str = "flex flex-col rounded-2xl bg-white p-4 shadow-soft ring-1 ring-slate-200/80";

/// A section with a heading (and a line under it).
fn section(title: &str, subtitle: Option<&str>, body: &str) -> String {
    let subtitle = subtitle
        .map(|s| format!("<p class=\"mt-1 text-sm text-slate-500\">{}</p>", escape(s)))
        .unwrap_or_default();
    format!(
        "<section class=\"{SECTION}\"><div class=\"mb-5 md:mb-6\"><h2 class=\"{H2}\">{}</h2>{subtitle}</div>{body}</section>",
        escape(title)
    )
}

/// The site header (logo, the search link) at the app's own height, and the
/// page under it. The app's header adds its actions to the same bar.
fn frame(s: &Strings, main: &str) -> String {
    let tagline = escape(&s.t("trips.imageTagline", &[]));
    let home = escape(&s.t("nav.home", &[]));
    let search = escape(&s.t("nav.searchTrips", &[]));
    let privacy = link(
        "/privacy",
        "hover:text-primary",
        &s.t("layout.footer.privacyPolicy", &[]),
    );
    let terms = link(
        "/terms",
        "hover:text-primary",
        &s.t("layout.footer.termsOfUse", &[]),
    );
    format!(
        "<div class=\"flex min-h-screen flex-col bg-canvas\">\
<header class=\"sticky top-0 z-40 w-full border-b border-slate-200/80 bg-white/85 text-slate-900 backdrop-blur-xl\">\
<div class=\"page-x flex h-(--header-h) items-center gap-2\">\
<a href=\"/\" class=\"group flex shrink-0 items-center gap-2.5\" aria-label=\"DatXeVui\">\
<img src=\"/logo.svg\" alt=\"\" aria-hidden=\"true\" width=\"36\" height=\"36\" class=\"size-8 shrink-0 md:size-9\" />\
<div class=\"leading-tight\"><div class=\"text-lg font-extrabold tracking-tight text-slate-900\">DatXeVui</div>\
<div class=\"-mt-0.5 hidden text-[10px] text-slate-500 sm:block\">{tagline}</div></div></a>\
<nav class=\"ml-6 hidden items-center gap-1 md:flex\" aria-label=\"{home}\">\
<a href=\"/search\" class=\"rounded-full px-3.5 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900\">{search}</a></nav>\
</div></header>\
<main id=\"main-content\" tabindex=\"-1\" class=\"flex-1 outline-none pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0\">{main}</main>\
<footer class=\"page-x flex flex-wrap gap-x-6 gap-y-2 py-8 text-sm text-slate-600\">{privacy}{terms}</footer>\
</div>"
    )
}

fn breadcrumbs(items: &[(String, String)]) -> Value {
    json!({
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": items.iter().enumerate().map(|(i, (name, url))| json!({
            "@type": "ListItem",
            "position": i + 1,
            "name": name,
            "item": url,
        })).collect::<Vec<_>>(),
    })
}

fn item_list(name: &str, items: &[(String, String)]) -> Value {
    json!({
        "@context": "https://schema.org",
        "@type": "ItemList",
        "name": name,
        "numberOfItems": items.len(),
        "itemListElement": items.iter().enumerate().map(|(i, (name, url))| json!({
            "@type": "ListItem",
            "position": i + 1,
            "name": name,
            "url": url,
        })).collect::<Vec<_>>(),
    })
}

/// Each corridor once (several brands run the same one), in the order given.
fn distinct_corridors(routes: &RouteListResponse) -> Vec<(&str, &str, Option<i64>)> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for route in &routes.items {
        if seen.insert((route.from.name.as_str(), route.to.name.as_str())) {
            out.push((
                route.from.name.as_str(),
                route.to.name.as_str(),
                route.price_from,
            ));
        }
    }
    out
}

/// A list of corridors as links with their lowest fare.
fn corridor_list(
    s: &Strings,
    corridors: &[(&str, &str, Option<i64>)],
) -> (String, Vec<(String, String)>) {
    let from_label = escape(&s.t("home.priceFrom", &[]));
    let mut html =
        String::from("<ul class=\"grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4\">");
    let mut listed = Vec::new();
    for (from, to, price) in corridors {
        let name = format!("{from} → {to}");
        let fare = price
            .map(|p| {
                format!(
                    "<span class=\"mt-1 text-xs text-slate-500\">{from_label} {}</span>",
                    escape(&vnd(p))
                )
            })
            .unwrap_or_default();
        html.push_str(&format!(
            "<li><a href=\"{}\" class=\"{CARD} h-full text-[15px] font-semibold text-slate-900 hover:ring-primary/30\">{}{fare}</a></li>",
            escape(&corridor_path(from, to)),
            escape(&name),
        ));
        listed.push((name, corridor_canonical(from, to)));
    }
    html.push_str("</ul>");
    (html, listed)
}

/// A trip as a line of text with its links.
fn trip_line(s: &Strings, trip: &TripResult) -> String {
    let time = trip.departure_time.as_deref().unwrap_or_default();
    let seats = if trip.available_seats > 0 {
        format!(
            "{} {}",
            trip.available_seats,
            s.t("common.seatsAvailable", &[])
        )
    } else {
        s.t("brandPage.soldOut", &[])
    };
    format!(
        "<li class=\"{CARD} gap-1\"><div class=\"text-[15px] font-semibold text-slate-900\"><a href=\"/trips/{}\">{} {}</a></div>\
<div class=\"text-sm text-slate-600\"><a href=\"/brands/{}\" class=\"{LINK}\">{}</a> · {}</div>\
<div class=\"text-sm text-slate-600\">{} {} · {}</div></li>",
        escape(&trip.trip_id.to_string()),
        escape(time),
        escape(&format!("{} → {}", trip.from_name, trip.to_name)),
        escape(&urlencoding::encode(&trip.brand_slug)),
        escape(&trip.brand_name),
        escape(&trip.vehicle_type),
        escape(&s.t("home.priceFrom", &[])),
        escape(&vnd(trip.min_price)),
        escape(&seats),
    )
}

// ── Home ────────────────────────────────────────────────────────────────

/// The hero photo, as the app picks it: the small file on a phone.
fn hero_picture() -> String {
    let wide = HERO_BREAKPOINT_PX + 1;
    format!(
        "<picture>\
<source srcset=\"{HERO_MOBILE}\" type=\"image/avif\" media=\"(max-width: {HERO_BREAKPOINT_PX}px)\" />\
<source srcset=\"{HERO_DESKTOP}\" type=\"image/avif\" media=\"(min-width: {wide}px)\" />\
<img src=\"/hero-vietnam-bus.jpg\" alt=\"\" class=\"absolute inset-0 h-full w-full object-cover\" fetchpriority=\"high\" loading=\"eager\" decoding=\"async\" width=\"1344\" height=\"768\" />\
</picture>"
    )
}

/// `<script type="application/json">` holding what the app's first screen
/// fetches, so it needs no round trip for it.
fn initial_data(data: &HomeData) -> String {
    let mut map = serde_json::Map::new();
    map.insert("generatedAt".into(), json!(data.generated_at_ms));
    let mut put = |key: &str, value: Option<Value>| {
        if let Some(value) = value {
            map.insert(key.into(), value);
        }
    };
    put(
        "routes",
        data.routes
            .as_ref()
            .and_then(|v| serde_json::to_value(v).ok()),
    );
    put(
        "brands",
        data.brands
            .as_ref()
            .and_then(|v| serde_json::to_value(v).ok()),
    );
    put(
        "stats",
        data.stats
            .as_ref()
            .and_then(|v| serde_json::to_value(v).ok()),
    );
    put(
        "recommendations",
        data.recommendations
            .as_ref()
            .and_then(|v| serde_json::to_value(v).ok()),
    );
    format!(
        "<script type=\"application/json\" id=\"{INITIAL_DATA_ID}\">{}</script>",
        script_json(&Value::Object(map))
    )
}

/// `/`: the hero with its headline, the four promises, the routes and the
/// brands people can book, the next departures.
pub fn home(s: &Strings, data: &HomeData) -> Content {
    let mut structured = Vec::new();
    let title = escape(&s.t("hero.title", &[]));
    let highlight = escape(&s.t("hero.titleHighlight", &[]));
    let subtitle = escape(&s.t("hero.subtitle", &[]));
    let mut main = format!(
        "<div class=\"pb-6\"><section class=\"page-x pt-3 sm:pt-5\">\
<div class=\"relative isolate overflow-hidden rounded-3xl sm:rounded-[2rem]\">\
<div class=\"absolute inset-0 -z-10 bg-slate-800\">{}\
<div class=\"absolute inset-0 bg-linear-to-r from-slate-950/80 via-slate-950/45 to-slate-950/10\"></div>\
<div class=\"absolute inset-x-0 bottom-0 h-1/2 bg-linear-to-t from-slate-950/55 to-transparent\"></div></div>\
<div class=\"px-5 pt-9 pb-24 sm:px-10 sm:pt-14 sm:pb-32 lg:px-14 lg:pt-20 lg:pb-40\">\
<h1 class=\"max-w-2xl text-[2rem] leading-[1.08] font-extrabold tracking-tight text-balance text-white sm:text-5xl lg:text-6xl\">{title} <span class=\"text-amber-300\">{highlight}</span></h1>\
<p class=\"mt-4 max-w-xl text-[15px] leading-relaxed text-white/85 sm:text-lg\">{subtitle}</p>",
        hero_picture(),
    );
    if let Some(stats) = &data.stats {
        let counts: Vec<String> = [
            (stats.brands, "home.statBrands"),
            (stats.routes, "home.statRoutes"),
            (stats.trips, "home.statTrips"),
        ]
        .into_iter()
        .filter(|(count, _)| *count > 0)
        .map(|(count, key)| {
            format!(
                "<div class=\"flex items-baseline gap-1.5\"><span class=\"text-xl font-bold tabular-nums\">{count}</span> <span class=\"text-sm text-white/70\">{}</span></div>",
                escape(&s.t(key, &[]))
            )
        })
        .collect();
        if !counts.is_empty() {
            main.push_str(&format!(
                "<div class=\"mt-6 hidden flex-wrap gap-x-6 gap-y-2 text-white sm:flex\">{}</div>",
                counts.join("")
            ));
        }
    }
    // The search card is the app's; its place is held at the height it takes.
    main.push_str(
        "</div></div>\
<div class=\"relative z-30 -mt-16 sm:-mt-20 sm:px-4 lg:-mt-24 lg:px-10\">\
<div class=\"min-h-[22rem] rounded-3xl bg-white p-4 shadow-float ring-1 ring-slate-900/5 sm:min-h-[16rem] sm:p-5 md:p-6\" aria-hidden=\"true\"></div></div>\
<ul class=\"mt-6 grid grid-cols-2 gap-x-3 gap-y-4 sm:mt-10 sm:gap-x-4 sm:gap-y-6 lg:grid-cols-4 lg:px-10\">",
    );
    for (title_key, body_key) in [
        ("home.featureCompare", "home.featureCompareBody"),
        ("home.featureSeats", "home.featureSeatsBody"),
        ("home.featureTicket", "home.featureTicketBody"),
        ("home.featurePay", "home.featurePayBody"),
    ] {
        main.push_str(&format!(
            "<li class=\"min-w-0\"><div class=\"text-[13px] leading-snug font-semibold text-slate-900 sm:text-sm\">{}</div>\
<p class=\"mt-0.5 hidden text-[13px] leading-relaxed text-slate-500 sm:block\">{}</p></li>",
            escape(&s.t(title_key, &[])),
            escape(&s.t(body_key, &[])),
        ));
    }
    main.push_str("</ul></section>");

    if let Some(routes) = &data.routes {
        let corridors: Vec<_> = distinct_corridors(routes)
            .into_iter()
            .take(POPULAR_ROUTES)
            .collect();
        if !corridors.is_empty() {
            let (list, listed) = corridor_list(s, &corridors);
            let heading = s.t("home.popularRoutesTitle", &[]);
            structured.push(item_list(&heading, &listed));
            main.push_str(&section(
                &heading,
                Some(&s.t("home.popularRoutesSubtitle", &[])),
                &format!(
                    "{list}<p class=\"mt-4\">{}</p>",
                    link("/search", LINK, &s.t("home.viewAllRoutes", &[]))
                ),
            ));
        }
    }
    if let Some(brands) = data.brands.as_ref().filter(|b| !b.items.is_empty()) {
        let mut list =
            String::from("<ul class=\"grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4\">");
        for brand in &brands.items {
            let rating = brand
                .rating
                .map(|r| {
                    format!(
                        "<span class=\"mt-1 text-xs font-normal text-slate-500\">★ {r:.1}</span>"
                    )
                })
                .unwrap_or_default();
            list.push_str(&format!(
                "<li><a href=\"/brands/{}\" class=\"{CARD} h-full text-[15px] font-semibold text-slate-900 hover:ring-primary/30\">{}{rating}</a></li>",
                escape(&urlencoding::encode(&brand.slug)),
                escape(&brand.name),
            ));
        }
        list.push_str("</ul>");
        main.push_str(&section(
            &s.t("brandDetail.partnersTitle", &[]),
            Some(&s.t("brandDetail.partnersSubtitle", &[])),
            &list,
        ));
    }
    if let Some(recs) = data
        .recommendations
        .as_ref()
        .filter(|r| !r.items.is_empty())
    {
        let lines: String = recs.items.iter().map(|t| trip_line(s, t)).collect();
        main.push_str(&section(
            &s.t("home.recommendationsTitle", &[]),
            Some(&s.t("home.recommendationsSubtitle", &[])),
            &format!(
                "<ul class=\"grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4\">{lines}</ul>"
            ),
        ));
    }
    main.push_str("</div>");

    Content {
        html: format!("{}{}", frame(s, &main), initial_data(data)),
        structured,
    }
}

// ── Search ──────────────────────────────────────────────────────────────

/// `/search` with no corridor: the way into the routes.
pub fn search(s: &Strings, data: &HomeData) -> Content {
    let heading = s.t("seo.page.searchHeading", &[]);
    let mut main = format!(
        "<div class=\"page-x py-8\"><h1 class=\"text-2xl font-extrabold tracking-tight text-slate-900 md:text-3xl\">{}</h1>",
        escape(&heading)
    );
    let mut structured = vec![breadcrumbs(&[
        (s.t("nav.home", &[]), SITE_URL.to_owned()),
        (heading.clone(), format!("{SITE_URL}/search")),
    ])];
    if let Some(routes) = &data.routes {
        let corridors = distinct_corridors(routes);
        if !corridors.is_empty() {
            let (list, listed) = corridor_list(s, &corridors);
            structured.push(item_list(&s.t("home.popularRoutesTitle", &[]), &listed));
            main.push_str(&format!(
                "<h2 class=\"mt-6 mb-4 {H2}\">{}</h2>{list}",
                escape(&s.t("home.popularRoutesTitle", &[]))
            ));
        }
    }
    main.push_str("</div>");
    Content {
        html: frame(s, &main),
        structured,
    }
}

/// A corridor: `/search?from=A&to=B`.
pub fn corridor(s: &Strings, data: &CorridorData) -> Content {
    let params = [("from", data.from.as_str()), ("to", data.to.as_str())];
    let heading = s.t("seo.page.corridorHeading", &params);
    let mut main = format!(
        "<div class=\"page-x py-8\"><h1 class=\"text-2xl font-extrabold tracking-tight text-slate-900 md:text-3xl\">{}</h1>\
<p class=\"mt-2 max-w-3xl text-slate-600\">{}</p>",
        escape(&heading),
        escape(&s.t("seo.page.corridorIntro", &params)),
    );
    let mut listed = Vec::new();
    for day in data.days.iter().filter(|d| !d.trips.is_empty()) {
        let label = if day.date == data.today {
            s.t("brandPage.today", &[])
        } else {
            s.t("brandPage.tomorrow", &[])
        };
        main.push_str(&format!(
            "<h2 class=\"mt-8 mb-4 {H2}\">{} · {}</h2><ul class=\"grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3\">",
            escape(&label),
            escape(&dmy(&day.date)),
        ));
        for trip in &day.trips {
            main.push_str(&trip_line(s, trip));
            if listed.len() < CORRIDOR_TRIPS_PER_DAY {
                listed.push((
                    format!(
                        "{} {} {}",
                        trip.departure_time.as_deref().unwrap_or_default(),
                        trip.brand_name,
                        trip.vehicle_type
                    )
                    .trim()
                    .to_owned(),
                    format!("{SITE_URL}/trips/{}", trip.trip_id),
                ));
            }
        }
        main.push_str("</ul>");
    }
    if listed.is_empty() {
        main.push_str(&format!(
            "<p class=\"mt-6 text-slate-600\">{}</p>",
            escape(&s.t("seo.page.corridorNoTrips", &params))
        ));
    }
    main.push_str("</div>");

    let mut structured = vec![breadcrumbs(&[
        (s.t("nav.home", &[]), SITE_URL.to_owned()),
        (s.t("nav.searchTrips", &[]), format!("{SITE_URL}/search")),
        (heading.clone(), corridor_canonical(&data.from, &data.to)),
    ])];
    if !listed.is_empty() {
        structured.push(item_list(&heading, &listed));
    }
    Content {
        html: frame(s, &main),
        structured,
    }
}

// ── Brand ───────────────────────────────────────────────────────────────

/// `/brands/<slug>`: who the brand is, its routes with their lowest fares and
/// departure times, where it has offices, and what leaves soon.
pub fn brand(s: &Strings, profile: &BrandProfile, today: &str) -> Content {
    let b = &profile.brand;
    let mut main = format!(
        "<div class=\"page-x py-8\"><h1 class=\"text-2xl font-extrabold tracking-tight text-slate-900 md:text-3xl\">{}</h1>",
        escape(&b.name)
    );
    if let Some(description) = b.description.as_deref().filter(|d| !d.trim().is_empty()) {
        main.push_str(&format!(
            "<p class=\"mt-2 max-w-3xl text-slate-600\">{}</p>",
            escape(description.trim())
        ));
    }
    let mut facts = Vec::new();
    if let Some(rating) = b.rating.filter(|_| b.review_count > 0) {
        facts.push(s.t(
            "seo.page.rating",
            &[
                ("rating", &format!("{rating:.1}")),
                ("count", &b.review_count.to_string()),
            ],
        ));
    }
    if let Some(phone) = b.contact_phone.as_deref().filter(|p| !p.trim().is_empty()) {
        facts.push(s.t("seo.page.phone", &[("phone", phone.trim())]));
    }
    if !facts.is_empty() {
        main.push_str(&format!(
            "<p class=\"mt-2 text-sm text-slate-500\">{}</p>",
            escape(&facts.join(" · "))
        ));
    }

    let mut structured = vec![breadcrumbs(&[
        (s.t("nav.home", &[]), SITE_URL.to_owned()),
        (
            b.name.clone(),
            format!("{SITE_URL}/brands/{}", urlencoding::encode(&b.slug)),
        ),
    ])];

    if !profile.routes.is_empty() {
        let mut list =
            String::from("<ul class=\"grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3\">");
        let mut listed = Vec::new();
        for route in &profile.routes {
            let name = format!("{} → {}", route.from.name, route.to.name);
            let fare = route
                .price_from
                .map(|p| format!("{} {}", s.t("home.priceFrom", &[]), vnd(p)))
                .unwrap_or_else(|| s.t("brandPage.noPrice", &[]));
            let times: Vec<&str> = route
                .schedules
                .iter()
                .map(|sc| sc.departure_time.as_str())
                .collect();
            let times = if times.is_empty() {
                String::new()
            } else {
                format!(
                    "<span class=\"mt-1 text-xs text-slate-500\">{}: {}</span>",
                    escape(&s.t("seo.page.timetable", &[])),
                    escape(&times.join(", "))
                )
            };
            list.push_str(&format!(
                "<li><a href=\"{}\" class=\"{CARD} h-full text-[15px] font-semibold text-slate-900 hover:ring-primary/30\">{}<span class=\"mt-1 text-sm font-normal text-slate-600\">{}</span>{times}</a></li>",
                escape(&corridor_path(&route.from.name, &route.to.name)),
                escape(&name),
                escape(&fare),
            ));
            listed.push((name, corridor_canonical(&route.from.name, &route.to.name)));
        }
        list.push_str("</ul>");
        let heading = s.t("brandPage.routesTitle", &[]);
        structured.push(item_list(&format!("{heading} — {}", b.name), &listed));
        main.push_str(&section(&heading, None, &list));
    }

    let trips: Vec<_> = profile.trips.iter().collect();
    if !trips.is_empty() {
        let mut list =
            String::from("<ul class=\"grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3\">");
        for trip in trips {
            let route = profile.routes.iter().find(|r| r.id == trip.route_id);
            let name = route
                .map(|r| format!("{} → {}", r.from.name, r.to.name))
                .unwrap_or_default();
            let day = if trip.date == today {
                s.t("brandPage.today", &[])
            } else {
                dmy(&trip.date)
            };
            let seats = if trip.available_seats > 0 {
                s.t(
                    "brandPage.seatsLeft",
                    &[("count", &trip.available_seats.to_string())],
                )
            } else {
                s.t("brandPage.soldOut", &[])
            };
            list.push_str(&format!(
                "<li class=\"{CARD} gap-1\"><a href=\"/trips/{}\" class=\"text-[15px] font-semibold text-slate-900\">{} {} · {}</a>\
<span class=\"text-sm text-slate-600\">{} {} · {}</span></li>",
                escape(&trip.trip_id.to_string()),
                escape(&trip.departure_time),
                escape(&name),
                escape(&day),
                escape(&s.t("home.priceFrom", &[])),
                escape(&vnd(trip.price_adult)),
                escape(&seats),
            ));
        }
        list.push_str("</ul>");
        main.push_str(&section(&s.t("brandPage.tripsTitle", &[]), None, &list));
    }

    if !profile.locations.is_empty() {
        let mut list = String::from("<ul class=\"grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 text-sm text-slate-700\">");
        for location in &profile.locations {
            let place: Vec<&str> = [location.address.as_deref(), location.city.as_deref()]
                .into_iter()
                .flatten()
                .filter(|p| !p.trim().is_empty())
                .collect();
            list.push_str(&format!(
                "<li><span class=\"font-semibold text-slate-900\">{}</span>{}</li>",
                escape(&location.name),
                if place.is_empty() {
                    String::new()
                } else {
                    format!("<br />{}", escape(&place.join(", ")))
                },
            ));
        }
        list.push_str("</ul>");
        main.push_str(&section(&s.t("brandPage.locationsTitle", &[]), None, &list));
    }
    main.push_str("</div>");

    Content {
        html: frame(s, &main),
        structured,
    }
}

// ── Other public pages ──────────────────────────────────────────────────

/// A public page with no data of its own (`/compare`): its headline and
/// description, from the page's own `seo.<key>` strings.
pub fn plain(s: &Strings, key: &str) -> Content {
    let main = format!(
        "<div class=\"page-x py-8\"><h1 class=\"text-2xl font-extrabold tracking-tight text-slate-900 md:text-3xl\">{}</h1>\
<p class=\"mt-2 max-w-3xl text-slate-600\">{}</p></div>",
        escape(&s.t(&format!("seo.{key}.title"), &[])),
        escape(&s.t(&format!("seo.{key}.description"), &[])),
    );
    Content {
        html: frame(s, &main),
        structured: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn amounts_are_written_as_the_app_writes_them() {
        assert_eq!(vnd(0), "0\u{a0}₫");
        assert_eq!(vnd(950), "950\u{a0}₫");
        assert_eq!(vnd(1_250_000), "1.250.000\u{a0}₫");
        assert_eq!(vnd(12_345), "12.345\u{a0}₫");
    }

    #[test]
    fn dates_read_day_first() {
        assert_eq!(dmy("2026-12-01"), "01/12/2026");
        assert_eq!(dmy("tomorrow"), "tomorrow");
    }
}
