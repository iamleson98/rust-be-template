// Simple i18n module — Vietnamese / English translation dictionary

import { useApp } from './store'

type TranslationMap = Record<string, string>

const vi: TranslationMap = {
  // Navigation
  'nav.home': 'Trang chủ',
  'nav.tickets': 'Vé của tôi',
  'nav.admin': 'Quản trị',
  'nav.support': 'Hỗ trợ',
  'nav.searchTrips': 'Tìm chuyến',
  'nav.bookTicket': 'Đặt vé',

  // Search
  'search.title': 'Tìm chuyến xe',
  'search.from': 'Điểm đi',
  'search.to': 'Điểm đến',
  'search.date': 'Ngày đi',
  'search.passengers': 'Khách',
  'search.adults': 'Người lớn',
  'search.children': 'Trẻ em',
  'search.btn': 'Tìm chuyến xe',
  'search.placeholder': 'Thành phố / bến xe',
  'search.popularRoutes': 'Tuyến phổ biến',

  // Hero
  'hero.title': 'Đặt vé xe khách',
  'hero.titleHighlight': 'toàn Việt Nam',
  'hero.subtitle': 'So sánh giá từ hàng chục hãng xe uy tín — Phương Trang, Thanh Bình, Limousine Việt. Chọn ghế trực quan, thanh toán an toàn, hỗ trợ 24/7.',
  'hero.trustBadge': 'Hơn {count} hành khách tin dùng',
  'hero.flashSale': 'Flash Sale kết thúc sau',

  // Booking
  'booking.passengers': 'Hành khách',
  'booking.payment': 'Thanh toán',
  'booking.complete': 'Hoàn tất',
  'booking.selectTrip': 'Chọn chuyến',

  // Common
  'common.fromPrice': 'Giá từ',
  'common.seatsAvailable': 'chỗ trống',
  'common.cancel': 'Huỷ',
  'common.confirm': 'Xác nhận',
  'common.close': 'Đóng',
  'common.back': 'Quay lại',
  'common.next': 'Tiếp theo',
  'common.success': 'Thành công',
  'common.loading': 'Đang tải...',
  'common.error': 'Có lỗi xảy ra',

  // Footer
  'footer.hotline': 'Hotline 24/7',
  'footer.newsletter': 'Nhận ưu đãi đặt vé xe',

  // Cancel dialog
  'cancel.title': 'Huỷ vé',
  'cancel.reason': 'Lý do huỷ vé',
  'cancel.reason.change': 'Thay đổi kế hoạch',
  'cancel.reason.cheaper': 'Tìm giá rẻ hơn',
  'cancel.reason.tripCancel': 'Chuyến đi bị hoãn',
  'cancel.reason.other': 'Lý do khác',
  'cancel.refundPolicy': 'Chính sách hoàn vé',
  'cancel.refundFull': 'Hoàn 90% nếu huỷ trước 24 giờ khởi hành',
  'cancel.refundHalf': 'Hoàn 50% nếu huỷ trước 4 giờ khởi hành',
  'cancel.refundNone': 'Không hoàn tiền nếu huỷ dưới 4 giờ trước khởi hành',
  'cancel.agree': 'Tôi hiểu và đồng ý với chính sách hoàn vé',
  'cancel.confirmWarning': 'Bạn có chắc chắn muốn huỷ vé? Hành động này không thể hoàn tác.',
  'cancel.refundAmount': 'Số tiền hoàn lại',
  'cancel.successTitle': 'Huỷ vé thành công',
  'cancel.successDesc': 'Vé của bạn đã được huỷ. Số tiền hoàn lại sẽ được chuyển về tài khoản trong 3-5 ngày làm việc.',
  'cancel.refCode': 'Mã tham chiếu huỷ',
}

const en: TranslationMap = {
  // Navigation
  'nav.home': 'Home',
  'nav.tickets': 'My Tickets',
  'nav.admin': 'Admin',
  'nav.support': 'Support',
  'nav.searchTrips': 'Search Trips',
  'nav.bookTicket': 'Book Ticket',

  // Search
  'search.title': 'Search trips',
  'search.from': 'From',
  'search.to': 'To',
  'search.date': 'Date',
  'search.passengers': 'Passengers',
  'search.adults': 'Adults',
  'search.children': 'Children',
  'search.btn': 'Search trips',
  'search.placeholder': 'City / bus station',
  'search.popularRoutes': 'Popular routes',

  // Hero
  'hero.title': 'Book bus tickets',
  'hero.titleHighlight': 'across Vietnam',
  'hero.subtitle': 'Compare prices from dozens of trusted bus operators — Phuong Trang, Thanh Binh, Limousine Viet. Choose seats visually, pay securely, 24/7 support.',
  'hero.trustBadge': 'Trusted by {count}+ passengers',
  'hero.flashSale': 'Flash Sale ends in',

  // Booking
  'booking.passengers': 'Passengers',
  'booking.payment': 'Payment',
  'booking.complete': 'Complete',
  'booking.selectTrip': 'Select trip',

  // Common
  'common.fromPrice': 'From price',
  'common.seatsAvailable': 'seats available',
  'common.cancel': 'Cancel',
  'common.confirm': 'Confirm',
  'common.close': 'Close',
  'common.back': 'Back',
  'common.next': 'Next',
  'common.success': 'Success',
  'common.loading': 'Loading...',
  'common.error': 'An error occurred',

  // Footer
  'footer.hotline': '24/7 Hotline',
  'footer.newsletter': 'Get bus ticket deals',

  // Cancel dialog
  'cancel.title': 'Cancel Ticket',
  'cancel.reason': 'Cancellation reason',
  'cancel.reason.change': 'Change of plans',
  'cancel.reason.cheaper': 'Found cheaper price',
  'cancel.reason.tripCancel': 'Trip cancelled',
  'cancel.reason.other': 'Other reason',
  'cancel.refundPolicy': 'Refund policy',
  'cancel.refundFull': '90% refund if cancelled >24h before departure',
  'cancel.refundHalf': '50% refund if cancelled >4h before departure',
  'cancel.refundNone': 'No refund if cancelled <4h before departure',
  'cancel.agree': 'I understand and agree to the refund policy',
  'cancel.confirmWarning': 'Are you sure you want to cancel? This action cannot be undone.',
  'cancel.refundAmount': 'Refund amount',
  'cancel.successTitle': 'Cancellation successful',
  'cancel.successDesc': 'Your ticket has been cancelled. The refund will be transferred to your account within 3-5 business days.',
  'cancel.refCode': 'Cancellation reference',
}

const dictionaries: Record<'vi' | 'en', TranslationMap> = { vi, en }

/**
 * Hook-based translation — use this in React components for reactivity.
 */
export function useT() {
  const { lang } = useApp()
  return (key: string): string => dictionaries[lang]?.[key] ?? key
}
