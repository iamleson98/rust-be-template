use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
    paths(
        crate::routes::auth::register,
        crate::routes::auth::login,
        crate::routes::auth::refresh,
        crate::routes::auth::logout,
        crate::routes::auth::me,
        crate::routes::users::list_users,
        crate::routes::users::get_user,
        crate::routes::users::delete_user,
        crate::routes::posts::list_posts,
        crate::routes::posts::create_post,
        crate::routes::posts::get_post,
        crate::routes::posts::update_post,
        crate::routes::posts::delete_post,
        crate::routes::health::health,
        crate::routes::health::ready,
    ),
    components(schemas(
        crate::routes::auth::RegisterRequest,
        crate::routes::auth::LoginRequest,
        crate::routes::auth::AuthResponse,
        crate::routes::users::UserOut,
        crate::routes::posts::PostOut,
        crate::routes::posts::CreatePostRequest,
        crate::routes::posts::UpdatePostRequest,
        crate::routes::posts::ListPostsResponse,
    )),
    tags(
        (name = "auth", description = "Authentication endpoints"),
        (name = "users", description = "User management"),
        (name = "posts", description = "Post management"),
        (name = "system", description = "Health & readiness"),
    )
)]
pub struct ApiDoc;
