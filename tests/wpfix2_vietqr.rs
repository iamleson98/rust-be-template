//! `VIETQR_*` reaches the payment config: the Worker lists `["cod", "vietqr"]`
//! when a bank account is configured, and so must this server.

use backend::config::PaymentConfig;

#[test]
fn vietqr_settings_come_from_the_environment() {
    // This binary holds only this test, so nothing else reads the variables.
    std::env::set_var("VIETQR_ENABLED", "true");
    std::env::set_var("VIETQR_BANK_BIN", "970436");
    std::env::set_var("VIETQR_ACCOUNT_NO", "0011001234567");
    std::env::set_var("VIETQR_ACCOUNT_NAME", "CONG TY DAT XE VUI");

    let vietqr = PaymentConfig::default().vietqr;

    assert!(vietqr.is_active(), "configured VietQR must be active");
    assert_eq!(vietqr.bank_bin, "970436");
    assert_eq!(vietqr.account_no, "0011001234567");
    assert_eq!(vietqr.account_name, "CONG TY DAT XE VUI");
}
