//! The app schema as the import sees it.
//!
//! The per-column rules come from the sea-orm entities (the code that
//! reads the database after the cutover), SQLite metadata comes from
//! `PRAGMA`s on the real files, and every entity is listed once, in
//! [`entities!`], which also drives the decode-every-row proof.

use std::collections::{BTreeMap, BTreeSet};

use anyhow::bail;
use futures::TryStreamExt;
use sea_orm::sea_query::ColumnType;
use sea_orm::sqlx::{Row, SqliteConnection};
use sea_orm::{ColumnTrait, DatabaseConnection, DbErr, EntityTrait, IdenStatic, Iterable};

use super::convert::{IntWidth, Kind};
use super::report::DecodeResult;
use crate::entity;

/// A SQL identifier, quoted.
pub fn quote(ident: &str) -> String {
    format!("\"{}\"", ident.replace('"', "\"\""))
}

// ── Entities ─────────────────────────────────────────────────────────

/// One app column: its name and how its values must look.
#[derive(Debug, Clone)]
pub struct ColumnSpec {
    pub name: String,
    pub kind: Kind,
}

/// One app table, as its entity declares it.
#[derive(Debug, Clone)]
pub struct EntitySpec {
    pub table: String,
    pub columns: Vec<ColumnSpec>,
}

/// The rules that depend on what a column means rather than on its type.
fn special_kind(table: &str, column: &str) -> Option<Kind> {
    match (table, column) {
        ("schedule", "days_of_week") => Some(Kind::DaysMask),
        ("trip_session", "actual_departure_at") => Some(Kind::InstantOrLocal),
        ("trip_session", "departure_date") | ("schedule", "effective_from" | "effective_to") => {
            Some(Kind::Date)
        }
        _ => None,
    }
}

/// How the values of `table.column` must look, from the entity's column
/// type. `String` columns that hold instants are the ones the app names
/// `*_at` / `*_until` (a unit test keeps that rule honest).
pub fn column_kind(table: &str, column: &str, ty: &ColumnType) -> anyhow::Result<Kind> {
    if let Some(kind) = special_kind(table, column) {
        return Ok(kind);
    }
    Ok(match ty {
        ColumnType::Uuid => Kind::Uuid,
        ColumnType::TimestampWithTimeZone | ColumnType::Timestamp | ColumnType::DateTime => {
            Kind::Instant
        }
        ColumnType::Boolean => Kind::Bool,
        ColumnType::SmallInteger => Kind::Int(IntWidth::I16),
        ColumnType::Integer => Kind::Int(IntWidth::I32),
        ColumnType::BigInteger => Kind::Int(IntWidth::I64),
        ColumnType::Float | ColumnType::Double => Kind::Real,
        ColumnType::String(_) | ColumnType::Text | ColumnType::Char(_) => {
            if column.ends_with("_at") || column.ends_with("_until") {
                Kind::InstantText
            } else {
                Kind::Text
            }
        }
        other => bail!("{table}.{column}: unsupported column type {other:?}"),
    })
}

fn spec_of<E: EntityTrait>() -> anyhow::Result<EntitySpec> {
    let table = E::default().table_name().to_owned();
    let columns = E::Column::iter()
        .map(|c| {
            let def = c.def();
            Ok(ColumnSpec {
                name: c.as_str().to_owned(),
                kind: column_kind(&table, c.as_str(), def.get_column_type())?,
            })
        })
        .collect::<anyhow::Result<_>>()?;
    Ok(EntitySpec { table, columns })
}

async fn decode_entity<E>(db: &DatabaseConnection) -> DecodeResult
where
    E: EntityTrait,
    E::Model: Send,
{
    let table = E::default().table_name().to_owned();
    let counted = async {
        let mut rows = E::find().stream(db).await?;
        let mut n = 0u64;
        while rows.try_next().await?.is_some() {
            n += 1;
        }
        Ok::<u64, DbErr>(n)
    }
    .await;
    match counted {
        Ok(rows) => DecodeResult {
            table,
            rows: Some(rows),
            error: None,
        },
        Err(e) => DecodeResult {
            table,
            rows: None,
            error: Some(e.to_string()),
        },
    }
}

