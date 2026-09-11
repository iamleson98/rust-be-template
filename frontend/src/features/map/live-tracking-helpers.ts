// Extracted from the original 'live-tracking.tsx'.

// Deterministic hash for seed-based mock data
export function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (s.charCodeAt(i) + ((h << 5) - h)) | 0
  }
  return Math.abs(h)
}

// Format seconds as HH:MM:SS countdown
export function formatCountdown(sec: number): string {
  if (sec <= 0) return '00:00:00'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
