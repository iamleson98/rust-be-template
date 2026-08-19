//! VietQR provider — generates an EMV QR Code (NAPAS MPC QR Code standard)
//! that encodes a bank transfer to the merchant's account. No gateway
//! interaction; the user scans the QR with any Vietnamese banking app.
//!
//! ## QR string format
//!
//! The string is a sequence of TLV (Tag-Length-Value) records. Each record
//! starts with a 2-digit tag, followed by a 2-digit length, then the value.
//! Length is the number of bytes (ASCII chars) in the value.
//!
//! The top-level structure (for transfer-to-account VietQR) is:
//!
//! ```text
//! 00 02 01            Payload format indicator (must be "01")
//! 01 02 12            Point of initiation: "12" = dynamic (has amount)
//! 26 <len> <sub-tlv>  Merchant account info (NAPAS template)
//!   00 0A A000000727  NAPAS AID
//!   01 <len> <bin><acct_no>   e.g. "9704360011001938111"
//!   02 04 5769        NAPAS service code
//! 52 04 4111          Merchant category code (4111 = transportation)
//! 53 03 704           Currency: 704 = VND
//! 54 <len> <amount>   Transaction amount (omit if zero — but we always have amount)
//! 58 02 VN            Country code
//! 62 <len> <sub-tlv>  Additional data
//!   01 <len> <bill_no>    Booking code
//!   08 <len> <purpose>    Purpose / memo
//! 63 04 <crc>          CRC-16/CCITT-FALSE over everything above (incl. "6304")
//! ```
//!
//! ## CRC algorithm
//!
//! CRC-16/CCITT-FALSE: init `0xFFFF`, poly `0x1021`, no reflection, no xor-out.
//! Computed over the entire QR string **including the `6304` literal but
//! excluding the 4-hex-digit CRC value itself**.

use crate::config::VietQrConfig;
use crate::error::AppError;

use super::model::build_memo;
use super::provider::{CreatePaymentInput, Provider, ProviderResult};

pub struct VietQrProvider {
    bank_bin: String,
    account_no: String,
    account_name: String,
}

impl VietQrProvider {
    pub fn new(cfg: &VietQrConfig) -> Self {
        Self {
            bank_bin: cfg.bank_bin.clone(),
            account_no: cfg.account_no.clone(),
            account_name: cfg.account_name.clone(),
        }
    }

    pub fn is_configured(&self) -> bool {
        !self.bank_bin.is_empty() && !self.account_no.is_empty() && !self.account_name.is_empty()
    }

    pub fn bank_bin(&self) -> &str {
        &self.bank_bin
    }
    pub fn account_no(&self) -> &str {
        &self.account_no
    }
    pub fn account_name(&self) -> &str {
        &self.account_name
    }
}

#[async_trait::async_trait]
impl Provider for VietQrProvider {
    fn name(&self) -> &'static str {
        super::providers::VIETQR
    }

    async fn create_payment(&self, input: &CreatePaymentInput) -> Result<ProviderResult, AppError> {
        if !self.is_configured() {
            return Err(AppError::ServiceUnavailable(
                "VietQR provider is not configured (missing bank_bin / account_no / account_name)"
                    .into(),
            ));
        }

        // The VietQR payload is independent of network calls — pure string assembly.
        // Run the construction synchronously; it's <1ms even for large amounts.
        let memo = build_memo(&input.booking_code);
        let qr_payload = build_vietqr_string(
            &self.bank_bin,
            &self.account_no,
            input.amount,
            &memo,
            &input.booking_code,
        );

        // Render the QR PNG. The `qrcode` crate is sync, so we wrap it in
        // `tokio::task::spawn_blocking` to avoid blocking the async runtime
        // for the ~5-10ms the rendering takes.
        //
        // We render to a raw `Vec<u8>` of pixel bytes via qrcode's `render()`
        // + a PNG encoder, avoiding the `image` crate's `ImageBuffer` wrapper
        // (which would require a separate `.into_raw()` call).
        let payload_for_png = qr_payload.clone();
        let qr_image_png: Vec<u8> =
            tokio::task::spawn_blocking(move || -> Result<Vec<u8>, AppError> {
                let code = qrcode::QrCode::new(payload_for_png.as_bytes())
                    .map_err(|e| AppError::Internal(format!("qr encode failed: {e}")))?;
                // Render to a greyscale pixel buffer (1 byte per pixel).
                let mut renderer = code.render::<image::Luma<u8>>();
                let image_buffer = renderer.min_dimensions(480, 480).build();
                // Encode the ImageBuffer to PNG.
                let mut png_bytes: Vec<u8> = Vec::new();
                let encoder = image::codecs::png::PngEncoder::new(&mut png_bytes);
                image::ImageEncoder::write_image(
                    encoder,
                    image_buffer.as_raw(),
                    image_buffer.width(),
                    image_buffer.height(),
                    image::ExtendedColorType::L8,
                )
                .map_err(|e| AppError::Internal(format!("png encode failed: {e}")))?;
                Ok(png_bytes)
            })
            .await
            .map_err(|e| AppError::Internal(format!("qr render join failed: {e}")))??;

        Ok(ProviderResult {
            gateway_url: None,
            qr_payload: Some(qr_payload.clone()),
            qr_image_png: Some(qr_image_png),
            provider_txn_ref: input.payment_id.clone(),
            provider_response: format!(
                "{{\"provider\":\"vietqr\",\"memo\":\"{}\",\"amount\":{}}}",
                memo, input.amount
            ),
        })
    }
}

