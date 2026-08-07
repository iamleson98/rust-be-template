//! `retry!` declarative macro — wraps an async operation in an
//! exponential-backoff retry loop.
//!
//! `$op` is an async block (`async { ... }`) which produces a fresh future
//! each invocation. Callers must wrap the call in `async move` and clone
//! any owned args inside the closure so each retry produces a fresh value.
//!
//! Example:
//! ```ignore
//! async fn get_user_by_email(&self, email: String) -> StoreResult<Option<User>> {
//!     retry!(self, async move { self.inner.get_user_by_email(email).await })
//! }
//! ```

#[macro_export]
macro_rules! retry {
    ($self:expr, $op:expr) => {{
        let mut attempt: usize = 0;
        loop {
            let result = $op.await;
            match result {
                Ok(v) => break Ok(v),
                Err(e) => {
                    if !$self.should_retry(&e) {
                        break Err(e);
                    }
                    if attempt >= $self.max_retries {
                        tracing::warn!(
                            attempt = attempt + 1,
                            error = %e,
                            "retries exhausted"
                        );
                        break Err($crate::store::StoreError::Exhausted {
                            retries: attempt,
                            source: Box::new(e),
                        });
                    }
                    let delay = $self.delay_for(attempt);
                    tracing::warn!(
                        attempt = attempt + 1,
                        delay_ms = delay.as_millis() as u64,
                        error = %e,
                        "retrying"
                    );
                    tokio::time::sleep(delay).await;
                    attempt += 1;
                }
            }
        }
    }};
}
