use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
    paths(
        // auth
        crate::routes::auth::register,
        crate::routes::auth::login,
        crate::routes::auth::employee_login,
        crate::routes::auth::refresh,
        crate::routes::auth::logout,
        crate::routes::auth::me,
        // users
        crate::routes::users::list_users,
        crate::routes::users::get_user,
        crate::routes::users::delete_user,
        // posts
        crate::routes::posts::list_posts,
        crate::routes::posts::create_post,
        crate::routes::posts::get_post,
        crate::routes::posts::update_post,
        crate::routes::posts::delete_post,
        // price alerts
        crate::routes::price_alerts::list,
        crate::routes::price_alerts::create,
        crate::routes::price_alerts::remove,
        // health
        crate::routes::health::health,
        crate::routes::health::ready,
        // reviews
        crate::routes::reviews::list,
        crate::routes::reviews::get,
        crate::routes::reviews::create,
        crate::routes::reviews::update,
        crate::routes::reviews::remove,
        crate::routes::reviews::tags,
        // bookings
        crate::routes::bookings::list,
        crate::routes::bookings::hold,
        crate::routes::bookings::lookup,
        crate::routes::bookings::detail,
        crate::routes::bookings::cancel,
        crate::routes::bookings::confirm,
        // chat
        crate::routes::chat::list_channels,
        crate::routes::chat::list_messages,
        crate::routes::chat::mark_read,
        // places
        crate::routes::places::list,
        crate::routes::places::search,
        crate::routes::places::reverse,
        // public catalog
        crate::routes::public::brands,
        crate::routes::public::brand_detail,
        crate::routes::public::routes,
        crate::routes::public::trip_detail,
        crate::routes::public::search_trips,
        crate::routes::public::recommendations,
        crate::routes::public::campaigns,
        crate::routes::public::validate_campaign,
        crate::routes::public::stats,
        // routing
        crate::routes::routing::directions,
        crate::routes::routing::matrix,
        crate::routes::routing::isochrone,
        // zeroclaw
        crate::routes::zeroclaw::status,
        crate::routes::zeroclaw::list_exchanges,
    ),
    components(schemas(
        // auth
        crate::routes::auth::RegisterRequest,
        crate::routes::auth::LoginRequest,
        crate::routes::auth::AuthResponse,
        // users
        crate::routes::users::UserOut,
        // posts
        crate::routes::posts::PostOut,
        crate::routes::posts::CreatePostRequest,
        crate::routes::posts::UpdatePostRequest,
        crate::routes::posts::ListPostsResponse,
        // price alerts
        crate::routes::price_alerts::PriceAlertOut,
        crate::routes::price_alerts::CreatePriceAlertRequest,
        crate::routes::price_alerts::CreatePriceAlertResponse,
        crate::routes::price_alerts::PriceAlertListEnvelope,
        // reviews
        crate::service::review_service::CreateReviewInput,
        crate::service::review_service::UpdateReviewInput,
        // bookings
        crate::service::booking_service::HoldReq,
        crate::service::booking_service::PassengerReq,
        crate::service::booking_service::ConfirmReq,
        crate::service::booking_service::CancelReq,
    )),
    tags(
        (name = "auth", description = "Authentication endpoints"),
        (name = "users", description = "User management"),
        (name = "posts", description = "Post management"),
        (name = "price-alerts", description = "Price-drop alert subscriptions"),
        (name = "system", description = "Health & readiness"),
        (name = "reviews", description = "Review management"),
        (name = "bookings", description = "Booking management"),
        (name = "chat", description = "Chat channels & messages"),
        (name = "places", description = "Place search & geocoding (OSM)"),
        (name = "public", description = "Public catalog (brands, routes, trips, campaigns)"),
        (name = "routing", description = "Routing & directions (Valhalla proxy)"),
        (name = "zeroclaw", description = "ZeroClaw AI provider"),
    )
)]
pub struct ApiDoc;
