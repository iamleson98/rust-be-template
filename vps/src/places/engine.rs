//! The in-memory place index and its ranking.
//!
//! Built from the prepared records in seconds and swapped in whole when a new
//! index is ready (see `crate::indexer`), so there is no on-disk index format
//! to migrate or corrupt.
//!
//! Layout
//! - Places are numbered by descending static importance (kind, population),
//!   so every posting list is also a ranking: its first K entries are its K
//!   most important places, and candidate generation can stop early without
//!   losing the places people most likely mean.
//! - Terms live in an FST: folded words, words run together ("hanoi",
//!   "benxemydinh") and short forms ("hcm", "bx", "q1"). It answers exact,
//!   prefix and typo-tolerant (Levenshtein) lookups.
//! - Each place keeps its spans (term, field, word position), so ranking sees
//!   which field a word matched, how much of the name the query covers and
//!   whether the words came in the name's order.

use std::collections::HashMap;

use fst::automaton::{Levenshtein, Str};
use fst::{Automaton, IntoStreamer, Map, MapBuilder, Streamer};
use place_extract::prepare::{is_area, kind_priority};
use place_extract::PlaceRecord;
use serde::Serialize;

use super::lexicon::{self, ADMIN_PHRASES, NUMBERED, SHORT_FORMS, TYPE_PHRASES};
use super::text;

const MAX_QUERY_WORDS: usize = 8;
const MAX_QUERY_CHARS: usize = 200;
/// Words indexed per name / alt name / context part (coverage is a u64 bitset).
const MAX_GROUP_WORDS: usize = 24;
const MAX_ALT_NAMES: usize = 4;
/// Places scored per query. Taken in importance order, so a common word
/// ("nguyen") is scored over its most important places, never all of them.
const MAX_CANDIDATES: usize = 20_000;
/// Candidate sets are intersected word by word until they are this small;
/// the rest of the words are checked while scoring.
const SMALL_CANDIDATE_SET: usize = 2_000;
/// A word's place set is only materialised when that is cheaper than
/// checking it on every remaining candidate.
const INTERSECT_RATIO: usize = 20;
/// Places that get the second, more expensive scoring pass.
const RERANK: usize = 200;
/// One- and two-letter prefixes are answered from precomputed top lists.
const SHORT_PREFIX: usize = 2;
const SHORT_PREFIX_TOP: usize = 4_000;
/// Term sets up to this size are searched in place; bigger ones get a lookup table.
const SMALL_MATCH_SET: usize = 64;
const POPULAR_LIMIT: usize = 200;
/// A lesser element (building, platform, shop) this close to a better result
/// of the same name is the same place to a user.
const SAME_PLACE_KM: f64 = 2.0;
/// Kinds at or below this weight are "lesser elements" (see [`lexicon::kind_weight`]).
const MINOR_KIND: f32 = 0.2;
/// Reverse geocoding grid cell edge, and the distance beyond which nothing is "near".
const CELL_DEG: f64 = 0.25;
const MAX_REVERSE_DEG: f64 = 0.5;

/// Ranking weights (see [`Engine::score`]).
const W_TEXT: f32 = 3.0;
const W_COVERAGE: f32 = 1.2;
const W_IMPORTANCE: f32 = 2.0;
const W_INTENT: f32 = 1.5;
/// "bến xe hà nội" asks for bus stations; the city of Hà Nội is not one.
const W_OFF_INTENT: f32 = 0.5;
const W_PHRASE: f32 = 0.3;
const W_ORDER: f32 = 0.1;
const W_NEAR: f32 = 0.8;
/// Distance (km) at which the "near" bonus has fallen to 1/e.
const NEAR_KM: f64 = 40.0;
const W_EXACT: f32 = 1.2;
const W_EXACT_CORE: f32 = 1.1;
const W_EXACT_ALT: f32 = 0.9;
const W_STARTS_WITH: f32 = 0.4;
const W_TONES: f32 = 1.5;
const W_EXTRA_WORD: f32 = 0.04;

/// Credit for an untyped type word when the place is tagged that type.
const TAGGED_TYPE: f32 = 0.6;
const FIELD_ALT: f32 = 0.92;
const FIELD_CTX: f32 = 0.55;
/// A match on a run-together or short form ("hanoi", "hcm") rather than a word.
const SYNTHETIC: f32 = 0.95;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Field {
    Name,
    Alt,
    Ctx,
}

/// One indexed word, or run of words, of one field.
#[derive(Debug, Clone, Copy)]
struct Span {
    term: u32,
    field: Field,
    /// 0 = the name, 1.. = alt names, 0/1/2 = province/district/ward in context.
    group: u8,
    /// First word position and number of words covered. `len > 1` marks a
    /// run-together or short form rather than a word.
    start: u8,
    len: u8,
}

/// Compressed-row posting lists: places per term, ascending (= by importance).
#[derive(Default)]
struct Postings {
    offsets: Vec<u32>,
    places: Vec<u32>,
}

