//! Migrations 23 and 24: `address.city_id` backfill and the `user` role
//! losing `users:read`, both on a database that already carried data.

use sea_orm::{ConnectionTrait, Database, DatabaseConnection, Statement};
use sea_orm_migration::MigratorTrait;

/// Number of migrations before the two under test.
const BEFORE_WP1: u32 = 22;

async fn scalar(db: &DatabaseConnection, sql: &str) -> i64 {
    let row = db
        .query_one(Statement::from_string(db.get_database_backend(), sql))
        .await
        .expect("query")
        .expect("one row");
    row.try_get("", "n").expect("column n")
}

async fn user_role_has_users_read(db: &DatabaseConnection) -> bool {
    scalar(
        db,
        "SELECT COUNT(*) AS n FROM role_permissions rp \
         JOIN roles r ON r.id = rp.role_id \
         JOIN permissions p ON p.id = rp.permission_id \
         WHERE r.name = 'user' AND p.name = 'users:read'",
    )
    .await
        == 1
}

async fn city_of(db: &DatabaseConnection, name: &str) -> Option<String> {
    let row = db
        .query_one(Statement::from_string(
            db.get_database_backend(),
            format!("SELECT city_id FROM address WHERE name = '{name}'"),
        ))
        .await
        .expect("query")
        .expect("address row");
    row.try_get("", "city_id").expect("city_id")
}

async fn province_of(db: &DatabaseConnection, name: &str) -> Option<String> {
    let row = db
        .query_one(Statement::from_string(
            db.get_database_backend(),
            format!("SELECT province FROM address WHERE name = '{name}'"),
        ))
        .await
        .expect("query")
        .expect("address row");
    row.try_get("", "province").expect("province")
}

#[tokio::test]
async fn new_migrations_backfill_cities_and_drop_the_customer_directory_grant() {
    let db = Database::connect("sqlite::memory:").await.expect("connect");
    migrator::Migrator::up(&db, Some(BEFORE_WP1))
        .await
        .expect("migrate to 22");

    assert!(
        user_role_has_users_read(&db).await,
        "the original seed grants customers users:read"
    );

    db.execute_unprepared(
        "INSERT INTO brand (id, slug, name, created_at, updated_at) \
         VALUES (randomblob(16), 'b', 'B', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    )
    .await
    .expect("brand");
    for (name, province) in [
        ("hn", "Thành phố Hà Nội"),
        ("hcm", " TP. Hồ Chí Minh "),
        ("hy", "Tỉnh Hưng Yên"),
        ("dl", "Đắk Lắk"),
        ("unknown", "Quận 1"),
    ] {
        db.execute_unprepared(&format!(
            "INSERT INTO address (id, brand_id, name, lat, lon, province, created_at, updated_at) \
             VALUES (randomblob(16), (SELECT id FROM brand LIMIT 1), '{name}', 1.0, 2.0, '{province}', \
                     '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')"
        ))
        .await
        .expect("address");
    }
    db.execute_unprepared(
        "INSERT INTO address (id, brand_id, name, lat, lon, created_at, updated_at) \
         VALUES (randomblob(16), (SELECT id FROM brand LIMIT 1), 'no-province', 1.0, 2.0, \
                 '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    )
    .await
    .expect("address without a province");

    migrator::Migrator::up(&db, None)
        .await
        .expect("migrate to head");

    assert!(
        !user_role_has_users_read(&db).await,
        "customers must not read the user directory"
    );
    assert_eq!(
        scalar(
            &db,
            "SELECT COUNT(*) AS n FROM role_permissions rp \
             JOIN roles r ON r.id = rp.role_id \
             JOIN permissions p ON p.id = rp.permission_id \
             WHERE r.name IN ('admin', 'employee') AND p.name = 'users:read'"
        )
        .await,
        2,
        "staff keep users:read"
    );

    assert_eq!(city_of(&db, "hn").await.as_deref(), Some("ha-noi"));
    assert_eq!(city_of(&db, "hcm").await.as_deref(), Some("ho-chi-minh"));
    assert_eq!(city_of(&db, "hy").await.as_deref(), Some("hung-yen"));
    assert_eq!(city_of(&db, "dl").await.as_deref(), Some("dak-lak"));
    assert_eq!(city_of(&db, "unknown").await, None, "unmatched stays NULL");
    assert_eq!(city_of(&db, "no-province").await, None);

    assert_eq!(province_of(&db, "hn").await.as_deref(), Some("Hà Nội"));
    assert_eq!(
        province_of(&db, "hcm").await.as_deref(),
        Some("TP. Hồ Chí Minh")
    );
    assert_eq!(
        province_of(&db, "unknown").await.as_deref(),
        Some("Quận 1"),
        "unmatched provinces are left as entered"
    );
}

#[tokio::test]
async fn fresh_database_has_no_customer_users_read_grant() {
    let db = Database::connect("sqlite::memory:").await.expect("connect");
    migrator::Migrator::up(&db, None).await.expect("migrate");
    assert!(!user_role_has_users_read(&db).await);
    assert_eq!(
        scalar(
            &db,
            "SELECT COUNT(*) AS n FROM pragma_table_info('address') WHERE name = 'city_id'"
        )
        .await,
        1
    );
}