/// Lists every entity once: the specs the copy is planned from and the
/// decode-every-row proof. `entity::mod.rs` lists the same modules; the
/// `every_table_has_an_entity_here` test keeps this list and the migrated
/// schema in step.
macro_rules! entities {
    ($($module:ident),+ $(,)?) => {
        /// The app tables, from their entities.
        pub fn entity_specs() -> anyhow::Result<Vec<EntitySpec>> {
            Ok(vec![$(spec_of::<entity::$module::Entity>()?),+])
        }

        /// Load every row of every entity through sea-orm, the way the
        /// app will: a row that does not decode is an import failure.
        pub async fn decode_every_row(db: &DatabaseConnection) -> Vec<DecodeResult> {
            vec![$(decode_entity::<entity::$module::Entity>(db).await),+]
        }
    };
}

entities!(
    ad_conversion,
    address,
    audit_log,
    background_job,
    booking,
    booking_seat,
    brand,
    bus_layout,
    campaign,
    chat_assignment,
    chat_channel,
    chat_channel_member,
    chat_message,
    coupon,
    discount_campaign,
    discount_campaign_brand,
    discount_program,
    discount_tier,
    job_run,
    notification,
    null_claw_exchange,
    payment,
    permissions,
    pickup_point,
    place,
    posts,
    price_alert,
    push_device,
    refresh_tokens,
    review,
    role_permissions,
    roles,
    route,
    route_picture,
    schedule,
    schedule_fare,
    schedule_point,
    scheduled_job,
    seat,
    seat_inventory,
    staff_presence_state,
    trip_session,
    user,
    user_roles,
    user_verification,
    vehicle_type,
);

// ── SQLite metadata ──────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct ColumnInfo {
    pub name: String,
    pub notnull: bool,
    /// 1-based position in the primary key, 0 when not part of it.
    pub pk: i64,
    /// Has a `DEFAULT`, so an INSERT may leave it out.
    pub has_default: bool,
}

#[derive(Debug, Clone)]
pub struct ForeignKey {
    /// `PRAGMA foreign_key_list` id; what `foreign_key_check` reports.
    pub id: i64,
    pub columns: Vec<String>,
    pub parent: String,
    pub on_delete: String,
}

pub async fn table_names(conn: &mut SqliteConnection) -> anyhow::Result<Vec<String>> {
    let rows =
        sea_orm::sqlx::query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
            .fetch_all(conn)
            .await?;
    rows.iter()
        .map(|r| Ok(r.try_get::<String, _>("name")?))
        .collect()
}

pub async fn table_info(
    conn: &mut SqliteConnection,
    table: &str,
) -> anyhow::Result<Vec<ColumnInfo>> {
    let rows = sea_orm::sqlx::query(&format!("PRAGMA table_info({})", quote(table)))
        .fetch_all(conn)
        .await?;
    rows.iter()
        .map(|r| {
            Ok(ColumnInfo {
                name: r.try_get("name")?,
                notnull: r.try_get::<i64, _>("notnull")? != 0,
                pk: r.try_get("pk")?,
                has_default: r.try_get::<Option<String>, _>("dflt_value")?.is_some(),
            })
        })
        .collect()
}

pub async fn foreign_keys(
    conn: &mut SqliteConnection,
    table: &str,
) -> anyhow::Result<Vec<ForeignKey>> {
    let rows = sea_orm::sqlx::query(&format!("PRAGMA foreign_key_list({})", quote(table)))
        .fetch_all(conn)
        .await?;
    let mut by_id: BTreeMap<i64, ForeignKey> = BTreeMap::new();
    for r in &rows {
        let id: i64 = r.try_get("id")?;
        let fk = by_id.entry(id).or_insert_with(|| ForeignKey {
            id,
            columns: Vec::new(),
            parent: r.try_get("table").unwrap_or_default(),
            on_delete: r.try_get("on_delete").unwrap_or_default(),
        });
        fk.columns.push(r.try_get("from")?);
    }
    Ok(by_id.into_values().collect())
}

/// The column sets of every UNIQUE index and the primary key.
pub async fn unique_indexes(
    conn: &mut SqliteConnection,
    table: &str,
) -> anyhow::Result<Vec<Vec<String>>> {
    let indexes = sea_orm::sqlx::query(&format!("PRAGMA index_list({})", quote(table)))
        .fetch_all(&mut *conn)
        .await?;
    let mut sets = Vec::new();
    for index in &indexes {
        if index.try_get::<i64, _>("unique")? == 0 || index.try_get::<i64, _>("partial")? != 0 {
            continue;
        }
        let name: String = index.try_get("name")?;
        let columns = sea_orm::sqlx::query(&format!("PRAGMA index_info({})", quote(&name)))
            .fetch_all(&mut *conn)
            .await?;
        let columns = columns
            .iter()
            .map(|c| Ok(c.try_get::<String, _>("name")?))
            .collect::<anyhow::Result<Vec<_>>>()?;
        if !sets.contains(&columns) {
            sets.push(columns);
        }
    }
    // An INTEGER PRIMARY KEY is the rowid and has no index of its own.
    let mut pk: Vec<_> = table_info(conn, table)
        .await?
        .into_iter()
        .filter(|c| c.pk > 0)
        .collect();
    pk.sort_by_key(|c| c.pk);
    let pk: Vec<String> = pk.into_iter().map(|c| c.name).collect();
    if !pk.is_empty() && !sets.contains(&pk) {
        sets.push(pk);
    }
    Ok(sets)
}

