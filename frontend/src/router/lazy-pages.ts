/**
 * Lazy route components + persistent overlays (code-split per route).
 *
 * Extracted from the original 'src/router.tsx'.
 *
 * Pages are `lazy()` islands — only the active route's chunk downloads.
 * Persistent shells (AdminShell / AccountShell) are imported EAGERLY (not
 * lazy) so the sidebar / account nav never unmounts during page-to-page
 * navigation. Only the content area inside the shell swaps (with a
 * skeleton fallback), which eliminates the old full-page white-flash
 * spinner.
 */

import { lazy } from 'react'
import { Header } from '@/components/layout/header'
import { AdminShell } from '@/components/layout/admin-shell'
import { AccountShell } from '@/components/layout/account-shell'
import { AdminContentSkeleton } from '@/components/layout/admin-content-skeleton'
import { AccountContentSkeleton } from '@/components/layout/account-content-skeleton'

// ── Lazy route components (code-split per route) ────────────────
export const HomePage = lazy(() => import('../routes/home').then((m) => ({ default: m.HomePage })))
export const SearchPage = lazy(() => import('../routes/search').then((m) => ({ default: m.SearchPage })))
export const TripDetailPage = lazy(() => import('../routes/trip-detail').then((m) => ({ default: m.TripDetailPage })))
export const BrandDetailPage = lazy(() => import('../routes/brand-detail').then((m) => ({ default: m.BrandDetailPage })))
export const BookingsPage = lazy(() => import('../routes/bookings').then((m) => ({ default: m.BookingsPage })))
export const BookingDetailPage = lazy(() => import('../routes/booking-detail').then((m) => ({ default: m.BookingDetailPage })))
export const ComparePage = lazy(() => import('../routes/compare').then((m) => ({ default: m.ComparePage })))
export const MapPage = lazy(() => import('../routes/map').then((m) => ({ default: m.MapPage })))
export const AdminPage = lazy(() => import('../routes/admin').then((m) => ({ default: m.AdminPage })))
export const AdminBrandsPage = lazy(() => import('../routes/admin/brands').then((m) => ({ default: m.AdminBrandsPage })))
export const AdminRoutesPage = lazy(() => import('../routes/admin/routes').then((m) => ({ default: m.AdminRoutesPage })))
export const AdminSchedulesPage = lazy(() => import('../routes/admin/schedules').then((m) => ({ default: m.AdminSchedulesPage })))
export const AdminCronJobsPage = lazy(() => import('../routes/admin/cron-jobs').then((m) => ({ default: m.AdminCronJobsPage })))
export const AdminTicketsPage = lazy(() => import('../routes/admin/tickets').then((m) => ({ default: m.AdminTicketsPage })))
export const AdminChatPage = lazy(() => import('../routes/admin/chat').then((m) => ({ default: m.AdminChatPage })))
export const AdminFeedbackPage = lazy(() => import('../routes/admin/feedback').then((m) => ({ default: m.AdminFeedbackPage })))
export const AdminBusLayoutsPage = lazy(() => import('../routes/admin/bus-layouts').then((m) => ({ default: m.AdminBusLayoutsPage })))
export const AdminVehicleTypesPage = lazy(() => import('../routes/admin/vehicle-types').then((m) => ({ default: m.AdminVehicleTypesPage })))
export const AdminSystemPage = lazy(() => import('../routes/admin/system').then((m) => ({ default: m.AdminSystemPage })))
export const AdminUsersPage = lazy(() => import('../routes/admin/users').then((m) => ({ default: m.AdminUsersPage })))
export const AdminPaymentsPage = lazy(() => import('../routes/admin/payments').then((m) => ({ default: m.AdminPaymentsPage })))
// Account pages
export const AccountPage = lazy(() => import('../routes/account').then((m) => ({ default: m.AccountPage })))
export const AccountWishlistPage = lazy(() => import('../routes/account/wishlist').then((m) => ({ default: m.AccountWishlistPage })))
export const AccountLoyaltyPage = lazy(() => import('../routes/account/loyalty').then((m) => ({ default: m.AccountLoyaltyPage })))
export const AccountNotificationsPage = lazy(() => import('../routes/account/notifications').then((m) => ({ default: m.AccountNotificationsPage })))
export const AccountSecurityPage = lazy(() => import('../routes/account/security').then((m) => ({ default: m.AccountSecurityPage })))
export const AccountTripsPage = lazy(() => import('../routes/account/trips').then((m) => ({ default: m.AccountTripsPage })))
export const AccountFeedbackPage = lazy(() => import('../routes/account/feedback').then((m) => ({ default: m.AccountFeedbackPage })))
export const LoginPage = lazy(() => import('../routes/login').then((m) => ({ default: m.LoginPageRoute })))
export const NotFoundPage = lazy(() => import('../routes/not-found').then((m) => ({ default: m.NotFoundPage })))

// Lazy persistent overlays (kept mounted once loaded for instant re-open)
export const Footer = lazy(() => import('@/components/layout/footer').then((m) => ({ default: m.Footer })))
export const MobileNav = lazy(() => import('@/components/layout/mobile-nav').then((m) => ({ default: m.MobileNav })))
export const ChatWidget = lazy(() => import('@/features/chat/chat-widget').then((m) => ({ default: m.ChatWidget })))
export const AudioCallWidget = lazy(() => import('@/components/layout/audio-call-widget').then((m) => ({ default: m.AudioCallWidget })))
export const BookingDialog = lazy(() => import('@/features/booking/flow/booking-dialog').then((m) => ({ default: m.BookingDialog })))
export const TripCompare = lazy(() => import('@/features/search/trip-compare').then((m) => ({ default: m.TripCompare })))
export const LoyaltyWidget = lazy(() => import('@/features/home/loyalty-widget').then((m) => ({ default: m.LoyaltyWidget })))
export const CancelDialog = lazy(() => import('@/features/booking/history/cancel-dialog').then((m) => ({ default: m.CancelDialog })))
export const PriceAlertDialog = lazy(() => import('@/features/price-alert/price-alert-dialog').then((m) => ({ default: m.PriceAlertDialog })))
export const ShareDialog = lazy(() => import('@/features/trips/share-dialog').then((m) => ({ default: m.ShareDialog })))
export const SupportFab = lazy(() => import('@/components/layout/support-fab').then((m) => ({ default: m.SupportFab })))

// ── Eagerly-imported persistent shells (see file header) ─────────
export { Header, AdminShell, AccountShell, AdminContentSkeleton, AccountContentSkeleton }
