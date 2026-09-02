use std::sync::Arc;

use sea_orm::DatabaseConnection;

use super::{
    AddressStore, AuditStore, BookingStore, BrandStore, ChatStore, NotificationStore, PaymentStore,
    PlaceStore, PostStore, PriceAlertStore, RbacStore, RefreshTokenStore, ReviewStore, RouteStore,
    ScheduleStore, TripStore, UserStore, WishlistStore,
};

#[derive(Clone)]
pub struct CompositeStore {
    db: Arc<DatabaseConnection>,
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
    notifications: Arc<dyn NotificationStore>,
    wishlist: Arc<dyn WishlistStore>,
    payments: Arc<dyn PaymentStore>,
    addresses: Arc<dyn AddressStore>,
}

impl CompositeStore {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        db: Arc<DatabaseConnection>,
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
        notifications: Arc<dyn NotificationStore>,
        wishlist: Arc<dyn WishlistStore>,
        payments: Arc<dyn PaymentStore>,
        addresses: Arc<dyn AddressStore>,
    ) -> Self {
        Self {
            db,
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
            notifications,
            wishlist,
            payments,
            addresses,
        }
    }

    /// Expose the underlying `DatabaseConnection` so services can run
    /// SeaORM transactions (`db.transaction(|txn| ...)`) for multi-table
    /// writes. The store traits don't accept a `&DatabaseTransaction`
    /// parameter (that would explode the trait surface), so transactional
    /// writes bypass the store layer and issue raw SeaORM queries on the
    /// transaction handle.
    pub fn db(&self) -> &DatabaseConnection {
        self.db.as_ref()
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

    pub fn notification_store(&self) -> Arc<dyn NotificationStore> {
        self.notifications.clone()
    }

    pub fn wishlist_store(&self) -> Arc<dyn WishlistStore> {
        self.wishlist.clone()
    }

    pub fn payment_store(&self) -> Arc<dyn PaymentStore> {
        self.payments.clone()
    }

    pub fn address_store(&self) -> Arc<dyn AddressStore> {
        self.addresses.clone()
    }
}

#[cfg(test)]
impl CompositeStore {
    /// Test fixture: every store over one shared in-memory SQLite DB
    /// (no schema — tests create only the tables they touch). Used by
    /// job-handler tests that need a `PlaceService` and by the jobs
    /// catalog contract test.
    pub async fn in_memory() -> Arc<Self> {
        let db = Arc::new(sea_orm::Database::connect("sqlite::memory:").await.unwrap());
        use super::{
            DbAddressStore, DbAuditStore, DbBookingStore, DbBrandStore, DbChatStore,
            DbNotificationStore, DbPaymentStore, DbPlaceStore, DbPostStore, DbPriceAlertStore,
            DbRbacStore, DbRefreshTokenStore, DbReviewStore, DbRouteStore, DbScheduleStore,
            DbTripStore, DbUserStore, DbWishlistStore,
        };
        Arc::new(Self::new(
            db.clone(),
            Arc::new(DbUserStore::new(db.clone())),
            Arc::new(DbPostStore::new(db.clone())),
            Arc::new(DbRbacStore::new(db.clone())),
            Arc::new(DbRefreshTokenStore::new(db.clone())),
            Arc::new(DbBrandStore::new(db.clone())),
            Arc::new(DbChatStore::new(db.clone())),
            Arc::new(DbBookingStore::new(db.clone())),
            Arc::new(DbReviewStore::new(db.clone())),
            Arc::new(DbRouteStore::new(db.clone())),
            Arc::new(DbScheduleStore::new(db.clone())),
            Arc::new(DbTripStore::new(db.clone())),
            Arc::new(DbPlaceStore::new(db.clone())),
            Arc::new(DbPriceAlertStore::new(db.clone())),
            Arc::new(DbAuditStore::new(db.clone())),
            Arc::new(DbNotificationStore::new(db.clone())),
            Arc::new(DbWishlistStore::new(db.clone())),
            Arc::new(DbPaymentStore::new(db.clone())),
            Arc::new(DbAddressStore::new(db.clone())),
        ))
    }
}
