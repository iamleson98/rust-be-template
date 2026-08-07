//! SeaORM entity definitions.
//!
//! These mirror what `sea-orm-cli generate entity -o src/entity` produces
//! from the live schema (reverse-from-DB workflow). Re-generating later
//! will overwrite these files without breaking the public surface.

pub mod post;
pub mod permission;
pub mod refresh_token;
pub mod role;
pub mod role_permission;
pub mod user;
pub mod user_role;

pub use post::Entity as Post;
pub use permission::Entity as Permission;
pub use refresh_token::Entity as RefreshToken;
pub use role::Entity as Role;
pub use role_permission::Entity as RolePermission;
pub use user::Entity as User;
pub use user_role::Entity as UserRole;
