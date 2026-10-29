//! place-extract — OSM PBF → travel-relevant places, one JSON object per line.
//!
//! Feeds the static place-search index (cloudflare/scripts/build-place-shards.ts):
//! a weekly CI job runs this on the Geofabrik Vietnam extract. The same code
//! runs inside the `vps/` place-search service as a library.

use std::path::PathBuf;

use anyhow::Result;
use clap::Parser;
use place_extract::{extract, travel, Centroids, ExtractOptions};

#[derive(Debug, Parser)]
#[command(version, about)]
struct Args {
    /// Path to the `.osm.pbf` extract (e.g. vietnam-latest.osm.pbf).
    pbf: PathBuf,
    /// Output NDJSON file.
    #[arg(long, short)]
    out: PathBuf,
    /// Scratch directory for the intermediate node/way files (deleted afterwards).
    #[arg(long)]
    tmp_dir: Option<PathBuf>,
    #[arg(long, value_enum, default_value_t = Centroids::First)]
    centroids: Centroids,
    /// How much of OSM to ship (each profile includes the one before it).
    #[arg(long, value_enum, default_value_t = travel::Profile::Travel)]
    profile: travel::Profile,
}

fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();
    let args = Args::parse();
    let tmp_dir = args
        .tmp_dir
        .clone()
        .unwrap_or_else(|| args.out.with_extension("tmp"));
    extract(&ExtractOptions {
        pbf: args.pbf,
        out: args.out,
        tmp_dir,
        centroids: args.centroids,
        profile: args.profile,
    })?;
    Ok(())
}
