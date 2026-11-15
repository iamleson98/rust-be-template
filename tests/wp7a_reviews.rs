//! Reviews: the 5000-character limit counts characters, editing an approved
//! review sends it back to moderation, a trip counts as ridden from its
//! Vietnam departure instant, and the tag statistics read both stored tag
//! formats.

mod wp7a_common;

use backend::dto::review::{CreateReviewInput, TagCount, UpdateReviewInput};
use backend::entity::review;
use backend::error::AppError;
use backend::service::ReviewService;
use sea_orm::{ActiveModelTrait, ActiveValue::Set, EntityTrait};
use uuid::Uuid;
use wp7a_common::{env, vn_date, Env};

fn input() -> CreateReviewInput {
    CreateReviewInput {
        booking_id: None,
        trip_session_id: None,
        route_id: None,
        brand_id: None,
        rating: 5,
        title: None,
        content: None,
        tags: None,
        photos: None,
        author_name: None,
        author_phone: None,
        user_id: None,
    }
}

async fn status_of(e: &Env, id: Uuid) -> String {
    review::Entity::find_by_id(id)
        .one(e.store.db())
        .await
        .expect("find")
        .expect("review")
        .status
}

async fn set_status(e: &Env, id: Uuid, status: &str) {
    review::ActiveModel {
        id: Set(id),
        status: Set(status.into()),
        ..Default::default()
    }
    .update(e.store.db())
    .await
    .expect("moderate");
}

#[tokio::test]
async fn the_content_limit_counts_characters_not_bytes() {
    let e = env("08:00").await;
    let svc = ReviewService::new(e.store.clone());
    let user = e.user().await;
    let uid = user.to_string();

    // 5000 Vietnamese letters are 15000 bytes: within the limit.
    let at_limit = "ế".repeat(5000);
    let made = svc
        .create(
            Some(&uid),
            &CreateReviewInput {
                content: Some(at_limit.clone()),
                user_id: Some(user),
                ..input()
            },
        )
        .await
        .expect("5000 characters fit");

    let over = "ế".repeat(5001);
    let err = svc
        .create(
            Some(&uid),
            &CreateReviewInput {
                content: Some(over.clone()),
                user_id: Some(user),
                ..input()
            },
        )
        .await
        .unwrap_err();
    assert!(matches!(err, AppError::Validation(_)), "{err:?}");

    // The same rule on edit.
    svc.update(
        made.id,
        Some(&uid),
        &UpdateReviewInput {
            content: Some(at_limit),
            ..Default::default()
        },
    )
    .await
    .expect("5000 characters fit on edit");
    let err = svc
        .update(
            made.id,
            Some(&uid),
            &UpdateReviewInput {
                content: Some(over),
                ..Default::default()
            },
        )
        .await
        .unwrap_err();
    assert!(matches!(err, AppError::Validation(_)), "{err:?}");
}

#[tokio::test]
async fn editing_an_approved_review_sends_it_back_to_pending() {
    let e = env("08:00").await;
    let svc = ReviewService::new(e.store.clone());
    let user = e.user().await;
    let uid = user.to_string();
    let made = svc
        .create(
            Some(&uid),
            &CreateReviewInput {
                content: Some("Xe sạch".into()),
                user_id: Some(user),
                ..input()
            },
        )
        .await
        .expect("create");
    assert_eq!(status_of(&e, made.id).await, "pending");
    set_status(&e, made.id, "approved").await;

    // An empty edit changes nothing, so the approval stands.
    svc.update(made.id, Some(&uid), &UpdateReviewInput::default())
        .await
        .expect("empty edit");
    assert_eq!(status_of(&e, made.id).await, "approved");

    svc.update(
        made.id,
        Some(&uid),
        &UpdateReviewInput {
            content: Some("Xe rất sạch".into()),
            ..Default::default()
        },
    )
    .await
    .expect("edit");
    assert_eq!(status_of(&e, made.id).await, "pending");

    // Staff verdicts other than approved are not overridden by an edit.
    set_status(&e, made.id, "rejected").await;
    svc.update(
        made.id,
        Some(&uid),
        &UpdateReviewInput {
            rating: Some(3),
            ..Default::default()
        },
    )
    .await
    .expect("edit");
    assert_eq!(status_of(&e, made.id).await, "rejected");
}