impl Postings {
    /// Two passes over `(term, place)` occurrences given in ascending place
    /// order: count, then fill. No intermediate pair list, so building costs
    /// little more memory than the result.
    fn build(n_terms: usize, each: impl Fn(&mut dyn FnMut(u32, u32))) -> Self {
        let mut last = vec![u32::MAX; n_terms];
        let mut offsets = vec![0u32; n_terms + 1];
        each(&mut |term, place| {
            let t = term as usize;
            if last[t] != place {
                last[t] = place;
                offsets[t + 1] += 1;
            }
        });
        for i in 1..offsets.len() {
            offsets[i] += offsets[i - 1];
        }
        let mut places = vec![0u32; offsets[n_terms] as usize];
        let mut cursor: Vec<u32> = offsets[..n_terms].to_vec();
        last.fill(u32::MAX);
        each(&mut |term, place| {
            let t = term as usize;
            if last[t] != place {
                last[t] = place;
                places[cursor[t] as usize] = place;
                cursor[t] += 1;
            }
        });
        Postings { offsets, places }
    }

    fn get(&self, term: u32) -> &[u32] {
        let t = term as usize;
        &self.places[self.offsets[t] as usize..self.offsets[t + 1] as usize]
    }
}

/// How a query word matched a term: kind in the high byte, quality (0..100)
/// in the low byte; 0 means no match.
type Packed = u16;
const EXACT: u16 = 1;
const PREFIX: u16 = 2;
const FUZZY: u16 = 3;

fn pack(kind: u16, quality: u16) -> Packed {
    kind << 8 | quality.min(100)
}

/// The terms one query word matches.
enum Matches {
    /// Sorted by term id.
    Small(Vec<(u32, Packed)>),
    /// Indexed by term id.
    Table(Vec<Packed>),
}

struct QueryWord {
    word: String,
    /// Bit `term % 64` is set for every matched term: a cheap "no" before the lookup.
    filter: u64,
    last: bool,
    optional: bool,
    /// Matched terms, sorted by id (kept for candidate generation).
    terms: Vec<(u32, Packed)>,
    matches: Matches,
    /// Rough number of places this word can match: the cheapest required word seeds the search.
    estimate: usize,
}

impl QueryWord {
    fn lookup(&self, term: u32) -> Packed {
        if self.filter & (1u64 << (term % 64)) == 0 {
            return 0;
        }
        match &self.matches {
            Matches::Small(v) => v
                .binary_search_by_key(&term, |(t, _)| *t)
                .map_or(0, |i| v[i].1),
            Matches::Table(t) => t[term as usize],
        }
    }
}

struct Query {
    words: Vec<QueryWord>,
    /// Words after the leading type phrase ("bến xe mỹ đình" → "my dinh").
    core_from: usize,
    /// Kinds the leading type phrase asks for.
    intent: Vec<&'static str>,
    /// Query words that carry tone marks ("hạ"), for the tone bonus.
    toned: Vec<String>,
    near: Option<(f64, f64)>,
}

/// One search result, in the shape the app's API has always returned.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaceHit {
    pub id: String,
    pub name: String,
    pub name_no_tones: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub province: Option<String>,
    pub district: Option<String>,
    pub ward: Option<String>,
    pub lat: f64,
    pub lon: f64,
    pub score: f64,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct SearchOptions {
    pub limit: usize,
    /// Bias results toward this point (lat, lon), e.g. the map the user is looking at.
    pub near: Option<(f64, f64)>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStats {
    pub places: usize,
    pub terms: usize,
    pub built_at: String,
}

pub struct Engine {
    places: Vec<PlaceRecord>,
    importance: Vec<f32>,
    /// Name and alt-name spans of place `i`: `spans[span_offsets[i]..span_offsets[i + 1]]`.
    span_offsets: Vec<u32>,
    /// Position of the first identifying word of each name, after its type
    /// phrase ("Bến xe Mỹ Đình" → 2): coverage is measured from there.
    name_core: Vec<u8>,
    /// Kinds the name's own type phrase stands for: a place called "Chợ …"
    /// is a market whatever OpenStreetMap tagged it.
    name_type: Vec<&'static [&'static str]>,
    spans: Vec<Span>,
    /// Context (province/district/ward) spans, shared by every place in the same area.
    place_ctx: Vec<u32>,
    ctx_offsets: Vec<u32>,
    ctx_spans: Vec<Span>,
    terms: Map<Vec<u8>>,
    n_terms: usize,
    name_postings: Postings,
    ctx_postings: Postings,
    short_prefix: HashMap<String, Vec<u32>>,
    grid: HashMap<(i32, i32), Vec<u32>>,
    popular: Vec<u32>,
    built_at: String,
}

/// Static importance, 0..1: what kind of place it is, and how many live there.
fn importance(rec: &PlaceRecord) -> f32 {
    let population = ((rec.population.max(0) as f64 + 1.0).log10() / 7.0).min(1.0) as f32;
    0.75 * lexicon::kind_weight(&rec.kind) + 0.25 * population
}

/// The longest type phrase `words` starts with, and the kinds it stands for.
fn leading_type<T: AsRef<str>>(words: &[T]) -> Option<(usize, &'static [&'static str])> {
    TYPE_PHRASES
        .iter()
        .filter(|(p, _)| lexicon::phrase_at(words, [*p]) == p.len())
        .max_by_key(|(p, _)| p.len())
        .map(|(p, kinds)| (p.len(), *kinds))
}

