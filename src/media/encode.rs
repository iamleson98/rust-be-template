//! Re-encoding of uploaded images.
//!
//! Everything an admin uploads is fully decoded (which rejects corrupt
//! files and polyglots), turned upright according to its EXIF
//! orientation, scaled down to a long-edge limit (never enlarged) and
//! written back out as lossy WebP. The output carries no metadata, so
//! EXIF (GPS coordinates included) never reaches storage.
//!
//! The work is CPU-bound: call it from `spawn_blocking`.

use std::io::Cursor;

use image::{imageops::FilterType, DynamicImage, ImageDecoder, ImageReader, Limits};
use thiserror::Error;

/// Widest or tallest image the decoder accepts. Bounds the pixel count
/// of a "decompression bomb" whose compressed size fits the byte cap.
const MAX_DIMENSION: u32 = 16_384;

/// Decoder memory ceiling (a 12000x9000 phone photo needs ~324 MiB as
/// RGB8, so this leaves room for 108 MP sensors).
const MAX_DECODE_ALLOC: u64 = 512 * 1024 * 1024;

/// Why an image could not be processed.
#[derive(Debug, Error)]
pub enum EncodeError {
    /// The bytes are not a decodable JPEG, PNG or WebP.
    #[error("{0}")]
    Undecodable(String),
    /// libwebp refused the (decoded) pixels.
    #[error("webp encoding failed: {0}")]
    Encoding(String),
}

/// A container format accepted for upload, sniffed from the magic bytes
/// (the client's declared MIME type is never trusted).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    Jpeg,
    Png,
    Webp,
}

impl Format {
    /// The format named by the leading bytes of `bytes`, if accepted.
    ///
    /// GIF, BMP, TIFF and HEIC are deliberately not accepted.
    pub fn sniff(bytes: &[u8]) -> Option<Self> {
        if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
            Some(Self::Jpeg)
        } else if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
            Some(Self::Png)
        } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
            Some(Self::Webp)
        } else {
            None
        }
    }
}

/// A WebP image ready to store.
#[derive(Debug, Clone)]
pub struct Encoded {
    pub bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// Decode `data` (JPEG, PNG or WebP) into upright pixels. Fails on
/// truncated, corrupt or oversized input.
pub fn decode(data: &[u8]) -> Result<DynamicImage, EncodeError> {
    let undecodable = |e: image::ImageError| {
        EncodeError::Undecodable(format!(
            "image failed to decode (corrupt or unsupported): {e}"
        ))
    };
    let reader = ImageReader::new(Cursor::new(data))
        .with_guessed_format()
        .map_err(|e| EncodeError::Undecodable(format!("image failed to decode: {e}")))?;
    let mut decoder = reader.into_decoder().map_err(undecodable)?;
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_DIMENSION);
    limits.max_image_height = Some(MAX_DIMENSION);
    limits.max_alloc = Some(MAX_DECODE_ALLOC);
    decoder.set_limits(limits).map_err(undecodable)?;
    // Read the orientation before the EXIF block is dropped, so a phone
    // photo stays upright without its metadata.
    let orientation = decoder.orientation().map_err(undecodable)?;
    let mut img = DynamicImage::from_decoder(decoder).map_err(undecodable)?;
    img.apply_orientation(orientation);
    Ok(img)
}

