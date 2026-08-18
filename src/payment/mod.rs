//! Payment provider integration.
//!
//! Each provider (VNPay, MoMo, ZaloPay, VietQR, COD) is implemented as
//! a separate submodule exposing the `Provider` trait (defined in
//! [`provider`]). The service layer dispatches based on the
//! `payment.provider` column.

pub mod cod;
pub mod model;
pub mod momo;
pub mod provider;
pub mod vietqr;
pub mod vnpay;
pub mod zalopay;

pub use model::*;
pub use provider::*;
