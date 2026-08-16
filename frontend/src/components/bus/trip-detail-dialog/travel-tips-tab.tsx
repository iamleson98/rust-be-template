'use client'

/**
 * TravelTipsTab — "Mẹo du lịch" tab inside the TripDetailDialog.
 *
 * Renders destination-specific travel tips (attractions, food,
 * etiquette, emergency contacts, payment info) from a small built-in
 * DB keyed by destination name. Falls back to a generic default.
 *
 * Extracted verbatim from the original `trip-detail-dialog.tsx`
 * (lines 1170-1507). Pure refactor.
 */

import { useMemo } from 'react'
import type { ReactNode } from 'react'
import {
  Waves,
  Building2,
  Landmark,
  Compass,
  Mountain,
  MapPinned,
  Camera,
  Utensils,
  UtensilsCrossed,
  Lightbulb,
  PhoneCall,
  Wallet,
  Banknote,
} from 'lucide-react'
import { noTones } from '@/lib/types'

type TravelTipData = {
  attractions: { name: string; desc: string; icon: ReactNode }[]
  food: { name: string; desc: string }[]
  etiquette: string[]
  emergency: { label: string; phone: string }[]
  payment: string
}

const TRAVEL_TIPS_DB: Record<string, TravelTipData> = {
  'ha noi': {
    attractions: [
      { name: 'Hồ Hoàn Kiếm', desc: 'Trái tim thủ đô với Tháp Rùa và Đền Ngọc Sơn', icon: <Waves className="h-4 w-4" /> },
      { name: 'Phố cổ Hà Nội', desc: '36 phố phường rêu phong với kiến trúc cổ trăm năm', icon: <Building2 className="h-4 w-4" /> },
      { name: 'Lăng Chủ tịch Hồ Chí Minh', desc: 'Quảng trường Ba Đình lịch sử', icon: <Landmark className="h-4 w-4" /> },
      { name: 'Văn Miếu - Quốc Tử Giám', desc: 'Trường đại học đầu tiên của Việt Nam', icon: <Landmark className="h-4 w-4" /> },
      { name: 'Hồ Tây', desc: 'Hồ tự nhiên lớn nhất Hà Nội, ngắm hoàng hôn đẹp', icon: <Waves className="h-4 w-4" /> },
    ],
    food: [
      { name: 'Phở Hà Nội', desc: 'Phở bò truyền thống với nước dùng đậm đà' },
      { name: 'Bún chả Hàng Mành', desc: 'Bún thịt nướng than hoa, nước mắm chua ngọt' },
      { name: 'Chả cá Lã Vọng', desc: 'Chả cá lăng xào nghệ, thì là đặc trưng' },
      { name: 'Cà phê trứng', desc: 'Cà phê pha cốt đqp trứng đánh bông, béo ngậy' },
    ],
    etiquette: [
      'Cởi giày dép khi vào đền, chùa, nhà người dân',
      'Tránh mặc quần áo quá ngắn hở hang khi đến khu tôn giáo',
      'Hỏi giá trước khi mua hàng rong, đồ ăn vỉa hè',
      'Giữ khoảng cách và không gây ồn tại Lăng Bác',
    ],
    emergency: [
      { label: 'Công an thành phố', phone: '069' },
      { label: 'Cấp cứu 115', phone: '115' },
      { label: 'Taxi Mai Linh', phone: '04 38 22 22 22' },
    ],
    payment: 'Tiền mặt phổ biến. MoMo, VNPay, ZaloPay chấp nhận ở mọi nơi. Có nhiều ATM ở phố cổ.',
  },
  'ho chi minh': {
    attractions: [
      { name: 'Dinh Độc Lập', desc: 'Biểu tượng lịch sử với kiến trúc độc đáo thời VNCH', icon: <Landmark className="h-4 w-4" /> },
      { name: 'Nhà thờ Đức Bà', desc: 'Công trình kiến trúc Pháp thế kỷ 19 bằng gạch đỏ', icon: <Building2 className="h-4 w-4" /> },
      { name: 'Bưu điện trung tâm', desc: 'Kiến trúc cổ do Eiffel thiết kế', icon: <Building2 className="h-4 w-4" /> },
      { name: 'Phố đi bộ Nguyễn Huệ', desc: 'Phố đi bộ đẹp nhất Sài Gòn về đêm', icon: <Compass className="h-4 w-4" /> },
      { name: 'Chợ Bến Thành', desc: 'Chợ truyền thống sầm uất bậc nhất', icon: <Building2 className="h-4 w-4" /> },
    ],
    food: [
      { name: 'Bánh mì Sài Gòn', desc: 'Bánh mì giòn với nhiều loại chả lụa, pate, rau thơm' },
      { name: 'Cơm tấm bì chả', desc: 'Cơm tấm sườn nướng, bì, chả trứng mỹ nghệ' },
      { name: 'Hủ tiếu Nam Vang', desc: 'Hủ tiếu tàu với tôm, thịt, gan, trứng cút' },
      { name: 'Chè Sài Gòn', desc: 'Nhiều loại chè mặn ngọt phong phú' },
    ],
    etiquette: [
      'Cẩn thận tư trang ở khu đông người, chợ, bến xe',
      'Không骑行 xe máy ngược chiều, mặc áo mưa khi trời mưa',
      'Phép lịch sự khi chụp ảnh trong nhà thờ, đình chùa',
      'Bargain ở chợ Bến Thành khoảng 30-50%',
    ],
    emergency: [
      { label: 'Công an thành phố', phone: '083' },
      { label: 'Cấp cứu 115', phone: '115' },
      { label: 'Taxi Vinasun', phone: '028 38 27 27 27' },
    ],
    payment: 'Thẻ tín dụng, MoMo, ZaloPay, VNPay phổ biến. Tiền mặt vẫn được ưu tiên ở chợ truyền thống.',
  },
  'da nang': {
    attractions: [
      { name: 'Bà Nà Hills', desc: 'Khu nghỉ dưỡng trên núi với Cầu Vàng nổi tiếng', icon: <Mountain className="h-4 w-4" /> },
      { name: 'Bãi biển Mỹ Khê', desc: 'Một trong 6 bãi biển quyến rũ nhất hành tinh', icon: <Waves className="h-4 w-4" /> },
      { name: 'Ngũ Hành Sơn', desc: '5 ngọn núi đá vôi với hang động và chùa cổ', icon: <Mountain className="h-4 w-4" /> },
      { name: 'Cầu Rồng', desc: 'Biểu tượng Đà Nẵng, phun lửa nước cuối tuần', icon: <Building2 className="h-4 w-4" /> },
      { name: 'Bán đảo Sơn Trà', desc: 'Rừng nguyên sinh với viewpoint ngắm toàn thành phố', icon: <Mountain className="h-4 w-4" /> },
    ],
    food: [
      { name: 'Mì Quảng', desc: 'Mì sợi vàng với tôm, thịt, trứng cút, đậu phộng' },
      { name: 'Bánh tráng cuốn thịt heo', desc: 'Thịt heo 2 đầu da với bánh tráng, rau sống' },
      { name: 'Bún chả cá Đà Nẵng', desc: 'Bún nước lèo với chả cá tươi ngon' },
      { name: 'Hải sản biển', desc: 'Cua, ghẹ, mực, tôm hùm tươi sống' },
    ],
    etiquette: [
      'Mặc đồ bơi phù hợp khi ở bãi biển, cấm tắm biển sau 18h',
      'Cấm xả rác xuống bãi biển, phạt nặng',
      'Tôn trọng văn hóa địa phương khi đến Ngũ Hành Sơn',
      'Đặt vé Bà Nà trước để tránh xếp hàng dài',
    ],
    emergency: [
      { label: 'Công an thành phố', phone: '0511' },
      { label: 'Cấp cứu 115', phone: '115' },
      { label: 'Taxi Mai Linh', phone: '0236 35 65 656' },
    ],
    payment: 'MoMo, VNPay, thẻ tín dụng chấp nhận rộng rãi. Tiền mặt phổ biến ở quán ăn địa phương.',
  },
  'da lat': {
    attractions: [
      { name: 'Hồ Xuân Hương', desc: 'Hồ nước ngọt thơ mộng giữa lòng thành phố', icon: <Waves className="h-4 w-4" /> },
      { name: 'Quảng trường Lâm Viên', desc: 'Quảng trường với hoa dã quỳ khổng lồ', icon: <Building2 className="h-4 w-4" /> },
      { name: 'Đồi chè Cầu Đất', desc: 'Đồi chè xanh mướt, ngắm bình minh tuyệt đẹp', icon: <Mountain className="h-4 w-4" /> },
      { name: 'Ga xe lửa Trai Mat', desc: 'Tuyến đường sắt cổ kính nhất Việt Nam', icon: <Compass className="h-4 w-4" /> },
      { name: 'Thác Prenn', desc: 'Thác nước tự nhiên thơ mộng', icon: <Waves className="h-4 w-4" /> },
    ],
    food: [
      { name: 'Bánh tráng nướng Đà Lạt', desc: 'Bánh tráng nướng giòn với trứng, hành lá' },
      { name: 'Lẩu gà lá é', desc: 'Lẩu gà lá é chua cay đặc sản Đà Lạt' },
      { name: 'Bánh căn', desc: 'Bánh bột gạo nướng khuôn với trứng cút' },
      { name: 'Sữa đậu nành nóng', desc: 'Sữa đậu nành nóng hạtSen, uống tối đông ấm lòng' },
    ],
    etiquette: [
      'Mang áo ấm vì Đà Lạt lạnh về đêm và sáng sớm',
      'Hỏi giá trước khi chụp ảnh tại các vườn hoa',
      'Tôn trọng cảnh quan, không bẻ cành hái hoa',
      'Thuê xe máy để khám phá nhiều địa điểm hơn',
    ],
    emergency: [
      { label: 'Công an tỉnh', phone: '0263' },
      { label: 'Cấp cứu 115', phone: '115' },
      { label: 'Taxi Đà Lạt', phone: '0263 38 22 22 22' },
    ],
    payment: 'Tiền mặt và MoMo phổ biến. Một số địa điểm du lịch lớn nhận thẻ tín dụng.',
  },
  'nha trang': {
    attractions: [
      { name: 'VinWonders Nha Trang', desc: 'Công viên giải trí lớn nhất Đông Nam Á', icon: <Compass className="h-4 w-4" /> },
      { name: 'Tháp Bà Ponagar', desc: 'Quần thể tháp Chăm cổ kính', icon: <Landmark className="h-4 w-4" /> },
      { name: 'Bãi biển Tran Phu', desc: 'Bãi biển trung tâm trải dài 6km', icon: <Waves className="h-4 w-4" /> },
      { name: 'Hòn Chồng', desc: 'Khu đá xếp tự nhiên với view biển tuyệt đẹp', icon: <Mountain className="h-4 w-4" /> },
      { name: 'Nhà thờ Núi', desc: 'Nhà thờ đá Gothic trên đồi', icon: <Building2 className="h-4 w-4" /> },
    ],
    food: [
      { name: 'Bún cá sứa Nha Trang', desc: 'Bún cá với sứa giòn, nước dùng thanh mát' },
      { name: 'Nem nướng Nha Trang', desc: 'Nem nướng xiên que với bánh tráng cuốn' },
      { name: 'Chả cá Nha Trang', desc: 'Chả cá tươi ngon hấp chả, chả chiên' },
      { name: 'Hải sản tươi sống', desc: 'Tôm hùm, ghẹ, ốc, cá mú tươi ngon' },
    ],
    etiquette: [
      'Mặc áo phao khi tắm biển, chú ý cờ báo động',
      'Bôi kem chống nắng, tia UV cao ở vùng biển',
      'Hỏi giá tour, dịch vụ trước khi đặt',
      'Tônposable không xả rác xuống biển',
    ],
    emergency: [
      { label: 'Công an tỉnh', phone: '0258' },
      { label: 'Cấp cứu 115', phone: '115' },
      { label: 'Taxi Nha Trang', phone: '0258 38 18 18 18' },
    ],
    payment: 'Thẻ tín dụng, MoMo, ZaloPay phổ biến. Tiền mặt ở quán ăn nhỏ.',
  },
  'hue': {
    attractions: [
      { name: 'Đại nội Huế', desc: 'Kinh thành triều Nguyễn với Hoàng Cung', icon: <Landmark className="h-4 w-4" /> },
      { name: 'Chùa Thiên Mụ', desc: 'Ngôi chùa cổ nhất và biểu tượng của xứ Huế', icon: <Landmark className="h-4 w-4" /> },
      { name: 'Các lăng tẩm', desc: 'Khải Định, Tự Đức, Minh Mạng kiến trúc độc đáo', icon: <Building2 className="h-4 w-4" /> },
      { name: 'Sông Hương', desc: 'Dòng sông thơ mộng, đi thuyền rồng nghe ca Huế', icon: <Waves className="h-4 w-4" /> },
      { name: 'Cầu Trường Tiền', desc: 'Cầu lịch sử 6 nhịp biểu tượng Huế', icon: <Building2 className="h-4 w-4" /> },
    ],
    food: [
      { name: 'Bún bò Huế', desc: 'Bún bò cay nồng với sả, ớt, thịt bò tươi' },
      { name: 'Cơm hến', desc: 'Cơm trộn hến với tóp mỡ, bánh tráng nướng' },
      { name: 'Bánh bèo, nậm, lọc', desc: 'Bộ 3 bánh truyền thống tinh tế xứ Huế' },
      { name: 'Nem lụi Huế', desc: 'Nem nướng xiên que với nước lèo đậu phộng' },
    ],
    etiquette: [
      'Trang phục lịch sự khi tham quan Đại nội, lăng tẩm',
      'Giữ yên tĩnh tại các đền chùa, lăng tẩm',
      'Tôn trọng văn hóa hoàng gia, không đứng lên bia đá',
      'Hỏi phép trước khi chụp ảnh người dân địa phương',
    ],
    emergency: [
      { label: 'Công an tỉnh', phone: '0234' },
      { label: 'Cấp cứu 115', phone: '115' },
      { label: 'Taxi Huế', phone: '0234 38 28 28 28' },
    ],
    payment: 'Tiền mặt phổ biến. MoMo, thẻ tín dụng chấp nhận ở khách sạn, nhà hàng lớn.',
  },
}

