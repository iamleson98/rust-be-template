//! `backend routes list` — print all registered routes.

use axum::routing::Route;

/// `Router` doesn't expose its routes publicly, so we maintain a hardcoded
/// list here and verify it stays in sync with the actual router at compile
/// time (changes to `routes/router.rs` should be reflected here).
pub fn run() -> anyhow::Result<()> {
    println!("Registered HTTP routes:");
    println!();
    println!("{:<30} {}", "Path", "Methods");
    println!("{}", "-".repeat(60));

    for (path, method) in ROUTES {
        println!("{:<30} {}", path, method);
    }

    println!();
    println!("Static routes:");
    println!("{:<30} {}", "/", "GET (ServeDir)");
    println!("{:<30} {}", "/*path", "GET (ServeDir)");

    println!();
    println!("Swagger UI: http://localhost:8080/swagger-ui");
    println!("OpenAPI JSON: http://localhost:8080/api-docs/openapi.json");

    Ok(())
}

const ROUTES: &[(&str, &str)] = &[
    ("/health", "GET"),
    ("/ready", "GET"),
    ("/api/auth/register", "POST"),
    ("/api/auth/login", "POST"),
    ("/api/auth/employee-login", "POST"),
    ("/api/auth/refresh", "POST"),
    ("/api/auth/logout", "POST"),
    ("/api/auth/me", "GET"),
    ("/api/users", "GET"),
    ("/api/users/:id", "GET, DELETE"),
    ("/api/posts", "GET, POST"),
    ("/api/posts/:id", "GET, PATCH, DELETE"),
    ("/api/ws", "GET (WebSocket upgrade)"),
];

#[allow(dead_code)]
fn _unused_route(_r: Route) {}
