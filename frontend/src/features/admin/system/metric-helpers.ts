/**
 * Formatting + tone helpers for the admin system-metrics cards.
 *
 * Ported from pdf-tts's `lib/utils/format.ts` + `usage-tone.ts` so both
 * products' admin screens share the same semantics: SI-decimal bytes,
 * compact uptime, and green/amber/red thresholds at 70 % / 90 %.
 */

/** SI-decimal bytes: 1536 → "1.5 KB"; invalid/negative → "—". */
export function formatBytes(bytes: number, digits = 1): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '—';
  }
  const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit++;
  }
  // Whole bytes never show a fraction; scaled units honour `digits`.
  const text =
    unit === 0
      ? value.toFixed(0)
      : value.toFixed(digits).replace(/\.0+$/, '');
  return `${text} ${UNITS[unit]}`;
}

/** `used / total * 100`, clamped to [0, 100]; 0 for invalid input. */
export function usagePercent(used: number, total: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }
  return Math.min(Math.max((used / total) * 100, 0), 100);
}

/** 90061 → "1d 1h"; 3665 → "1h 1m"; invalid → "—". */
export function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '—';
  }
  const s = Math.floor(seconds);
  const days = Math.floor(s / 86_400);
  const hours = Math.floor((s % 86_400) / 3_600);
  const minutes = Math.floor((s % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${s}s`;
}

/** ≥ 90 % critical (red) · ≥ 70 % warning (amber) · else OK (green). */
export function usageTone(percent: number): string {
  if (percent >= 90) return 'text-red-600';
  if (percent >= 70) return 'text-amber-600';
  return 'text-green-600';
}

/** Bar-fill color matching `usageTone`'s thresholds. */
export function barTone(percent: number): string {
  if (percent >= 90) return 'bg-red-500';
  if (percent >= 70) return 'bg-amber-500';
  return 'bg-green-500';
}