const DEFAULT_TIPS: TravelTipData = {
  attractions: [
    { name: 'Khu trung tâm thành phố', desc: 'Khám phá phố phường, ẩm thực và văn hóa địa phương', icon: <Building2 className="h-4 w-4" /> },
    { name: 'Chợ truyền thống', desc: 'Mua sắm đặc sản, quà lưu niệm với giá tốt', icon: <Building2 className="h-4 w-4" /> },
    { name: 'Bãi biển / Hồ nước', desc: 'Thư giãn, ngắm hoàng hôn, chụp ảnh check-in', icon: <Waves className="h-4 w-4" /> },
    { name: 'Đền, chùa cổ', desc: 'Tìm hiểu văn hóa tâm linh, kiến trúc cổ', icon: <Landmark className="h-4 w-4" /> },
    { name: 'Vantage điểm ngắm cảnh', desc: 'Xem toàn cảnh thành phố từ trên cao', icon: <Mountain className="h-4 w-4" /> },
  ],
  food: [
    { name: 'Phở / Bún địa phương', desc: 'Món nước truyền thống với hương vị đặc trưng' },
    { name: 'Hải sản tươi', desc: 'Nếu gần biển, hải sản tươi sống là lựa chọn số 1' },
    { name: 'Bánh mì / Bánh tráng', desc: 'Món ăn vỉa hè nhanh gọn, đậm chất Việt' },
    { name: 'Cà phê / Trà đặc sản', desc: 'Thưởng thức cà phê/phở kiểu địa phương' },
  ],
  etiquette: [
    'Hỏi giá trước khi mua hàng, đặt dịch vụ',
    'Mang theo tiền mặt nhỏ cho các quán ăn vỉa hè',
    'Tôn trọng văn hóa, phong tục địa phương',
    'Giữ gìn vệ sinh chung, không xả rác bừa bãi',
  ],
  emergency: [
    { label: 'Công an', phone: '113' },
    { label: 'Cấp cứu', phone: '115' },
    { label: 'Hotline VeXeVN', phone: '1900 6067' },
  ],
  payment: 'Tiền mặt và ví điện tử (MoMo, ZaloPay, VNPay) phổ biến. Thẻ tín dụng chấp nhận ở nơi lớn.',
}