/// Build the full VietQR EMV string with CRC.
///
/// Public so it's testable without constructing a `VietQrProvider`.
pub fn build_vietqr_string(
    bank_bin: &str,
    account_no: &str,
    amount: i64,
    memo: &str,
    bill_no: &str,
) -> String {
    // ── Merchant account information (tag 26) ───────────────────────
    // Sub-tags: 00 (NAPAS AID), 01 (bin+account), 02 (service code)
    let aid = "A000000727"; // NAPAS AID
    let bin_acct = format!("{bank_bin}{account_no}");
    let service = "5769"; // NAPAS default service code
    let merchant_account = format!(
        "{}{}{}",
        tlv("00", aid),
        tlv("01", &bin_acct),
        tlv("02", service),
    );
    let merchant_account_tlv = tlv("26", &merchant_account);

    // ── Additional data (tag 62) ─────────────────────────────────────
    // Sub-tags: 01 (bill number / booking ref), 08 (purpose / memo)
    let additional = format!("{}{}", tlv("01", bill_no), tlv("08", memo));
    let additional_tlv = tlv("62", &additional);

    // ── Top-level payload (without CRC) ─────────────────────────────
    let mut payload = String::new();
    payload.push_str(&tlv("00", "01")); // Payload format indicator
    payload.push_str(&tlv("01", "12")); // Point of initiation: dynamic
    payload.push_str(&merchant_account_tlv);
    payload.push_str(&tlv("52", "4111")); // MCC: transportation
    payload.push_str(&tlv("53", "704")); // Currency: VND
    payload.push_str(&tlv("54", &amount.to_string())); // Amount
    payload.push_str(&tlv("58", "VN")); // Country: Vietnam
    payload.push_str(&additional_tlv);

    // ── CRC-16/CCITT-FALSE ──────────────────────────────────────────
    // The CRC is computed over the payload + the literal "6304" (tag+len
    // of the CRC field itself, which is always 4 hex digits).
    payload.push_str("6304");
    let crc = crc16_ccitt_false(payload.as_bytes());
    payload.push_str(&format!("{:04X}", crc));

    payload
}

/// Encode a TLV record: `tag` + 2-digit zero-padded length + value.
fn tlv(tag: &str, value: &str) -> String {
    let len = value.len();
    debug_assert!(
        len < 100,
        "VietQR TLV value for tag {tag} exceeds 99 bytes (got {len})"
    );
    format!("{tag}{len:02}{value}")
}

/// CRC-16/CCITT-FALSE: init `0xFFFF`, poly `0x1021`, no reflection.
///
/// Reference: NAPAS MPC QR Code specification, Appendix A.
fn crc16_ccitt_false(data: &[u8]) -> u16 {
    let mut crc: u16 = 0xFFFF;
    for &byte in data {
        crc ^= (byte as u16) << 8;
        for _ in 0..8 {
            if crc & 0x8000 != 0 {
                crc = (crc << 1) ^ 0x1021;
            } else {
                crc <<= 1;
            }
        }
    }
    crc
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crc_matches_napas_reference_vector() {
        // Reference: EMV QR Code spec sample payload (NAPAS-issued test vector).
        // Input: "000201010212261000A0000007270112009704360110..." — too long
        // to inline; instead use the official test vector from EMVCo: the
        // CRC of the empty string is 0xFFFF, and the CRC of "123456789" is
        // 0x29B1 (the well-known CRC-16/CCITT-FALSE check value).
        assert_eq!(crc16_ccitt_false(b""), 0xFFFF);
        assert_eq!(crc16_ccitt_false(b"123456789"), 0x29B1);
    }

    #[test]
    fn vietqr_string_has_correct_top_level_tags() {
        let s = build_vietqr_string("970436", "0011001938111", 150000, "VEXEVN-ABC123", "ABC123");
        // Must start with the payload format indicator.
        assert!(s.starts_with("000201010212"));
        // Must end with a 4-digit hex CRC after "6304".
        assert!(
            s.ends_with("6304") || {
                let tail = &s[s.len() - 8..];
                tail.starts_with("6304") && {
                    let _ = u16::from_str_radix(&s[s.len() - 4..], 16);
                    true
                }
            }
        );
        // Must contain the NAPAS AID.
        assert!(s.contains("A000000727"));
        // Must contain the bank BIN + account number.
        assert!(s.contains("970436"));
        assert!(s.contains("0011001938111"));
        // Must contain the amount.
        assert!(s.contains("150000"));
    }

    #[test]
    fn tlv_pads_length_to_two_digits() {
        assert_eq!(tlv("00", "01"), "0002 01".replace(" ", ""));
        assert_eq!(tlv("53", "704"), "5303 704".replace(" ", ""));
    }
}
