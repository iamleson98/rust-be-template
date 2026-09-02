//! Pure schedule time-math for the recurring-job scheduler.
//!
//! A schedule is "every `interval_days` days at `at_hour:at_minute`
//! local wall-clock time", where "local" is a **fixed UTC offset**
//! (default +420 min = UTC+7, Vietnam). Vietnam has no daylight-saving
//! time, so a fixed offset is exactly correct there and avoids a tz
//! database dependency; deployments elsewhere can override the offset
//! via `SCHEDULER_TZ_OFFSET_MINUTES`.
//!
//! All timestamps on the wire and in the DB are ISO-8601 UTC strings
//! (`2026-09-02T15:04:05Z`, second precision — lexicographically
//! sortable). This module works in typed `DateTime<Utc>` values; the
//! store layer converts.
//!
//! Three pure functions cover the whole state machine:
//!
//! - [`next_occurrence`] — the first slot strictly after a reference
//!   instant (used when arming a schedule that has never run).
//! - [`advance_slot`] — the slot one interval after a previous slot
//!   (used after the scheduler fires a job).
//! - [`catch_up`] — repeatedly advance a stale slot until it is in the
//!   future (used on boot / after downtime so a schedule that missed
//!   several intervals while the server was down fires once, not N
//!   times).

use chrono::{DateTime, Duration, NaiveDate, NaiveTime, TimeZone, Utc};

/// The local wall-clock time of `t` under a fixed UTC offset, as a
/// naive date + time pair.
fn to_local(t: DateTime<Utc>, offset_minutes: i32) -> (NaiveDate, NaiveTime) {
    let shifted = t + Duration::minutes(i64::from(offset_minutes));
    (shifted.date_naive(), shifted.time())
}

/// The UTC instant of `at_hour:at_minute` on local date `day`.
fn from_local(day: NaiveDate, at_hour: i16, at_minute: i16, offset_minutes: i32) -> DateTime<Utc> {
    let naive = day
        .and_hms_opt(at_hour as u32, at_minute as u32, 0)
        .expect("at_hour / at_minute are validated to the 0-23 / 0-59 range");
    // Interpret the naive wall-clock as if it were UTC, then remove the
    // offset: local = utc + offset → utc = local - offset.
    Utc.from_utc_datetime(&naive) - Duration::minutes(i64::from(offset_minutes))
}

/// The first `at_hour:at_minute` (local, fixed offset) strictly after
/// `after`.
///
/// If today's slot is still in the future it is today's; otherwise
/// tomorrow's. Never returns a value `<= after`.
pub fn next_occurrence(
    after: DateTime<Utc>,
    at_hour: i16,
    at_minute: i16,
    offset_minutes: i32,
) -> DateTime<Utc> {
    let (day, _) = to_local(after, offset_minutes);
    let mut slot = from_local(day, at_hour, at_minute, offset_minutes);
    if slot <= after {
        slot = from_local(
            day.succ_opt().expect("date arithmetic overflow"),
            at_hour,
            at_minute,
            offset_minutes,
        );
    }
    slot
}

/// The slot one `interval_days` after a previous slot (same wall-clock
/// time, `interval_days` days later).
pub fn advance_slot(
    previous_slot: DateTime<Utc>,
    interval_days: i16,
    at_hour: i16,
    at_minute: i16,
    offset_minutes: i32,
) -> DateTime<Utc> {
    let (day, _) = to_local(previous_slot, offset_minutes);
    let next_day = day
        .checked_add_signed(Duration::days(i64::from(interval_days as i64)))
        .expect("date arithmetic overflow");
    from_local(next_day, at_hour, at_minute, offset_minutes)
}

