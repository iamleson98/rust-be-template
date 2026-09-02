//! OSM extract downloader — streams the Vietnam `.osm.pbf` to disk.
//!
//! Rust port of `scripts/download-vietnam-osm.sh` so the worker can
//! fetch the extract itself (the script stays for manual/CLI use).
//!
//! Properties:
//! - **Streams to a `.part` sibling** then renames — a crash never
//!   leaves a half-written file masquerading as a valid extract.
//! - **Polite user agent** (Geofabrik asks bulk consumers to identify
//!   themselves).
//! - **No total timeout** — a ~500 MB extract over a slow link can take
//!   hours; only the CONNECT phase is time-boxed. Progress reporting
//!   goes through the callback.
//! - **Size sanity floor** — Geofabrik's Vietnam extract is ~450-500
//!   MB; anything under 100 MB is a truncated/error page, not an
//!   extract.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use futures::StreamExt;
use tokio::io::AsyncWriteExt;

/// Geofabrik's Vietnam extract — the canonical source the shell script
/// uses too. Overridable via `SEARCH_OSM_DOWNLOAD_URL` (mirrors, tests).
pub const VIETNAM_PBF_URL: &str = "https://download.geofabrik.de/asia/vietnam-latest.osm.pbf";

/// Identify ourselves to bulk-download endpoints.
pub const USER_AGENT: &str = concat!(
    "VeXeVN-place-index/",
    env!("CARGO_PKG_VERSION"),
    " (+https://github.com/iamleson98/rust-be-template)"
);

/// Minimum believable extract size. Real Vietnam extract ≈ 450-500 MB.
pub const MIN_PBF_BYTES: u64 = 100 * 1024 * 1024;

/// Build the HTTP client used for extract downloads.
///
/// `connect_timeout` only — the body may legitimately take hours.
pub fn client() -> Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(std::time::Duration::from_secs(30))
        .build()?)
}

/// Sibling path used while the download is in flight
/// (`vietnam-latest.osm.pbf` → `vietnam-latest.osm.pbf.part`).
pub fn part_path(dest: &Path) -> PathBuf {
    let mut s = dest.as_os_str().to_os_string();
    s.push(".part");
    PathBuf::from(s)
}

/// Stream `url` to `dest` (via a `.part` file, then rename).
///
/// `on_progress` receives the cumulative byte count as chunks land —
/// throttle DB writes on the receiving side, this fires per chunk.
/// Returns the final size in bytes.
pub async fn download_file(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    on_progress: &(dyn Fn(u64) + Send + Sync),
) -> Result<u64> {
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .with_context(|| format!("creating {}", parent.display()))?;
    }

    let response = client
        .get(url)
        .send()
        .await
        .with_context(|| format!("requesting {url}"))?;
    let status = response.status();
    if !status.is_success() {
        anyhow::bail!("download failed: HTTP {status} from {url}");
    }

    let expected = response.content_length();
    let part = part_path(dest);
    let mut file = tokio::io::BufWriter::with_capacity(
        1024 * 1024,
        tokio::fs::File::create(&part)
            .await
            .with_context(|| format!("creating {}", part.display()))?,
    );

    let mut stream = response.bytes_stream();
    let mut written: u64 = 0;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.with_context(|| format!("reading body of {url}"))?;
        file.write_all(&chunk)
            .await
            .with_context(|| format!("writing {}", part.display()))?;
        written += chunk.len() as u64;
        on_progress(written);
    }
    // Flush the BufWriter before sync + rename.
    file.flush().await.context("flushing download buffer")?;
    drop(file);
    // fsync so the rename below can't publish unflushed data.
    let sync_file = tokio::fs::File::open(&part).await?;
    sync_file.sync_all().await.context("fsyncing download")?;
    drop(sync_file);

    if let Some(min) = expected {
        // Server told us the size and we wrote less — truncated body.
        anyhow::ensure!(
            written >= min,
            "truncated download: got {written} of {min} bytes from {url}"
        );
    }
    anyhow::ensure!(
        written >= MIN_PBF_BYTES,
        "download too small to be an OSM extract ({written} bytes < {} MiB floor) — {url}",
        MIN_PBF_BYTES / (1024 * 1024)
    );

    tokio::fs::rename(&part, dest)
        .await
        .with_context(|| format!("renaming {} → {}", part.display(), dest.display()))?;

    tracing::info!(url, bytes = written, "osm extract downloaded");
    Ok(written)
}

/// Remove the `.part` sibling of `dest` if one was left behind.
pub fn cleanup_partial(dest: &Path) {
    let _ = std::fs::remove_file(part_path(dest));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn part_path_is_a_sibling() {
        assert_eq!(
            part_path(Path::new("/data/vietnam-latest.osm.pbf")),
            PathBuf::from("/data/vietnam-latest.osm.pbf.part")
        );
        assert_eq!(part_path(Path::new("v.pbf")), PathBuf::from("v.pbf.part"));
    }

    #[tokio::test]
    async fn download_rejects_html_error_pages_via_size_floor() {
        // Serve a tiny body from an ephemeral local server; the size
        // floor must reject it without ever touching `dest`.
        use std::io::{Read, Write};

        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = std::thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            let mut buf = [0u8; 1024];
            let n = sock.read(&mut buf).unwrap();
            let _req = String::from_utf8_lossy(&buf[..n]);
            let body = "not an osm extract";
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            sock.write_all(resp.as_bytes()).unwrap();
        });

        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("vn.osm.pbf");
        let url = format!("http://{addr}/vn.osm.pbf");
        let client = client().unwrap();

        let err = download_file(&client, &url, &dest, &|_| {})
            .await
            .unwrap_err();
        assert!(err.to_string().contains("too small"), "got: {err}");
        assert!(!dest.exists(), "dest must not exist on failure");
        handle.join().unwrap();
    }

    #[tokio::test]
    async fn download_missing_server_is_an_error_not_a_panic() {
        // Port 1 on localhost: nothing listens there (kernel rejects).
        let client = client().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("vn.osm.pbf");
        let err = download_file(&client, "http://127.0.0.1:1/vn.pbf", &dest, &|_| {})
            .await
            .unwrap_err();
        assert!(!err.to_string().is_empty());
        cleanup_partial(&dest);
        assert!(!part_path(&dest).exists());
    }
}
