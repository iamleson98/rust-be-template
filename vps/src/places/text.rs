//! Text folding shared by the index (build time) and the query (search time):
//! an index built with one normaliser and queried with another silently
//! returns nothing, so both sides call these and nothing else.

use unicode_normalization::UnicodeNormalization;

pub use place_extract::osm::vn_text::expand_synonyms as expand_abbreviations;
pub use place_extract::prepare::fold;

/// Alphanumeric tokens of the folded text ("Hà Nội, Q.1" → `ha noi q 1`).
pub fn tokens(s: &str) -> Vec<String> {
    fold(&s.nfc().collect::<String>())
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(str::to_string)
        .collect()
}

/// Lower-case words WITH their tones ("Hạ Long" → `hạ long`). Input is
/// NFC-composed first: some keyboards send "a" + a combining accent.
pub fn toned_tokens(s: &str) -> Vec<String> {
    let composed: String = s.nfc().collect::<String>().to_lowercase();
    composed
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(str::to_string)
        .collect()
}

/// Does the word carry Vietnamese tone or vowel marks?
pub fn has_marks(word: &str) -> bool {
    !word.is_ascii()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folds_tones_case_and_punctuation() {
        assert_eq!(tokens("Hà Nội, Q.1"), ["ha", "noi", "q", "1"]);
        assert_eq!(tokens("ĐƯỜNG Lê Lợi"), ["duong", "le", "loi"]);
        assert_eq!(tokens("  ?! "), Vec::<String>::new());
    }

    #[test]
    fn decomposed_input_folds_like_composed_input() {
        let decomposed = "Ha\u{0300} No\u{0302}\u{0323}i";
        assert_eq!(tokens(decomposed), ["ha", "noi"]);
        assert_eq!(toned_tokens(decomposed), ["hà", "nội"]);
    }

    #[test]
    fn keeps_tones_when_asked() {
        assert_eq!(toned_tokens("Hạ Long"), ["hạ", "long"]);
        assert!(has_marks("hạ"));
        assert!(!has_marks("ha"));
    }
}
