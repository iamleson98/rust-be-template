#![allow(dead_code)] // the shared files carry the backend's full API; this tool uses a slice

//! The backend's OSM modules, included by path (not copied) so this tool and
//! the server's importer can never drift. Paths are relative to this file's
//! directory: tools/place-extract/src/osm -> repository root.
#[path = "../../../../src/osm/osm_reader.rs"]
pub mod osm_reader;
#[path = "../../../../src/osm/spatial.rs"]
pub mod spatial;
#[path = "../../../../src/osm/vn_text.rs"]
pub mod vn_text;