/// Words of a leading type phrase ("Phường", "Bến xe", "Đường") of `words`,
/// leaving at least one word.
fn type_prefix_len<T: AsRef<str>>(words: &[T]) -> usize {
    let mut at = 0;
    loop {
        let len = lexicon::phrase_at(&words[at..], TYPE_PHRASES.iter().map(|(p, _)| *p));
        if len == 0 || at + len >= words.len() {
            return at;
        }
        at += len;
    }
}

#[derive(Default)]
/// Term strings, each stored once, numbered in order of first sight.
struct Interner(indexmap::IndexSet<Box<str>>);

impl Interner {
    fn id(&mut self, term: &str) -> u32 {
        match self.0.get_index_of(term) {
            Some(id) => id as u32,
            None => self.0.insert_full(term.into()).0 as u32,
        }
    }

    fn get(&self, id: u32) -> &str {
        &self.0[id as usize]
    }
}

/// Indexes one field value: its words, the words run together, short forms.
fn push_group(out: &mut Vec<Span>, terms: &mut Interner, field: Field, group: u8, value: &str) {
    let mut words = text::tokens(value);
    words.truncate(MAX_GROUP_WORDS);
    let n = words.len();
    let mut add = |term: &str, start: usize, len: usize| {
        out.push(Span {
            term: terms.id(term),
            field,
            group,
            start: start as u8,
            len: len as u8,
        });
    };
    for (i, w) in words.iter().enumerate() {
        add(w, i, 1);
    }
    // "Hà Nội" is typed "hanoi" as often as "ha noi"; "Hồ Chí Minh" as "hochiminh".
    for len in 2..=3.min(n) {
        for start in 0..=n - len {
            add(&words[start..start + len].concat(), start, len);
        }
    }
    if n > 3 {
        add(&words.concat(), 0, n);
        // "benxemydinh" and "mydinh" alike.
        let lead = type_prefix_len(&words);
        if lead > 0 && n - lead > 3 {
            add(&words[lead..].concat(), lead, n - lead);
        }
    }
    for start in 0..n {
        let rest = &words[start..];
        for (phrase, shorts) in SHORT_FORMS {
            if lexicon::phrase_at(rest, [*phrase]) == phrase.len() {
                for short in *shorts {
                    add(short, start, phrase.len());
                }
            }
        }
        if let [word, number, ..] = rest {
            if number.bytes().all(|b| b.is_ascii_digit()) {
                if let Some((_, short)) = NUMBERED.iter().find(|(w, _)| w == word) {
                    add(&format!("{short}{number}"), start, 2);
                }
            }
        }
    }
}

fn hit(rec: &PlaceRecord, score: f32) -> PlaceHit {
    let opt = |s: &str| (!s.is_empty()).then(|| s.to_string());
    PlaceHit {
        id: rec.id.clone(),
        name: rec.name.clone(),
        name_no_tones: text::fold(&rec.name),
        kind: rec.kind.clone(),
        province: opt(&rec.province),
        district: opt(&rec.district),
        ward: opt(&rec.ward),
        lat: rec.lat,
        lon: rec.lon,
        score: (score as f64 * 1000.0).round() / 1000.0,
    }
}

fn km_between(a: (f64, f64), b: (f64, f64)) -> f64 {
    let kx = ((a.0 + b.0) / 2.0).to_radians().cos();
    let dy = a.0 - b.0;
    let dx = (a.1 - b.1) * kx;
    (dy * dy + dx * dx).sqrt() * 111.2
}

fn cell(lat: f64, lon: f64) -> (i32, i32) {
    (
        (lat / CELL_DEG).floor() as i32,
        (lon / CELL_DEG).floor() as i32,
    )
}

/// Places that look the same in a result list are shown once.
fn display_key(rec: &PlaceRecord) -> (String, &'static str, String) {
    let class = if is_area(&rec.kind) {
        "area"
    } else if rec.kind.starts_with(lexicon::ROAD) {
        lexicon::ROAD
    } else {
        "other"
    };
    let detail = if class == "other" {
        format!("{}|{}", rec.kind, rec.district)
    } else {
        rec.district.clone()
    };
    (text::fold(&rec.name), class, detail)
}

