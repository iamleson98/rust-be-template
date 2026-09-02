//! `import-osm` CLI command — build the Tantivy place-search index from an
//! OSM PBF file.
//!
//! Usage:
//! ```sh
//! backend import-osm ./data/vietnam-latest.osm.pbf --index-dir ./place-index
//! ```
//!
//! See `scripts/download-vietnam-osm.sh` for how to fetch the PBF.

use std::path::PathBuf;

use crate::osm::indexer::{run_index, IndexOptions};
use crate::osm::osm_reader::CentroidMode;

/// Run the OSM → Tantivy indexer.
pub async fn run(
    pbf_path: PathBuf,
    index_dir: Option<PathBuf>,
    heap_bytes: u64,
    threads: Option<usize>,
) -> anyhow::Result<()> {
    let index_dir = index_dir.unwrap_or_else(|| PathBuf::from("./osm-index"));

    if !pbf_path.exists() {
        anyhow::bail!("OSM PBF file not found: {}", pbf_path.display());
    }

    let opts = IndexOptions {
        heap_bytes: heap_bytes as usize,
        max_threads: threads.unwrap_or_else(num_cpus::get),
        centroid_mode: CentroidMode::Full,
        progress: None,
        stop: None,
    };

    tracing::info!(
        pbf = %pbf_path.display(),
        index_dir = %index_dir.display(),
        heap_mb = heap_bytes / 1_048_576,
        threads = opts.max_threads,
        "starting OSM import"
    );

    let started = std::time::Instant::now();
    let stats = run_index(&pbf_path, &index_dir, &opts)
        .map_err(|e| anyhow::anyhow!("indexing failed: {e}"))?;
    let elapsed = started.elapsed();

    println!(
        "OSM import complete in {:.1}s — indexed {} places ({} nodes, {} ways, {} admin relations)",
        elapsed.as_secs_f64(),
        stats.indexed,
        stats.nodes,
        stats.ways,
        stats.admins
    );
    println!("Index written to: {}", index_dir.display());
    println!(
        "Set SEARCH__INDEX_DIR={} and restart the server to enable place search.",
        index_dir.display()
    );

    Ok(())
}
