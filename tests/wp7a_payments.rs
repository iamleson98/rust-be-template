//! Payment gateways: a provider that is switched off is refused BEFORE the
//! booking's hold moves, gateway callbacks are refused while the gateway is
//! off (an unconfigured gateway's secret is empty, so its signature is
//! forgeable), and a gateway that is enabled without credentials stops the
//! process from starting.

mod wp7a_common;

use std::sync::Arc;

use hmac::{Hmac, Mac};
use sea_orm::EntityTrait;
use sha2::Sha256;

use backend::config::PaymentConfig;
use backend::dto::payment::CreatePaymentReq;
use backend::entity::{booking, payment};
use backend::error::AppError;
use backend::payment::cod::CodProvider;
use backend::payment::momo::{MomoIpnPayload, MomoProvider};
use backend::payment::vietqr::VietQrProvider;
use backend::payment::vnpay::VnpayProvider;
use backend::payment::zalopay::ZalopayProvider;
use backend::service::payment_service::{ensure_gateways_configured, misconfigured_gateways};
use backend::service::{BookingService, PaymentService};
use wp7a_common::{env, vn_date, Env};

fn service(e: &Env, cfg: PaymentConfig) -> PaymentService {
    let cfg = Arc::new(cfg);
    PaymentService::new(
        e.store.clone(),
        Arc::new(BookingService::new(e.store.clone())),
        cfg.clone(),
        Arc::new(VnpayProvider::new(&cfg.vnpay)),
        Arc::new(MomoProvider::new(&cfg.momo)),
        Arc::new(ZalopayProvider::new(&cfg.zalopay)),
        Arc::new(VietQrProvider::new(&cfg.vietqr)),
        Arc::new(CodProvider::new()),
    )
}

/// The launch configuration: cash on board only, every gateway off.
fn launch_config() -> PaymentConfig {
    let mut cfg = PaymentConfig::default();
    cfg.vnpay.enabled = false;
    cfg.momo.enabled = false;
    cfg.zalopay.enabled = false;
    cfg.vietqr.enabled = false;
    cfg.cod_enabled = true;
    cfg
}

async fn pending_booking(e: &Env, user: uuid::Uuid) -> booking::Model {
    let trip = e.trip(&vn_date(1)).await;
    let b = e.booking(Some(user), trip, "pending", 350_000).await;
    // A checkout hold with a deadline, as a real hold leaves it.
    let hold_until = (chrono::Utc::now() + chrono::Duration::minutes(10))
        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    sea_orm::ConnectionTrait::execute_unprepared(
        e.store.db(),
        &format!(
            "UPDATE booking SET expires_at = '{hold_until}' WHERE code = '{}'",
            b.code
        ),
    )
    .await
    .expect("hold deadline");
    booking::Entity::find_by_id(b.id)
        .one(e.store.db())
        .await
        .unwrap()
        .unwrap()
}

async fn reload(e: &Env, b: &booking::Model) -> booking::Model {
    booking::Entity::find_by_id(b.id)
        .one(e.store.db())
        .await
        .unwrap()
        .unwrap()
}

#[tokio::test]
async fn a_disabled_provider_is_refused_before_the_hold_moves() {
    let e = env("08:00").await;
    let svc = service(&e, launch_config());
    let user = e.user().await;
    let uid = user.to_string();
    let b = pending_booking(&e, user).await;

    for provider in ["momo", "zalopay", "vnpay", "vietqr"] {
        let err = svc
            .create_payment(
                &CreatePaymentReq {
                    booking_id: b.id,
                    provider: provider.into(),
                },
                Some(&uid),
            )
            .await
            .expect_err(provider);
        assert!(
            matches!(err, AppError::BadRequest(_)),
            "{provider}: {err:?}"
        );

        let after = reload(&e, &b).await;
        assert_eq!(after.expires_at, b.expires_at, "{provider} moved the hold");
        assert_eq!(after.payment_method, b.payment_method);
        assert_eq!(after.status, "pending");
    }
    assert_eq!(
        payment::Entity::find()
            .all(e.store.db())
            .await
            .unwrap()
            .len(),
        0
    );
    assert_eq!(svc.enabled_providers().providers, ["cod"]);

    // Control: an enabled provider does move the hold.
    svc.create_payment(
        &CreatePaymentReq {
            booking_id: b.id,
            provider: "cod".into(),
        },
        Some(&uid),
    )
    .await
    .expect("cod");
    let after = reload(&e, &b).await;
    assert_eq!(after.payment_method.as_deref(), Some("cod"));
    assert_ne!(after.expires_at, b.expires_at);
}

