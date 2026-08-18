//! SEO routes — `/sitemap.xml` + `/robots.txt`.

use axum::extract::State;
use axum::http::header;
use axum::response::{IntoResponse, Response};

use crate::error::AppResult;
use crate::state::AppState;

const SITEMAP_MAX_URLS: usize = 5000;

/// `GET /sitemap.xml` — list the public routes for SEO crawlers.
#[utoipa::path(
    get,
    path = "/sitemap.xml",
    tag = "seo",
    responses(
        (status = 200, description = "Sitemap XML", content_type = "application/xml"),
    )
)]
pub async fn sitemap(State(st): State<AppState>) -> AppResult<Response> {
    let base = public_base_url(&st);
    let now = chrono::Utc::now().format("%Y-%m-%d").to_string();

    let static_routes = [
        ("/", "1.0", "daily"),
        ("/search", "0.9", "daily"),
        ("/bookings", "0.5", "weekly"),
        ("/map", "0.6", "weekly"),
        ("/compare", "0.4", "weekly"),
        ("/login", "0.3", "monthly"),
    ];

    let mut xml = String::with_capacity(2048);
    xml.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    xml.push_str("<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n");

    for (path, prio, freq) in static_routes.iter().take(SITEMAP_MAX_URLS) {
        xml.push_str("  <url>\n");
        xml.push_str(&format!("    <loc>{}{}</loc>\n", base, path));
        xml.push_str(&format!("    <lastmod>{}</lastmod>\n", now));
        xml.push_str(&format!("    <changefreq>{}</changefreq>\n", freq));
        xml.push_str(&format!("    <priority>{}</priority>\n", prio));
        xml.push_str("  </url>\n");
    }

    xml.push_str("</urlset>\n");

    let mut resp = xml.into_response();
    resp.headers_mut().insert(
        header::CONTENT_TYPE,
        header::HeaderValue::from_static("application/xml; charset=utf-8"),
    );
    resp.headers_mut().insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("public, max-age=3600"),
    );
    Ok(resp)
}

/// `GET /robots.txt` — dynamic robots.txt that points to the sitemap.
#[utoipa::path(
    get,
    path = "/robots.txt",
    tag = "seo",
    responses(
        (status = 200, description = "Robots.txt", content_type = "text/plain"),
    )
)]
pub async fn robots(State(st): State<AppState>) -> AppResult<Response> {
    let base = public_base_url(&st);
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
         Sitemap: {}/sitemap.xml\n",
        base
    );

    let mut resp = body.into_response();
    resp.headers_mut().insert(
        header::CONTENT_TYPE,
        header::HeaderValue::from_static("text/plain; charset=utf-8"),
    );
    resp.headers_mut().insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("public, max-age=3600"),
    );
    Ok(resp)
}

fn public_base_url(st: &AppState) -> String {
    let url = st.config.payment.public_base_url.trim_end_matches('/');
    if url.is_empty() {
        "https://vexevn.vn".to_string()
    } else {
        url.to_string()
    }
}
