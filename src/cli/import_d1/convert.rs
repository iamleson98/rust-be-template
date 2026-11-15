//! Value conversions for `import-d1`: one D1 cell in, the cell the app's
//! own code writes and reads out.
//!
//! Everything here is pure, so the rules are unit-tested without a
//! database. The shapes come from the app, not from guesswork:
//!
//! * a `Uuid` column holds the 16 raw bytes (`sqlx` encodes `Uuid` as a
//!   BLOB and decodes nothing else);
//! * an entity `DateTimeUtc` column holds what `sqlx` encodes for a
//!   `DateTime<Utc>`: RFC 3339 with a `+00:00` offset and as many
//!   fraction digits as the instant needs;
//! * a `String` column that holds an instant is written by the app as
//!   RFC 3339 UTC with a `Z` suffix, and the store compares those strings
//!   in SQL (`next_run_at <= now`), so the import writes that same shape;
//! * `schedule.days_of_week` is a 7-character `0`/`1` mask, Monday first
//!   (`trip_warmer::schedule_runs_on`).

use chrono::{DateTime, NaiveDate, NaiveDateTime, SecondsFormat, Utc};
use uuid::Uuid;

/// The text D1 stores when a column default was baked in as a string
/// instead of being evaluated (`DEFAULT '(datetime(''now''))'`).
pub const LITERAL_DEFAULT: &str = "(datetime('now'))";

/// One SQLite value, read from the stage database or ready to be bound.
#[derive(Debug, Clone, PartialEq)]
pub enum Cell {
    Null,
    Int(i64),
    Real(f64),
    Text(String),
    Blob(Vec<u8>),
}

/// How a column's values must look in the app database.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// An entity `Uuid`: TEXT in D1, 16 raw bytes here.
    Uuid,
    /// An entity `DateTimeUtc`: what `sqlx` writes for a `DateTime<Utc>`.
    Instant,
    /// A `String` column holding an instant: RFC 3339 UTC, `Z` suffix.
    InstantText,
    /// `trip_session.actual_departure_at`: an RFC 3339 instant, or a
    /// zone-less local timestamp, which the app reads as Vietnam time and
    /// which therefore stays as it is.
    InstantOrLocal,
    /// A calendar day, `YYYY-MM-DD`.
    Date,
    /// 0 / 1.
    Bool,
    /// An integer that must fit the entity's field.
    Int(IntWidth),
    Real,
    /// Text (or anything SQLite's own affinity turns into text).
    Text,
    /// `schedule.days_of_week`.
    DaysMask,
}

/// The entity integer type a column decodes into.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IntWidth {
    I16,
    I32,
    I64,
}

impl IntWidth {
    fn contains(self, v: i64) -> bool {
        match self {
            Self::I16 => i16::try_from(v).is_ok(),
            Self::I32 => i32::try_from(v).is_ok(),
            Self::I64 => true,
        }
    }
}

/// How a converted value differs from the source, for the report.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Change {
    /// Copied as it was.
    Same,
    /// Same value, the app's shape (a UUID as bytes, an instant in the
    /// app's format, a number that was text, a mask built from JSON).
    Reshaped,
    /// The column held the literal default text; the caller substitutes
    /// the row's creation instant (or the import instant).
    LiteralDefault,
    /// A malformed value made valid (see [`repair_uuid`]).
    Repaired,
}

/// A value the import cannot turn into something the app can read.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{0}")]
pub struct Reject(pub String);

pub fn reject<T>(msg: impl Into<String>) -> Result<T, Reject> {
    Err(Reject(msg.into()))
}

/// Convert one cell to `kind`.
pub fn convert(kind: Kind, cell: Cell) -> Result<(Cell, Change), Reject> {
    if cell == Cell::Null {
        return Ok((Cell::Null, Change::Same));
    }
    match kind {
        Kind::Text => Ok((cell, Change::Same)),
        Kind::Uuid => uuid_cell(cell),
        Kind::Instant | Kind::InstantText | Kind::InstantOrLocal => instant_cell(kind, cell),
        Kind::Date => date_cell(cell),
        Kind::Bool => bool_cell(cell),
        Kind::Int(width) => int_cell(cell, width),
        Kind::Real => real_cell(cell),
        Kind::DaysMask => days_cell(cell),
    }
}

