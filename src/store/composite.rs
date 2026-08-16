use std::sync::Arc;

use super::{
    AuditStore, BookingStore, BrandStore, ChatStore, PlaceStore, PostStore, PriceAlertStore,
    RbacStore, RefreshTokenStore, ReviewStore, RouteStore, ScheduleStore, TripStore, UserStore,
};

#[derive(Clone)]
pub struct CompositeStore {
    users: Arc<dyn UserStore>,
    posts: Arc<dyn PostStore>,
    rbac: Arc<dyn RbacStore>,
    refresh_tokens: Arc<dyn RefreshTokenStore>,
    brands: Arc<dyn BrandStore>,
    chat: Arc<dyn ChatStore>,
    bookings: Arc<dyn BookingStore>,
    reviews: Arc<dyn ReviewStore>,
    routes: Arc<dyn RouteStore>,
    schedules: Arc<dyn ScheduleStore>,
    trips: Arc<dyn TripStore>,
    places: Arc<dyn PlaceStore>,
    price_alerts: Arc<dyn PriceAlertStore>,
    audit: Arc<dyn AuditStore>,
}

impl CompositeStore {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        users: Arc<dyn UserStore>,
        posts: Arc<dyn PostStore>,
        rbac: Arc<dyn RbacStore>,
        refresh_tokens: Arc<dyn RefreshTokenStore>,
        brands: Arc<dyn BrandStore>,
        chat: Arc<dyn ChatStore>,
        bookings: Arc<dyn BookingStore>,
        reviews: Arc<dyn ReviewStore>,
        routes: Arc<dyn RouteStore>,
        schedules: Arc<dyn ScheduleStore>,
        trips: Arc<dyn TripStore>,
        places: Arc<dyn PlaceStore>,
        price_alerts: Arc<dyn PriceAlertStore>,
        audit: Arc<dyn AuditStore>,
    ) -> Self {
        Self {
            users,
            posts,
            rbac,
            refresh_tokens,
            brands,
            chat,
            bookings,
            reviews,
            routes,
            schedules,
            trips,
            places,
            price_alerts,
            audit,
        }
    }

    pub fn user_store(&self) -> Arc<dyn UserStore> {
        self.users.clone()
    }

    pub fn post_store(&self) -> Arc<dyn PostStore> {
        self.posts.clone()
    }

    pub fn rbac_store(&self) -> Arc<dyn RbacStore> {
        self.rbac.clone()
    }

    pub fn refresh_token_store(&self) -> Arc<dyn RefreshTokenStore> {
        self.refresh_tokens.clone()
    }

    pub fn brand_store(&self) -> Arc<dyn BrandStore> {
        self.brands.clone()
    }

    pub fn chat_store(&self) -> Arc<dyn ChatStore> {
        self.chat.clone()
    }

    pub fn booking_store(&self) -> Arc<dyn BookingStore> {
        self.bookings.clone()
    }

    pub fn review_store(&self) -> Arc<dyn ReviewStore> {
        self.reviews.clone()
    }

    pub fn route_store(&self) -> Arc<dyn RouteStore> {
        self.routes.clone()
    }

    pub fn schedule_store(&self) -> Arc<dyn ScheduleStore> {
        self.schedules.clone()
    }

    pub fn trip_store(&self) -> Arc<dyn TripStore> {
        self.trips.clone()
    }

    pub fn place_store(&self) -> Arc<dyn PlaceStore> {
        self.places.clone()
    }

    pub fn price_alert_store(&self) -> Arc<dyn PriceAlertStore> {
        self.price_alerts.clone()
    }

    pub fn audit_store(&self) -> Arc<dyn AuditStore> {
        self.audit.clone()
    }
}