impl Engine {
    pub fn build(records: Vec<PlaceRecord>, built_at: impl Into<String>) -> Engine {
        let mut ranked: Vec<(f32, PlaceRecord)> =
            records.into_iter().map(|r| (importance(&r), r)).collect();
        ranked.sort_by(|a, b| b.0.total_cmp(&a.0).then_with(|| a.1.id.cmp(&b.1.id)));
        let (importance, places): (Vec<f32>, Vec<PlaceRecord>) = ranked.into_iter().unzip();

        let mut terms = Interner(indexmap::IndexSet::new());
        let mut spans = Vec::new();
        let mut span_offsets = vec![0u32];
        let mut ctx_ids: HashMap<(&str, &str, &str), u32> = HashMap::new();
        let mut ctx_spans = Vec::new();
        let mut ctx_offsets = vec![0u32];
        let mut place_ctx = Vec::with_capacity(places.len());
        let mut name_core = Vec::with_capacity(places.len());
        let mut name_type = Vec::with_capacity(places.len());
        for rec in &places {
            let mut words = text::tokens(&rec.name);
            words.truncate(MAX_GROUP_WORDS);
            name_core.push(type_prefix_len(&words) as u8);
            name_type.push(leading_type(&words).map_or(&[][..], |(_, kinds)| kinds));
            push_group(&mut spans, &mut terms, Field::Name, 0, &rec.name);
            for (i, alt) in rec.alt_names.iter().take(MAX_ALT_NAMES).enumerate() {
                push_group(&mut spans, &mut terms, Field::Alt, i as u8 + 1, alt);
            }
            span_offsets.push(spans.len() as u32);
            let key = (
                rec.province.as_str(),
                rec.district.as_str(),
                rec.ward.as_str(),
            );
            let id = *ctx_ids.entry(key).or_insert_with(|| {
                for (group, part) in [key.0, key.1, key.2].into_iter().enumerate() {
                    push_group(&mut ctx_spans, &mut terms, Field::Ctx, group as u8, part);
                }
                ctx_offsets.push(ctx_spans.len() as u32);
                ctx_offsets.len() as u32 - 2
            });
            place_ctx.push(id);
        }

        // Short-prefix top lists, while term strings are still at hand.
        let mut short_prefix: HashMap<String, Vec<u32>> = HashMap::new();
        for (place, w) in span_offsets.windows(2).enumerate() {
            for span in &spans[w[0] as usize..w[1] as usize] {
                if span.len != 1 {
                    continue;
                }
                let term = terms.get(span.term);
                for len in 1..=SHORT_PREFIX.min(term.len()) {
                    let list = short_prefix.entry(term[..len].to_string()).or_default();
                    if list.len() < SHORT_PREFIX_TOP && list.last() != Some(&(place as u32)) {
                        list.push(place as u32);
                    }
                }
            }
        }

        // The FST wants its keys sorted: renumber terms in key order.
        let n_terms = terms.0.len();
        let mut order: Vec<u32> = (0..n_terms as u32).collect();
        order.sort_unstable_by(|&a, &b| terms.get(a).cmp(terms.get(b)));
        let mut renumber = vec![0u32; n_terms];
        let mut builder = MapBuilder::memory();
        for (new, &old) in order.iter().enumerate() {
            renumber[old as usize] = new as u32;
            builder
                .insert(terms.get(old), new as u64)
                .expect("terms are inserted in sorted order");
        }
        let terms_fst = Map::new(builder.into_inner().expect("in-memory FST"))
            .expect("a freshly built FST is valid");
        drop(terms);
        for span in spans.iter_mut().chain(ctx_spans.iter_mut()) {
            span.term = renumber[span.term as usize];
        }

        let name_postings = Postings::build(n_terms, |emit| {
            for (place, w) in span_offsets.windows(2).enumerate() {
                for span in &spans[w[0] as usize..w[1] as usize] {
                    emit(span.term, place as u32);
                }
            }
        });
        let ctx_postings = Postings::build(n_terms, |emit| {
            for (place, &ctx) in place_ctx.iter().enumerate() {
                let c = ctx as usize;
                for span in &ctx_spans[ctx_offsets[c] as usize..ctx_offsets[c + 1] as usize] {
                    emit(span.term, place as u32);
                }
            }
        });

        let mut grid: HashMap<(i32, i32), Vec<u32>> = HashMap::new();
        for (i, rec) in places.iter().enumerate() {
            if is_area(&rec.kind) {
                grid.entry(cell(rec.lat, rec.lon))
                    .or_default()
                    .push(i as u32);
            }
        }

        let mut popular: Vec<u32> = (0..places.len() as u32)
            .filter(|&i| matches!(places[i as usize].kind.as_str(), "city" | "town"))
            .collect();
        popular.sort_by(|&a, &b| {
            let (a, b) = (&places[a as usize], &places[b as usize]);
            b.population
                .cmp(&a.population)
                .then(kind_priority(&b.kind).total_cmp(&kind_priority(&a.kind)))
                .then_with(|| text::fold(&a.name).cmp(&text::fold(&b.name)))
        });
        popular.truncate(POPULAR_LIMIT);

        Engine {
            name_postings,
            ctx_postings,
            places,
            importance,
            span_offsets,
            name_core,
            name_type,
            spans,
            place_ctx,
            ctx_offsets,
            ctx_spans,
            terms: terms_fst,
            n_terms,
            short_prefix,
            grid,
            popular,
            built_at: built_at.into(),
        }
    }

    pub fn len(&self) -> usize {
        self.places.len()
    }

    /// The indexed places, most important first.
    pub fn records(&self) -> &[PlaceRecord] {
        &self.places
    }

    pub fn stats(&self) -> EngineStats {
        EngineStats {
            places: self.places.len(),
            terms: self.n_terms,
            built_at: self.built_at.clone(),
        }
    }