export function TravelTipsTab({ destination }: { destination: string }) {
  const tips = useMemo(() => {
    const normalized = noTones(destination).toLowerCase()
    // Try direct match
    if (TRAVEL_TIPS_DB[normalized]) return TRAVEL_TIPS_DB[normalized]
    // Try partial match
    for (const key of Object.keys(TRAVEL_TIPS_DB)) {
      if (normalized.includes(key) || key.includes(normalized)) {
        return TRAVEL_TIPS_DB[key]
      }
    }
    // Try alias matches
    if (normalized.includes('sai gon') || normalized.includes('saigon')) return TRAVEL_TIPS_DB['ho chi minh']
    return DEFAULT_TIPS
  }, [destination])

  return (
    <div className="space-y-5">
      {/* Top attractions */}
      <div>
        <h3 className="text-sm font-bold flex items-center gap-2 mb-3">
          <MapPinned className="h-4 w-4 text-blue-700" />
          Top 5 điểm đến tại {destination}
        </h3>
        <div className="space-y-2">
          {tips.attractions.map((a, i) => (
            <div
              key={i}
              className="flex items-start gap-3 rounded-lg border bg-white p-3"
            >
              <div className="h-9 w-9 rounded-lg bg-blue-50 text-blue-800 inline-flex items-center justify-center shrink-0">
                {a.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] font-bold text-blue-700">#{i + 1}</span>
                  <span className="font-semibold text-sm">{a.name}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{a.desc}</p>
              </div>
              <Camera className="h-4 w-4 text-slate-300 shrink-0" />
            </div>
          ))}
        </div>
      </div>

      {/* Local food */}
      <div>
        <h3 className="text-sm font-bold flex items-center gap-2 mb-3">
          <Utensils className="h-4 w-4 text-amber-500" />
          Ẩm thực địa phương
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {tips.food.map((f, i) => (
            <div
              key={i}
              className="flex items-start gap-2.5 rounded-lg border bg-white p-3"
            >
              <div className="h-8 w-8 rounded-lg bg-amber-50 text-amber-700 inline-flex items-center justify-center shrink-0">
                <UtensilsCrossed className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="font-semibold text-sm">{f.name}</div>
                <div className="text-xs text-muted-foreground">{f.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Cultural etiquette */}
      <div>
        <h3 className="text-sm font-bold flex items-center gap-2 mb-3">
          <Lightbulb className="h-4 w-4 text-violet-500" />
          Văn hóa & lưu ý
        </h3>
        <div className="rounded-xl border bg-violet-50/30 p-4 space-y-2">
          {tips.etiquette.map((e, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              <div className="h-5 w-5 rounded-full bg-violet-100 text-violet-700 inline-flex items-center justify-center shrink-0 text-[10px] font-bold mt-0.5">
                {i + 1}
              </div>
              <span className="leading-relaxed">{e}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Emergency contacts */}
      <div>
        <h3 className="text-sm font-bold flex items-center gap-2 mb-3">
          <PhoneCall className="h-4 w-4 text-rose-500" />
          Số điện thoại khẩn cấp
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {tips.emergency.map((e, i) => (
            <a
              key={i}
              href={`tel:${e.phone}`}
              className="flex items-center gap-2.5 rounded-lg border bg-white p-3 hover:border-rose-300 hover:bg-rose-50/50 transition-colors"
            >
              <div className="h-8 w-8 rounded-full bg-rose-100 text-rose-700 inline-flex items-center justify-center shrink-0">
                <PhoneCall className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">{e.label}</div>
                <div className="font-bold text-sm font-mono">{e.phone}</div>
              </div>
            </a>
          ))}
        </div>
      </div>

      {/* Payment info */}
      <div className="rounded-xl bg-linear-to-r from-blue-50 to-blue-50 ring-1 ring-blue-200/50 p-4 flex items-start gap-3">
        <div className="h-10 w-10 rounded-full bg-blue-700 text-white inline-flex items-center justify-center shrink-0">
          <Wallet className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <Banknote className="h-4 w-4 text-blue-800" />
            <span className="font-bold text-sm">Thanh toán & tiền tệ</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{tips.payment}</p>
          <div className="mt-2 flex items-center gap-1.5 text-[10px] text-blue-800">
            <Banknote className="h-3 w-3" />
            <span>Đơn vị: VNĐ (Việt Nam Đồng)</span>
          </div>
        </div>
      </div>
    </div>
  )
}
