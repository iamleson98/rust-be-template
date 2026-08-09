//! Shared helpers used by CLI command handlers.

use crate::config::Config;
use anyhow::Context;

/// Construct a DB connection (without applying migrations) for use in
/// CLI commands that need to talk to the DB.
pub async fn db_connect(cfg: &Config) -> anyhow::Result<sea_orm::DatabaseConnection> {
    let mut opts = sea_orm::ConnectOptions::new(&cfg.database.url);
    opts.max_connections(cfg.database.max_connections)
        .min_connections(cfg.database.min_connections)
        .connect_timeout(cfg.database.connect_timeout())
        .idle_timeout(cfg.database.idle_timeout())
        .sqlx_logging(cfg.database.enable_sqlx_logs);
    let db = sea_orm::Database::connect(opts)
        .await
        .context("connecting to database")?;
    Ok(db)
}

/// Returns the cargo feature that's currently active for the DB backend.
pub fn db_backend_name() -> &'static str {
    #[cfg(feature = "postgres")]
    {
        "postgres"
    }
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    {
        "sqlite"
    }
    #[cfg(not(any(feature = "postgres", feature = "sqlite")))]
    {
        compile_error!(
            "no DB backend feature enabled; rebuild with --features sqlite or --features postgres"
        );
    }
}

/// Format a `Duration` as `1.234s` / `56ms` / `789µs` for human-friendly
/// timing output.
// pub fn fmt_duration(d: Duration) -> String {
//     let nanos = d.as_nanos();
//     if nanos >= 1_000_000_000 {
//         format!("{:.3}s", d.as_secs_f64())
//     } else if nanos >= 1_000_000 {
//         format!("{:.3}ms", nanos as f64 / 1_000_000.0)
//     } else if nanos >= 1_000 {
//         format!("{:.3}µs", nanos as f64 / 1_000.0)
//     } else {
//         format!("{}ns", nanos)
//     }
// }

/// Mask a secret string, showing only the first 4 and last 4 characters
/// (or full string if shorter than 12 chars).
pub fn mask_secret(s: &str) -> String {
    if s.len() < 12 {
        return "*".repeat(s.len().max(1));
    }
    let head = &s[..4];
    let tail = &s[s.len() - 4..];
    format!("{head}…{tail}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mask_short_secret() {
        assert_eq!(mask_secret("abc"), "***");
        assert_eq!(mask_secret(""), "");
    }

    #[test]
    fn mask_long_secret() {
        let masked = mask_secret("abcdefghijklmnopqrstuvwxyz");
        assert_eq!(masked, "abcd…wxyz");
    }

    #[test]
    fn backend_name_is_set() {
        assert!(matches!(db_backend_name(), "sqlite" | "postgres"));
    }
}
