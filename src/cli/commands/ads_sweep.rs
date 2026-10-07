//! `backend ads-sweep` — backfill-upload stored ad conversions.
//!
//! Every conversion the beacon endpoint records is durable in the
//! `ad_conversion` table. Rows stored while the `GOOGLE_ADS_*`
//! credential group was incomplete (status `unconfigured`), plus rows
//! whose upload failed (`error`), are retried by this command once
//! the credentials are live — nothing recorded is ever lost.
//!
//! Run it after enabling credentials, and periodically (cron) if
//! desired; `--limit` bounds the batch.

use anyhow::Context;

use crate::cli::util::db_connect;
use crate::config::Config;

pub async fn run(limit: u64) -> anyhow::Result<()> {
    let cfg = Config::load().context("loading config")?;
    let db = db_connect(&cfg).await?;
    let db = std::sync::Arc::new(db);

    if !cfg.google_ads.is_active() {
        anyhow::bail!(
            "GOOGLE_ADS_* credentials incomplete — set DEVELOPER_TOKEN, CUSTOMER_ID, \
             CLIENT_ID, CLIENT_SECRET and REFRESH_TOKEN to enable uploads \
             (rows stay stored and retryable)"
        );
    }

    crate::ads::init(
        db,
        Some(crate::ads::GoogleAdsApi::new(cfg.google_ads.clone())),
    );
    let uploaded = crate::ads::ads()
        .sweep(limit)
        .await
        .map_err(|e| anyhow::anyhow!("sweep: {e}"))?;
    println!("uploaded {uploaded} conversion(s) (batch limit {limit})");
    Ok(())
}