/// Tables in the order a copy can run without a child ahead of its
/// parent: parents first, ties by name. A cycle (none in the app schema)
/// would not stop the copy, since foreign keys are off while it runs; its
/// members just follow in name order.
pub fn parents_first(parents: &BTreeMap<String, BTreeSet<String>>) -> Vec<String> {
    let mut waiting: BTreeMap<&str, BTreeSet<&str>> = parents
        .iter()
        .map(|(table, set)| {
            let deps = set
                .iter()
                .filter(|p| *p != table && parents.contains_key(*p))
                .map(String::as_str)
                .collect();
            (table.as_str(), deps)
        })
        .collect();
    let mut order = Vec::with_capacity(waiting.len());
    while !waiting.is_empty() {
        let ready: Vec<&str> = waiting
            .iter()
            .filter(|(_, deps)| deps.is_empty())
            .map(|(t, _)| *t)
            .collect();
        let ready = if ready.is_empty() {
            // A cycle: release everything left, in name order.
            waiting.keys().copied().collect()
        } else {
            ready
        };
        for table in &ready {
            waiting.remove(table);
            order.push((*table).to_owned());
        }
        for deps in waiting.values_mut() {
            for table in &ready {
                deps.remove(table);
            }
        }
    }
    order
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm_migration::MigratorTrait;

    fn deps(pairs: &[(&str, &[&str])]) -> BTreeMap<String, BTreeSet<String>> {
        pairs
            .iter()
            .map(|(t, ps)| {
                (
                    (*t).to_owned(),
                    ps.iter().map(|p| (*p).to_owned()).collect(),
                )
            })
            .collect()
    }

    #[test]
    fn parents_come_before_children() {
        let order = parents_first(&deps(&[
            ("booking", &["user", "trip"]),
            ("payment", &["booking", "user"]),
            ("trip", &[]),
            ("user", &[]),
        ]));
        let pos = |t: &str| order.iter().position(|o| o == t).unwrap();
        assert!(pos("user") < pos("booking"));
        assert!(pos("trip") < pos("booking"));
        assert!(pos("booking") < pos("payment"));
        assert_eq!(order.len(), 4);
    }

    #[test]
    fn self_references_and_cycles_do_not_hang_the_order() {
        let order = parents_first(&deps(&[
            ("a", &["a"]),
            ("b", &["c"]),
            ("c", &["b"]),
            ("d", &["gone"]),
        ]));
        assert_eq!(order.len(), 4);
        assert!(order.contains(&"b".to_owned()) && order.contains(&"c".to_owned()));
    }

    #[tokio::test]
    async fn every_table_has_an_entity_here() {
        use sea_orm::{ConnectionTrait, Database, Statement};
        let db = Database::connect("sqlite::memory:").await.unwrap();
        migrator::Migrator::up(&db, None).await.unwrap();
        let rows = db
            .query_all(Statement::from_string(
                db.get_database_backend(),
                "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
            ))
            .await
            .unwrap();
        let mut tables: Vec<String> = rows
            .iter()
            .map(|r| r.try_get("", "name").unwrap())
            .filter(|t: &String| t != "seaql_migrations")
            .collect();
        let mut entities: Vec<String> = entity_specs()
            .unwrap()
            .into_iter()
            .map(|s| s.table)
            .collect();
        tables.sort();
        entities.sort();
        assert_eq!(
            tables, entities,
            "a table without an entity (or the reverse) in `entities!`"
        );
    }

    #[test]
    fn instants_in_string_columns_are_exactly_the_at_and_until_names() {
        for spec in entity_specs().unwrap() {
            for c in &spec.columns {
                let timestamp_name = c.name.ends_with("_at") || c.name.ends_with("_until");
                let instant = matches!(
                    c.kind,
                    Kind::InstantText | Kind::InstantOrLocal | Kind::Instant
                );
                assert_eq!(
                    timestamp_name, instant,
                    "{}.{} is classified {:?}",
                    spec.table, c.name, c.kind
                );
            }
        }
    }
}
