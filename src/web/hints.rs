//! `Link: rel=preload` headers for a page, so the edge can answer with a
//! `103 Early Hints` while the origin is still working: the browser starts on
//! the entry script, the stylesheet, the fonts and the hero photo before the
//! HTML arrives.
//!
//! What to hint is read from the built shell (the entry script and stylesheet
//! carry content hashes; the fonts are `rel=preload` links the template
//! already declares), plus the hero photo of the home page.

use super::head::{HERO_BREAKPOINT_PX, HERO_DESKTOP, HERO_MOBILE};

/// The value of `name` in an HTML start tag (`<link a="b" />`), if it has one.
fn attribute<'a>(tag: &'a str, name: &str) -> Option<&'a str> {
    let key = format!(" {name}=\"");
    let from = tag.find(&key)? + key.len();
    let len = tag[from..].find('"')?;
    Some(&tag[from..from + len])
}

/// Whether `tag` carries the bare attribute `name` (`crossorigin`).
fn has_flag(tag: &str, name: &str) -> bool {
    tag.split_whitespace()
        .any(|word| word == name || word.starts_with(&format!("{name}=")))
}

/// The start tags `<tag ...>` of a document, in order.
fn start_tags<'a>(html: &'a str, tag: &str) -> Vec<&'a str> {
    let open = format!("<{tag} ");
    html.match_indices(&open)
        .filter_map(|(at, _)| {
            let rest = &html[at..];
            rest.find('>').map(|end| &rest[..=end])
        })
        .collect()
}

/// A local path only: a hint must never point off this origin.
fn local(href: &str) -> bool {
    href.starts_with('/') && !href.starts_with("//")
}

/// One `Link` header value.
fn header(href: &str, params: &[(&str, &str)], crossorigin: bool) -> String {
    let mut value = format!("<{href}>; rel=preload");
    for (name, content) in params {
        value.push_str(&format!("; {name}=\"{content}\""));
    }
    if crossorigin {
        value.push_str("; crossorigin");
    }
    value
}

/// The `Link` header values for a page built on `shell`. `home` adds the hero
/// photo.
pub fn links(shell: &str, home: bool) -> Vec<String> {
    let mut out = Vec::new();
    for tag in start_tags(shell, "script") {
        let entry = attribute(tag, "src").filter(|src| local(src) && src.starts_with("/assets/"));
        if let (Some(src), true) = (entry, tag.contains("type=\"module\"")) {
            out.push(header(src, &[("as", "script")], true));
        }
    }
    for tag in start_tags(shell, "link") {
        let Some(href) = attribute(tag, "href").filter(|href| local(href)) else {
            continue;
        };
        match attribute(tag, "rel") {
            Some("stylesheet") if href.starts_with("/assets/") => {
                out.push(header(
                    href,
                    &[("as", "style")],
                    has_flag(tag, "crossorigin"),
                ));
            }
            Some("preload") => {
                let mut params = Vec::new();
                for name in ["as", "type"] {
                    if let Some(value) = attribute(tag, name) {
                        params.push((name, value));
                    }
                }
                out.push(header(href, &params, has_flag(tag, "crossorigin")));
            }
            _ => {}
        }
    }
    if home {
        let wide = format!("(min-width: {}px)", HERO_BREAKPOINT_PX + 1);
        let narrow = format!("(max-width: {HERO_BREAKPOINT_PX}px)");
        for (href, media) in [(HERO_DESKTOP, &wide), (HERO_MOBILE, &narrow)] {
            out.push(header(
                href,
                &[("as", "image"), ("type", "image/avif"), ("media", media)],
                false,
            ));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const SHELL: &str = r#"<head>
<link rel="icon" href="/favicon.ico" />
<link rel="preload" href="/fonts/geist-latin.woff2" as="font" type="font/woff2" crossorigin />
<link rel="stylesheet" href="https://cdn.example/x.css" />
<script async src="https://www.googletagmanager.com/gtag/js?id=G-1"></script>
<script type="module" crossorigin src="/assets/index-abc.js"></script>
<link rel="modulepreload" crossorigin href="/assets/vendor-react-abc.js">
<link rel="stylesheet" crossorigin href="/assets/index-abc.css">
</head>"#;

    #[test]
    fn the_entry_script_stylesheet_and_declared_preloads_are_hinted() {
        let links = links(SHELL, false);
        assert_eq!(
            links,
            [
                "</assets/index-abc.js>; rel=preload; as=\"script\"; crossorigin",
                "</fonts/geist-latin.woff2>; rel=preload; as=\"font\"; type=\"font/woff2\"; crossorigin",
                "</assets/index-abc.css>; rel=preload; as=\"style\"; crossorigin",
            ]
        );
    }

    #[test]
    fn only_this_origins_files_are_hinted() {
        let shell = r#"<script type="module" src="//evil.example/assets/x.js"></script>
<link rel="preload" href="https://evil.example/a.woff2" as="font" />"#;
        assert!(links(shell, false).is_empty());
    }

    #[test]
    fn the_home_page_adds_its_hero_photo_per_screen() {
        let links = links("<head></head>", true);
        assert_eq!(links.len(), 2);
        assert!(links[0].starts_with("</hero-vietnam-bus.avif>; rel=preload; as=\"image\""));
        assert!(links[0].contains("media=\"(min-width: 641px)\""));
        assert!(links[1].starts_with("</hero-vietnam-bus-mobile.avif>"));
        assert!(links[1].contains("media=\"(max-width: 640px)\""));
    }
}
