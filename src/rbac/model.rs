use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Role {
    pub id: uuid::Uuid,
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Permission {
    pub id: uuid::Uuid,
    pub name: String,
    pub description: Option<String>,
}

/// Standard permission names used by the routes. The seed migration
/// inserts exactly these.
pub mod consts {
    pub const USERS_READ: &str = "users:read";
    pub const USERS_WRITE: &str = "users:write";
    pub const USERS_DELETE: &str = "users:delete";
    pub const POSTS_READ: &str = "posts:read";
    pub const POSTS_WRITE: &str = "posts:write";
    pub const POSTS_DELETE: &str = "posts:delete";

    // Admin namespace — these are checked at the route handler layer,
    // not the service layer, so the guard is visible at the route
    // definition and impossible to forget.
    pub const ADMIN_BRANDS_READ: &str = "admin:brands:read";
    pub const ADMIN_BRANDS_WRITE: &str = "admin:brands:write";
    pub const ADMIN_ROUTES_READ: &str = "admin:routes:read";
    pub const ADMIN_ROUTES_WRITE: &str = "admin:routes:write";
    pub const ADMIN_SCHEDULES_READ: &str = "admin:schedules:read";
    pub const ADMIN_SCHEDULES_WRITE: &str = "admin:schedules:write";
    pub const ADMIN_ADDRESSES_READ: &str = "admin:addresses:read";
    pub const ADMIN_ADDRESSES_WRITE: &str = "admin:addresses:write";
    pub const ADMIN_PICKUP_POINTS_READ: &str = "admin:pickup_points:read";
    pub const ADMIN_PICKUP_POINTS_WRITE: &str = "admin:pickup_points:write";
    pub const ADMIN_BUS_LAYOUTS_READ: &str = "admin:bus_layouts:read";
    pub const ADMIN_REVIEWS_MODERATE: &str = "admin:reviews:moderate";
    pub const ADMIN_BOOKINGS_READ: &str = "admin:bookings:read";
    pub const ADMIN_BOOKINGS_WRITE: &str = "admin:bookings:write";
    pub const ADMIN_PAYMENTS_READ: &str = "admin:payments:read";
    pub const ADMIN_PAYMENTS_WRITE: &str = "admin:payments:write";
    pub const ADMIN_STATS_READ: &str = "admin:stats:read";
    pub const ADMIN_EXPORT: &str = "admin:export";
    pub const ADMIN_NULLCLAW_READ: &str = "admin:nullclaw:read";
}
