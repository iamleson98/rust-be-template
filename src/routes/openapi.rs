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
        // oauth (social login — Facebook / Google / X-Twitter)
        crate::routes::oauth::oauth_start,
        crate::routes::oauth::oauth_callback,
        // users
        crate::routes::users::list_users,
        crate::routes::users::get_user,
        crate::routes::users::delete_user,
        crate::routes::users::set_user_role,
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
        // payments
        crate::routes::payments::create_payment,
        crate::routes::payments::get_payment,
        crate::routes::payments::list_booking_payments,
        crate::routes::payments::cancel_payment,
        crate::routes::payments::mark_cod_collected,
        crate::routes::payments::vnpay_ipn,
        crate::routes::payments::momo_ipn,
        crate::routes::payments::zalopay_callback,
        crate::routes::payments::list_admin_payments,
        crate::routes::payments::update_payment_status,
        // vitals + seo
        crate::routes::vitals::report_vitals,
        crate::routes::seo::sitemap,
        crate::routes::seo::robots,
        // chat
        crate::routes::chat::list_channels,
        crate::routes::chat::create_channel,
        crate::routes::chat::list_messages,
        crate::routes::chat::post_message,
        crate::routes::chat::mark_read,
        crate::routes::chat::claim_channel,
        crate::routes::chat::release_channel,
        crate::routes::chat::close_channel,
        crate::routes::presence::get_staff_presence,
        // notifications
        crate::routes::notifications::list,
        crate::routes::notifications::mark_read,
        // wishlist
        crate::routes::wishlist::list,
        crate::routes::wishlist::toggle,
        crate::routes::wishlist::remove,
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
        // admin — brands
        crate::routes::admin::brands::list,
        crate::routes::admin::brands::create,
        crate::routes::admin::brands::update,
        crate::routes::admin::brands::delete,
        // admin — routes
        crate::routes::admin::routes::list,
        crate::routes::admin::routes::create,
        crate::routes::admin::routes::update,
        crate::routes::admin::routes::delete,
        // admin — schedules
        crate::routes::admin::schedules::list,
        crate::routes::admin::schedules::create,
        crate::routes::admin::schedules::update,
        crate::routes::admin::schedules::delete,
        // admin — pickup points
        crate::routes::admin::pickup_points::list,
        crate::routes::admin::pickup_points::create,
        crate::routes::admin::pickup_points::update,
        crate::routes::admin::pickup_points::delete,
        // admin — bus layouts
        crate::routes::admin::bus_layouts::list,
        // admin — reviews moderation
        crate::routes::admin::reviews::list,
        crate::routes::admin::reviews::moderate,
        crate::routes::admin::reviews::delete,
        // admin — bookings
        crate::routes::admin::bookings::list,
        crate::routes::admin::bookings::get,
        crate::routes::admin::bookings::update_status,
        crate::routes::admin::bookings::stats,
        crate::routes::admin::bookings::export,
        // admin — cron jobs (recurring background jobs)
        crate::routes::admin::jobs::list,
        crate::routes::admin::jobs::list_runs,
        crate::routes::admin::jobs::update,
        crate::routes::admin::jobs::trigger,
        // admin — addresses (brand-owned points for schedule sequences).
        // Registered LAST on purpose: utoipa numbers the generated SDK
        // functions by declaration order (list2, list3, …), so appending
        // keeps the existing numbers stable and the frontend's aliased
        // imports (`list2Options as adminBrandsListOptions`, …) valid.
        crate::routes::admin::addresses::list,
        crate::routes::admin::addresses::create,
        crate::routes::admin::addresses::update,
        crate::routes::admin::addresses::delete,
        // nullclaw
        crate::routes::nullclaw::status,
        crate::routes::nullclaw::list_exchanges,
        // system monitoring
        crate::routes::system::system_status,
        crate::routes::system::chat_stats,
        // admin — vehicle types (schedule form's "Loại xe" catalog).
        // Registered LAST on purpose (see the addresses comment above):
        // appending keeps the existing SDK function numbers stable.
        crate::routes::admin::vehicle_types::list,
        crate::routes::admin::vehicle_types::create,
        crate::routes::admin::vehicle_types::update,
        crate::routes::admin::vehicle_types::delete,
        // admin — cron job run cancellation (the admin "kill" button).
        crate::routes::admin::jobs::cancel,
        // reviews — the caller's own reviews (account feedback page).
        // Appended LAST on purpose (see the addresses comment above):
        // appending keeps the existing SDK function numbers stable.
        crate::routes::reviews::mine,
        // admin — per-brand feedback aggregates (admin feedback page).
        crate::routes::admin::reviews::summary,
        // system — live host metrics (admin server-monitoring page).
        // Appended LAST on purpose (see the addresses comment above):
        // appending keeps the existing SDK function numbers stable.
        crate::routes::system::system_metrics,
    ),
    components(schemas(
        // auth
        crate::routes::auth::RegisterRequest,
        crate::routes::auth::LoginRequest,
        crate::routes::auth::AuthResponse,
        // users
        crate::routes::users::UserOut,
        crate::routes::users::SetUserRoleRequest,
        crate::routes::users::SetUserRoleResponse,
        crate::routes::users::UserListResponse,
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
        crate::dto::review::CreateReviewInput,
        crate::dto::review::UpdateReviewInput,
        crate::dto::review::ReviewOut,
        crate::dto::review::ReviewListResponse,
        crate::dto::review::ReviewMutationResponse,
        crate::dto::review::ReviewDeleteResponse,
        crate::dto::review::ReviewTagsResponse,
        // bookings
        crate::dto::booking::HoldReq,
        crate::dto::booking::PassengerReq,
        crate::dto::booking::ConfirmReq,
        crate::dto::booking::CancelReq,
        crate::dto::booking::BookingListItem,
        crate::dto::booking::BookingListResponse,
        crate::dto::booking::BookingLookupResponse,
        crate::dto::booking::BookingHoldResponse,
        crate::dto::booking::BookingCancelResponse,
        crate::dto::booking::BookingConfirmResponse,
        crate::dto::booking::BookingSeatOut,
        crate::dto::booking::BookingTripPreview,
        crate::dto::booking::BookingRoutePreview,
        crate::dto::booking::BookingBrandPreview,
        crate::dto::booking::BookingBusLayoutPreview,
        crate::dto::booking::PickupPointOut,
        // payments
        crate::dto::payment::CreatePaymentReq,
        crate::dto::payment::CreatePaymentResponse,
        crate::dto::payment::PaymentOut,
        crate::dto::payment::ListPaymentsResponse,
        crate::dto::payment::CancelPaymentReq,
        crate::dto::payment::CancelPaymentResponse,
        crate::dto::payment::MarkCodCollectedReq,
        crate::dto::payment::MarkCodCollectedResponse,
        crate::dto::payment::BankTransferInstructions,
        crate::dto::payment::IpnResponse,
        crate::dto::payment::AdminPaymentOut,
        crate::dto::payment::AdminPaymentListResponse,
        crate::dto::payment::AdminPaymentsQuery,
        crate::dto::payment::UpdatePaymentStatusReq,
        crate::dto::payment::UpdatePaymentStatusResponse,
        // vitals
        crate::routes::vitals::VitalsReport,
        // places
        crate::dto::place::PlaceOut,
        crate::dto::place::PlaceListResponse,
        crate::dto::place::PlaceSearchHit,
        crate::dto::place::PlaceSearchResponse,
        // routing
        crate::dto::routing::DirectionsResponse,
        crate::dto::routing::MatrixResponse,
        crate::dto::routing::IsochroneResponse,
        // public catalog
        crate::dto::public::BrandOut,
        crate::dto::public::BrandDetailOut,
        crate::dto::public::BrandListResponse,
        crate::dto::public::RouteOut,
        crate::dto::public::RouteBrandPreview,
        crate::dto::public::RouteEndpoint,
        crate::dto::public::RouteListResponse,
        crate::dto::public::TripResult,
        crate::dto::public::TripSearchResponse,
        crate::dto::public::TripDetail,
        crate::dto::public::TripCore,
        crate::dto::public::TripRouteDetail,
        crate::dto::public::TripBrandDetail,
        crate::dto::public::TripEndpoint,
        crate::dto::public::TripBusLayout,
        crate::dto::public::TripPricing,
        crate::dto::public::TripAmenity,
        crate::dto::public::TripPickupPoint,
        crate::dto::public::TripSeatMap,
        crate::dto::public::TripSeatDeck,
        crate::dto::public::TripSeatRow,
        crate::dto::public::TripSeat,
        crate::dto::public::TripCampaign,
        crate::dto::public::CampaignOut,
        crate::dto::public::CampaignListResponse,
        crate::dto::public::CampaignValidateResponse,
        crate::dto::public::StatsResponse,
        // chat
        crate::dto::chat::ChatChannelOut,
        crate::dto::chat::ChatChannelListResponse,
        crate::dto::chat::ChatMessageOut,
        crate::dto::chat::ChatMessageListResponse,
        crate::dto::chat::CreateChannelRequest,
        crate::dto::chat::ChannelAssignmentResponse,
        crate::dto::chat::StaffPresenceOut,
        crate::dto::chat::StaffPresenceResponse,
        crate::dto::chat::CreateChannelResponse,
        crate::dto::chat::CreateMessageRequest,
        crate::dto::chat::CreateMessageResponse,
        crate::dto::chat::MarkChannelReadResponse,
        crate::dto::chat::ChatStatsResponse,
        // notifications
        crate::dto::notification::NotificationOut,
        crate::dto::notification::NotificationListResponse,
        crate::dto::notification::MarkNotificationsReadRequest,
        crate::dto::notification::MarkNotificationsReadResponse,
        // wishlist
        crate::dto::wishlist::WishlistItemOut,
        crate::dto::wishlist::WishlistListResponse,
        crate::dto::wishlist::ToggleWishlistRequest,
        crate::dto::wishlist::ToggleWishlistResponse,
        crate::dto::wishlist::DeleteWishlistResponse,
        // admin
        crate::dto::admin::AdminBrandOut,
        crate::dto::admin::AdminBrandListResponse,
        crate::dto::admin::AdminMutationResponse,
        crate::dto::admin::UpsertBrandRequest,
        crate::dto::admin::AdminRouteOut,
        crate::dto::admin::AdminRouteListResponse,
        crate::dto::admin::AdminPlacePreview,
        crate::dto::admin::UpsertRouteRequest,
        crate::dto::admin::AdminScheduleOut,
        crate::dto::admin::AdminScheduleListResponse,
        crate::dto::admin::UpsertScheduleRequest,
        crate::dto::admin::AdminSchedulePointOut,
        crate::dto::admin::UpsertSchedulePointItem,
        crate::dto::admin::AdminAddressOut,
        crate::dto::admin::AdminAddressListResponse,
        crate::dto::admin::UpsertAddressRequest,
        crate::dto::admin::CronJobOut,
        crate::dto::admin::CronJobListResponse,
        crate::dto::admin::CronJobRunOut,
        crate::dto::admin::CronJobRunListResponse,
        crate::dto::admin::UpdateCronJobRequest,
        crate::dto::admin::AdminPickupPointOut,
        crate::dto::admin::AdminPickupPointListResponse,
        crate::dto::admin::UpsertPickupPointRequest,
        crate::dto::admin::AdminBusLayoutOut,
        crate::dto::admin::AdminBusLayoutListResponse,
        crate::dto::admin::AdminReviewListResponse,
        crate::dto::admin::ModerateReviewRequest,
        crate::dto::admin::ModerateReviewResponse,
        crate::dto::admin::AdminBookingOut,
        crate::dto::admin::AdminBookingListResponse,
        crate::dto::admin::AdminBookingDetail,
        crate::dto::admin::AdminBookingDetailResponse,
        crate::dto::admin::AdminBookingSeatOut,
        crate::dto::admin::UpdateBookingStatusRequest,
        crate::dto::admin::UpdateBookingStatusResponse,
        crate::dto::admin::AdminBookingStatusUpdate,
        crate::dto::admin::AdminBookingStatsResponse,
        crate::dto::admin::AdminBookingTotals,
        crate::dto::admin::AdminBookingDayBucket,
        crate::dto::admin::AdminBookingExportResponse,
        // system monitoring
        crate::routes::system::SystemStatusResponse,
        crate::routes::system::SystemUptime,
        crate::routes::system::WebsocketStats,
        crate::routes::system::DatabaseStats,
        crate::routes::system::ProcessStats,
        // admin — vehicle types (appended last, same ordering rule)
        crate::dto::admin::AdminVehicleTypeOut,
        crate::dto::admin::AdminVehicleTypeListResponse,
        crate::dto::admin::UpsertVehicleTypeRequest,
        // admin — per-brand feedback aggregates (appended last, same rule)
        crate::dto::admin::AdminReviewBrandSummary,
        crate::dto::admin::AdminReviewBrandSummaryListResponse,
        // system — live host metrics (admin server-monitoring page)
        crate::dto::system::SystemMetrics,
        crate::dto::system::DiskInfo,
    )),
    tags(
        (name = "auth", description = "Authentication endpoints"),
        (name = "users", description = "User management"),
        (name = "posts", description = "Post management"),
        (name = "price-alerts", description = "Price-drop alert subscriptions"),
        (name = "system", description = "Health & readiness"),
        (name = "reviews", description = "Review management"),
        (name = "bookings", description = "Booking management"),
        (name = "payments", description = "Payment intents + provider webhooks (VNPay/MoMo/ZaloPay/VietQR/COD)"),
        (name = "vitals", description = "Web Vitals RUM (real-user monitoring)"),
        (name = "seo", description = "SEO — sitemap.xml, robots.txt, PWA manifest"),
        (name = "chat", description = "Chat channels & messages"),
        (name = "notifications", description = "User notifications"),
        (name = "wishlist", description = "Saved routes / trips"),
        (name = "places", description = "Place search & geocoding (OSM)"),
        (name = "public", description = "Public catalog (brands, routes, trips, campaigns)"),
        (name = "routing", description = "Routing & directions (Valhalla proxy)"),
        (name = "admin", description = "Admin CRUD + moderation (requires employee role)"),
        (name = "nullclaw", description = "NullClaw AI provider"),
    )
)]
pub struct ApiDoc;

