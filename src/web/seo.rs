//! What a page tells search engines and link previews: its title,
//! description, canonical URL and whether it may be indexed.
//!
//! The server half of `frontend/src/lib/seo.ts` (the SPA keeps
//! `document.title` in step from the same logic). The Vietnamese strings come
//! from `dist/seo-strings.json`, which the frontend build emits from the
//! translation file, so the `<title>` this server writes and the one the
//! browser sets cannot disagree. `tests/fixtures/seo-golden.json` (written by
//! the frontend from its own implementation) is the parity test.

use std::collections::HashMap;

use super::content;

/// The public origin every canonical URL is built on.
pub const SITE_URL: &str = "https://datxevui.com";

/// How a page is treated by crawlers.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PageKind {
    /// Indexed, with a canonical URL.
    Public,
    /// Shown to anyone but not worth a search result; links followed.
    Noindex,
    /// Signed-in or staff pages; neither indexed nor followed.
    Private,
}

impl PageKind {
    /// The `robots` meta content for this kind.
    pub fn robots(self) -> &'static str {
        match self {
            Self::Public => "index, follow",
            Self::Noindex => "noindex, follow",
            Self::Private => "noindex, nofollow",
        }
    }
}

/// A page the SPA serves.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Page {
    /// The translation key stem (`seo.<key>.title`).
    pub key: &'static str,
    pub kind: PageKind,
}

/// `robots` of a path no page has (the 404 page).
pub const NOT_FOUND_ROBOTS: &str = "noindex, follow";

/// `path` followed by exactly one more non-empty segment, which is returned.
fn one_segment_after<'a>(path: &'a str, prefix: &str) -> Option<&'a str> {
    let rest = path.strip_prefix(prefix)?.strip_prefix('/')?;
    (!rest.is_empty() && !rest.contains('/')).then_some(rest)
}

/// `path` is `/<name>` or anything below it.
fn is_section(path: &str, name: &str) -> bool {
    path.strip_prefix('/')
        .and_then(|p| p.strip_prefix(name))
        .is_some_and(|rest| rest.is_empty() || rest.starts_with('/'))
}

/// A `.` or `..` path segment (also percent-encoded): a URL parser folds
/// these away, so no canonical URL could name such a path faithfully.
fn is_dot_segment(segment: &str) -> bool {
    matches!(
        segment.to_ascii_lowercase().replace("%2e", ".").as_str(),
        "." | ".."
    )
}

/// The page `path` shows, or `None` when no page has that path. `path` is the
/// URL path as it arrives on the wire (percent-encoded).
pub fn match_page(path: &str) -> Option<Page> {
    if path.split('/').any(is_dot_segment) {
        return None;
    }
    let (key, kind) = match path {
        "/" => ("home", PageKind::Public),
        "/search" => ("search", PageKind::Public),
        "/compare" => ("compare", PageKind::Public),
        "/privacy" => ("privacy", PageKind::Public),
        "/terms" => ("terms", PageKind::Public),
        "/login" => ("login", PageKind::Private),
        _ if one_segment_after(path, "/brands").is_some() => ("brandDetail", PageKind::Public),
        // A trip departs and is gone: the page is not worth a search result, its links are.
        _ if one_segment_after(path, "/trips").is_some() => ("tripDetail", PageKind::Noindex),
        _ if one_segment_after(path, "/bookings").is_some() => ("bookingDetail", PageKind::Private),
        _ if is_payment_return(path) => ("paymentReturn", PageKind::Private),
        _ if is_section(path, "admin") => ("admin", PageKind::Private),
        _ if is_section(path, "account") => ("account", PageKind::Private),
        _ => return None,
    };
    Some(Page { key, kind })
}

/// `/payments/<id>/return`.
fn is_payment_return(path: &str) -> bool {
    path.strip_prefix("/payments/")
        .and_then(|rest| rest.strip_suffix("/return"))
        .is_some_and(|id| !id.is_empty() && !id.contains('/'))
}

