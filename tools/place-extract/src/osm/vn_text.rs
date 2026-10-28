//! Vietnamese text normalization and query expansion.
//!
//! ## Diacritic stripping
//!
//! Uses the [`deunicode`](https://crates.io/crates/deunicode) crate — a premade,
//! well-maintained Unicode→ASCII transliteration table — instead of a hand-rolled
//! NFD decomposition. `deunicode` correctly handles Vietnamese-specific characters
//! like `đ → d`, `ơ → o`, `ư → u`, `ạ → a`, etc.
//!
//! ## Synonym expansion
//!
//! Common Vietnamese administrative abbreviations are expanded *before*
//! normalization so that `"P. Cầu Giấy"`, `"Q. 1"`, `"TP. HCM"` all resolve
//! to their full forms.

use once_cell::sync::Lazy;
use regex::Regex;

/// Strip Vietnamese diacritics and lowercase.
///
/// | Input           | Output          |
/// |-----------------|-----------------|
/// | `Hà Nội`        | `ha noi`        |
/// | `Nguyễn Trãi`   | `nguyen trai`   |
/// | `Đường Lê Lợi`  | `duong le loi`  |
/// | `Hồ Chí Minh`   | `ho chi minh`   |
pub fn normalize(input: &str) -> String {
    deunicode::deunicode(input).to_lowercase()
}

/// Compact form: same as [`normalize`] but with all non-alphanumerics removed.
/// `Hà Nội → hanoi`, `Nguyễn-Trãi → nguyentrai`.
pub fn compact(input: &str) -> String {
    normalize(input)
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect()
}

/// Split a string into normalized alphanumeric tokens.
pub fn tokens(input: &str) -> Vec<String> {
    normalize(input)
        .split(|c: char| !c.is_alphanumeric())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect()
}

// -----------------------------------------------------------------------
// Synonym / abbreviation expansion
// -----------------------------------------------------------------------

/// Compiled regexes for common Vietnamese administrative abbreviations.
/// Word boundaries (`\b`) prevent false matches inside longer words.
static RE_P: Lazy<Regex> = Lazy::new(|| Regex::new(r"\bP\.\s*").unwrap());
static RE_Q: Lazy<Regex> = Lazy::new(|| Regex::new(r"\bQ\.\s*").unwrap());
static RE_TP: Lazy<Regex> = Lazy::new(|| Regex::new(r"\bTP\.\s*").unwrap());
static RE_TX: Lazy<Regex> = Lazy::new(|| Regex::new(r"\bTX\.\s*").unwrap());
static RE_TT: Lazy<Regex> = Lazy::new(|| Regex::new(r"\bTT\.\s*").unwrap());
static RE_X: Lazy<Regex> = Lazy::new(|| Regex::new(r"\bX\.\s*").unwrap());
static RE_D: Lazy<Regex> = Lazy::new(|| Regex::new(r"\bD\.\s*").unwrap());
static RE_ST: Lazy<Regex> = Lazy::new(|| Regex::new(r"\bSt\.\s*").unwrap());
static RE_DD: Lazy<Regex> = Lazy::new(|| Regex::new(r"\bĐ\.\s*").unwrap());

/// Expand common Vietnamese administrative abbreviations to their full forms.
///
/// Applied **before** [`normalize`] so that the expansion result is also
/// diacritic-stripped. This means `"P. Cầu Giấy"` → `"Phường Cầu Giấy"` →
/// (after normalize) `"phuong cau giay"`, which matches indexed text that was
/// stored as `"Phường Cầu Giấy"`.
///
/// | Input                | Output                  |
/// |----------------------|-------------------------|
/// | `P. Cầu Giấy`        | `Phường Cầu Giấy`       |
/// | `Q. 1`               | `Quận 1`                |
/// | `TP. HCM`            | `Thành phố HCM`         |
/// | `TX. Gia Nghĩa`      | `Thị xã Gia Nghĩa`      |
/// | `TT. Châu Thành`     | `Thị trấn Châu Thành`   |
/// | `X. Tân Bình`        | `Xã Tân Bình`           |
/// | `D. Lê Lợi`          | `Đường Lê Lợi`          |
/// | `St. Lê Lợi`         | `Đường Lê Lợi`          |
pub fn expand_synonyms(input: &str) -> String {
    let s = RE_P.replace_all(input, "Phường ");
    let s = RE_Q.replace_all(&s, "Quận ");
    let s = RE_TP.replace_all(&s, "Thành phố ");
    let s = RE_TX.replace_all(&s, "Thị xã ");
    let s = RE_TT.replace_all(&s, "Thị trấn ");
    let s = RE_X.replace_all(&s, "Xã ");
    let s = RE_D.replace_all(&s, "Đường ");
    let s = RE_ST.replace_all(&s, "Đường ");
    let s = RE_DD.replace_all(&s, "Đường ");
    s.into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_diacritics() {
        assert_eq!(normalize("Hà Nội"), "ha noi");
        assert_eq!(normalize("Nguyễn Trãi"), "nguyen trai");
        assert_eq!(normalize("Đường Lê Lợi"), "duong le loi");
        assert_eq!(normalize("Hồ Chí Minh"), "ho chi minh");
        assert_eq!(normalize("Quận Hai Bà Trưng"), "quan hai ba trung");
        assert_eq!(normalize("Phường Cầu Giấy"), "phuong cau giay");
    }

    #[test]
    fn compact_drops_spaces_and_punct() {
        assert_eq!(compact("Hà Nội"), "hanoi");
        assert_eq!(compact("Nguyễn-Trãi"), "nguyentrai");
    }

    #[test]
    fn preserves_ascii_text() {
        assert_eq!(normalize("Hanoi"), "hanoi");
        assert_eq!(normalize("123 Le Loi"), "123 le loi");
    }

    #[test]
    fn tokenizes() {
        assert_eq!(
            tokens("123 Lê Lợi, Hà Nội"),
            vec!["123", "le", "loi", "ha", "noi"]
        );
    }

    #[test]
    fn expands_abbreviations() {
        assert_eq!(expand_synonyms("P. Cầu Giấy"), "Phường Cầu Giấy");
        assert_eq!(expand_synonyms("Q. 1"), "Quận 1");
        assert_eq!(expand_synonyms("TP. HCM"), "Thành phố HCM");
        assert_eq!(expand_synonyms("TX. Gia Nghĩa"), "Thị xã Gia Nghĩa");
        assert_eq!(expand_synonyms("TT. Châu Thành"), "Thị trấn Châu Thành");
        assert_eq!(expand_synonyms("X. Tân Bình"), "Xã Tân Bình");
        assert_eq!(expand_synonyms("D. Lê Lợi"), "Đường Lê Lợi");
        assert_eq!(expand_synonyms("St. Lê Lợi"), "Đường Lê Lợi");
        // No false match inside words
        assert_eq!(expand_synonyms("AP. something"), "AP. something");
    }

    #[test]
    fn expand_then_normalize() {
        // Full pipeline: "P. Cầu Giấy" → "Phường Cầu Giấy" → "phuong cau giay"
        let expanded = expand_synonyms("P. Cầu Giấy");
        let normalized = normalize(&expanded);
        assert_eq!(normalized, "phuong cau giay");
    }
}
