//! The JSON report `import-d1` writes: what was read, what arrived, what
//! did not and why, and the checks that prove the result.

use std::collections::BTreeMap;

use serde::Serialize;

/// Most row keys listed per reason; the count is always exact.
const KEYS_LISTED: usize = 1000;

/// Rows that share one reason for not being imported as they were.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Group {
    pub reason: String,
    pub count: u64,
    /// Primary keys of the affected rows (UUIDs as text), capped.
    pub keys: Vec<String>,
    pub keys_truncated: bool,
}

/// Rows grouped by reason (sorted by the reason's text).
#[derive(Debug, Default, Clone)]
pub struct Tally(BTreeMap<String, (u64, Vec<String>)>);

impl Tally {
    pub fn add(&mut self, reason: impl Into<String>, key: Option<String>) {
        let entry = self.0.entry(reason.into()).or_default();
        entry.0 += 1;
        if let Some(key) = key {
            if entry.1.len() < KEYS_LISTED {
                entry.1.push(key);
            }
        }
    }

    pub fn add_many(&mut self, reason: impl Into<String>, n: u64) {
        if n > 0 {
            self.0.entry(reason.into()).or_default().0 += n;
        }
    }

    pub fn total(&self) -> u64 {
        self.0.values().map(|(n, _)| n).sum()
    }

    /// How many rows were counted under exactly this reason.
    pub fn count_of(&self, reason: &str) -> u64 {
        self.0.get(reason).map_or(0, |(n, _)| *n)
    }

    pub fn groups(&self) -> Vec<Group> {
        self.0
            .iter()
            .map(|(reason, (count, keys))| Group {
                reason: reason.clone(),
                count: *count,
                keys: keys.clone(),
                keys_truncated: *count > keys.len() as u64 && !keys.is_empty(),
            })
            .collect()
    }
}

/// One table's accounting. `source_rows == imported_rows + skipped +
/// pruned + rejected` or the run is not clean.
#[derive(Debug, Serialize)]
pub struct TableReport {
    pub table: String,
    /// The stage table it came from (`nullclaw_exchange` for
    /// `null_claw_exchange`).
    pub source_table: String,
    pub source_rows: u64,
    pub imported_rows: u64,
    /// Rows the app database already needed and D1 lacked (RBAC seeds).
    pub restored_rows: u64,
    /// Not imported, for a stated and expected reason: a constraint the
    /// app schema has and D1 did not, a missing parent row, a table the
    /// cutover plan leaves behind.
    pub skipped: Vec<Group>,
    /// Not imported on purpose, as the app's own boot code would delete
    /// them (`ensure_default_jobs`).
    pub pruned: Vec<Group>,
    /// Values the app cannot read (bad UUID, bad timestamp). Any of these
    /// makes the run not clean.
    pub rejected: Vec<Group>,
    /// Rows kept with a changed value, by what changed.
    pub fixes: BTreeMap<String, u64>,
    pub reconciled: bool,
}

/// A stage table the app has no counterpart for.
#[derive(Debug, Serialize)]
pub struct StageOnlyTable {
    pub table: String,
    pub rows: u64,
    /// `ignored` (D1 / Cloudflare bookkeeping, FTS shadow tables) or
    /// `unexplained` (rows with nowhere to go: the run is not clean).
    pub disposition: &'static str,
}

#[derive(Debug, Serialize)]
pub struct DroppedColumn {
    pub table: String,
    pub column: String,
    pub non_null_rows: u64,
}

/// A UNIQUE constraint of the app schema, compared with the stage.
#[derive(Debug, Serialize)]
pub struct UniqueDiff {
    pub table: String,
    pub columns: Vec<String>,
    /// D1 enforced the same uniqueness.
    pub in_source: bool,
    /// Rows left out because they broke it.
    pub rows_skipped: u64,
}

/// A column the app requires and D1 allowed to be empty.
#[derive(Debug, Serialize)]
pub struct NullabilityDiff {
    pub table: String,
    pub column: String,
    pub source_null_rows: u64,
}

/// A foreign key of the app schema, compared with the stage.
#[derive(Debug, Serialize)]
pub struct FkDiff {
    pub table: String,
    pub columns: Vec<String>,
    pub parent: String,
    pub on_delete: String,
    /// D1 declared the same reference.
    pub in_source: bool,
    /// Dangling references found in the copied data (before repair).
    pub violations: u64,
}

#[derive(Debug, Default, Serialize)]
pub struct SeedReport {
    /// The migrator's random seed rows were removed and D1's roles,
    /// permissions, grants and vehicle types took their place.
    pub replaced: BTreeMap<String, u64>,
    /// Roles / permissions the app needs by name that D1 did not have,
    /// kept from the migrator's seed.
    pub restored: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct DerivedCounter {
    pub table: String,
    pub column: String,
    pub rule: &'static str,
    /// Rows the rule applied to.
    pub considered: u64,
    /// Rows whose D1 value differed and was replaced.
    pub changed: u64,
}

#[derive(Debug, Serialize)]
pub struct JsonWarning {
    pub table: String,
    pub column: String,
    pub invalid_rows: u64,
}

#[derive(Debug, Default, Serialize)]
pub struct Checks {
    pub stage_integrity_check: Vec<String>,
    /// `table -> parent -> dangling rows` in the stage (informational: D1
    /// did not always enforce its foreign keys).
    pub stage_foreign_key_violations: BTreeMap<String, BTreeMap<String, u64>>,
    pub integrity_check: Vec<String>,
    /// Must be empty.
    pub foreign_key_check: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct DecodeResult {
    pub table: String,
    /// Rows decoded through the sea-orm entity.
    pub rows: Option<u64>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct Report {
    pub clean: bool,
    /// Why `clean` is false.
    pub problems: Vec<String>,
    pub stage: String,
    pub out: String,
    pub sqlite_version: String,
    pub import_instant: String,
    pub tables: Vec<TableReport>,
    pub stage_only_tables: Vec<StageOnlyTable>,
    pub dropped_columns: Vec<DroppedColumn>,
    pub unique_diff: Vec<UniqueDiff>,
    pub nullability_diff: Vec<NullabilityDiff>,
    pub fk_diff: Vec<FkDiff>,
    pub seeds: SeedReport,
    pub derived: Vec<DerivedCounter>,
    pub json_warnings: Vec<JsonWarning>,
    pub checks: Checks,
    pub decode: Vec<DecodeResult>,
}

impl Report {
    /// One line per table that lost or changed rows, for the terminal.
    pub fn summary(&self) -> String {
        use std::fmt::Write as _;
        let mut out = String::new();
        let (mut source, mut imported) = (0, 0);
        for t in &self.tables {
            source += t.source_rows;
            imported += t.imported_rows;
            let skipped: u64 = t.skipped.iter().map(|g| g.count).sum();
            let pruned: u64 = t.pruned.iter().map(|g| g.count).sum();
            let rejected: u64 = t.rejected.iter().map(|g| g.count).sum();
            if skipped + pruned + rejected > 0 || !t.reconciled {
                let _ = writeln!(
                    out,
                    "  {:<24} {} -> {} (skipped {skipped}, pruned {pruned}, rejected {rejected})",
                    t.table, t.source_rows, t.imported_rows
                );
            }
        }
        let _ = writeln!(out, "  total: {source} source rows, {imported} imported");
        for problem in &self.problems {
            let _ = writeln!(out, "  PROBLEM: {problem}");
        }
        out
    }
}