#[cfg(test)]
mod tests {
    use super::ApiDoc;
    use utoipa::OpenApi;

    /// Serialize the spec (catches derive/registration mistakes at test
    /// time) and dump it to `frontend/openapi.json` so the TS SDK can
    /// be regenerated offline:
    ///
    /// ```sh
    /// cargo test --lib dump_openapi_spec_for_the_frontend_sdk
    /// cd frontend && bun run openapi-ts
    /// ```
    ///
    /// (The config used to point at a live server; a checked-in spec
    /// file makes regeneration reproducible without one.)
    #[test]
    fn dump_openapi_spec_for_the_frontend_sdk() {
        let spec = ApiDoc::openapi();
        let json = serde_json::to_string_pretty(&spec).expect("serialize openapi spec");
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/frontend/openapi.json");
        std::fs::write(path, &json).expect("write frontend/openapi.json");
        // The cron-jobs admin surface must stay registered.
        assert!(json.contains("/api/admin/cron-jobs"));
        // Every registered path must have an operationId (openapi-ts
        // generates SDK functions from them).
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        for (path, item) in v["paths"].as_object().expect("paths object") {
            let ops = item.as_object().expect("path item object");
            for (method, op) in ops {
                if ["get", "post", "patch", "put", "delete"].contains(&method.as_str()) {
                    assert!(
                        op.get("operationId").is_some(),
                        "{method} {path} is missing an operationId"
                    );
                }
            }
        }
    }
}
