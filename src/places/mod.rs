//! Place search: Vietnamese text folding, the vocabulary of place types, and
//! the in-memory index that answers search, reverse geocoding and the
//! popular-places list.
//!
//! The index is built outside the server's own heap. `places-build` turns the
//! Geofabrik Vietnam extract into a *generation* on disk ([`store`], [`build`]);
//! the server runs it weekly as a child process (the `places.build` job), or
//! by hand as `datxevui places-build`. The server loads the generation
//! `current` points at, and picks up a newer one while it runs ([`live`]).

pub mod build;
mod engine;
pub mod lexicon;
pub mod live;
pub mod store;
pub mod text;

pub use engine::{Engine, PlaceHit, SearchOptions};

#[cfg(test)]
mod tests;
