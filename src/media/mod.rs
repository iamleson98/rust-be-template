//! Image handling for uploads: decode, strip metadata, scale, encode as
//! WebP ([`encode`]) and the safety check for SVG logos ([`svg`]).

pub mod encode;
pub mod svg;
