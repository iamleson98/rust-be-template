//! Tantivy schema definition + custom tokenizers.
//!
//! Schema design notes
//! -------------------
//! We store *both* the original Vietnamese text and a pre-normalized ASCII
//! version so that:
//!
//! - Search for "Hà Nội" (original diacritics) hits the `name` field.
//! - Search for "hanoi", "Ha Noi", "Hà noi" all hit the `name_ascii` /
//!   `name_ascii_ngram` / `name_compact` fields (already pre-normalized at
//!   index time, so the analyzer is just `LowerCaser`).
//! - Prefix matching ("ha no" -> "Ha Noi") uses an n-gram tokenizer on
//!   `name_ascii_ngram`.
//! - Compact single-token "hanoi" form (no spaces) is indexed separately
//!   so a one-word query matches even if the original name is two words.
//!
//! Hierarchy fields (`ward`, `district`, `city`, `province`) are also
//! pre-normalized, so a query "le loi ha noi" can match a street named
//! "Lê Lợi" whose `city` field is "ha noi" (normalized from "Hà Nội").

use once_cell::sync::Lazy;
use tantivy::schema::{Field, NumericOptions, Schema, SchemaBuilder, TextOptions};
use tantivy::tokenizer::{
    AsciiFoldingFilter, LowerCaser, NgramTokenizer, RemoveLongFilter, SimpleTokenizer, TextAnalyzer,
};

// -----------------------------------------------------------------------
// Field option builders
// -----------------------------------------------------------------------

/// Text options for a stored + indexed field using the default lowercased
/// ASCII-folding tokenizer. Used for fields whose source data is already
/// pre-normalized via [`crate::vn_text::normalize`].
pub fn stored_indexed_text() -> TextOptions {
    TextOptions::default()
        .set_indexing_options(
            tantivy::schema::TextFieldIndexing::default()
                .set_tokenizer("lowercase_ascii")
                .set_index_option(tantivy::schema::IndexRecordOption::WithFreqsAndPositions),
        )
        .set_stored()
}

/// Stored-only text (not indexed). Useful for the original Vietnamese name
/// (we still want to retrieve it for display, but actual matching happens
/// on the normalized field).
pub fn stored_text() -> TextOptions {
    TextOptions::default().set_stored()
}

/// Indexed with n-gram tokenizer (2-3 chars) for prefix / fuzzy matching.
/// NOT stored (we don't need to retrieve n-grams).
pub fn ngram_text() -> TextOptions {
    TextOptions::default().set_indexing_options(
        tantivy::schema::TextFieldIndexing::default()
            .set_tokenizer("ngram_2_3")
            .set_index_option(tantivy::schema::IndexRecordOption::WithFreqsAndPositions),
    )
}

/// Indexed as a single token (no splitting). Used for `name_compact`
/// ("hanoi" form) and for `osm_type` / `place_kind` enums.
///
/// Uses `WithFreqsAndPositions` (not `Basic`) because Tantivy's
/// `QueryParser::set_conjunction_by_default` requires positions on every
/// searched field.
pub fn keyword_text() -> TextOptions {
    TextOptions::default()
        .set_indexing_options(
            tantivy::schema::TextFieldIndexing::default()
                .set_tokenizer("raw")
                .set_index_option(tantivy::schema::IndexRecordOption::WithFreqsAndPositions),
        )
        .set_stored()
}

pub fn i64_stored_indexed() -> NumericOptions {
    NumericOptions::default()
        .set_indexed()
        .set_stored()
        .set_fast()
}

pub fn i64_stored() -> NumericOptions {
    NumericOptions::default().set_stored()
}

pub fn f64_stored() -> NumericOptions {
    NumericOptions::default().set_stored()
}

/// f64 indexed (for range queries — reverse geocoding bounding boxes)
/// + stored (for retrieval).
pub fn f64_stored_indexed() -> NumericOptions {
    NumericOptions::default().set_stored().set_indexed()
}

// -----------------------------------------------------------------------
// Schema struct
// -----------------------------------------------------------------------

/// Container of all field handles so the rest of the code can reference
/// fields by name without re-resolving them.
#[derive(Clone)]
pub struct PlaceSchema {
    pub schema: Schema,

    pub id: Field,          // OSM id
    pub osm_type: Field,    // "node" | "way" | "relation"
    pub place_kind: Field,  // "city" | "district" | "ward" | "street" | "poi" | ...
    pub admin_level: Field, // OSM admin_level if present (0 otherwise)

    pub name: Field,             // original Vietnamese, stored only (for display)
    pub name_ascii: Field,       // normalized diacritic-stripped, indexed+stored
    pub name_ascii_ngram: Field, // n-grams of normalized name, indexed
    pub name_compact: Field,     // "hanoi" form, single-token indexed+stored
    pub house_number: Field,     // addr:housenumber (e.g. "123"), indexed+stored

    // Hierarchy (each normalized to ASCII lowercase)
    pub ward: Field,     // phường / xã
    pub district: Field, // quận / huyện / thị trấn
    pub city: Field,     // thành phố
    pub province: Field, // tỉnh / thành phố trực thuộc TW

    pub lat: Field,
    pub lon: Field,
    pub tags_json: Field, // all OSM tags JSON-encoded (for debugging / extra fields)
}