#[tokio::test]
async fn a_trip_counts_as_ridden_from_its_vietnam_departure_instant() {
    // The schedule leaves at 00:00 Vietnam time.
    let e = env("00:00").await;
    let svc = ReviewService::new(e.store.clone());
    let user = e.user().await;
    let uid = user.to_string();
    let review_of = |booking: Uuid| CreateReviewInput {
        booking_id: Some(booking),
        user_id: Some(user),
        ..input()
    };

    // Today's 00:00 trip left hours ago, although its date is not before
    // today's UTC date: it can be reviewed.
    let left = e.trip(&vn_date(0)).await;
    let booking = e.booking(Some(user), left, "confirmed", 350_000).await;
    let made = svc
        .create(Some(&uid), &review_of(booking.id))
        .await
        .expect("a trip that has left can be reviewed");
    // The review rides the booking's chain.
    let row = review::Entity::find_by_id(made.id)
        .one(e.store.db())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(row.trip_session_id, Some(left));
    assert_eq!(row.route_id, Some(e.route));
    assert_eq!(row.brand_id, Some(e.brand));

    // One review per booking.
    let err = svc
        .create(Some(&uid), &review_of(booking.id))
        .await
        .unwrap_err();
    assert!(matches!(err, AppError::Conflict(_)), "{err:?}");

    // Tomorrow's 00:00 trip has not left.
    let ahead = e.trip(&vn_date(1)).await;
    let booking = e.booking(Some(user), ahead, "confirmed", 350_000).await;
    let err = svc
        .create(Some(&uid), &review_of(booking.id))
        .await
        .unwrap_err();
    assert!(matches!(err, AppError::Validation(_)), "{err:?}");
}

#[tokio::test]
async fn top_tags_read_both_the_json_and_the_comma_separated_format() {
    let e = env("08:00").await;
    let svc = ReviewService::new(e.store.clone());
    let stamp = chrono::Utc::now().to_rfc3339();
    let insert = |status: &'static str, tags: Option<&'static str>| {
        let (db, brand, stamp) = (e.store.db(), e.brand, stamp.clone());
        async move {
            review::ActiveModel {
                id: Set(Uuid::new_v4()),
                brand_id: Set(Some(brand)),
                rating: Set(5),
                tags: Set(tags.map(str::to_string)),
                status: Set(status.into()),
                helpful_count: Set(0),
                created_at: Set(stamp.clone()),
                updated_at: Set(stamp),
                ..Default::default()
            }
            .insert(db)
            .await
            .expect("review");
        }
    };
    // Written by this service: comma-joined.
    insert("approved", Some("clean,on_time")).await;
    insert("approved", Some("clean, friendly")).await;
    // Written by the Cloudflare port: a JSON array.
    insert("approved", Some(r#"["clean","on_time"]"#)).await;
    insert("approved", None).await;
    // Not public, so not counted.
    insert("pending", Some("secret")).await;

    let stats = svc.stats(Some(e.brand), None).await.expect("stats");
    assert_eq!(stats.count, 4);
    assert_eq!(
        stats.top_tags,
        [
            TagCount {
                tag: "clean".into(),
                count: 3
            },
            TagCount {
                tag: "on_time".into(),
                count: 2
            },
            TagCount {
                tag: "friendly".into(),
                count: 1
            },
        ]
    );

    let tags = svc.tags_index().await.expect("tags").items;
    assert_eq!(tags, ["clean", "friendly", "on_time"]);
}