// ── UUIDs ────────────────────────────────────────────────────────────

/// The UUID in its canonical hyphenated form (8-4-4-4-12), any case.
/// Anything else (braces, `urn:uuid:`, no hyphens) is refused: a strict
/// check keeps a mistyped id from becoming a different, valid-looking one.
pub fn parse_uuid(text: &str) -> Result<Uuid, Reject> {
    let b = text.as_bytes();
    let hyphens_in_place = b.len() == 36 && [8, 13, 18, 23].iter().all(|&i| b[i] == b'-');
    match Uuid::parse_str(text) {
        Ok(id) if hyphens_in_place => Ok(id),
        _ => reject(format!("not a 36-character UUID: {text:?}")),
    }
}

/// The Worker's RBAC seed (`0001_fts_and_seeds.sql`) numbers sixteen
/// permissions `…-b000-00000000010` to `…-b000-0000000001f`: the last group
/// is one zero short. The same typo is in every grant that names them, so
/// padding the group gives each a valid id and keeps every reference
/// pointing at it (the seeded rows are only ever addressed by name).
/// Returns the padded text when that is all that is wrong.
pub fn repair_uuid(text: &str) -> Option<String> {
    let groups: Vec<&str> = text.split('-').collect();
    let widths = [8, 4, 4, 4];
    let well_formed = groups.len() == 5
        && groups[..4].iter().zip(widths).all(|(g, w)| g.len() == w)
        && (1..12).contains(&groups[4].len())
        && groups
            .iter()
            .all(|g| g.bytes().all(|c| c.is_ascii_hexdigit()));
    well_formed.then(|| {
        format!(
            "{}-{}-{}-{}-{:0>12}",
            groups[0], groups[1], groups[2], groups[3], groups[4]
        )
    })
}

fn uuid_cell(cell: Cell) -> Result<(Cell, Change), Reject> {
    match cell {
        Cell::Text(t) => match parse_uuid(&t) {
            Ok(id) => Ok((Cell::Blob(id.as_bytes().to_vec()), Change::Reshaped)),
            Err(rejected) => match repair_uuid(&t) {
                Some(padded) => Ok((
                    Cell::Blob(parse_uuid(&padded)?.as_bytes().to_vec()),
                    Change::Repaired,
                )),
                None => Err(rejected),
            },
        },
        Cell::Blob(b) if b.len() == 16 => Ok((Cell::Blob(b), Change::Same)),
        other => reject(format!("not a UUID: {other:?}")),
    }
}

// ── Instants ─────────────────────────────────────────────────────────

/// What a timestamp column held.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Parsed {
    Instant(DateTime<Utc>),
    /// The literal default text.
    LiteralDefault,
    /// A timestamp without a zone (`2026-11-15T09:30:00`).
    Local(NaiveDateTime),
}

/// Read a D1 timestamp. D1 holds three shapes: the Worker's
/// `toISOString()` (`…T10:00:00.123Z`), SQLite's own `datetime('now')`
/// (`2026-11-15 10:00:00`, UTC), and the literal default text. Zone-less
/// values are UTC except where the caller says otherwise (`Parsed::Local`).
pub fn parse_instant(raw: &str) -> Result<Parsed, Reject> {
    let s = raw.trim();
    if s == LITERAL_DEFAULT {
        return Ok(Parsed::LiteralDefault);
    }
    if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
        return Ok(Parsed::Instant(dt.with_timezone(&Utc)));
    }
    const ZONELESS: [&str; 2] = ["%Y-%m-%d %H:%M:%S%.f", "%Y-%m-%dT%H:%M:%S%.f"];
    for format in ZONELESS {
        if let Ok(naive) = NaiveDateTime::parse_from_str(s, format) {
            return Ok(Parsed::Local(naive));
        }
    }
    // `2026-11-15 10:00:00Z` / `… +07:00`: the same with a space.
    if let Some((date, rest)) = s.split_once(' ') {
        if let Ok(dt) = DateTime::parse_from_rfc3339(&format!("{date}T{rest}")) {
            return Ok(Parsed::Instant(dt.with_timezone(&Utc)));
        }
    }
    reject(format!("not a timestamp: {raw:?}"))
}

