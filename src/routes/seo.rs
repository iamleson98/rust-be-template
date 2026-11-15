//! SEO routes — `/sitemap.xml` + `/robots.txt`.

use std::collections::BTreeSet;

use axum::extract::State;
use axum::http::header;
use axum::response::{IntoResponse, Response};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect};

use crate::entity::{brand, route};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::web::seo::{corridor_canonical, SITE_URL};

/// The pages every sitemap lists: `(path, changefreq, priority)`.
const STATIC_PAGES: [(&str, &str, &str); 5] = [
    ("/", "daily", "1.0"),
    ("/search", "daily", "0.9"),
    ("/compare", "weekly", "0.6"),
    ("/privacy", "yearly", "0.3"),
    ("/terms", "yearly", "0.3"),
];

/// Written as XML text.
fn xml_escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// `https://datxevui.com/brands/<slug>`, the slug percent-encoded as one segment.
fn brand_url(slug: &str) -> String {
    let mut url = url::Url::parse(SITE_URL).expect("SITE_URL is a valid URL");
    url.path_segments_mut()
        .expect("an https URL has path segments")
        .extend(["brands", slug]);
    url.to_string()
}

/// `GET /sitemap.xml` — the indexable pages: the static ones, one per active
/// brand, and one search page per city pair some active route serves ("vé xe
/// Hà Nội đi Đà Nẵng"). Never lists `/login` or a page that is not indexed.
#[utoipa::path(
    get,
    path = "/sitemap.xml",
    tag = "seo",
    responses(
        (status = 200, description = "Sitemap XML", content_type = "application/xml"),
        (status = 503, description = "The catalogue could not be read"),
    )
)]
pub async fn sitemap(State(st): State<AppState>) -> AppResult<Response> {
    let db = st.db.as_ref();
    let slugs: Vec<String> = brand::Entity::find()
        .filter(brand::Column::Status.eq("active"))
        .select_only()
        .column(brand::Column::Slug)
        .order_by_asc(brand::Column::Slug)
        .into_tuple()
        .all(db)
        .await
        .map_err(|e| AppError::ServiceUnavailable(format!("sitemap brands: {e}")))?;
    let pairs: Vec<(String, String)> = route::Entity::find()
        .filter(route::Column::Status.eq("active"))
        .select_only()
        .column(route::Column::StartLocationId)
        .column(route::Column::EndLocationId)
        .distinct()
        .into_tuple()
        .all(db)
        .await
        .map_err(|e| AppError::ServiceUnavailable(format!("sitemap routes: {e}")))?;

    // A route whose end has no known city name cannot be a corridor page.
    let corridors: BTreeSet<String> = pairs
        .iter()
        .filter_map(|(from, to)| {
            let from = crate::cities::find_by_slug(from)?;
            let to = crate::cities::find_by_slug(to)?;
            Some(corridor_canonical(from.name, to.name))
        })
        .collect();

    let urls = STATIC_PAGES
        .iter()
        .map(|(path, freq, priority)| (format!("{SITE_URL}{path}"), *freq, *priority))
        .chain(slugs.iter().map(|slug| (brand_url(slug), "weekly", "0.7")))
        .chain(corridors.into_iter().map(|url| (url, "daily", "0.8")));

    let lastmod = chrono::Utc::now().format("%Y-%m-%d");
    let mut xml = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n",
    );
    for (loc, changefreq, priority) in urls {
        xml.push_str(&format!(
            "  <url><loc>{}</loc><lastmod>{lastmod}</lastmod><changefreq>{changefreq}</changefreq><priority>{priority}</priority></url>\n",
            xml_escape(&loc)
        ));
    }
    xml.push_str("</urlset>\n");

    Ok((
        [
            (header::CONTENT_TYPE, "application/xml; charset=utf-8"),
            (header::CACHE_CONTROL, "public, max-age=3600"),
        ],
        xml,
    )
        .into_response())
}

/// `GET /robots.txt` — one rule group for every crawler; the sitemap pointer
/// follows the configured public origin.
#[utoipa::path(
    get,
    path = "/robots.txt",
    tag = "seo",
    responses(
        (status = 200, description = "Robots.txt", content_type = "text/plain"),
    )
)]
pub async fn robots(State(st): State<AppState>) -> AppResult<Response> {
    let configured = st
        .config
        .payment
        .public_base_url
        .trim()
        .trim_end_matches('/');
    let base = if configured.is_empty() {
        SITE_URL
    } else {
        configured
    };
    let body = format!(
        "# https://www.robotstxt.org/robotstxt.html\n\
         User-agent: *\n\
         Allow: /\n\
         Disallow: /api/\n\
         Disallow: /admin/\n\
         Disallow: /bookings/\n\
         Disallow: /payments/\n\
         Crawl-delay: 1\n\
         \n\
         Sitemap: {base}/sitemap.xml\n"
    );
    Ok((
        [
            (header::CONTENT_TYPE, "text/plain; charset=utf-8"),
            (header::CACHE_CONTROL, "public, max-age=3600"),
        ],
        body,
    )
        .into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn xml_text_is_escaped() {
        assert_eq!(xml_escape("a&b<c>\"d'"), "a&amp;b&lt;c&gt;&quot;d&apos;");
    }

    #[test]
    fn brand_slugs_are_encoded_as_one_path_segment() {
        assert_eq!(
            brand_url("phuong-trang"),
            "https://datxevui.com/brands/phuong-trang"
        );
        assert_eq!(
            brand_url("limousine/việt"),
            "https://datxevui.com/brands/limousine%2Fvi%E1%BB%87t"
        );
    }
}