    /// Is the place the kind a query's type phrase asks for, by tag or by its own name?
    fn is_wanted(&self, place: u32, intent: &[&str]) -> bool {
        lexicon::kind_matches(&self.places[place as usize].kind, intent)
            || self.name_type[place as usize]
                .iter()
                .any(|k| intent.contains(k))
    }

    fn own_spans(&self, place: u32) -> &[Span] {
        let p = place as usize;
        &self.spans[self.span_offsets[p] as usize..self.span_offsets[p + 1] as usize]
    }

    fn ctx_spans(&self, place: u32) -> &[Span] {
        let c = self.place_ctx[place as usize] as usize;
        &self.ctx_spans[self.ctx_offsets[c] as usize..self.ctx_offsets[c + 1] as usize]
    }

    /// Every term `word` can stand for: itself, the words it starts (prefix),
    /// and words one or two typos away.
    fn match_word(&self, word: &str, last: bool, optional: bool) -> QueryWord {
        let mut found: Vec<(u32, Packed)> = Vec::new();
        if let Some(id) = self.terms.get(word) {
            found.push((id as u32, pack(EXACT, 100)));
        }
        // Only the word being typed is a prefix: the words before it are
        // finished ("phu" in "tran phu nha trang" is not "phường").
        if last {
            let mut stream = self
                .terms
                .search(Str::new(word).starts_with())
                .into_stream();
            while let Some((key, id)) = stream.next() {
                if key.len() > word.len() {
                    let quality = 70 + (30 * word.len() / key.len()) as u16;
                    found.push((id as u32, pack(PREFIX, quality)));
                }
            }
        }
        // Typos, but only for words the index does not know: "trang" is a
        // word, not a typo of "tran". House numbers and short words have too
        // many neighbours to guess.
        if found.is_empty() && word.len() >= 4 && !word.bytes().all(|b| b.is_ascii_digit()) {
            // Swapped neighbours ("nguyne") are two edits to Levenshtein, one to a typist.
            let bytes = word.as_bytes();
            for i in 0..bytes.len() - 1 {
                if bytes[i] != bytes[i + 1] {
                    let mut swapped = bytes.to_vec();
                    swapped.swap(i, i + 1);
                    if let Some(id) = self.terms.get(&swapped) {
                        found.push((id as u32, pack(FUZZY, 60)));
                    }
                }
            }
            let distance = if word.len() >= 8 { 2 } else { 1 };
            if let Ok(lev) = Levenshtein::new_with_limit(word, distance, 50_000) {
                let mut stream = self.terms.search(&lev).into_stream();
                while let Some((_, id)) = stream.next() {
                    found.push((id as u32, pack(FUZZY, 60)));
                }
            }
            if last && word.len() >= 5 {
                if let Ok(lev) = Levenshtein::new_with_limit(word, 1, 50_000) {
                    let mut stream = self.terms.search(lev.starts_with()).into_stream();
                    while let Some((_, id)) = stream.next() {
                        found.push((id as u32, pack(FUZZY, 50)));
                    }
                }
            }
        }
        // Best match per term (exact beats prefix beats typo).
        found.sort_unstable_by(|a, b| a.0.cmp(&b.0).then(match_rank(b.1).cmp(&match_rank(a.1))));
        found.dedup_by_key(|(id, _)| *id);

        let estimate = found
            .iter()
            .map(|&(term, m)| {
                let ctx = if ctx_allows(m, last) {
                    self.ctx_postings.get(term).len()
                } else {
                    0
                };
                self.name_postings.get(term).len() + ctx
            })
            .sum();
        let matches = if found.len() <= SMALL_MATCH_SET {
            Matches::Small(found.clone())
        } else {
            let mut table = vec![0; self.n_terms];
            for &(term, m) in &found {
                table[term as usize] = m;
            }
            Matches::Table(table)
        };
        QueryWord {
            filter: found
                .iter()
                .fold(0, |f, &(term, _)| f | 1u64 << (term % 64)),
            word: word.to_string(),
            last,
            optional,
            terms: found,
            matches,
            estimate,
        }
    }

    fn parse(&self, raw: &str, near: Option<(f64, f64)>) -> Option<Query> {
        let raw: String = raw.chars().take(MAX_QUERY_CHARS).collect();
        let expanded = text::expand_abbreviations(&raw);
        let mut words = text::tokens(&expanded);
        words.truncate(MAX_QUERY_WORDS);
        if words.is_empty() {
            return None;
        }
        let n = words.len();

        // A leading type phrase sets the intent ("bến xe …" → bus stations).
        let mut optional = vec![false; n];
        let mut intent: Vec<&'static str> = Vec::new();
        let mut at = 0;
        while let Some((len, kinds)) = leading_type(&words[at..]) {
            optional[at..at + len].fill(true);
            intent.extend_from_slice(kinds);
            at += len;
        }
        let core_from = at;
        // Administrative words are optional anywhere ("cầu giấy thành phố hà nội").
        let mut i = at;
        while i < n {
            let len = lexicon::phrase_at(&words[i..], ADMIN_PHRASES.iter().copied());
            if len > 0 {
                optional[i..i + len].fill(true);
                i += len;
            } else {
                i += 1;
            }
        }
        // A query of nothing but type words must match them all ("bến xe").
        if optional.iter().all(|&o| o) {
            optional.fill(false);
        }

        let words = words
            .iter()
            .enumerate()
            .map(|(i, w)| self.match_word(w, i == n - 1, optional[i]))
            .collect();
        let toned = text::toned_tokens(&expanded)
            .into_iter()
            .filter(|w| text::has_marks(w))
            .collect();
        Some(Query {
            words,
            core_from,
            intent,
            toned,
            near,
        })
    }