/// An instant as an entity `DateTimeUtc` column stores it.
pub fn format_instant_sqlx(at: DateTime<Utc>) -> String {
    at.to_rfc3339_opts(SecondsFormat::AutoSi, false)
}

/// An instant as the app writes it into `String` columns.
pub fn format_instant_text(at: DateTime<Utc>) -> String {
    at.to_rfc3339_opts(SecondsFormat::AutoSi, true)
}

/// Format `at` the way `kind` stores instants.
pub fn format_instant(kind: Kind, at: DateTime<Utc>) -> String {
    match kind {
        Kind::Instant => format_instant_sqlx(at),
        _ => format_instant_text(at),
    }
}

fn instant_cell(kind: Kind, cell: Cell) -> Result<(Cell, Change), Reject> {
    let Cell::Text(text) = cell else {
        return reject(format!("a timestamp must be text, got {cell:?}"));
    };
    let (instant, change) = match parse_instant(&text)? {
        Parsed::LiteralDefault => return Ok((Cell::Text(text), Change::LiteralDefault)),
        Parsed::Instant(at) => (at, Change::Reshaped),
        Parsed::Local(_) if kind == Kind::InstantOrLocal => {
            return Ok((Cell::Text(text), Change::Same))
        }
        Parsed::Local(naive) => (naive.and_utc(), Change::Reshaped),
    };
    let out = format_instant(kind, instant);
    let change = if out == text { Change::Same } else { change };
    Ok((Cell::Text(out), change))
}

fn date_cell(cell: Cell) -> Result<(Cell, Change), Reject> {
    let Cell::Text(text) = cell else {
        return reject(format!("a date must be text, got {cell:?}"));
    };
    let s = text.trim();
    let day = s.get(..10).unwrap_or("");
    let well_formed = NaiveDate::parse_from_str(day, "%Y-%m-%d").is_ok() && day.len() == 10;
    let rest = &s[day.len().min(s.len())..];
    if well_formed && (rest.is_empty() || rest.starts_with('T') || rest.starts_with(' ')) {
        let change = if day == text {
            Change::Same
        } else {
            Change::Reshaped
        };
        return Ok((Cell::Text(day.to_owned()), change));
    }
    reject(format!("not a YYYY-MM-DD date: {text:?}"))
}

// ── Numbers ──────────────────────────────────────────────────────────

fn bool_cell(cell: Cell) -> Result<(Cell, Change), Reject> {
    match cell {
        Cell::Int(0 | 1) => Ok((cell, Change::Same)),
        Cell::Text(t) => match t.trim().to_ascii_lowercase().as_str() {
            "1" | "true" => Ok((Cell::Int(1), Change::Reshaped)),
            "0" | "false" => Ok((Cell::Int(0), Change::Reshaped)),
            _ => reject(format!("not a boolean: {t:?}")),
        },
        other => reject(format!("not a boolean: {other:?}")),
    }
}

fn int_cell(cell: Cell, width: IntWidth) -> Result<(Cell, Change), Reject> {
    let (value, change) = match cell {
        Cell::Int(v) => (v, Change::Same),
        // A whole number D1 stored as REAL (JavaScript numbers).
        #[allow(clippy::cast_possible_truncation)]
        Cell::Real(r) if r.fract() == 0.0 && r.abs() < 9.0e15 => (r as i64, Change::Reshaped),
        Cell::Text(ref t) => match t.trim().parse::<i64>() {
            Ok(v) => (v, Change::Reshaped),
            Err(_) => return reject(format!("not an integer: {t:?}")),
        },
        other => return reject(format!("not an integer: {other:?}")),
    };
    if !width.contains(value) {
        return reject(format!("{value} does not fit {width:?}"));
    }
    Ok((Cell::Int(value), change))
}

