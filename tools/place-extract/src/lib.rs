//! OSM PBF → travel-relevant places.
//!
//! Two users:
//! - the `place-extract` CLI (weekly CI job, `.github/workflows/place-index.yml`)
//!   that feeds the Worker's static shard index, and
//! - the place-search service in `vps/`, which runs [`extract`] in a child
//!   process and [`prepare`] in memory to build its own index.
//!
//! The heavy lifting (multi-pass PBF read, admin polygon stitching, R-tree
//! hierarchy lookup) lives in [`osm`]; [`travel`] decides what is worth
//! shipping and [`prepare`] turns raw rows into one entry per real place.

mod extract;
pub mod osm;
pub mod prepare;
pub mod travel;

pub use extract::{extract, Centroids, ExtractOptions, ExtractStats, OsmType, RawPlace};
pub use prepare::{prepare, PlaceRecord, Prepared};