/// The slug of the brand a `/brands/<slug>` path names (still percent-encoded).
pub fn brand_slug(path: &str) -> Option<&str> {
    one_segment_after(path, "/brands")
}

/// The query string as `URLSearchParams` reads it.
#[derive(Debug, Default)]
pub struct Query(Vec<(String, String)>);

impl Query {
    /// Parses `a=b&c=d` (no leading `?`): `+` is a space, `%XX` decoded.
    pub fn parse(raw: &str) -> Self {
        Self(
            url::form_urlencoded::parse(raw.as_bytes())
                .map(|(k, v)| (k.into_owned(), v.into_owned()))
                .collect(),
        )
    }

    /// The query of a corridor search: the two ends, as the page names them.
    pub fn with_route(from: &str, to: &str) -> Self {
        Self(vec![
            ("from".to_owned(), from.to_owned()),
            ("to".to_owned(), to.to_owned()),
        ])
    }

    /// The first value of `name`.
    pub fn get(&self, name: &str) -> Option<&str> {
        self.0
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.as_str())
    }
}

/// JavaScript's `String.prototype.trim`.
fn js_trim(s: &str) -> &str {
    s.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
}

/// The corridor a search is for, when it names both ends: such a search is a
/// page of its own ("vé xe Hà Nội đi Đà Nẵng"), whatever its date.
pub fn search_route(query: &Query) -> Option<(&str, &str)> {
    let from = js_trim(query.get("from")?);
    let to = js_trim(query.get("to")?);
    (!from.is_empty() && !to.is_empty()).then_some((from, to))
}

/// Longest city name a corridor page looks up.
const CITY_NAME_MAX: usize = 64;

/// A corridor whose two ends are each exactly one city of the catalogue.
#[derive(Debug, PartialEq, Eq)]
pub struct Corridor {
    pub from_slug: &'static str,
    pub to_slug: &'static str,
    /// What the page calls the ends (head, heading, breadcrumb, canonical):
    /// the city's own name when the text is that name (`ha-noi`, `hà nội`),
    /// else the text as typed (`Sài Gòn` stays `Sài Gòn`).
    pub from: String,
    pub to: String,
}

/// The one city `text` names, with the name to show for it; `None` for text
/// that names no city or several (`an` is half of Vietnam): such a search page
/// is not a corridor.
fn one_city(text: &str) -> Option<(&'static str, String)> {
    let text = js_trim(text);
    if text.is_empty() || text.chars().count() > CITY_NAME_MAX {
        return None;
    }
    let slugs = crate::cities::match_city_slugs(text);
    let [slug] = slugs.as_slice() else {
        return None;
    };
    let city = crate::cities::find_by_slug(slug)?;
    let own =
        crate::cities::normalize_for_match(text) == crate::cities::normalize_for_match(city.name);
    Some((
        city.slug,
        if own {
            city.name.to_owned()
        } else {
            text.to_owned()
        },
    ))
}

/// The corridor `from` to `to` names, or `None` when either end is unknown or
/// ambiguous. The slugs are what a cache is keyed by, never the typed text.
pub fn resolve_corridor(from: &str, to: &str) -> Option<Corridor> {
    let ((from_slug, from), (to_slug, to)) = (one_city(from)?, one_city(to)?);
    Some(Corridor {
        from_slug,
        to_slug,
        from,
        to,
    })
}

/// The path and query of the search page for the corridor `from` to `to`.
pub fn corridor_path(from: &str, to: &str) -> String {
    let query = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("from", from)
        .append_pair("to", to)
        .finish();
    format!("/search?{query}")
}

/// The canonical URL of the search page for the corridor `from` to `to`.
pub fn corridor_canonical(from: &str, to: &str) -> String {
    format!("{SITE_URL}{}", corridor_path(from, to))
}

/// What the build wrote to `dist/seo-strings.json`.
#[derive(Debug)]
pub struct Strings(HashMap<String, String>);