fn real_cell(cell: Cell) -> Result<(Cell, Change), Reject> {
    match cell {
        Cell::Real(_) => Ok((cell, Change::Same)),
        #[allow(clippy::cast_precision_loss)]
        Cell::Int(v) => Ok((Cell::Real(v as f64), Change::Reshaped)),
        Cell::Text(ref t) => match t.trim().parse::<f64>() {
            Ok(v) if v.is_finite() => Ok((Cell::Real(v), Change::Reshaped)),
            _ => reject(format!("not a number: {t:?}")),
        },
        other => reject(format!("not a number: {other:?}")),
    }
}

// ── Schedules ────────────────────────────────────────────────────────

/// `schedule.days_of_week`: the app's mask, Monday first. D1 rows hold
/// either that mask already, or the Worker port's earlier JSON array of
/// weekday numbers 1..=7 with Sunday = 1 (`["2","3"]` = Monday, Tuesday);
/// an empty array or empty text means every day, which the app stores as
/// no mask at all.
pub fn days_mask(raw: &str) -> Result<Option<String>, Reject> {
    let s = raw.trim();
    if s.is_empty() {
        return Ok(None);
    }
    if s.len() == 7 && s.bytes().all(|c| c == b'0' || c == b'1') {
        return Ok(Some(s.to_owned()));
    }
    let numbers: Vec<serde_json::Value> = serde_json::from_str(s).map_err(|_| {
        Reject(format!(
            "days_of_week is neither a mask nor a JSON array: {raw:?}"
        ))
    })?;
    if numbers.is_empty() {
        return Ok(None);
    }
    let mut mask = *b"0000000";
    for value in &numbers {
        let day = match value {
            serde_json::Value::Number(n) => n.as_i64(),
            serde_json::Value::String(t) => t.trim().parse::<i64>().ok(),
            _ => None,
        };
        let Some(day @ 1..=7) = day else {
            return reject(format!("weekday {value} outside 1..=7 in {raw:?}"));
        };
        // Sunday (1) is the mask's last slot, Monday (2) its first.
        mask[((day + 5) % 7) as usize] = b'1';
    }
    Ok(Some(String::from_utf8(mask.to_vec()).expect("ASCII")))
}

fn days_cell(cell: Cell) -> Result<(Cell, Change), Reject> {
    let Cell::Text(text) = cell else {
        return reject(format!("days_of_week must be text, got {cell:?}"));
    };
    let change = if text.trim().len() == 7 && text.trim() == text {
        Change::Same
    } else {
        Change::Reshaped
    };
    Ok(match days_mask(&text)? {
        Some(mask) => (Cell::Text(mask), change),
        None => (Cell::Null, Change::Reshaped),
    })
}

