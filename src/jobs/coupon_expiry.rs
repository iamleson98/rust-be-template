//! `coupons.expire` — nightly: unused coupons whose window passed become
//! `expired`, which frees their owners to claim again and keeps the
//! campaign numbers honest.
//!
//! Expiry is also applied lazily wherever a coupon is read or used, so
//! a late or skipped run never lets a stale coupon through; this job
//! only tidies the ones nobody touched.

use std::sync::Arc;

use async_trait::async_trait;
use chrono::{SecondsFormat, Utc};
use serde_json::json;

use crate::store::CampaignStore;
use crate::worker::{Job, JobContext, JobPolicy};

use super::JobDeps;

pub struct CouponExpiry {
    campaigns: Arc<dyn CampaignStore>,
}

impl CouponExpiry {
    pub fn new(deps: &JobDeps) -> Self {
        Self {
            campaigns: deps.campaigns.clone(),
        }
    }
}

#[async_trait]
impl Job for CouponExpiry {
    const KIND: &'static str = "coupons.expire";
    type Args = ();

    fn policy(&self) -> JobPolicy {
        JobPolicy {
            max_attempts: 3,
            ..JobPolicy::default()
        }
    }

    async fn perform(&self, ctx: &JobContext, _: ()) -> anyhow::Result<()> {
        let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
        let expired = self.campaigns.expire_stale(&now).await?;
        ctx.progress(json!({
            "phase": "done",
            "message": format!("expired {expired} unused coupons"),
            "expired": expired,
        }))
        .await;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::DbCampaignStore;
    use crate::worker::NoObserver;

    #[tokio::test]
    async fn runs_on_an_empty_ledger() {
        let db = crate::store::migrated_test_db().await;
        let job = CouponExpiry {
            campaigns: Arc::new(DbCampaignStore::new(db)),
        };
        job.perform(&JobContext::for_test(Arc::new(NoObserver)), ())
            .await
            .unwrap();
    }
}
