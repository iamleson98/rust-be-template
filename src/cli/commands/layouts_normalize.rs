//! `backend layouts-normalize` — give legacy bus layouts a real seat plan.
//!
//! Layouts imported before seat plans existed are flat grids (a 42-bed
//! sleeper is one deck of 21 rows × 2 columns). For every layout whose
//! size and name match a catalog template, this lays the template over
//! the layout's existing seats: ids and labels are untouched — tickets and
//! trips keep working — and only positions, decks and fixtures change.
//!
//! Dry run by default; `--apply` writes. Layouts with no matching
//! template, or whose seats the template cannot hold exactly, are
//! reported and left alone (fix them in the admin editor).

use std::collections::BTreeMap;
use std::sync::Arc;

use anyhow::Context;

use crate::cli::util::db_connect;
use crate::config::Config;
use crate::service::seat_plan::{self, sync_seats};
use crate::service::seat_plan_db;
use crate::service::seat_plan_normalize::{plan_normalization, Normalization};
use crate::store::{DbScheduleStore, DbTripStore, ScheduleStore, TripStore};

pub async fn run(apply: bool) -> anyhow::Result<()> {
    let cfg = Config::load().context("loading config")?;
    let db = Arc::new(db_connect(&cfg).await?);
    let schedules = DbScheduleStore::new(db.clone());
    let trips = DbTripStore::new(db.clone());

    let layouts = schedules
        .list_bus_layouts()
        .await
        .context("listing layouts")?;
    let mut tally: BTreeMap<&str, usize> = BTreeMap::new();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);

    for layout in &layouts {
        let seats = trips
            .list_seats_by_bus_layout_id(&layout.id.to_string())
            .await
            .context("listing seats")?;
        let name = layout.name.as_deref().unwrap_or("(unnamed)");
        let verdict = plan_normalization(layout, &seats);
        let outcome = match verdict {
            Normalization::AlreadyPlanned => "already planned",
            Normalization::NoSeats => "no seats",
            Normalization::NoTemplate => {
                println!(
                    "skip  {}  {name} ({} seats): no matching template",
                    layout.id,
                    seats.len()
                );
                "no template"
            }
            Normalization::DoesNotFit { preset, reason } => {
                println!(
                    "skip  {}  {name}: {preset} does not fit — {reason}",
                    layout.id
                );
                "does not fit"
            }
            Normalization::Fitted { preset, plan } => {
                let in_use = seat_plan_db::layout_in_use(&schedules, layout.id).await?;
                let sync = match sync_seats(&seats, &plan, in_use) {
                    Ok(sync) => sync,
                    Err(e) => {
                        println!("skip  {}  {name}: {preset}: {e:?}", layout.id);
                        *tally.entry("error").or_default() += 1;
                        continue;
                    }
                };
                if apply {
                    seat_plan_db::apply_plan(&db, layout.id, &plan, &seats, &sync, &now)
                        .await
                        .with_context(|| format!("applying {preset} to {}", layout.id))?;
                }
                println!(
                    "{}  {}  {name} → {preset} ({} seats)",
                    if apply { "done " } else { "plan " },
                    layout.id,
                    seat_plan::sellable_count(&plan)
                );
                "normalized"
            }
        };
        *tally.entry(outcome).or_default() += 1;
    }

    println!(
        "\n{} layout(s): {}",
        layouts.len(),
        tally
            .iter()
            .map(|(k, v)| format!("{v} {k}"))
            .collect::<Vec<_>>()
            .join(", ")
    );
    if !apply && tally.contains_key("normalized") {
        println!("dry run — nothing changed; re-run with --apply to write.");
    }
    Ok(())
}
