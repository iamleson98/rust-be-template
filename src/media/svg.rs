//! Safety check for SVG logos, which are stored as they were uploaded.
//!
//! An SVG is a document that can carry script. Stored SVGs are served
//! with a sandboxing `Content-Security-Policy` (see `routes/media.rs`),
//! which is the primary defence; this check is the second one: a file
//! that could run code, load something from elsewhere or expand
//! entities is refused instead of stored.

use std::sync::LazyLock;

use regex::Regex;

/// The document must start (after a BOM, an XML declaration and
/// comments) with an `<svg>` root element.
static ROOT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?s)\A\s*(?:<\?xml.*?\?>\s*|<!--.*?-->\s*)*<svg[\s/>]").expect("valid regex")
});

/// Entity and DOCTYPE declarations: entity expansion ("billion laughs")
/// and external entities.
static DECLARATION: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)<!\s*(?:doctype|entity)").expect("valid regex"));

/// Elements that execute code, embed another document or can rewrite
/// an attribute (`<set attributeName="href" to="javascript:…">`).
static ACTIVE_ELEMENT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)<\s*(?:[\w.-]+:)?(?:script|foreignobject|iframe|embed|object|audio|video|animate\w*|set|handler|listener)\b",
    )
    .expect("valid regex")
});

/// Event handler attributes (`onload=`, `onclick=`, …).
static EVENT_HANDLER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?i)[\s"'/]on[a-z]+\s*="#).expect("valid regex"));

/// `href` / `xlink:href` values.
static HREF: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')"#).expect("valid regex")
});

/// `url(…)` references in attributes and style sheets.
static URL_REF: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))"#).expect("valid regex")
});

/// Style sheet imports load a document from elsewhere.
static IMPORT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)@import").expect("valid regex"));

/// A reference that stays inside the document (`#id`) or carries its
/// own raster image (`data:image/…`).
fn is_local(reference: &str) -> bool {
    let r = reference.trim().to_ascii_lowercase();
    r.starts_with('#') || r.starts_with("data:image/")
}

/// `Ok(())` when `bytes` is a plain, self-contained SVG document;
/// otherwise the reason it was refused.
pub fn check(bytes: &[u8]) -> Result<(), &'static str> {
    let text = std::str::from_utf8(bytes).map_err(|_| "SVG must be UTF-8 text")?;
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    if !ROOT.is_match(text) {
        return Err("not an SVG document");
    }
    if DECLARATION.is_match(text) {
        return Err("SVG must not declare a DOCTYPE or entities");
    }
    if ACTIVE_ELEMENT.is_match(text) {
        return Err("SVG must not contain scripts, embedded documents or animations");
    }
    if EVENT_HANDLER.is_match(text) {
        return Err("SVG must not contain event handlers");
    }
    if IMPORT.is_match(text) {
        return Err("SVG must not import style sheets");
    }
    let outside = |caps: regex::Captures<'_>| {
        let value = caps
            .iter()
            .skip(1)
            .flatten()
            .next()
            .map_or("", |m| m.as_str());
        !is_local(value)
    };
    if HREF.captures_iter(text).any(outside) {
        return Err("SVG must not reference anything outside the document");
    }
    if URL_REF.captures_iter(text).any(outside) {
        return Err("SVG must not reference anything outside the document");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_logos_pass() {
        assert!(check(b"<svg xmlns='http://www.w3.org/2000/svg'/>").is_ok());
        let logo = "\u{feff}<?xml version=\"1.0\"?>\n<!-- logo -->\n<svg xmlns=\"http://www.w3.org/2000/svg\" \
            xmlns:xlink=\"http://www.w3.org/1999/xlink\" viewBox=\"0 0 10 10\">\
            <defs><linearGradient id=\"g\"><stop offset=\"0\"/></linearGradient>\
            <style>.a{fill:url(#g)}</style></defs>\
            <use xlink:href=\"#a\"/><image href=\"data:image/png;base64,AAAA\"/>\
            <text>Xe khách Hà Nội</text></svg>";
        assert_eq!(check(logo.as_bytes()), Ok(()));
    }

    #[test]
    fn code_and_external_references_are_refused() {
        for bad in [
            "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>",
            "<svg><SCRIPT>x</SCRIPT></svg>",
            "<svg><svg:script/></svg>",
            "<svg onload='alert(1)'/>",
            "<svg><rect\nonclick = 'x'/></svg>",
            "<svg><foreignObject><div/></foreignObject></svg>",
            "<svg><a href='javascript:alert(1)'><rect/></a></svg>",
            "<svg><a xlink:href=\"&#106;avascript:alert(1)\"><rect/></a></svg>",
            "<svg><image href='https://evil.example/x.png'/></svg>",
            "<svg><use href='https://evil.example/x.svg#a'/></svg>",
            "<svg><rect style='fill:url(https://evil.example/x)'/></svg>",
            "<svg><style>@import 'https://evil.example/x.css';</style></svg>",
            "<svg><set attributeName='href' to='javascript:alert(1)'/></svg>",
            "<svg><animate attributeName='href'/></svg>",
            "<!DOCTYPE svg [<!ENTITY a 'aaaa'>]><svg>&a;</svg>",
            "<html><body><svg/></body></html>",
            "plain text",
        ] {
            assert!(check(bad.as_bytes()).is_err(), "accepted: {bad}");
        }
        assert!(check(&[0xFF, 0xFE, b'<']).is_err());
    }
}