/// Every key a head is built from (the Rust half of `SEO_STRING_KEYS`).
const PAGE_KEYS: [&str; 12] = [
    "home",
    "search",
    "compare",
    "privacy",
    "terms",
    "brandDetail",
    "tripDetail",
    "bookingDetail",
    "paymentReturn",
    "login",
    "admin",
    "account",
];

impl Strings {
    /// Parses the file; every key a head needs must be there, so a stale or
    /// truncated build fails here and not as a half-empty `<title>`.
    pub fn parse(json: &str) -> Result<Self, String> {
        let map: HashMap<String, String> =
            serde_json::from_str(json).map_err(|e| format!("not a string map: {e}"))?;
        let mut required: Vec<String> = PAGE_KEYS
            .iter()
            .flat_map(|key| [format!("seo.{key}.title"), format!("seo.{key}.description")])
            .collect();
        required.extend(
            content::TEXT_KEYS
                .iter()
                .chain(&content::SERVER_TEXT_KEYS)
                .map(|key| (*key).to_owned()),
        );
        required.extend(
            [
                "seo.searchRoute.title",
                "seo.searchRoute.description",
                "seo.brand.title",
                "seo.brand.description",
                "seo.notFound.title",
            ]
            .map(String::from),
        );
        let missing: Vec<&str> = required
            .iter()
            .filter(|key| !map.contains_key(*key))
            .map(String::as_str)
            .collect();
        if missing.is_empty() {
            Ok(Self(map))
        } else {
            Err(format!("missing keys: {}", missing.join(", ")))
        }
    }

    /// The text for `key` with `{name}` placeholders filled in one pass: a
    /// value that itself holds `{to}` is not substituted again.
    pub fn t(&self, key: &str, params: &[(&str, &str)]) -> String {
        let text = self.0.get(key).map(String::as_str).unwrap_or(key);
        let mut out = String::with_capacity(text.len());
        let mut rest = text;
        while let Some(open) = rest.find('{') {
            out.push_str(&rest[..open]);
            let tail = &rest[open..];
            let filled = tail.find('}').and_then(|close| {
                let name = &tail[1..close];
                params
                    .iter()
                    .find(|(n, _)| *n == name)
                    .map(|(_, value)| (value, close))
            });
            match filled {
                Some((value, close)) => {
                    out.push_str(value);
                    rest = &tail[close + 1..];
                }
                None => {
                    out.push('{');
                    rest = &tail[1..];
                }
            }
        }
        out.push_str(rest);
        out
    }
}

/// What only the database knows about a page.
#[derive(Debug, Default)]
pub struct PageFacts {
    /// The brand on `/brands/<slug>`, when it exists.
    pub brand: Option<BrandFacts>,
}

#[derive(Clone, Debug)]
pub struct BrandFacts {
    pub name: String,
    pub description: Option<String>,
}

/// The head of one page.
#[derive(Debug, PartialEq, Eq)]
pub struct PageSeo {
    pub title: String,
    pub description: String,
    /// Absolute; `None` for pages that are not indexed.
    pub canonical: Option<String>,
    pub robots: &'static str,
}

/// The head of `path` + `query`; `None` when no page has that path.
/// `facts` carries what only the database knows (a brand's name).
pub fn page_seo(
    path: &str,
    query: &Query,
    strings: &Strings,
    facts: &PageFacts,
) -> Option<PageSeo> {
    let page = match_page(path)?;
    let route = if page.key == "search" {
        search_route(query)
    } else {
        None
    };

    let mut title = strings.t(&format!("seo.{}.title", page.key), &[]);
    let mut description = strings.t(&format!("seo.{}.description", page.key), &[]);
    if let Some((from, to)) = route {
        let params = [("from", from), ("to", to)];
        title = strings.t("seo.searchRoute.title", &params);
        description = strings.t("seo.searchRoute.description", &params);
    } else if let Some(brand) = &facts.brand {
        let params = [("name", brand.name.as_str())];
        title = strings.t("seo.brand.title", &params);
        description = match brand.description.as_deref().map(js_trim) {
            Some(text) if !text.is_empty() => text.to_owned(),
            _ => strings.t("seo.brand.description", &params),
        };
    }

    let canonical = (page.kind == PageKind::Public).then(|| match route {
        Some((from, to)) => corridor_canonical(from, to),
        None => format!("{SITE_URL}{path}"),
    });
    Some(PageSeo {
        title,
        description,
        canonical,
        robots: page.kind.robots(),
    })
}

