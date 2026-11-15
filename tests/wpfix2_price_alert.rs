//! Price alerts of a signed-in user: the `user_id` column is TEXT, so the
//! list, count and duplicate lookups must bind the uuid's string form.

mod wp7a_common;

use backend::service::price_alert_service::{
    CreatePriceAlertInput, PriceAlertListFilter, PriceAlertService,
};
use wp7a_common::env;

#[tokio::test]
async fn a_users_alerts_are_listed_deduplicated_and_cancelled() {
    let e = env("08:00").await;
    let user = e.user().await;
    let service = PriceAlertService::new(e.store.clone());
    let input = CreatePriceAlertInput {
        user_id: Some(user),
        phone: "0912345678".into(),
        email: None,
        from_name: "Hà Nội".into(),
        to_name: "Đà Nẵng".into(),
        route_id: Some(e.route),
        target_price: 300_000,
        frequency: "daily".into(),
    };

    let (alert, created) = service.create(&input).await.expect("create");
    assert!(created);
    assert_eq!(alert.user_id, Some(user.to_string()));

    let (again, created) = service.create(&input).await.expect("duplicate");
    assert!(!created, "the same user, route and price is one alert");
    assert_eq!(again.id, alert.id);

    let filter = PriceAlertListFilter {
        user_id: Some(user),
        limit: 50,
        ..Default::default()
    };
    let (items, total) = service.list(&filter).await.expect("list");
    assert_eq!((items.len(), total), (1, 1));
    assert_eq!(items[0].id, alert.id);

    let stranger = e.user().await;
    let (none, total) = service
        .list(&PriceAlertListFilter {
            user_id: Some(stranger),
            ..filter.clone()
        })
        .await
        .expect("list of another user");
    assert_eq!((none.len(), total), (0, 0));

    let cancelled = service.remove(alert.id, Some(user)).await.expect("remove");
    assert_eq!(cancelled.status, "cancelled");
    let (active, total) = service
        .list(&PriceAlertListFilter {
            status: Some("active".into()),
            ..filter.clone()
        })
        .await
        .expect("list after cancel");
    assert_eq!(
        (active.len(), total),
        (0, 0),
        "cancelled alerts leave the active list"
    );
    let (all, _) = service
        .list(&PriceAlertListFilter {
            status: Some("cancelled".into()),
            ..filter
        })
        .await
        .expect("cancelled list");
    assert_eq!(all.len(), 1);
}