/// `img` scaled down to fit `long_edge` px (never enlarged) and encoded
/// as lossy WebP at `quality` (0-100). Transparency is kept.
pub fn to_webp(img: &DynamicImage, long_edge: u32, quality: f32) -> Result<Encoded, EncodeError> {
    let scaled;
    let img = if img.width().max(img.height()) > long_edge {
        scaled = img.resize(long_edge, long_edge, FilterType::Lanczos3);
        &scaled
    } else {
        img
    };
    let (width, height) = (img.width(), img.height());
    let memory = if img.color().has_alpha() {
        let pixels = img.to_rgba8();
        webp::Encoder::from_rgba(pixels.as_raw(), width, height).encode_simple(false, quality)
    } else {
        let pixels = img.to_rgb8();
        webp::Encoder::from_rgb(pixels.as_raw(), width, height).encode_simple(false, quality)
    }
    .map_err(|e| EncodeError::Encoding(format!("{e:?}")))?;
    Ok(Encoded {
        bytes: memory.to_vec(),
        width,
        height,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageFormat, RgbImage, RgbaImage};

    fn write(img: &DynamicImage, format: ImageFormat) -> Vec<u8> {
        let mut buf = Vec::new();
        img.write_to(&mut Cursor::new(&mut buf), format)
            .expect("test image encodes");
        buf
    }

    fn gradient(w: u32, h: u32) -> DynamicImage {
        DynamicImage::ImageRgb8(RgbImage::from_fn(w, h, |x, y| {
            image::Rgb([(x % 251) as u8, (y % 241) as u8, 150])
        }))
    }

    /// `jpeg` with an EXIF block (orientation + a GPS-looking payload)
    /// spliced in right after the SOI marker.
    fn with_exif(jpeg: &[u8], orientation: u8) -> Vec<u8> {
        let mut tiff = b"II*\0\x08\0\0\0".to_vec();
        tiff.extend_from_slice(&[1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0]);
        tiff.extend_from_slice(&[0, 0, 0, 0]);
        tiff.extend_from_slice(b"GPSLatitude=21.0285");
        let mut segment = b"Exif\0\0".to_vec();
        segment.extend_from_slice(&tiff);
        let len = (segment.len() + 2) as u16;
        let mut out = vec![0xFF, 0xD8, 0xFF, 0xE1];
        out.extend_from_slice(&len.to_be_bytes());
        out.extend_from_slice(&segment);
        out.extend_from_slice(&jpeg[2..]);
        out
    }

    fn contains(haystack: &[u8], needle: &[u8]) -> bool {
        haystack.windows(needle.len()).any(|w| w == needle)
    }

    #[test]
    fn sniff_recognises_only_the_accepted_containers() {
        assert_eq!(Format::sniff(b"\xFF\xD8\xFF\xE0"), Some(Format::Jpeg));
        assert_eq!(Format::sniff(b"\x89PNG\r\n\x1A\n-rest"), Some(Format::Png));
        assert_eq!(Format::sniff(b"RIFF\0\0\0\0WEBPVP8 "), Some(Format::Webp));
        assert_eq!(Format::sniff(b"GIF89a"), None);
        assert_eq!(Format::sniff(b"<svg/>"), None);
        assert_eq!(Format::sniff(b""), None);
    }

    #[test]
    fn output_is_lossy_webp_scaled_to_the_long_edge() {
        let png = write(&gradient(3000, 1500), ImageFormat::Png);
        let img = decode(&png).unwrap();
        let out = to_webp(&img, 1920, 80.0).unwrap();
        assert_eq!((out.width, out.height), (1920, 960));
        assert_eq!(&out.bytes[0..4], b"RIFF");
        assert_eq!(&out.bytes[8..12], b"WEBP");
        assert_eq!(&out.bytes[12..16], b"VP8 ", "lossy bitstream, not VP8L");
        let back = image::load_from_memory(&out.bytes).unwrap();
        assert_eq!((back.width(), back.height()), (1920, 960));
    }

    #[test]
    fn small_images_are_not_enlarged() {
        let img = decode(&write(&gradient(300, 200), ImageFormat::Png)).unwrap();
        let out = to_webp(&img, 640, 75.0).unwrap();
        assert_eq!((out.width, out.height), (300, 200));
    }

    #[test]
    fn transparency_survives() {
        let rgba = DynamicImage::ImageRgba8(RgbaImage::from_fn(64, 64, |x, _| {
            image::Rgba([200, 30, 30, if x < 32 { 0 } else { 255 }])
        }));
        let out = to_webp(&decode(&write(&rgba, ImageFormat::Png)).unwrap(), 512, 85.0).unwrap();
        let back = image::load_from_memory(&out.bytes).unwrap();
        assert!(back.color().has_alpha());
        assert_eq!(back.to_rgba8().get_pixel(2, 2)[3], 0);
        assert_eq!(back.to_rgba8().get_pixel(60, 2)[3], 255);
    }

    #[test]
    fn every_accepted_container_decodes() {
        let src = gradient(64, 48);
        for format in [ImageFormat::Png, ImageFormat::Jpeg, ImageFormat::WebP] {
            let img = decode(&write(&src, format)).unwrap_or_else(|e| panic!("{format:?}: {e}"));
            assert_eq!((img.width(), img.height()), (64, 48), "{format:?}");
        }
    }

    #[test]
    fn exif_orientation_is_applied_and_the_metadata_is_gone() {
        let jpeg = write(&gradient(40, 20), ImageFormat::Jpeg);
        let tagged = with_exif(&jpeg, 6);
        assert!(contains(&tagged, b"GPSLatitude"), "fixture carries EXIF");

        let img = decode(&tagged).unwrap();
        assert_eq!((img.width(), img.height()), (20, 40), "rotated upright");

        let out = to_webp(&img, 1920, 80.0).unwrap();
        assert!(!contains(&out.bytes, b"GPSLatitude"));
        assert!(!contains(&out.bytes, b"Exif"));
        assert!(!contains(&out.bytes, b"EXIF"));
    }

    #[test]
    fn corrupt_and_truncated_files_are_undecodable() {
        let mut bad_jpeg = vec![0xFF, 0xD8, 0xFF, 0xE0];
        bad_jpeg.extend_from_slice(&[0u8; 64]);
        let png = write(&gradient(64, 64), ImageFormat::Png);
        for bad in [
            bad_jpeg,
            png[..png.len() / 2].to_vec(),
            b"not an image".to_vec(),
        ] {
            assert!(matches!(decode(&bad), Err(EncodeError::Undecodable(_))));
        }
    }

    #[test]
    fn a_png_polyglot_with_trailing_html_still_encodes_to_pure_webp() {
        let mut polyglot = write(&gradient(32, 32), ImageFormat::Png);
        polyglot.extend_from_slice(b"<script>alert(1)</script>");
        let out = to_webp(&decode(&polyglot).unwrap(), 512, 85.0).unwrap();
        assert!(!contains(&out.bytes, b"<script>"));
    }

    #[test]
    fn images_over_the_dimension_limit_are_refused() {
        let wide = DynamicImage::ImageLuma8(image::GrayImage::new(MAX_DIMENSION + 1, 1));
        assert!(matches!(
            decode(&write(&wide, ImageFormat::Png)),
            Err(EncodeError::Undecodable(_))
        ));
    }
}