/// Advance a (possibly stale) slot until it is strictly after `now`.
///
/// A server that was down for three missed biweekly slots should fire
/// the job once on boot, not three times — so the scheduler skips
/// missed slots rather than replaying them. Bounded by
/// downtime / interval iterations (cheap date arithmetic).
pub fn catch_up(
    mut slot: DateTime<Utc>,
    interval_days: i16,
    at_hour: i16,
    at_minute: i16,
    offset_minutes: i32,
    now: DateTime<Utc>,
) -> DateTime<Utc> {
    while slot <= now {
        slot = advance_slot(slot, interval_days, at_hour, at_minute, offset_minutes);
    }
    slot
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    /// UTC+7 — the default (Vietnam, no DST).
    const VN: i32 = 420;
    /// UTC-5 (New York standard time, no DST handling — fixed offsets only).
    const NY: i32 = -300;

    fn utc(y: i32, m: u32, d: u32, h: u32, min: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(y, m, d, h, min, 0).unwrap()
    }

    // ── next_occurrence ─────────────────────────────────────────────

    #[test]
    fn next_occurrence_today_when_slot_still_in_future() {
        // 01:00 local (+7) == 18:00Z previous day. Today's 02:00 local
        // (== 19:00Z same UTC day boundary aside) is still ahead.
        let now = utc(2026, 9, 1, 18, 0); // 01:00 +07 on Sep 2
        let slot = next_occurrence(now, 2, 0, VN);
        assert_eq!(slot, utc(2026, 9, 1, 19, 0)); // 02:00 +07 on Sep 2
    }

    #[test]
    fn next_occurrence_tomorrow_when_today_slot_passed() {
        // 03:00 local (+7) == 20:00Z. Today's 02:00 local already passed.
        let now = utc(2026, 9, 1, 20, 0); // 03:00 +07 on Sep 2
        let slot = next_occurrence(now, 2, 0, VN);
        assert_eq!(slot, utc(2026, 9, 2, 19, 0)); // 02:00 +07 on Sep 3
    }

    #[test]
    fn next_occurrence_is_strictly_after() {
        // Exactly on the slot → next is tomorrow's (strictly after).
        let now = utc(2026, 9, 1, 19, 0); // 02:00 +07 on Sep 2
        let slot = next_occurrence(now, 2, 0, VN);
        assert!(slot > now);
        assert_eq!(slot, utc(2026, 9, 2, 19, 0));
    }

    #[test]
    fn next_occurrence_midnight_boundary_wraps_day() {
        // 23:59 local +7 = 16:59Z; slot at 00:00 local → tomorrow local
        // day's midnight = 17:00Z on the SAME UTC date.
        let now = utc(2026, 9, 1, 16, 59); // 23:59 +07 Sep 1
        let slot = next_occurrence(now, 0, 0, VN);
        assert_eq!(slot, utc(2026, 9, 1, 17, 0)); // 00:00 +07 Sep 2
    }

    #[test]
    fn next_occurrence_negative_offset() {
        // 03:00Z with NY (-5) = 22:00 Aug 31 local. That day's 02:00 NY
        // slot (07:00Z Aug 31) has passed → next is Sep 1 02:00 NY = 07:00Z.
        let now = utc(2026, 9, 1, 3, 0);
        let slot = next_occurrence(now, 2, 0, NY);
        assert_eq!(slot, utc(2026, 9, 1, 7, 0));
    }

    // ── advance_slot ────────────────────────────────────────────────

    #[test]
    fn advance_slot_adds_interval_days_same_wall_clock() {
        let slot = utc(2026, 9, 1, 19, 0); // 02:00 +07 Sep 2
        let next = advance_slot(slot, 14, 2, 0, VN);
        assert_eq!(next, utc(2026, 9, 15, 19, 0)); // 02:00 +07 Sep 16
    }

    #[test]
    fn advance_slot_over_month_boundary() {
        let slot = utc(2026, 8, 18, 19, 0); // 02:00 +07 Aug 19
        let next = advance_slot(slot, 14, 2, 0, VN);
        assert_eq!(next, utc(2026, 9, 1, 19, 0)); // 02:00 +07 Sep 2
    }

    #[test]
    fn advance_slot_daily() {
        let slot = utc(2026, 9, 1, 19, 0);
        assert_eq!(advance_slot(slot, 1, 2, 0, VN), utc(2026, 9, 2, 19, 0));
    }

    // ── catch_up ────────────────────────────────────────────────────

    #[test]
    fn catch_up_noop_when_slot_in_future() {
        let slot = utc(2026, 9, 15, 19, 0);
        let now = utc(2026, 9, 1, 0, 0);
        assert_eq!(catch_up(slot, 14, 2, 0, VN, now), utc(2026, 9, 15, 19, 0));
    }

    #[test]
    fn catch_up_skips_missed_intervals() {
        // Server was down 3 weeks; the Sep-1 slot is 3 weeks stale with a
        // 14-day interval → the job should fire ONCE on boot, then be
        // armed for the next future slot.
        let slot = utc(2026, 9, 1, 19, 0);
        let now = utc(2026, 9, 22, 0, 0);
        let next = catch_up(slot, 14, 2, 0, VN, now);
        assert!(next > now);
        assert_eq!(next, utc(2026, 9, 29, 19, 0)); // 02:00 +07 Sep 30
    }

    #[test]
    fn catch_up_daily_recovers_fast() {
        // 30 missed daily slots — still resolves in 30 cheap iterations.
        let slot = utc(2026, 8, 1, 19, 0);
        let now = utc(2026, 8, 31, 0, 0);
        let next = catch_up(slot, 1, 2, 0, VN, now);
        assert!(next > now);
        assert_eq!(next, utc(2026, 8, 31, 19, 0)); // Sep 1 02:00 +07
    }

    // ── round-trip sanity ───────────────────────────────────────────

    #[test]
    fn advance_then_catch_up_is_stable() {
        let now = utc(2026, 9, 1, 0, 0);
        let armed = next_occurrence(now, 2, 0, VN);
        let fired = catch_up(armed, 14, 2, 0, VN, now);
        assert_eq!(fired, armed);
        let next = advance_slot(fired, 14, 2, 0, VN);
        assert!(next > fired);
        assert_eq!(next, fired + Duration::days(14));
    }
}