/// Build the schema, returning a `PlaceSchema` with all field handles.
pub fn build_schema() -> PlaceSchema {
    let mut b = SchemaBuilder::new();

    let id = b.add_i64_field("id", i64_stored_indexed());
    let osm_type = b.add_text_field("osm_type", keyword_text());
    let place_kind = b.add_text_field("place_kind", keyword_text());
    let admin_level = b.add_i64_field("admin_level", i64_stored());

    let name = b.add_text_field("name", stored_text());
    let name_ascii = b.add_text_field("name_ascii", stored_indexed_text());
    let name_ascii_ngram = b.add_text_field("name_ascii_ngram", ngram_text());
    let name_compact = b.add_text_field("name_compact", keyword_text());
    let house_number = b.add_text_field("house_number", keyword_text());

    let ward = b.add_text_field("ward", stored_indexed_text());
    let district = b.add_text_field("district", stored_indexed_text());
    let city = b.add_text_field("city", stored_indexed_text());
    let province = b.add_text_field("province", stored_indexed_text());

    // Indexed (not just stored) so reverse geocoding can run lat/lon
    // bounding-box range queries.
    let lat = b.add_f64_field("lat", f64_stored_indexed());
    let lon = b.add_f64_field("lon", f64_stored_indexed());

    let tags_json = b.add_text_field("tags_json", stored_text());

    let schema = b.build();

    PlaceSchema {
        schema,
        id,
        osm_type,
        place_kind,
        admin_level,
        name,
        name_ascii,
        name_ascii_ngram,
        name_compact,
        house_number,
        ward,
        district,
        city,
        province,
        lat,
        lon,
        tags_json,
    }
}

// -----------------------------------------------------------------------
// Tokenizers
// -----------------------------------------------------------------------

/// Custom tokenizers registered on every index opened/created by this binary.
///
/// - `lowercase_ascii`: simple tokenizer + lowercase + ASCII folding.
///   Used on already-normalized text; ASCII folding is a safety net for
///   any diacritics that slipped through.
/// - `ngram_3_5`: 3..5-gram tokenizer + lowercase. Used for prefix search.
/// - `raw`: passes the input through as a single token (no splitting).
pub fn register_tokenizers(index: &tantivy::Index) {
    let lowercase_ascii: TextAnalyzer = TextAnalyzer::builder(SimpleTokenizer::default())
        .filter(LowerCaser)
        .filter(AsciiFoldingFilter)
        .filter(RemoveLongFilter::limit(40))
        .build();

    // NgramTokenizer::new returns Result (validates min_gram <= max_gram, min_gram > 0).
    //
    // We use sliding 2..3-grams (prefix_only=false). This generates ALL 2-3
    // character substrings of the input, including across word boundaries.
    //
    // Why not prefix_only=true (edge n-grams)?
    //   With prefix_only=true, the tokenizer only generates n-grams starting
    //   at position 0 of the WHOLE input. For a multi-word field value like
    //   "ha noi", it would generate "ha", "ha ", "ha n", "ha no", "ha noi" —
    //   but NOT "no" or "noi" (since those don't start at position 0).
    //   This means a query for "noi" (the second word) would NOT match,
    //   breaking multi-word search.
    //
    //   The QueryParser tokenizes each query WORD separately with the field's
    //   analyzer, so "ha no" becomes two lookups: "ha" → "ha" and "no" → "no".
    //   With prefix_only=true, the index has "ha" but not "no", so the
    //   conjunction fails.
    //
    // Tradeoff: sliding n-grams are noisier (tokens like "a ", " n" match
    // broadly) but correctly handle multi-word queries. The noise is mitigated
    // by the low field boost (0.3) in the searcher.
    //
    // If you only need single-word prefix matching and want less noise, switch
    // to NgramTokenizer::new(2, 5, true) and accept that multi-word queries
    // won't use the n-gram field.
    let ngram_2_3: TextAnalyzer = TextAnalyzer::builder(
        NgramTokenizer::new(2, 3, false).expect("invalid ngram tokenizer params"),
    )
    .filter(LowerCaser)
    .filter(RemoveLongFilter::limit(40))
    .build();

    let raw: TextAnalyzer = TextAnalyzer::builder(SimpleTokenizer::default())
        .filter(LowerCaser)
        .build();

    index
        .tokenizers()
        .register("lowercase_ascii", lowercase_ascii);
    index.tokenizers().register("ngram_2_3", ngram_2_3);
    index.tokenizers().register("raw", raw);
}

/// Static schema instance used across the binary. (Keeps schema definitions
/// consistent between indexer and searcher.)
pub static SCHEMA: Lazy<PlaceSchema> = Lazy::new(build_schema);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_builds_with_all_fields() {
        let s = build_schema();
        assert_eq!(s.schema.num_fields(), 16);
        // Field names are reachable
        let names: Vec<&str> = s.schema.fields().map(|(_, entry)| entry.name()).collect();
        for must in [
            "id",
            "osm_type",
            "place_kind",
            "admin_level",
            "name",
            "name_ascii",
            "name_ascii_ngram",
            "name_compact",
            "house_number",
            "ward",
            "district",
            "city",
            "province",
            "lat",
            "lon",
            "tags_json",
        ] {
            assert!(names.contains(&must), "missing field: {}", must);
        }
    }
}
