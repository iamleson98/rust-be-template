/**
 * Slot arithmetic for table-driven jobs — port of `scheduler.rs`. A job
 * fires "every N days at HH:MM" in the operator's wall clock (Vietnam,
 * UTC+7 unless `SCHEDULER_TZ_OFFSET_MINUTES` says otherwise); slots are
 * absolute instants.
 */

/** Vietnam's UTC offset in minutes (Rust `SCHEDULER_TZ_OFFSET_MINUTES` default). */
export const DEFAULT_TZ_OFFSET_MINUTES = 420;

const MINUTE = 60_000;
const DAY = 86_400_000;

/** The UTC instant of `hour:minute` on the local calendar day that `localDayStart` begins. */
function fromLocal(localDayStart: number, hour: number, minute: number, offset: number): number {
  return localDayStart + (hour * 60 + minute - offset) * MINUTE;
}

/** Start (as if UTC) of the local calendar day containing `t`. */
function localDay(t: number, offset: number): number {
  return Math.floor((t + offset * MINUTE) / DAY) * DAY;
}

/** The first slot strictly after `after`. */
export function nextOccurrence(after: Date, hour: number, minute: number, offset: number): Date {
  const day = localDay(after.getTime(), offset);
  let slot = fromLocal(day, hour, minute, offset);
  if (slot <= after.getTime()) slot = fromLocal(day + DAY, hour, minute, offset);
  return new Date(slot);
}

/** The slot `intervalDays` local days after `previous`, at the same wall-clock time. */
export function advanceSlot(
  previous: Date,
  intervalDays: number,
  hour: number,
  minute: number,
  offset: number,
): Date {
  const day = localDay(previous.getTime(), offset) + intervalDays * DAY;
  return new Date(fromLocal(day, hour, minute, offset));
}

/** Skip missed slots: the first slot after `now`, stepping from `slot`. */
export function catchUp(
  slot: Date,
  intervalDays: number,
  hour: number,
  minute: number,
  offset: number,
  now: Date,
): Date {
  let next = slot;
  while (next.getTime() <= now.getTime())
    next = advanceSlot(next, intervalDays, hour, minute, offset);
  return next;
}
