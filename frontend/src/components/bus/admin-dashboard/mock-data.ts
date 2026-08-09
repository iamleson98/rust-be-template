/**
 * Mock data constants for the AdminDashboard module.
 *
 * Extracted verbatim from the original `admin-dashboard.tsx`
 * (lines 143-227). The dashboard shows mock data for revenue trends,
 * booking status distribution, customer segments, VIP customers, etc.
 * — these arrays power those visualizations until a real backend
 * analytics endpoint exists.
 */

import {
  Crown,
  Repeat,
  UserCheck,
  UserPlus,
} from 'lucide-react'
import type { RecentBooking } from './types'

export const REVENUE_7_DAYS = [12.5, 15.2, 8.7, 18.3, 14.1, 22.6, 16.8] // triệu VND
export const DAY_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']

// 30-day and 90-day revenue arrays (mock — derived for stable visuals)
export const REVENUE_30_DAYS = Array.from({ length: 30 }, (_, i) => {
  const base = 12 + Math.sin(i / 3) * 5 + ((i * 7) % 11) * 0.6
  return Number(base.toFixed(1))
})
export const REVENUE_90_DAYS = Array.from({ length: 90 }, (_, i) => {
  const base = 11 + Math.sin(i / 6) * 6 + ((i * 13) % 17) * 0.4
  return Number(base.toFixed(1))
})

export const BOOKING_STATUS = [
  { label: 'Đã xác nhận', pct: 65, color: '#2563eb' },
  { label: 'Chờ xử lý', pct: 20, color: '#f59e0b' },
  { label: 'Đã huỷ', pct: 10, color: '#f43f5e' },
  { label: 'Hoàn tiền', pct: 5, color: '#64748b' },
]

export const RECENT_BOOKINGS: RecentBooking[] = [
  { code: 'BK-7A3F12', name: 'Nguyễn Văn An', phone: '0912 345 678', route: 'Hà Nội → Đà Nẵng', departDate: '15/08/2025 08:30', seat: 'A1, A2', price: 350000, status: 'confirmed', payment: 'VNPay QR', time: '2 phút trước' },
  { code: 'BK-9B2E45', name: 'Trần Thị Bình', phone: '0987 654 321', route: 'Sài Gòn → Đà Lạt', departDate: '16/08/2025 22:00', seat: 'B3', price: 280000, status: 'pending', payment: 'Chờ chuyển khoản', time: '15 phút trước' },
  { code: 'BK-1C8D78', name: 'Lê Hoàng Cường', phone: '0901 234 567', route: 'Hà Nội → Sài Gòn', departDate: '17/08/2025 19:00', seat: 'C5, C6, C7', price: 620000, status: 'confirmed', payment: 'Momo', time: '32 phút trước' },
  { code: 'BK-4F6G90', name: 'Phạm Minh Dũng', phone: '0934 567 890', route: 'Đà Nẵng → Huế', departDate: '14/08/2025 06:00', seat: 'D2', price: 150000, status: 'cancelled', payment: 'Tiền mặt', time: '1 giờ trước' },
  { code: 'BK-2H5J34', name: 'Võ Thị Emma', phone: '0978 123 456', route: 'Sài Gòn → Nha Trang', departDate: '13/08/2025 23:30', seat: 'E1', price: 220000, status: 'refunded', payment: 'VNPay QR', time: '2 giờ trước' },
  { code: 'BK-8K3L56', name: 'Đỗ Minh Phong', phone: '0988 777 555', route: 'Hà Nội → Hải Phòng', departDate: '15/08/2025 14:00', seat: 'A4', price: 120000, status: 'confirmed', payment: 'Momo', time: '3 giờ trước' },
  { code: 'BK-5M7N89', name: 'Bùi Thị Quỳnh', phone: '0911 222 333', route: 'Sài Gòn → Cần Thơ', departDate: '16/08/2025 07:00', seat: 'B1, B2', price: 180000, status: 'confirmed', payment: 'ZaloPay', time: '4 giờ trước' },
  { code: 'BK-3P1Q23', name: 'Hoàng Văn Sơn', phone: '0902 333 444', route: 'Hà Nội → Quảng Ninh', departDate: '17/08/2025 09:00', seat: 'C2', price: 130000, status: 'pending', payment: 'Chờ chuyển khoản', time: '5 giờ trước' },
]

export const TOP_ROUTES = [
  { route: 'Hà Nội → Đà Nẵng', count: 342 },
  { route: 'Hà Nội → Sài Gòn', count: 287 },
  { route: 'Sài Gòn → Đà Lạt', count: 256 },
  { route: 'Sài Gòn → Nha Trang', count: 198 },
  { route: 'Đà Nẵng → Huế', count: 167 },
]

export const ACTIVITY_FEED = [
  { text: 'Nguyễn Văn An đặt vé Hà Nội → Đà Nẵng', icon: 'ticket', color: '#2563eb' },
  { text: 'Trần Thị Bình huỷ vé BK-9B2E45', icon: 'cancel', color: '#f43f5e' },
  { text: 'Chat mới từ khách Lê Hoàng Cường', icon: 'chat', color: '#f59e0b' },
  { text: 'Phạm Minh Dũng thanh toán vé BK-4F6G90', icon: 'payment', color: '#16a34a' },
  { text: 'Khuyến mãi SUMMER25 sắp hết hạn', icon: 'alert', color: '#7c3aed' },
  { text: 'Võ Thị Emma yêu cầu hoàn tiền', icon: 'refund', color: '#64748b' },
  { text: 'Huỳnh Đức Phong đặt vé Sài Gòn → Đà Lạt', icon: 'ticket', color: '#2563eb' },
  { text: 'Đánh giá mới 5 sao cho hãng Phương Trang', icon: 'review', color: '#f59e0b' },
]

// Customer segments (mock)
export const CUSTOMER_SEGMENTS = [
  { key: 'new', label: 'Khách mới', desc: '1 lần đặt', count: 4820, color: '#2563eb', icon: UserPlus },
  { key: 'returning', label: 'Khách quen', desc: '2-5 lần', count: 3150, color: '#3b82f6', icon: Repeat },
  { key: 'vip', label: 'Khách VIP', desc: '6+ lần', count: 890, color: '#f59e0b', icon: Crown },
  { key: 'potential', label: 'Tiềm năng', desc: 'Đã xem, chưa đặt', count: 1560, color: '#64748b', icon: UserCheck },
]

export const VIP_CUSTOMERS = [
  { name: 'Nguyễn Văn An', phone: '0912***678', bookings: 18, total: 12450000 },
  { name: 'Trần Thị Bình', phone: '0987***321', bookings: 15, total: 9870000 },
  { name: 'Lê Hoàng Cường', phone: '0901***567', bookings: 12, total: 8650000 },
  { name: 'Phạm Minh Dũng', phone: '0934***890', bookings: 11, total: 7320000 },
  { name: 'Võ Thị Emma', phone: '0978***456', bookings: 9, total: 6450000 },
]

// Bookings per hour for last 24h (mock — based on common traffic pattern)
export const BOOKINGS_PER_HOUR = [
  2, 1, 0, 0, 1, 3, 8, 18, 25, 22, 16, 14, 19, 24, 28, 31, 26, 21, 17, 23, 19, 12, 7, 4,
]