#[tokio::test]
async fn a_forged_momo_callback_is_refused_while_momo_is_off() {
    let e = env("08:00").await;
    let svc = service(&e, launch_config());
    let user = e.user().await;
    let trip = e.trip(&vn_date(1)).await;
    let b = e.booking(Some(user), trip, "pending", 350_000).await;
    let pending = e.payment(&b, "momo", "pending", 350_000).await;

    // MoMo is off, so its secret is empty: anyone can sign with it.
    let mut payload = MomoIpnPayload {
        partner_code: String::new(),
        order_id: pending.provider_txn_ref.clone(),
        request_id: "req".into(),
        amount: 350_000,
        order_info: "VEXEVN".into(),
        order_type: None,
        trans_id: 42,
        result_code: 0,
        message: "Successful.".into(),
        response_time: 1,
        extra_data: String::new(),
        pay_type: None,
        signature: String::new(),
    };
    let sign_data = format!(
        "accessKey=&amount={}&extraData=&message={}&orderId={}&orderInfo={}&orderType=&partnerCode=&payType=&requestId={}&responseTime={}&resultCode={}&transId={}",
        payload.amount,
        payload.message,
        payload.order_id,
        payload.order_info,
        payload.request_id,
        payload.response_time,
        payload.result_code,
        payload.trans_id,
    );
    let mut mac = Hmac::<Sha256>::new_from_slice(b"").unwrap();
    mac.update(sign_data.as_bytes());
    payload.signature = hex::encode(mac.finalize().into_bytes());

    let err = svc.handle_momo_ipn(&payload).await.unwrap_err();
    assert!(matches!(err, AppError::BadRequest(_)), "{err:?}");
    let after = payment::Entity::find_by_id(pending.id)
        .one(e.store.db())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(after.status, "pending", "the forged callback paid nothing");
    assert_eq!(reload(&e, &b).await.status, "pending");

    // The other gateways answer the same way.
    let err = svc.handle_vnpay_ipn(&Default::default()).await.unwrap_err();
    assert!(matches!(err, AppError::BadRequest(_)), "{err:?}");
}

#[test]
fn an_enabled_gateway_without_credentials_stops_the_boot() {
    assert!(ensure_gateways_configured(&launch_config()).is_ok());

    for (name, enable) in [
        (
            "momo",
            (|c: &mut PaymentConfig| c.momo.enabled = true) as fn(&mut PaymentConfig),
        ),
        ("zalopay", |c| c.zalopay.enabled = true),
        ("vnpay", |c| c.vnpay.enabled = true),
        ("vietqr", |c| c.vietqr.enabled = true),
    ] {
        let mut cfg = launch_config();
        enable(&mut cfg);
        assert_eq!(misconfigured_gateways(&cfg), [name]);
        let err = ensure_gateways_configured(&cfg).unwrap_err().to_string();
        assert!(err.contains(name), "{err}");
    }

    // A partly filled gateway is still misconfigured; a complete one is fine.
    let mut cfg = launch_config();
    cfg.momo.enabled = true;
    cfg.momo.partner_code = "PARTNER".into();
    cfg.momo.access_key = "access".into();
    assert_eq!(misconfigured_gateways(&cfg), ["momo"]);
    cfg.momo.secret_key = "secret".into();
    assert!(ensure_gateways_configured(&cfg).is_ok());

    let mut cfg = launch_config();
    cfg.vietqr.enabled = true;
    cfg.vietqr.bank_bin = "970436".into();
    cfg.vietqr.account_no = "0123456789".into();
    cfg.vietqr.account_name = "DAT XE VUI".into();
    assert!(ensure_gateways_configured(&cfg).is_ok());
}
