/**
 * Formatting + tone helpers for the admin system page. Every formatter takes
 * `null` (a value the platform did not report) and shows "—" for it: the page
 * never turns a missing measurement into a zero.
 */

const DASH = "—";

/** SI-decimal bytes: 1536 → "1.5 KB"; missing/invalid → "—". */
export function formatBytes(bytes: number | null | undefined, digits = 1): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return DASH;
  const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit++;
  }
  // Whole bytes never show a fraction; scaled units honour `digits`.
  const text = unit === 0 ? value.toFixed(0) : value.toFixed(digits).replace(/\.0+$/, "");
  return `${text} ${UNITS[unit]}`;
}

/** `used / total * 100`, clamped to [0, 100]; `null` when either is unknown. */
export function usagePercent(
  used: number | null | undefined,
  total: number | null | undefined,
): number | null {
  if (used == null || total == null || !Number.isFinite(used) || !(total > 0)) return null;
  return Math.min(Math.max((used / total) * 100, 0), 100);
}

/** 90061 → "1d 1h"; 3665 → "1h 1m"; missing → "—". */
export function formatUptime(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return DASH;
  const s = Math.floor(seconds);
  const days = Math.floor(s / 86_400);
  const hours = Math.floor((s % 86_400) / 3_600);
  const minutes = Math.floor((s % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${s}s`;
}

/** 12.345 → "12.3 ms"; missing → "—". */
export function formatMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return DASH;
  return `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms`;
}

/** 42.5 → "42.5%"; missing → "—". */
export function formatPercent(pct: number | null | undefined): string {
  return pct == null || !Number.isFinite(pct) ? DASH : `${pct.toFixed(1)}%`;
}

/** Bar-fill color: ≥ 90 % red · ≥ 70 % amber · else green. */
export function barTone(percent: number): string {
  if (percent >= 90) return "bg-red-500";
  if (percent >= 70) return "bg-amber-500";
  return "bg-green-500";
}
