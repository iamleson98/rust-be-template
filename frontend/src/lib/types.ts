// Shared types and utilities for the bus booking platform

export const VEHICLE_TYPE_LABELS: Record<string, string> = {
  limousine: 'Limousine',
  sleeper: 'Giường nằm',
  semi_sleeper: 'Giường nằm đơn',
  standard: 'Ghế ngồi',
  minivan: 'Minivan',
}

export const VEHICLE_TYPE_ICONS: Record<string, string> = {
  limousine: '🚐',
  sleeper: '🛏️',
  semi_sleeper: '💺',
  standard: '🚌',
  minivan: '🚐',
}

export const SEAT_CLASS_LABELS: Record<string, string> = {
  standard: 'Thường',
  premium: 'Cao cấp',
  vip: 'VIP',
  bed_lower: 'Giường dưới',
  bed_upper: 'Giường trên',
}

export const SEAT_CLASS_COLORS: Record<string, string> = {
  standard: '#64748b',
  premium: '#2563eb',
  vip: '#7c3aed',
  bed_lower: '#1d4ed8',
  bed_upper: '#3b82f6',
}

export const AMENITY_LABELS: Record<string, string> = {
  window: 'Cửa sổ',
  legroom: 'Rộng chân',
  recline: 'Ngả sâu',
  curtain: 'Rèm che',
  charging: 'Cắm sạc',
  wifi: 'Wi-Fi',
  ac: 'Điều hòa',
  water: 'Nước uống',
}

// Format VND currency
export function formatVND(amount: number): string {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(amount)
}

// Format number with thousand separator (no currency symbol)
export function formatNum(n: number): string {
  return new Intl.NumberFormat('vi-VN').format(n)
}

// Format duration in minutes to "Xh Ym" or "X ngày Yh"
export function formatDuration(min: number): string {
  if (min < 60) return `${min} phút`
  const days = Math.floor(min / (24 * 60))
  const hours = Math.floor((min % (24 * 60)) / 60)
  const mins = min % 60
  if (days > 0) {
    return mins > 0 ? `${days} ngày ${hours}h${mins > 0 ? ` ${mins}p` : ''}` : `${days} ngày ${hours}h`
  }
  return mins > 0 ? `${hours}h ${mins}p` : `${hours}h`
}

// Format a date string (ISO or yyyy-mm-dd) to Vietnamese display
// IMPORTANT: Always use Asia/Ho_Chi_Minh timezone to keep date and time parts in sync.
export function formatDateVN(dateStr: string, opts?: Intl.DateTimeFormatOptions): string {
  const d = typeof dateStr === 'string' ? new Date(dateStr) : dateStr
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    ...(opts ?? { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }),
  }).format(d)
}

export function formatTimeVN(dateStr: string): string {
  const d = typeof dateStr === 'string' ? new Date(dateStr) : dateStr
  return new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Ho_Chi_Minh' }).format(d)
}

export function formatDateTimeVN(dateStr: string): string {
  return `${formatDateVN(dateStr)} • ${formatTimeVN(dateStr)}`
}

// Relative time (e.g. "3 phút trước")
export function relativeTime(dateStr: string): string {
  const d = typeof dateStr === 'string' ? new Date(dateStr) : dateStr
  const diff = Date.now() - d.getTime()
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return 'vừa xong'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} phút trước`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} giờ trước`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day} ngày trước`
  return formatDateVN(dateStr, { day: '2-digit', month: '2-digit' })
}

// Vietnamese diacritic-insensitive search normalization
export function noTones(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim()
}

export function normalizePhone(phone: string): string {
  const p = phone.replace(/\s/g, '')
  if (p.startsWith('0')) return '+84' + p.slice(1)
  if (p.startsWith('84')) return '+' + p
  return p
}
