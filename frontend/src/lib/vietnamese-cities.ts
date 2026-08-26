/**
 * Vietnamese cities — the 5 centrally-governed municipalities + 58 provinces.
 *
 * Used by the route creation form as the start/end location options.
 * Brands define pickup/drop at the city level; specific pickup points
 * (bus stations, curbside) are defined at the schedule level.
 *
 * The `id` is a URL-safe slug used as the `startLocationId`/`endLocationId`
 * when creating a route. It's NOT a UUID — the backend stores it as a
 * TEXT field reference that the frontend can resolve back to a name.
 *
 * After the 2025 administrative reorganization, Vietnam has:
 * - 5 centrally-governed municipalities (thành phố trực thuộc trung ương)
 * - 58 provinces (tỉnh)
 * Total: 63 first-level administrative divisions.
 *
 * NOTE: The 2025 reorganization merged several provinces. This list
 * reflects the post-merger structure. If further reorganizations occur,
 * update this constant.
 */

export type VietnameseCity = {
  id: string
  name: string
  region: 'north' | 'central' | 'south'
}

export const VIETNAMESE_CITIES: VietnameseCity[] = [
  // ── Centrally-governed municipalities ──────────────────────────
  { id: 'ha-noi', name: 'Hà Nội', region: 'north' },
  { id: 'ho-chi-minh', name: 'TP. Hồ Chí Minh', region: 'south' },
  { id: 'hai-phong', name: 'Hải Phòng', region: 'north' },
  { id: 'da-nang', name: 'Đà Nẵng', region: 'central' },
  { id: 'can-tho', name: 'Cần Thơ', region: 'south' },

  // ── Northern provinces ──────────────────────────────────────────
  { id: 'ha-giang', name: 'Hà Giang', region: 'north' },
  { id: 'cao-bang', name: 'Cao Bằng', region: 'north' },
  { id: 'bac-kan', name: 'Bắc Kạn', region: 'north' },
  { id: 'tuyen-quang', name: 'Tuyên Quang', region: 'north' },
  { id: 'lao-cai', name: 'Lào Cai', region: 'north' },
  { id: 'dien-bien', name: 'Điện Biên', region: 'north' },
  { id: 'lai-chau', name: 'Lai Châu', region: 'north' },
  { id: 'son-la', name: 'Sơn La', region: 'north' },
  { id: 'yen-bai', name: 'Yên Bái', region: 'north' },
  { id: 'hoa-binh', name: 'Hoà Bình', region: 'north' },
  { id: 'thai-nguyen', name: 'Thái Nguyên', region: 'north' },
  { id: 'lang-son', name: 'Lạng Sơn', region: 'north' },
  { id: 'quang-ninh', name: 'Quảng Ninh', region: 'north' },
  { id: 'bac-giang', name: 'Bắc Giang', region: 'north' },
  { id: 'vinh-phuc', name: 'Vĩnh Phúc', region: 'north' },
  { id: 'bac-ninh', name: 'Bắc Ninh', region: 'north' },
  { id: 'phu-tho', name: 'Phú Thọ', region: 'north' },
  { id: 'ha-nam', name: 'Hà Nam', region: 'north' },
  { id: 'thai-binh', name: 'Thái Bình', region: 'north' },
  { id: 'nam-dinh', name: 'Nam Định', region: 'north' },
  { id: 'ninh-binh', name: 'Ninh Bình', region: 'north' },
  { id: 'ninh-thuan', name: 'Ninh Thuận', region: 'central' },

  // ── Central provinces ────────────────────────────────────────────
  { id: 'thanh-hoa', name: 'Thanh Hóa', region: 'central' },
  { id: 'nghe-an', name: 'Nghệ An', region: 'central' },
  { id: 'ha-tinh', name: 'Hà Tĩnh', region: 'central' },
  { id: 'quang-binh', name: 'Quảng Bình', region: 'central' },
  { id: 'quang-tri', name: 'Quảng Trị', region: 'central' },
  { id: 'hue', name: 'Thừa Thiên Huế', region: 'central' },
  { id: 'quang-nam', name: 'Quảng Nam', region: 'central' },
  { id: 'quang-ngai', name: 'Quảng Ngãi', region: 'central' },
  { id: 'binh-dinh', name: 'Bình Định', region: 'central' },
  { id: 'phu-yen', name: 'Phú Yên', region: 'central' },
  { id: 'khanh-hoa', name: 'Khánh Hòa', region: 'central' },
  { id: 'binh-thuan', name: 'Bình Thuận', region: 'central' },
  { id: 'kon-tum', name: 'Kon Tum', region: 'central' },
  { id: 'gia-lai', name: 'Gia Lai', region: 'central' },
  { id: 'dak-lak', name: 'Đắk Lắk', region: 'central' },
  { id: 'dak-nong', name: 'Đắk Nông', region: 'central' },
  { id: 'lam-dong', name: 'Lâm Đồng', region: 'central' },

  // ── Southern provinces ──────────────────────────────────────────
  { id: 'ba-ria-vung-tau', name: 'Bà Rịa - Vũng Tàu', region: 'south' },
  { id: 'binh-duong', name: 'Bình Dương', region: 'south' },
  { id: 'binh-phuoc', name: 'Bình Phước', region: 'south' },
  { id: 'dong-nai', name: 'Đồng Nai', region: 'south' },
  { id: 'tay-ninh', name: 'Tây Ninh', region: 'south' },
  { id: 'long-an', name: 'Long An', region: 'south' },
  { id: 'tien-giang', name: 'Tiền Giang', region: 'south' },
  { id: 'ben-tre', name: 'Bến Tre', region: 'south' },
  { id: 'tra-vinh', name: 'Trà Vinh', region: 'south' },
  { id: 'vinh-long', name: 'Vĩnh Long', region: 'south' },
  { id: 'dong-thap', name: 'Đồng Tháp', region: 'south' },
  { id: 'an-giang', name: 'An Giang', region: 'south' },
  { id: 'kien-giang', name: 'Kiên Giang', region: 'south' },
  { id: 'hau-giang', name: 'Hậu Giang', region: 'south' },
  { id: 'soc-trang', name: 'Sóc Trăng', region: 'south' },
  { id: 'bac-lieu', name: 'Bạc Liêu', region: 'south' },
  { id: 'ca-mau', name: 'Cà Mau', region: 'south' },
]

/**
 * Lookup a city by its id (slug).
 * Returns `undefined` if not found.
 */
export function getCityById(id: string): VietnameseCity | undefined {
  return VIETNAMESE_CITIES.find((c) => c.id === id)
}

/**
 * Get the display name for a city id.
 * Returns the id itself if not found (so the UI shows something
 * rather than blank).
 */
export function getCityName(id: string): string {
  return getCityById(id)?.name ?? id
}