    /// Every place a word matches, ascending (= by importance). Name matches
    /// come first when `cap` cuts the list, so "hà nội" never loses the city
    /// to the hundred thousand places whose address says Hà Nội.
    fn word_places(&self, w: &QueryWord, cap: usize) -> Vec<u32> {
        let mut out: Vec<u32> = Vec::new();
        for &(term, _) in &w.terms {
            let list = self.name_postings.get(term);
            out.extend_from_slice(&list[..list.len().min(cap)]);
        }
        out.sort_unstable();
        out.dedup();
        out.truncate(cap);
        if out.len() < cap {
            let room = cap - out.len();
            let mut ctx: Vec<u32> = Vec::new();
            for &(term, m) in &w.terms {
                if ctx_allows(m, w.last) {
                    let list = self.ctx_postings.get(term);
                    ctx.extend_from_slice(&list[..list.len().min(room)]);
                }
            }
            ctx.sort_unstable();
            ctx.dedup();
            ctx.retain(|p| out.binary_search(p).is_err());
            ctx.truncate(room);
            out.extend(ctx);
            out.sort_unstable();
        }
        out
    }

    /// Places worth scoring: the intersection of the required words' place
    /// sets, most selective word first, until it is small enough to score.
    fn candidates(&self, required: &[&QueryWord]) -> Vec<u32> {
        let mut words: Vec<&QueryWord> = required.to_vec();
        words.sort_by_key(|w| w.estimate);
        // A one- or two-letter word being typed matches half the index: when
        // it is all there is, its precomputed top list answers.
        if let [only] = words[..] {
            if only.last && only.word.len() <= SHORT_PREFIX {
                if let Some(top) = self.short_prefix.get(&only.word) {
                    return top.clone();
                }
            }
            return self.word_places(only, MAX_CANDIDATES);
        }
        // Short words being typed are checked while scoring, never materialised.
        words.retain(|w| !(w.last && w.word.len() <= SHORT_PREFIX));
        let Some((first, rest)) = words.split_first() else {
            return Vec::new();
        };
        let mut out = self.word_places(first, usize::MAX);
        for w in rest {
            if out.len() <= SMALL_CANDIDATE_SET || w.estimate > INTERSECT_RATIO * out.len() {
                break;
            }
            let other = self.word_places(w, usize::MAX);
            out.retain(|p| other.binary_search(p).is_ok());
        }
        out.truncate(MAX_CANDIDATES);
        out
    }

    /// First-pass score of one place, or `None` when a required word does not match.
    ///
    /// text      — how well each query word matched (word > prefix > typo; name > alt > context)
    /// coverage  — how much of the name (or an alt name) the query accounts for
    /// phrase    — the words matched the name in its own order (and adjacent)
    /// intent    — the place is the kind the leading type phrase asked for
    /// importance, near — static rank and distance to `near`
    fn score(&self, place: u32, q: &Query) -> Option<f32> {
        let n = q.words.len();
        let mut best = [0f32; MAX_QUERY_WORDS];
        let mut best_span: [Option<Span>; MAX_QUERY_WORDS] = [None; MAX_QUERY_WORDS];
        let mut group_words = [0u32; MAX_ALT_NAMES + 1];
        for span in self.own_spans(place).iter().chain(self.ctx_spans(place)) {
            if span.len == 1 && span.field != Field::Ctx {
                group_words[span.group as usize] += 1;
            }
            for (i, w) in q.words.iter().enumerate() {
                let m = w.lookup(span.term);
                if m == 0 {
                    continue;
                }
                let weight = match_weight(m, span, w.last);
                if weight > best[i] {
                    best[i] = weight;
                    best_span[i] = Some(*span);
                }
            }
        }
        if q.words
            .iter()
            .zip(&best)
            .any(|(w, &b)| b == 0.0 && !w.optional)
        {
            return None;
        }
        // A rail station need not be called "Ga …" to answer "ga sài gòn":
        // being tagged that kind of place earns most of the type words' credit.
        if !q.intent.is_empty()
            && lexicon::kind_matches(&self.places[place as usize].kind, &q.intent)
        {
            for b in &mut best[..q.core_from] {
                *b = b.max(TAGGED_TYPE);
            }
        }
        let text_score = best[..n].iter().sum::<f32>() / n as f32;

        let mut covered = [0u64; MAX_ALT_NAMES + 1];
        for span in best_span[..n].iter().flatten() {
            if span.field != Field::Ctx {
                let bits = if span.len >= 64 {
                    u64::MAX
                } else {
                    ((1u64 << span.len) - 1) << span.start
                };
                covered[span.group as usize] |= bits;
            }
        }
        // The name's type phrase ("Thành phố", "Bến xe") need not be typed.
        let core = (self.name_core[place as usize] as u32).min(group_words[0].saturating_sub(1));
        covered[0] &= !((1u64 << core) - 1);
        group_words[0] -= core;
        let coverage = (0..=MAX_ALT_NAMES)
            .filter(|&g| group_words[g] > 0)
            .map(|g| {
                let share =
                    covered[g].count_ones().min(group_words[g]) as f32 / group_words[g] as f32;
                if g == 0 {
                    share
                } else {
                    share * FIELD_ALT
                }
            })
            .fold(0.0, f32::max);

        let in_name: Vec<&Span> = best_span[..n]
            .iter()
            .flatten()
            .filter(|s| s.field == Field::Name)
            .collect();
        let phrase = if in_name.len() < 2 {
            0.0
        } else if in_name
            .windows(2)
            .all(|p| p[1].start == p[0].start + p[0].len)
        {
            W_PHRASE
        } else if in_name.windows(2).all(|p| p[1].start > p[0].start) {
            W_ORDER
        } else {
            0.0
        };

        let rec = &self.places[place as usize];
        let intent = if q.intent.is_empty() {
            0.0
        } else if self.is_wanted(place, &q.intent) {
            W_INTENT
        } else {
            -W_OFF_INTENT
        };
        let near = q.near.map_or(0.0, |p| {
            W_NEAR * (-km_between(p, (rec.lat, rec.lon)) / NEAR_KM).exp() as f32
        });
        Some(
            W_TEXT * text_score
                + W_COVERAGE * coverage
                + phrase
                + intent
                + W_IMPORTANCE * self.importance[place as usize]
                + near,
        )
    }

