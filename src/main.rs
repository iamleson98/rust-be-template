//! Backend entry point.
//!
//! Dispatches to the CLI parser defined in [`backend::cli`].

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    install_panic_hook();
    backend::cli::run().await
}

/// Install a panic hook that emits a structured `tracing::error!` event
/// (with backtrace + payload) before delegating to the default panic
/// printer. Without this, panics in spawned tasks (WS write pumps,
/// ZeroClaw handlers, audio-call) are invisible to log aggregators like
/// Loki/journald that only consume structured log lines.
fn install_panic_hook() {
    let orig = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "<unknown>".to_string());
        let payload = info
            .payload()
            .downcast_ref::<&str>()
            .copied()
            .or_else(|| info.payload().downcast_ref::<String>().map(|s| s.as_str()))
            .unwrap_or("<non-string panic payload>");
        let bt = std::backtrace::Backtrace::force_capture();
        tracing::error!(
            target: "panic",
            panic = payload,
            location = %location,
            backtrace = %bt,
            "task panicked"
        );
        orig(info);
    }));
}
