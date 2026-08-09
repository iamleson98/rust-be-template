//! Test: #[retry] actually retries on transient errors.
//!
//! This test runs against a deliberately-unreachable Postgres, so DB
//! calls fail with `ConnectionError`. We assert that the macro:
//! - Calls the body multiple times (3 retries + 1 initial = 4 attempts)
//! - Returns StoreError::Exhausted when attempts run out

use std::sync::Arc;
use std::time::{Duration, Instant};

use sea_orm::{ConnectOptions, Database};

use backend::store::{RetryPolicy, StoreError};

#[tokio::test]
#[ignore = "needs unreachable Postgres at port 5433 to fail; run manually"]
async fn retry_macro_fires_on_db_errors() {
    // Point at a port where nothing is listening — connection refused.
    let mut opts = ConnectOptions::new("postgres://postgres:postgres@localhost:5433/app");
    opts.max_connections(1);
    let db = Database::connect(opts).await.unwrap();
    let store = DbStore::new(Arc::new(db));

    let start = Instant::now();
    let result = store.get_user(uuid::Uuid::new_v4()).await;
    let elapsed = start.elapsed();

    // Should have retried 3 times (default) before failing.
    assert!(
        matches!(result, Err(StoreError::Exhausted { retries: 3, .. })),
        "expected Exhausted after 3 retries, got: {:?}",
        result
    );

    // Total delay should be at least 100+200+400 = 700ms (exponential).
    assert!(
        elapsed >= Duration::from_millis(700),
        "expected at least 700ms of backoff, got {:?}",
        elapsed
    );
}

#[test]
fn db_store_implements_retry_policy() {
    // Trait is implemented with defaults — this just verifies it compiles.
    fn assert_retry_policy<T: RetryPolicy>() {}
    assert_retry_policy::<DbStore>();
}