    /// Second pass over the best few: whole-name equality, tones, extra words.
    fn rescore(&self, place: u32, first: f32, q: &Query) -> f32 {
        let rec = &self.places[place as usize];
        let name = text::tokens(&rec.name);
        let query: Vec<&str> = q.words.iter().map(|w| w.word.as_str()).collect();
        let (name_all, query_all) = (name.concat(), query.concat());
        let query_core = query[q.core_from..].concat();
        let name_core = name[type_prefix_len(&name)..].concat();
        // "bến xe hà nội" asks for bus stations: the city is not an exact answer.
        let wanted = q.intent.is_empty() || self.is_wanted(place, &q.intent);
        // "ha" equalling a shop called "Hà" says little; "hanoi" equalling Hà Nội says a lot.
        let sure = query_all.len().min(4) as f32 / 4.0;
        let exact = sure
            * if name_all == query_all {
                W_EXACT
            } else if wanted && !query_core.is_empty() && name_core == query_core {
                W_EXACT_CORE
            } else if rec
                .alt_names
                .iter()
                .any(|a| text::tokens(a).concat() == query_all)
            {
                W_EXACT_ALT
            } else if name_all.starts_with(&query_all) {
                W_STARTS_WITH
            } else {
                0.0
            };
        let tones = if q.toned.is_empty() {
            0.0
        } else {
            let own = text::toned_tokens(&rec.name);
            let hits = q.toned.iter().filter(|w| own.contains(w)).count();
            W_TONES * hits as f32 / q.toned.len() as f32
        };
        let matched = name
            .iter()
            .filter(|w| query.iter().any(|q| w.starts_with(q)))
            .count();
        let extra = name.len().saturating_sub(matched) as f32;
        first + exact + tones - W_EXTRA_WORD * extra
    }

    pub fn search(&self, raw: &str, opts: &SearchOptions) -> Vec<PlaceHit> {
        let Some(q) = self.parse(raw, opts.near) else {
            return Vec::new();
        };
        let hits = self.run(&q, opts.limit.max(1));
        // "sai gon", "vung tau": words typed apart that are indexed run together.
        if hits.is_empty() && q.words.len() > 1 {
            let joined: String = q.words.iter().map(|w| w.word.as_str()).collect();
            if let Some(q) = self.parse(&joined, opts.near) {
                return self.run(&q, opts.limit.max(1));
            }
        }
        hits
    }

