/**
 * Document head management (SEO) — per-route <title> + meta description.
 *
 * Extracted from the original 'src/router.tsx'.
 *
 * For the prerendered home page, the meta tags are baked into index.html
 * at build time; for client-side navigations we update them here.
 */

import { useEffect } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { trackPageView } from '@/lib/analytics'

export const ROUTE_META: Record<string, { title: string; description: string }> = {
  '/': {
    title: 'DatXeVui — Đặt vé xe khách online | Xe giường nằm, limousine giá rẻ',
    description: 'Đặt vé xe khách online nhanh chóng, giá tốt nhất. Xe giường nằm, limousine, sleeper bus các tuyến Hà Nội, Đà Nẵng, Sài Gòn. Hỗ trợ 24/7.',
  },
  '/search': {
    title: 'Tìm chuyến xe — DatXeVui',
    description: 'So sánh giá vé xe khách các hãng. Lọc theo giờ đi, giá, loại xe, đánh giá.',
  },
  '/bookings': {
    title: 'Vé của tôi — DatXeVui',
    description: 'Quản lý vé đã đặt, lịch sử chuyến đi, đánh giá chuyến.',
  },
  '/admin': {
    title: 'Quản trị — DatXeVui',
    description: 'Bảng điều khiển quản trị hệ thống DatXeVui.',
  },
  '/admin/brands': { title: 'Hãng xe — Quản trị DatXeVui', description: 'Quản lý hãng xe, tuyến đường, lịch trình.' },
  '/admin/routes': { title: 'Tuyến đường — Quản trị DatXeVui', description: 'Quản lý tuyến đường.' },
  '/admin/schedules': { title: 'Lịch trình — Quản trị DatXeVui', description: 'Quản lý lịch trình.' },
  '/admin/cron-jobs': { title: 'Cron jobs — Quản trị DatXeVui', description: 'Quản lý tác vụ nền định kỳ.' },
  '/admin/tickets': { title: 'Vé đã bán — Quản trị DatXeVui', description: 'Quản lý vé đã bán.' },
  '/admin/chat': { title: 'Chat hỗ trợ — Quản trị DatXeVui', description: 'Hỗ trợ khách hàng qua chat.' },
  '/admin/feedback': { title: 'Phản hồi — Quản trị DatXeVui', description: 'Quản lý phản hồi khách hàng.' },
  '/admin/bus-layouts': { title: 'Sơ đồ ghế — Quản trị DatXeVui', description: 'Quản lý sơ đồ ghế xe.' },
  '/admin/vehicle-types': { title: 'Loại xe — Quản trị DatXeVui', description: 'Quản lý danh mục loại xe.' },
  '/admin/system': { title: 'Hệ thống — Quản trị DatXeVui', description: 'Theo dõi hệ thống.' },
  '/admin/users': { title: 'Người dùng — Quản trị DatXeVui', description: 'Quản lý vai trò người dùng, nhân viên và quản trị viên.' },
  '/admin/payments': { title: 'Thanh toán — Quản trị DatXeVui', description: 'Quản lý giao dịch thanh toán.' },
  '/account': { title: 'Tài khoản — DatXeVui', description: 'Quản lý tài khoản và cài đặt.' },
  '/account/wishlist': { title: 'Yêu thích — DatXeVui', description: 'Danh sách yêu thích.' },
  '/account/loyalty': { title: 'Điểm thưởng — DatXeVui', description: 'Điểm tích lũy.' },
  '/account/notifications': { title: 'Thông báo — DatXeVui', description: 'Cài đặt thông báo.' },
  '/account/security': { title: 'Bảo mật — DatXeVui', description: 'Bảo mật tài khoản.' },
  '/account/trips': { title: 'Lịch sử chuyến đi — DatXeVui', description: 'Lịch sử đặt vé và đánh giá chuyến đi.' },
  '/account/feedback': { title: 'Phản hồi của tôi — DatXeVui', description: 'Lịch sử đánh giá các chuyến đi đã đi.' },
  '/map': {
    title: 'Bản đồ tuyến đường — DatXeVui',
    description: 'Xem bản đồ các tuyến xe khách phổ biến trên khắp Việt Nam.',
  },
  '/login': {
    title: 'Đăng nhập — DatXeVui',
    description: 'Đăng nhập để đặt vé, xem vé của bạn và tích điểm thưởng.',
  },
  '/compare': {
    title: 'So sánh chuyến xe — DatXeVui',
    description: 'So sánh giá, giờ đi, tiện nghi của các chuyến xe.',
  },
}

export function RouteMeta() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  useEffect(() => {
    // Match either exact path or prefix for parameterized routes
    let meta = ROUTE_META[pathname]
    if (!meta) {
      if (pathname.startsWith('/trips/')) {
        meta = { title: 'Chi tiết chuyến xe — DatXeVui', description: 'Xem sơ đồ ghế, lịch trình, đánh giá và đặt vé trực tuyến.' }
      } else if (pathname.startsWith('/brands/')) {
        meta = { title: 'Hãng xe — DatXeVui', description: 'Thông tin hãng xe, tuyến đường, đánh giá khách hàng.' }
      } else if (pathname.startsWith('/bookings/')) {
        meta = { title: 'Chi tiết vé — DatXeVui', description: 'Thông tin vé đã đặt.' }
      } else {
        meta = { title: 'DatXeVui — Đặt vé xe khách online', description: ROUTE_META['/'].description }
      }
    }
    if (typeof document !== 'undefined') {
      document.title = meta.title
      const descTag = document.querySelector('meta[name="description"]')
      if (descTag) descTag.setAttribute('content', meta.description)

      // ── noindex for private routes (UIUX-017) ───────────────
      // Admin + account pages should never be indexed by search engines.
      // We add/update `<meta name="robots" content="noindex, nofollow">`
      // on these routes, and remove it on public routes (so the meta
      // element doesn't accumulate stale state across SPA navigations).
      const isPrivate = pathname.startsWith('/admin') || pathname.startsWith('/account') || pathname === '/login'
      let robotsTag = document.querySelector('meta[name="robots"]')
      if (isPrivate) {
        if (!robotsTag) {
          robotsTag = document.createElement('meta')
          robotsTag.setAttribute('name', 'robots')
          document.head.appendChild(robotsTag)
        }
        robotsTag.setAttribute('content', 'noindex, nofollow')
      } else if (robotsTag) {
        // Remove the noindex tag on public routes so they're crawlable.
        robotsTag.remove()
      }

      // ── GA4 page-view tracking ──────────────────────────────
      // Fires on every SPA route change. No-op if GA4 isn't configured.
      // Skip on private routes — admin/account activity shouldn't hit
      // analytics (PII + abuse-vector protection).
      if (!isPrivate) {
        trackPageView(pathname, meta.title)
      }
    }
  }, [pathname])
  return null
}
