//! `POST /api/ads/conversions`: the beacon is trusted for nothing but its
//! click ids. The event must be `booking` or `purchase`, the transaction id
//! the code of a real booking, a purchase needs a completed payment, and the
//! value and currency come from the database.

mod wp7a_common;

use backend::ads::{AdsHub, GoogleAdsApi};
use backend::config::GoogleAdsConfig;
use backend::dto::ad_conversion::{ClickIds, ReportConversionRequest};
use backend::entity::ad_conversion;
use backend::error::AppError;
use sea_orm::{EntityTrait, PaginatorTrait};
use std::sync::Arc;
use wp7a_common::{env, vn_date, Env};

fn beacon(event: &str, code: &str) -> ReportConversionRequest {
    ReportConversionRequest {
        event: event.into(),
        transaction_id: code.to_string(),
        click_ids: ClickIds {
            gclid: Some("  Cj0KCQ-test  ".into()),
            wbraid: None,
            gbraid: Some(" ".into()),
        },
    }
}

fn hub(e: &Env) -> AdsHub {
    AdsHub::new(Arc::new(e.store.db().clone()), None)
}

async fn rows(e: &Env) -> Vec<ad_conversion::Model> {
    ad_conversion::Entity::find()
        .all(e.store.db())
        .await
        .expect("rows")
}

#[tokio::test]
async fn only_booking_and_purchase_events_are_accepted() {
    let e = env("08:00").await;
    let trip = e.trip(&vn_date(1)).await;
    let b = e.booking(None, trip, "confirmed", 350_000).await;
    let hub = hub(&e);

    for event in ["signup", "", "page_view", "Booking2"] {
        let err = hub.report(beacon(event, &b.code)).await.expect_err(event);
        assert!(matches!(err, AppError::BadRequest(_)), "{event}: {err:?}");
    }
    // Case and blanks around a valid event are forgiven.
    assert!(hub.report(beacon(" Booking ", &b.code)).await.is_ok());
    assert_eq!(rows(&e).await.len(), 1);
}

#[tokio::test]
async fn the_transaction_id_must_be_a_real_booking_code() {
    let e = env("08:00").await;
    let hub = hub(&e);

    let err = hub.report(beacon("booking", "")).await.unwrap_err();
    assert!(matches!(err, AppError::BadRequest(_)), "{err:?}");
    let err = hub.report(beacon("booking", "  ")).await.unwrap_err();
    assert!(matches!(err, AppError::BadRequest(_)), "{err:?}");
    let err = hub
        .report(beacon("booking", &"x".repeat(129)))
        .await
        .unwrap_err();
    assert!(matches!(err, AppError::BadRequest(_)), "{err:?}");
    let err = hub
        .report(beacon("booking", "VEX-NOSUCH00"))
        .await
        .unwrap_err();
    assert!(matches!(err, AppError::NotFound(_)), "{err:?}");

    assert_eq!(rows(&e).await.len(), 0, "a forged beacon writes nothing");
}

#[tokio::test]
async fn value_and_currency_come_from_the_booking_not_the_client() {
    let e = env("08:00").await;
    let trip = e.trip(&vn_date(1)).await;
    let b = e.booking(None, trip, "pending", 350_000).await;

    let out = hub(&e)
        .report(beacon("booking", &b.code))
        .await
        .expect("report");
    assert!(out.ok && out.stored && !out.server_upload_enabled);

    let rows = rows(&e).await;
    assert_eq!(rows.len(), 1);
    let row = &rows[0];
    assert_eq!(row.transaction_id, b.code);
    assert_eq!(row.conversion_value.as_deref(), Some("350000"));
    assert_eq!(row.currency.as_deref(), Some("VND"));
    // Click ids are the one thing the beacon is believed about: trimmed,
    // blanks dropped.
    assert_eq!(row.gclid.as_deref(), Some("Cj0KCQ-test"));
    assert_eq!(row.gbraid, None);
}

#[tokio::test]
async fn a_purchase_needs_a_completed_payment_and_is_worth_its_amount() {
    let e = env("08:00").await;
    let trip = e.trip(&vn_date(1)).await;
    let b = e.booking(None, trip, "confirmed", 350_000).await;
    let hub = hub(&e);

    // Nothing paid yet, and a payment that is still pending is not paid.
    let err = hub.report(beacon("purchase", &b.code)).await.unwrap_err();
    assert!(matches!(err, AppError::NotFound(_)), "{err:?}");
    e.payment(&b, "vietqr", "pending", 350_000).await;
    assert!(hub.report(beacon("purchase", &b.code)).await.is_err());

    // The completed payment's amount is what the purchase is worth (here a
    // part payment, to show it is not just the booking total).
    e.payment(&b, "cod", "completed", 300_000).await;
    let out = hub
        .report(beacon("purchase", &b.code))
        .await
        .expect("purchase");
    assert!(out.stored);
    let rows = rows(&e).await;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].event, "purchase");
    assert_eq!(rows[0].conversion_value.as_deref(), Some("300000"));
    assert_eq!(rows[0].currency.as_deref(), Some("VND"));
}

#[tokio::test]
async fn a_cancelled_booking_converts_nothing() {
    let e = env("08:00").await;
    let trip = e.trip(&vn_date(1)).await;
    let b = e.booking(None, trip, "cancelled", 350_000).await;
    e.payment(&b, "cod", "completed", 350_000).await;
    let hub = hub(&e);

    for event in ["booking", "purchase"] {
        let err = hub.report(beacon(event, &b.code)).await.unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)), "{event}: {err:?}");
    }
    assert_eq!(rows(&e).await.len(), 0);
}

#[tokio::test]
async fn a_repeated_beacon_collapses_into_one_row() {
    let e = env("08:00").await;
    let trip = e.trip(&vn_date(1)).await;
    let b = e.booking(None, trip, "confirmed", 350_000).await;
    let hub = hub(&e);

    let first = hub.report(beacon("booking", &b.code)).await.unwrap();
    let again = hub.report(beacon("booking", &b.code)).await.unwrap();
    assert!(first.stored);
    assert!(!again.stored, "the repeat is deduped, not an error");
    assert_eq!(
        ad_conversion::Entity::find()
            .count(e.store.db())
            .await
            .unwrap(),
        1
    );
}

#[test]
fn the_upload_endpoint_uses_the_configured_api_version() {
    let api = |version: &str| {
        GoogleAdsApi::new(GoogleAdsConfig {
            developer_token: "dev".into(),
            customer_id: "1234567890".into(),
            login_customer_id: None,
            client_id: "id".into(),
            client_secret: "secret".into(),
            refresh_token: "refresh".into(),
            conversion_actions: Default::default(),
            api_version: version.into(),
        })
    };
    assert_eq!(
        api("v21").upload_url(),
        "https://googleads.googleapis.com/v21/customers/1234567890:uploadClickConversions"
    );
    assert!(api("v99").upload_url().contains("/v99/"));
    assert!(!api("v21").upload_url().contains("v17"));
}