    fn run(&self, q: &Query, limit: usize) -> Vec<PlaceHit> {
        let required: Vec<&QueryWord> = q.words.iter().filter(|w| !w.optional).collect();
        if required.is_empty() || required.iter().any(|w| w.terms.is_empty()) {
            return Vec::new();
        }

        let mut scored: Vec<(f32, u32)> = self
            .candidates(&required)
            .into_iter()
            .filter_map(|p| self.score(p, q).map(|s| (s, p)))
            .collect();
        if scored.len() > RERANK {
            scored.select_nth_unstable_by(RERANK, |a, b| b.0.total_cmp(&a.0));
            scored.truncate(RERANK);
        }
        for entry in &mut scored {
            entry.0 = self.rescore(entry.1, entry.0, q);
        }
        scored.sort_by(|a, b| {
            b.0.total_cmp(&a.0).then_with(|| {
                self.places[a.1 as usize]
                    .name
                    .cmp(&self.places[b.1 as usize].name)
            })
        });

        // A lesser element (the station's building, platform or yard: "Ga Sài
        // Gòn" next to the "Sài Gòn" station) is the same place to a user:
        // drop it when a better-kinded result of the same core name is close,
        // wherever that one ranks.
        let core_name = |p: u32| {
            let words = text::tokens(&self.places[p as usize].name);
            words[type_prefix_len(&words)..].concat()
        };
        let major: Vec<(String, u32)> = scored
            .iter()
            .filter(|&&(_, p)| lexicon::kind_weight(&self.places[p as usize].kind) > MINOR_KIND)
            .map(|&(_, p)| (core_name(p), p))
            .collect();
        let mut keys = std::collections::HashSet::new();
        let mut shown_minor: Vec<(String, f64, f64)> = Vec::new();
        let mut out = Vec::new();
        for (s, p) in scored {
            let rec = &self.places[p as usize];
            if lexicon::kind_weight(&rec.kind) <= MINOR_KIND {
                let name = core_name(p);
                // Same name, or the same core name and this one's own type
                // phrase says it is that kind of place ("Ga Sài Gòn" / station
                // "Sài Gòn", never "Bến xe Mỹ Đình" / market "Chợ Mỹ Đình").
                let twin = major.iter().any(|(n, m)| {
                    let other = &self.places[*m as usize];
                    let same = text::fold(&other.name) == text::fold(&rec.name)
                        || (*n == name
                            && lexicon::kind_matches(&other.kind, self.name_type[p as usize]));
                    same && km_between((other.lat, other.lon), (rec.lat, rec.lon)) < SAME_PLACE_KM
                });
                // ...or a lesser element of the same name already shown
                // (one station mapped as both a platform and a building).
                let shown_twin = shown_minor.iter().any(|&(ref n, lat, lon)| {
                    *n == text::fold(&rec.name)
                        && km_between((lat, lon), (rec.lat, rec.lon)) < SAME_PLACE_KM
                });
                if twin || shown_twin {
                    continue;
                }
                shown_minor.push((text::fold(&rec.name), rec.lat, rec.lon));
            }
            if !keys.insert(display_key(rec)) {
                continue;
            }
            out.push(hit(rec, s));
            if out.len() == limit {
                break;
            }
        }
        out
    }

    /// The biggest cities and towns: the autocomplete list before the first keystroke.
    pub fn popular(&self, offset: usize, limit: usize) -> Vec<PlaceHit> {
        self.popular
            .iter()
            .skip(offset)
            .take(limit)
            .map(|&p| hit(&self.places[p as usize], 0.0))
            .collect()
    }

    /// Nearest areas to a point ("where am I"), nearest first. Landmarks only
    /// count where no settlement or admin area is close.
    pub fn reverse(&self, lat: f64, lon: f64, limit: usize) -> Vec<PlaceHit> {
        if !lat.is_finite() || !lon.is_finite() {
            return Vec::new();
        }
        let (ci, cj) = cell(lat, lon);
        let kx = lat.to_radians().cos();
        let mut near: Vec<(f64, u32)> = Vec::new();
        for di in -1..=1 {
            for dj in -1..=1 {
                for &p in self.grid.get(&(ci + di, cj + dj)).into_iter().flatten() {
                    let rec = &self.places[p as usize];
                    let dy = rec.lat - lat;
                    let dx = (rec.lon - lon) * kx;
                    let d2 = dy * dy + dx * dx;
                    if d2 <= MAX_REVERSE_DEG * MAX_REVERSE_DEG {
                        near.push((d2, p));
                    }
                }
            }
        }
        near.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
        // Provinces are huge: their centroid says little about where a point is.
        let local: Vec<u32> = near
            .iter()
            .filter(|(_, p)| self.places[*p as usize].kind != "province")
            .map(|&(_, p)| p)
            .collect();
        let chosen = if local.is_empty() {
            near.iter().map(|&(_, p)| p).collect()
        } else {
            local
        };
        chosen
            .into_iter()
            .take(limit)
            .map(|p| hit(&self.places[p as usize], 0.0))
            .collect()
    }
}

/// Exact > prefix > typo, then by quality.
fn match_rank(m: Packed) -> (u16, u16) {
    let kind = m >> 8;
    (3 - kind.min(3), m & 0xff)
}

/// Context words (province, district, ward) only count when typed exactly,
/// or as the word still being typed: "tran phu nha tr" may mean Nha Trang.
fn ctx_allows(m: Packed, last: bool) -> bool {
    let kind = m >> 8;
    kind == EXACT || (kind == PREFIX && last)
}

fn match_weight(m: Packed, span: &Span, last: bool) -> f32 {
    let quality = (m & 0xff) as f32 / 100.0;
    let field = match span.field {
        Field::Name => 1.0,
        Field::Alt => FIELD_ALT,
        Field::Ctx if ctx_allows(m, last) => FIELD_CTX,
        Field::Ctx => return 0.0,
    };
    let form = if span.len > 1 { SYNTHETIC } else { 1.0 };
    quality * field * form
}