/// The app's name for a schedule stop. The Worker called them
/// departure / intermediate / destination; the app writes
/// pickup / middle / drop (and already-converted names pass through).
pub fn stop_kind(raw: &str) -> Result<&'static str, Reject> {
    match raw.trim() {
        "departure" | "pickup" => Ok("pickup"),
        "intermediate" | "middle" => Ok("middle"),
        "destination" | "drop" => Ok("drop"),
        other => reject(format!("unknown schedule stop kind {other:?}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(s: &str) -> Cell {
        Cell::Text(s.to_owned())
    }

    fn conv(kind: Kind, s: &str) -> Result<(Cell, Change), Reject> {
        convert(kind, text(s))
    }

    #[test]
    fn a_uuid_becomes_its_sixteen_bytes_as_sqlx_encodes_it() {
        let id = "085de57d-d6fc-4e88-bb39-b6a3906e801f";
        let (cell, change) = conv(Kind::Uuid, id).unwrap();
        let expected = Uuid::parse_str(id).unwrap().as_bytes().to_vec();
        assert_eq!(cell, Cell::Blob(expected));
        assert_eq!(change, Change::Reshaped);
        // Upper case is the same id.
        let upper = conv(Kind::Uuid, &id.to_uppercase()).unwrap().0;
        assert_eq!(upper, cell);
    }

    #[test]
    fn the_workers_seed_ids_one_zero_short_are_padded_and_nothing_else_is_guessed() {
        let (cell, change) = conv(Kind::Uuid, "00000000-0000-4000-b000-00000000010").unwrap();
        assert_eq!(change, Change::Repaired);
        assert_eq!(
            cell,
            Cell::Blob(
                Uuid::parse_str("00000000-0000-4000-b000-000000000010")
                    .unwrap()
                    .as_bytes()
                    .to_vec()
            )
        );
        // Only the last group may be short, and only with hex digits.
        for bad in [
            "00000000-0000-4000-b00-000000000010",
            "0000000-0000-4000-b000-000000000010",
            "00000000-0000-4000-b000-0000000000g",
            "00000000-0000-4000-b000-",
            "00000000-0000-4000-b000-0000000000100",
        ] {
            assert!(conv(Kind::Uuid, bad).is_err(), "{bad:?} must be refused");
        }
    }

    #[test]
    fn only_the_canonical_36_character_form_is_a_uuid() {
        for bad in [
            "085de57dd6fc4e88bb39b6a3906e801f",
            "{085de57d-d6fc-4e88-bb39-b6a3906e801f}",
            "urn:uuid:085de57d-d6fc-4e88-bb39-b6a3906e801f",
            "085de57d-d6fc-4e88-bb39-b6a3906e801f0",
            "system",
            "",
        ] {
            assert!(conv(Kind::Uuid, bad).is_err(), "{bad:?} must be refused");
        }
    }

    #[test]
    fn the_worker_timestamp_becomes_the_sqlx_encoding_for_entity_instants() {
        let (cell, change) = conv(Kind::Instant, "2026-11-15T10:00:00.123Z").unwrap();
        assert_eq!(cell, text("2026-11-15T10:00:00.123+00:00"));
        assert_eq!(change, Change::Reshaped);
        // No fraction, no digits: exactly what `to_rfc3339_opts(AutoSi)` writes.
        assert_eq!(
            conv(Kind::Instant, "2026-11-15T10:00:00.000Z").unwrap().0,
            text("2026-11-15T10:00:00+00:00")
        );
    }

    #[test]
    fn instant_strings_keep_the_z_suffix_the_store_compares() {
        assert_eq!(
            conv(Kind::InstantText, "2026-11-15T10:00:00.123Z").unwrap(),
            (text("2026-11-15T10:00:00.123Z"), Change::Same)
        );
        assert_eq!(
            conv(Kind::InstantText, "2026-11-15T17:00:00+07:00")
                .unwrap()
                .0,
            text("2026-11-15T10:00:00Z")
        );
    }

    #[test]
    fn sqlites_own_datetime_is_utc() {
        assert_eq!(
            conv(Kind::InstantText, "2026-11-15 10:00:00").unwrap().0,
            text("2026-11-15T10:00:00Z")
        );
        assert_eq!(
            conv(Kind::Instant, "2026-11-15 10:00:00.5").unwrap().0,
            text("2026-11-15T10:00:00.500+00:00")
        );
    }

    #[test]
    fn a_zoneless_departure_stays_local_time() {
        let (cell, change) = conv(Kind::InstantOrLocal, "2026-11-15T07:30:00").unwrap();
        assert_eq!((cell, change), (text("2026-11-15T07:30:00"), Change::Same));
        assert_eq!(
            conv(Kind::InstantOrLocal, "2026-11-15T07:30:00.000Z")
                .unwrap()
                .0,
            text("2026-11-15T07:30:00Z")
        );
    }

    #[test]
    fn the_literal_default_is_flagged_for_the_caller() {
        let (_, change) = conv(Kind::InstantText, LITERAL_DEFAULT).unwrap();
        assert_eq!(change, Change::LiteralDefault);
        let (_, change) = conv(Kind::Instant, LITERAL_DEFAULT).unwrap();
        assert_eq!(change, Change::LiteralDefault);
    }

    #[test]
    fn an_unparseable_timestamp_is_refused() {
        for bad in ["yesterday", "2026-13-45T00:00:00Z", "10:00", ""] {
            assert!(conv(Kind::InstantText, bad).is_err(), "{bad:?}");
        }
        assert!(convert(Kind::Instant, Cell::Int(1_700_000_000)).is_err());
    }

    #[test]
    fn dates_are_trimmed_to_the_day_and_checked() {
        assert_eq!(
            conv(Kind::Date, "2026-11-15").unwrap(),
            (text("2026-11-15"), Change::Same)
        );
        assert_eq!(
            conv(Kind::Date, "2026-11-15T00:00:00.000Z").unwrap(),
            (text("2026-11-15"), Change::Reshaped)
        );
        assert!(conv(Kind::Date, "2026-02-30").is_err());
        assert!(conv(Kind::Date, "15/11/2026").is_err());
        assert!(conv(Kind::Date, "2026-11-15garbage").is_err());
    }

    #[test]
    fn booleans_are_zero_or_one() {
        assert_eq!(convert(Kind::Bool, Cell::Int(1)).unwrap().0, Cell::Int(1));
        assert_eq!(conv(Kind::Bool, "false").unwrap().0, Cell::Int(0));
        assert!(convert(Kind::Bool, Cell::Int(2)).is_err());
        assert!(conv(Kind::Bool, "yes").is_err());
    }

    #[test]
    fn integers_must_fit_the_entity_field() {
        let int = |v, w| convert(Kind::Int(w), Cell::Int(v));
        assert!(int(32_767, IntWidth::I16).is_ok());
        assert!(int(32_768, IntWidth::I16).is_err());
        assert!(int(i64::MAX, IntWidth::I64).is_ok());
        assert_eq!(
            convert(Kind::Int(IntWidth::I64), Cell::Real(450_000.0))
                .unwrap()
                .0,
            Cell::Int(450_000)
        );
        assert!(convert(Kind::Int(IntWidth::I64), Cell::Real(1.5)).is_err());
        assert_eq!(
            conv(Kind::Int(IntWidth::I32), " 42 ").unwrap().0,
            Cell::Int(42)
        );
    }

    #[test]
    fn coordinates_stored_as_text_become_reals() {
        assert_eq!(conv(Kind::Real, "10.7769").unwrap().0, Cell::Real(10.7769));
        assert_eq!(
            convert(Kind::Real, Cell::Int(3)).unwrap().0,
            Cell::Real(3.0)
        );
        assert!(conv(Kind::Real, "north").is_err());
        assert!(conv(Kind::Real, "NaN").is_err());
    }

    #[test]
    fn null_stays_null_whatever_the_kind() {
        for kind in [
            Kind::Uuid,
            Kind::Instant,
            Kind::Date,
            Kind::Bool,
            Kind::Real,
        ] {
            assert_eq!(
                convert(kind, Cell::Null).unwrap(),
                (Cell::Null, Change::Same)
            );
        }
    }

    #[test]
    fn the_masks_pass_through_and_json_weekdays_are_converted() {
        assert_eq!(days_mask("1111100").unwrap().as_deref(), Some("1111100"));
        // 1 = Sunday … 7 = Saturday; the mask is Monday first.
        assert_eq!(
            days_mask("[2,3,4,5,6]").unwrap().as_deref(),
            Some("1111100")
        );
        assert_eq!(days_mask("[1,7]").unwrap().as_deref(), Some("0000011"));
        assert_eq!(
            days_mask(r#"["1","2"]"#).unwrap().as_deref(),
            Some("1000001")
        );
        assert_eq!(
            days_mask("[1,2,3,4,5,6,7]").unwrap().as_deref(),
            Some("1111111")
        );
        assert_eq!(days_mask("[]").unwrap(), None);
        assert_eq!(days_mask("  ").unwrap(), None);
    }

    #[test]
    fn a_weekday_outside_the_range_is_refused() {
        for bad in ["[0]", "[8]", "[\"mon\"]", "monday", "111110", "[1.5]"] {
            assert!(days_mask(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn stop_kinds_map_both_vocabularies() {
        assert_eq!(stop_kind("departure").unwrap(), "pickup");
        assert_eq!(stop_kind("intermediate").unwrap(), "middle");
        assert_eq!(stop_kind("destination").unwrap(), "drop");
        assert_eq!(stop_kind("pickup").unwrap(), "pickup");
        assert_eq!(stop_kind("middle").unwrap(), "middle");
        assert_eq!(stop_kind("drop").unwrap(), "drop");
        assert!(stop_kind("terminus").is_err());
    }
}
