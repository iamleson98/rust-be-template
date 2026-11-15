# libsqlite3-sys (vendored, patched)

A copy of [`libsqlite3-sys`](https://crates.io/crates/libsqlite3-sys) 0.30.1
(the version `sqlx-sqlite` 0.8 resolves to), wired in through
`[patch.crates-io]` in the workspace `Cargo.toml`. Differences from upstream:

- `sqlite3/sqlite3.{c,h}` and `sqlite3ext.h` are the amalgamation of SQLite's
  `begin-concurrent-3.51` branch (`BEGIN CONCURRENT`, which no release
  amalgamation has, on the 3.51 release line: its tip is stamped
  "Version 3.51.3 for the begin-concurrent branch", unlike the
  `begin-concurrent` trunk branch). Regenerate with `scripts/sqlite-amalgamate.sh <sha>`;
  the pinned commit, SQLite source id and version are in `PINNED`.
- The prebuilt Rust bindings under `sqlite3/` are upstream's (generated from
  SQLite 3.46); the symbols `sqlx-sqlite` uses are unchanged in newer SQLite.
- `build.rs` adds the compile flags `SQLITE_DQS=0`,
  `SQLITE_DEFAULT_WAL_SYNCHRONOUS=1`, `SQLITE_ENABLE_MATH_FUNCTIONS` and
  `SQLITE_LIKE_DOESNT_MATCH_BLOBS`.

SQLite itself is public domain; the Rust wrapper code is MIT (see `LICENSE`).
