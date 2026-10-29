//! Place search: Vietnamese text folding, the vocabulary of place types, and
//! the in-memory index that answers search, reverse geocoding and the
//! popular-places list.

mod engine;
pub mod lexicon;
pub mod text;

pub use engine::{Engine, PlaceHit, SearchOptions};

#[cfg(test)]
mod tests;
