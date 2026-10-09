//! When a trip leaves, and what that means for refunds.
//!
//! Schedules are wall-clock times in Vietnam (UTC+7, no daylight saving):
//! the trip row carries a plain `YYYY-MM-DD` date and the schedule a plain
//! `HH:MM`, so the UTC instant has to be derived.

use chrono::{DateTime, FixedOffset, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Utc};

/// Vietnam's UTC offset in seconds.
const LOCAL_OFFSET_SECS: i32 = 7 * 3600;

fn local_offset() -> FixedOffset {
    FixedOffset::east_opt(LOCAL_OFFSET_SECS).expect("UTC+7 is a valid offset")
}

fn parse_hhmm(s: &str) -> Option<NaiveTime> {
    let s = s.trim();
    NaiveTime::parse_from_str(s, "%H:%M")
        .or_else(|_| NaiveTime::parse_from_str(s, "%H:%M:%S"))
        .ok()
}

fn local_to_utc(naive: NaiveDateTime) -> Option<DateTime<Utc>> {
    local_offset()
        .from_local_datetime(&naive)
        .single()
        .map(|t| t.with_timezone(&Utc))
}

/// The UTC instant a trip departs: the driver's recorded departure when the
/// trip has left, otherwise the schedule's wall-clock time on the trip date.
/// `None` when neither can be read.
pub fn departure_instant(
    departure_date: &str,
    schedule_time: &str,
    actual_departure_at: Option<&str>,
) -> Option<DateTime<Utc>> {
    if let Some(actual) = actual_departure_at.map(str::trim).filter(|a| !a.is_empty()) {
        if let Ok(t) = DateTime::parse_from_rfc3339(actual) {
            return Some(t.with_timezone(&Utc));
        }
        // A zone-less timestamp is local wall-clock time like everything else.
        if let Ok(naive) = NaiveDateTime::parse_from_str(actual, "%Y-%m-%dT%H:%M:%S") {
            return local_to_utc(naive);
        }
    }
    let date = NaiveDate::parse_from_str(departure_date.split('T').next()?, "%Y-%m-%d").ok()?;
    local_to_utc(date.and_time(parse_hhmm(schedule_time)?))
}

/// Today's date in Vietnam (`YYYY-MM-DD`), the calendar trips are dated by.
pub fn local_today() -> String {
    Utc::now()
        .with_timezone(&local_offset())
        .format("%Y-%m-%d")
        .to_string()
}

/// Share of the paid amount handed back when cancelling `hours_until`
/// hours before departure: more than 24 h → 90 %, more than 4 h → 50 %,
/// otherwise nothing.
pub fn refund_percent(hours_until: f64) -> i64 {
    if hours_until > 24.0 {
        90
    } else if hours_until > 4.0 {
        50
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    #[test]
    fn schedule_time_is_vietnam_wall_clock() {
        // 08:30 in UTC+7 is 01:30 UTC.
        assert_eq!(
            departure_instant("2026-10-10", "08:30", None),
            Some(at("2026-10-10T01:30:00Z"))
        );
        // Early-morning departures land on the previous UTC day.
        assert_eq!(
            departure_instant("2026-10-10", "05:00", None),
            Some(at("2026-10-09T22:00:00Z"))
        );
    }

    #[test]
    fn accepts_seconds_and_a_datetime_for_the_date() {
        assert_eq!(
            departure_instant("2026-10-10T00:00:00", "21:15:00", None),
            Some(at("2026-10-10T14:15:00Z"))
        );
    }

    #[test]
    fn a_recorded_departure_wins() {
        assert_eq!(
            departure_instant("2026-10-10", "08:30", Some("2026-10-10T02:10:00Z")),
            Some(at("2026-10-10T02:10:00Z"))
        );
        // Zone-less recorded times are local.
        assert_eq!(
            departure_instant("2026-10-10", "08:30", Some("2026-10-10T09:00:00")),
            Some(at("2026-10-10T02:00:00Z"))
        );
        // Garbage falls back to the schedule.
        assert_eq!(
            departure_instant("2026-10-10", "08:30", Some("soon")),
            Some(at("2026-10-10T01:30:00Z"))
        );
    }

    #[test]
    fn unreadable_input_is_none() {
        assert_eq!(departure_instant("tomorrow", "08:30", None), None);
        assert_eq!(departure_instant("2026-10-10", "late", None), None);
        assert_eq!(departure_instant("", "", None), None);
    }

    #[test]
    fn refund_tiers() {
        assert_eq!(refund_percent(72.0), 90);
        assert_eq!(refund_percent(24.1), 90);
        assert_eq!(refund_percent(24.0), 50);
        assert_eq!(refund_percent(4.1), 50);
        assert_eq!(refund_percent(4.0), 0);
        assert_eq!(refund_percent(-3.0), 0);
    }
}
