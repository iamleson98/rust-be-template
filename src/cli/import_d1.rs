//! `backend import-d1` — Cloudflare D1 export → app database.

use std::path::PathBuf;

pub async fn run(_stage: PathBuf, _out: PathBuf, _report: PathBuf) -> anyhow::Result<()> {
    anyhow::bail!("import-d1 is not implemented yet")
}