/// Where `/foo/` is redirected to (308, query kept): a path and its
/// slash-terminated twin must not both answer 200. Browsers read a leading
/// `//` or `/\` as a protocol-relative URL, so those runs collapse into one
/// `/` and the redirect can never leave this host.
pub fn trailing_slash_target(path: &str, query: Option<&str>) -> Option<String> {
    if path.len() < 2 || !path.ends_with('/') {
        return None;
    }
    let trimmed = path.trim_end_matches('/');
    let target = if trimmed.is_empty() {
        "/".to_owned()
    } else {
        format!("/{}", trimmed.trim_start_matches(['/', '\\']))
    };
    Some(match query {
        Some(q) => format!("{target}?{q}"),
        None => target,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kind(path: &str) -> Option<PageKind> {
        match_page(path).map(|p| p.kind)
    }

    #[test]
    fn every_spa_page_matches_and_nothing_else() {
        assert_eq!(kind("/"), Some(PageKind::Public));
        assert_eq!(kind("/brands/phuong-trang"), Some(PageKind::Public));
        assert_eq!(kind("/trips/abc"), Some(PageKind::Noindex));
        assert_eq!(kind("/bookings/DXV-1"), Some(PageKind::Private));
        assert_eq!(kind("/payments/abc/return"), Some(PageKind::Private));
        assert_eq!(kind("/admin"), Some(PageKind::Private));
        assert_eq!(kind("/admin/brands/x"), Some(PageKind::Private));
        assert_eq!(kind("/account/trips"), Some(PageKind::Private));
        for path in [
            "/brands",
            "/brands/a/b",
            "/trips",
            "/payments/abc",
            "/payments//return",
            "/payments/a/b/return",
            "/administrator",
            "/accounts",
            "/SEARCH",
            "/index.html",
            "",
            "/brands/..",
            "/brands/%2E%2e",
        ] {
            assert_eq!(kind(path), None, "{path}");
        }
    }

    #[test]
    fn form_urlencoded_queries_read_like_url_search_params() {
        let q = Query::parse("from=H%C3%A0+N%E1%BB%99i&from=x&to=%20a%2B&empty&k=v=w");
        assert_eq!(q.get("from"), Some("Hà Nội"));
        assert_eq!(q.get("to"), Some(" a+"));
        assert_eq!(q.get("empty"), Some(""));
        assert_eq!(q.get("k"), Some("v=w"));
        assert_eq!(q.get("missing"), None);
    }

    #[test]
    fn a_corridor_needs_both_ends_after_trimming() {
        let route = |raw: &str| {
            let q = Query::parse(raw);
            search_route(&q).map(|(a, b)| (a.to_owned(), b.to_owned()))
        };
        assert_eq!(route("from=A&to=B"), Some(("A".into(), "B".into())));
        assert_eq!(route("from=%20A+&to=+B"), Some(("A".into(), "B".into())));
        assert_eq!(route("from=A"), None);
        assert_eq!(route("from=A&to=+++"), None);
        assert_eq!(route("from=&to=B"), None);
    }

    #[test]
    fn corridor_urls_use_form_encoding() {
        assert_eq!(
            corridor_canonical("Phan Rang - Tháp Chàm", "Nha Trang & Cam Ranh"),
            "https://datxevui.com/search?from=Phan+Rang+-+Th%C3%A1p+Ch%C3%A0m&to=Nha+Trang+%26+Cam+Ranh"
        );
    }

    #[test]
    fn trailing_slash_redirect_never_leaves_the_host() {
        for (path, want) in [
            ("//evil.example/", "/evil.example"),
            ("///evil.example//", "/evil.example"),
            ("/\\evil/", "/evil"),
            ("/\\/evil.example/", "/evil.example"),
            ("//", "/"),
            ("/\\/", "/"),
        ] {
            let target = trailing_slash_target(path, None).unwrap();
            assert_eq!(target, want, "{path}");
            assert!(!target.starts_with("//") && !target.starts_with("/\\"));
        }
    }

    #[test]
    fn trailing_slashes_redirect_and_keep_the_query() {
        assert_eq!(trailing_slash_target("/", None), None);
        assert_eq!(trailing_slash_target("/search", None), None);
        assert_eq!(
            trailing_slash_target("/search/", None).as_deref(),
            Some("/search")
        );
        assert_eq!(
            trailing_slash_target("/search//", Some("from=A&to=B")).as_deref(),
            Some("/search?from=A&to=B")
        );
    }

    #[test]
    fn strings_without_every_key_are_rejected() {
        let err = Strings::parse(r#"{"seo.home.title":"x"}"#).unwrap_err();
        assert!(err.contains("seo.home.description"), "{err}");
        assert!(Strings::parse("[]").is_err());
    }

    #[test]
    fn placeholders_are_filled_in_one_pass() {
        let strings = Strings(HashMap::from([("k".into(), "{a}-{b}-{c}".into())]));
        // A value holding another placeholder is left as it is.
        assert_eq!(strings.t("k", &[("a", "{b}"), ("b", "x")]), "{b}-x-{c}");
        assert_eq!(strings.t("k", &[]), "{a}-{b}-{c}");
        assert_eq!(strings.t("unknown", &[]), "unknown");
        let odd = Strings(HashMap::from([("k".into(), "{ {a} }{".into())]));
        assert_eq!(odd.t("k", &[("a", "x")]), "{ x }{");
    }

    #[test]
    fn a_corridor_needs_one_known_city_at_each_end() {
        let c = resolve_corridor("ha-noi", " Hải Phòng ").unwrap();
        assert_eq!((c.from_slug, c.to_slug), ("ha-noi", "hai-phong"));
        // The city's own name, whatever the spelling of it.
        assert_eq!((c.from.as_str(), c.to.as_str()), ("Hà Nội", "Hải Phòng"));
        assert_eq!(resolve_corridor("hà nội", "DA NANG").unwrap().to, "Đà Nẵng");
        // An alias stays as typed.
        assert_eq!(
            resolve_corridor("Sài Gòn", "Đà Lạt").unwrap().from,
            "Sài Gòn"
        );
        // Unknown, empty or ambiguous ends are no corridor.
        for (from, to) in [
            ("zzz", "Hà Nội"),
            ("Hà Nội", ""),
            ("an", "Hà Nội"),
            ("Phan Rang - Tháp Chàm", "Nha Trang"),
        ] {
            assert_eq!(resolve_corridor(from, to), None, "{from} -> {to}");
        }
        assert_eq!(resolve_corridor(&"a".repeat(200), "Hà Nội"), None);
    }

    #[test]
    fn every_spelling_of_a_city_is_the_same_cache_key() {
        let key =
            |from: &str, to: &str| resolve_corridor(from, to).map(|c| (c.from_slug, c.to_slug));
        let spellings = ["Hà Nội", "ha noi", "HA-NOI", "  hà nội ", "hanoi"];
        for a in spellings {
            assert_eq!(key(a, "Đà Nẵng"), Some(("ha-noi", "da-nang")), "{a}");
        }
        for n in 0..500 {
            assert_eq!(key(&format!("junk{n}"), "Đà Nẵng"), None);
        }
    }
}
