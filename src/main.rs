//! Backend entry point.
//!
//! Dispatches to the CLI parser defined in [`backend::cli`].

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    backend::cli::run().await
}
