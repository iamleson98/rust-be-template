//! Database engine identity for this project.
//!
//! The ONLY database engine is **rust-sql** (`rustqlite`), consumed
//! through its C-ABI compatibility layer:
//!
//! * `libsqlite3-sys` is `[patch.crates-io]`-redirected to
//!   `rust-sql/compat/libsqlite3-sys`, and `rustqlite-compat`
//!   (crate `sqlite3`) implements the `sqlite3_*` C ABI on the
//!   pure-Rust engine.
//! * sea-orm (via sqlx-sqlite) speaks that ABI — every call lands in
//!   the rustqlite engine compiled INTO the binary (rlib link mode,
//!   see `.cargo/config.toml`). There is no C SQLite, no
//!   `libsqlite3.so`, and no postgres backend in this project.
//! * The on-disk format is rustqlite's own (`RSQLDB01` magic); files
//!   written by C SQLite are NOT openable — legacy import support has
//!   been removed (2026-09): rust-sql is the only engine, past the
//!   transition window.

// Force the rustqlite engine into every binary that links this crate
// (rlib link mode — see .cargo/config.toml). sqlx-sqlite's objects carry
// the sqlite3_* undefined references, but rustc keeps the `sqlite3`
// crate's rlib on a binary's link line only when some compiled code
// REFERENCES the crate — the C-ABI #[no_mangle] exports alone are
// invisible to that selection. This anchor references the compat
// crate's Rust-visible `engine_version`, so the rlib (and its engine
// dependency) land on the link line of every dependent — integration
// tests included — and ALL 124 sqlite3_* exports come with them.
#[used]
static ENGINE_LINK_ANCHOR: fn() -> &'static str = sqlite3::engine_version;

/// The SQLite C API version the compat layer reports (what
/// `sqlite3_libversion()` would answer — sqlx expects a version here).
/// For the engine's BUILD identity (which names rustqlite), use
/// [`engine_source_id`].
pub fn engine_version() -> &'static str {
    sqlite3::engine_version()
}

/// The engine's build identity (matches `sqlite3_source_id()`) — this
/// is the string that names the rustqlite engine.
pub fn engine_source_id() -> &'static str {
    sqlite3::engine_source_id()
}

#[cfg(test)]
mod tests {
    #[test]
    fn engine_is_rustqlite() {
        // engine_version() answers the SQLite C API version (sqlx
        // compatibility); engine_source_id() carries the BUILD identity
        // and must name the rustqlite engine.
        let v = super::engine_version();
        assert!(!v.is_empty(), "engine version: {v}");
        let source_id = super::engine_source_id();
        assert!(
            source_id.to_lowercase().contains("rustqlite"),
            "engine source id: {source_id}"
        );
    }
}
