//! Input validators shared by the admin endpoints.

/// Vietnamese-aware slugify: strips diacritics, lowercases, replaces
/// non-alphanumeric runs with a single `-`.
pub fn slugify(input: &str) -> String {
    fn strip_diacritic(c: char) -> char {
        match c {
            'á' | 'à' | 'ả' | 'ã' | 'ạ' | 'â' | 'ầ' | 'ẩ' | 'ẫ' | 'ậ' | 'ấ' | 'ă' | 'ằ' | 'ẳ'
            | 'ẵ' | 'ặ' => 'a',
            'Á' | 'À' | 'Ả' | 'Ã' | 'Ạ' | 'Â' | 'Ầ' | 'Ẩ' | 'Ẫ' | 'Ậ' | 'Ấ' | 'Ă' | 'Ằ' | 'Ẳ'
            | 'Ẵ' | 'Ặ' => 'a',
            'é' | 'è' | 'ẻ' | 'ẽ' | 'ẹ' | 'ê' | 'ề' | 'ể' | 'ễ' | 'ệ' | 'ế' => {
                'e'
            }
            'É' | 'È' | 'Ẻ' | 'Ẽ' | 'Ẹ' | 'Ê' | 'Ề' | 'Ể' | 'Ễ' | 'Ệ' | 'Ế' => {
                'e'
            }
            'í' | 'ì' | 'ỉ' | 'ĩ' | 'ị' => 'i',
            'Í' | 'Ì' | 'Ỉ' | 'Ĩ' | 'Ị' => 'i',
            'ó' | 'ò' | 'ỏ' | 'õ' | 'ọ' | 'ô' | 'ồ' | 'ổ' | 'ỗ' | 'ộ' | 'ố' | 'ơ' | 'ờ' | 'ở'
            | 'ỡ' | 'ợ' | 'ớ' => 'o',
            'Ó' | 'Ò' | 'Ỏ' | 'Õ' | 'Ọ' | 'Ô' | 'Ồ' | 'Ổ' | 'Ỗ' | 'Ộ' | 'Ố' | 'Ơ' | 'Ờ' | 'Ở'
            | 'Ỡ' | 'Ợ' | 'Ớ' => 'o',
            'ú' | 'ù' | 'ủ' | 'ũ' | 'ụ' | 'ư' | 'ừ' | 'ử' | 'ữ' | 'ự' | 'ứ' => {
                'u'
            }
            'Ú' | 'Ù' | 'Ủ' | 'Ũ' | 'Ụ' | 'Ư' | 'Ừ' | 'Ử' | 'Ữ' | 'Ự' | 'Ứ' => {
                'u'
            }
            'ý' | 'ỳ' | 'ỷ' | 'ỹ' | 'ỵ' => 'y',
            'Ý' | 'Ỳ' | 'Ỷ' | 'Ỹ' | 'Ỵ' => 'y',
            'đ' => 'd',
            'Đ' => 'd',
            _ => c,
        }
    }
    let s: String = input.chars().map(strip_diacritic).collect();
    let s = s.to_lowercase();
    let mut out = String::with_capacity(s.len());
    let mut prev_dash = true; // suppress leading dashes
    for c in s.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    out
}

/// `#RRGGBB` hex color validator.
pub(super) fn valid_hex_color(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s.as_bytes()[1..7].iter().all(|b| b.is_ascii_hexdigit())
}

/// Validate a slug (lowercase alphanumeric + dashes).
pub(super) fn valid_slug(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && !s.starts_with('-')
        && !s.ends_with('-')
}

/// `HH:MM` time validator (00:00 – 23:59).
pub(super) fn regex_like_hhmm(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 5
        && b[0].is_ascii_digit()
        && b[1].is_ascii_digit()
        && b[2] == b':'
        && b[3].is_ascii_digit()
        && b[4].is_ascii_digit()
        && (b[0] - b'0') * 10 + (b[1] - b'0') <= 23
        && (b[3] - b'0') * 10 + (b[4] - b'0') <= 59
}

/// 7-char `0`/`1` days-of-week bitmask validator.
pub(super) fn is_days_of_week(s: &str) -> bool {
    s.len() == 7 && s.bytes().all(|c| c == b'0' || c == b'1')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugify_ascii_lowercases() {
        assert_eq!(slugify("Hello World"), "hello-world");
    }
    #[test]
    fn slugify_strips_vietnamese_diacritics() {
        assert_eq!(slugify("Hà Nội"), "ha-noi");
        assert_eq!(slugify("Đà Nẵng"), "da-nang");
    }

    #[test]
    fn slugify_strips_double_diacritic_vowels() {
        // Regression: ấ ế ố ớ ứ were missing from the strip table, so
        // "Đất" slugified to "d-t" (the vowel vanished entirely).
        assert_eq!(slugify("Anh Huy Đất Cảng"), "anh-huy-dat-cang");
        assert_eq!(slugify("Bến Dầu"), "ben-dau");
        assert_eq!(slugify("Kết Đoàn"), "ket-doan");
        assert_eq!(slugify("Xuân Tứ"), "xuan-tu");
        assert_eq!(slugify("Cửa Việt"), "cua-viet");
    }
    #[test]
    fn slugify_trims_trailing_dashes() {
        assert_eq!(slugify("hello!!!"), "hello");
    }

    #[test]
    fn valid_hex_color_accepts_6_digit() {
        assert!(valid_hex_color("#1a2b3c"));
        assert!(valid_hex_color("#FFFFFF"));
    }
    #[test]
    fn valid_hex_color_rejects_short() {
        assert!(!valid_hex_color("#fff"));
        assert!(!valid_hex_color("1a2b3c"));
        assert!(!valid_hex_color("#gggggg"));
    }

    #[test]
    fn valid_slug_accepts_simple() {
        assert!(valid_slug("phuong-trang"));
        assert!(valid_slug("abc123"));
    }
    #[test]
    fn valid_slug_rejects_edge_cases() {
        assert!(!valid_slug(""));
        assert!(!valid_slug("-leading"));
        assert!(!valid_slug("trailing-"));
        assert!(!valid_slug("Upper"));
    }

    #[test]
    fn regex_like_hhmm_accepts_valid() {
        assert!(regex_like_hhmm("00:00"));
        assert!(regex_like_hhmm("08:30"));
        assert!(regex_like_hhmm("23:59"));
    }
    #[test]
    fn regex_like_hhmm_rejects_invalid() {
        assert!(!regex_like_hhmm("24:00"));
        assert!(!regex_like_hhmm("12:60"));
        assert!(!regex_like_hhmm("abc"));
        assert!(!regex_like_hhmm("1:30"));
    }

    #[test]
    fn is_days_of_week_accepts_7_chars() {
        assert!(is_days_of_week("1111111"));
        assert!(is_days_of_week("1010101"));
    }
    #[test]
    fn is_days_of_week_rejects_other_lengths() {
        assert!(!is_days_of_week("111111"));
        assert!(!is_days_of_week("11111111"));
        assert!(!is_days_of_week("2020111"));
    }
}
