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
import { useT } from '@/lib/i18n'

type TravelTipData = {
  attractions: { name: string; desc: string; icon: ReactNode }[]
  food: { name: string; desc: string }[]
  etiquette: string[]
  emergency: { label: string; phone: string }[]
  payment: string
}

/* The built-in tips DB — attraction/food names are proper nouns (kept
 * as data); descriptions, etiquette, emergency labels and payment
 * notes are translated via `t`. */
function travelTipsDb(t: ReturnType<typeof useT>): Record<string, TravelTipData> {
  return {
    'ha noi': {
      attractions: [
        { name: 'Hồ Hoàn Kiếm', desc: t('tripDetail.tips.haNoi.hoHoanKiem'), icon: <Waves className="h-4 w-4" /> },
        { name: 'Phố cổ Hà Nội', desc: t('tripDetail.tips.haNoi.phoCo'), icon: <Building2 className="h-4 w-4" /> },
        { name: 'Lăng Chủ tịch Hồ Chí Minh', desc: t('tripDetail.tips.haNoi.langBac'), icon: <Landmark className="h-4 w-4" /> },
        { name: 'Văn Miếu - Quốc Tử Giám', desc: t('tripDetail.tips.haNoi.vanMieu'), icon: <Landmark className="h-4 w-4" /> },
        { name: 'Hồ Tây', desc: t('tripDetail.tips.haNoi.hoTay'), icon: <Waves className="h-4 w-4" /> },
      ],
      food: [
        { name: 'Phở Hà Nội', desc: t('tripDetail.tips.haNoi.phoHaNoi') },
        { name: 'Bún chả Hàng Mành', desc: t('tripDetail.tips.haNoi.bunCha') },
        { name: 'Chả cá Lã Vọng', desc: t('tripDetail.tips.haNoi.chaCa') },
        { name: 'Cà phê trứng', desc: t('tripDetail.tips.haNoi.caPheTrung') },
      ],
      etiquette: [
        t('tripDetail.tips.haNoi.shoesOff'),
        t('tripDetail.tips.haNoi.modestDress'),
        t('tripDetail.tips.haNoi.askStreetPrice'),
        t('tripDetail.tips.haNoi.quietAtMausoleum'),
      ],
      emergency: [
        { label: t('tripDetail.tips.policeCity'), phone: '069' },
        { label: t('tripDetail.tips.emergency115'), phone: '115' },
        { label: t('tripDetail.tips.taxiMaiLinh'), phone: '04 38 22 22 22' },
      ],
      payment: t('tripDetail.tips.haNoi.payment'),
    },
    'ho chi minh': {
      attractions: [
        { name: 'Dinh Độc Lập', desc: t('tripDetail.tips.hcm.dinhDocLap'), icon: <Landmark className="h-4 w-4" /> },
        { name: 'Nhà thờ Đức Bà', desc: t('tripDetail.tips.hcm.ducBa'), icon: <Building2 className="h-4 w-4" /> },
        { name: 'Bưu điện trung tâm', desc: t('tripDetail.tips.hcm.buuDien'), icon: <Building2 className="h-4 w-4" /> },
        { name: 'Phố đi bộ Nguyễn Huệ', desc: t('tripDetail.tips.hcm.nguyenHue'), icon: <Compass className="h-4 w-4" /> },
        { name: 'Chợ Bến Thành', desc: t('tripDetail.tips.hcm.benThanh'), icon: <Building2 className="h-4 w-4" /> },
      ],
      food: [
        { name: 'Bánh mì Sài Gòn', desc: t('tripDetail.tips.hcm.banhMi') },
        { name: 'Cơm tấm bì chả', desc: t('tripDetail.tips.hcm.comTam') },
        { name: 'Hủ tiếu Nam Vang', desc: t('tripDetail.tips.hcm.huTieu') },
        { name: 'Chè Sài Gòn', desc: t('tripDetail.tips.hcm.che') },
      ],
      etiquette: [
        t('tripDetail.tips.hcm.watchBelongings'),
        t('tripDetail.tips.hcm.trafficSafety'),
        t('tripDetail.tips.hcm.photoEtiquette'),
        t('tripDetail.tips.hcm.bargain'),
      ],
      emergency: [
        { label: t('tripDetail.tips.policeCity'), phone: '083' },
        { label: t('tripDetail.tips.emergency115'), phone: '115' },
        { label: t('tripDetail.tips.taxiVinasun'), phone: '028 38 27 27 27' },
      ],
      payment: t('tripDetail.tips.hcm.payment'),
    },
    'da nang': {
      attractions: [
        { name: 'Bà Nà Hills', desc: t('tripDetail.tips.daNang.baNa'), icon: <Mountain className="h-4 w-4" /> },
        { name: 'Bãi biển Mỹ Khê', desc: t('tripDetail.tips.daNang.myKhe'), icon: <Waves className="h-4 w-4" /> },
        { name: 'Ngũ Hành Sơn', desc: t('tripDetail.tips.daNang.nguHanhSon'), icon: <Mountain className="h-4 w-4" /> },
        { name: 'Cầu Rồng', desc: t('tripDetail.tips.daNang.cauRong'), icon: <Building2 className="h-4 w-4" /> },
        { name: 'Bán đảo Sơn Trà', desc: t('tripDetail.tips.daNang.sonTra'), icon: <Mountain className="h-4 w-4" /> },
      ],
      food: [
        { name: 'Mì Quảng', desc: t('tripDetail.tips.daNang.miQuang') },
        { name: 'Bánh tráng cuốn thịt heo', desc: t('tripDetail.tips.daNang.banhTrangThitHeo') },
        { name: 'Bún chả cá Đà Nẵng', desc: t('tripDetail.tips.daNang.bunChaCa') },
        { name: 'Hải sản biển', desc: t('tripDetail.tips.daNang.haiSan') },
      ],
      etiquette: [
        t('tripDetail.tips.daNang.swimwear'),
        t('tripDetail.tips.daNang.noLitter'),
        t('tripDetail.tips.daNang.respectCulture'),
        t('tripDetail.tips.daNang.bookBaNa'),
      ],
      emergency: [
        { label: t('tripDetail.tips.policeCity'), phone: '0511' },
        { label: t('tripDetail.tips.emergency115'), phone: '115' },
        { label: t('tripDetail.tips.taxiMaiLinh'), phone: '0236 35 65 656' },
      ],
      payment: t('tripDetail.tips.daNang.payment'),
    },
    'da lat': {
      attractions: [
        { name: 'Hồ Xuân Hương', desc: t('tripDetail.tips.daLat.hoXuanHuong'), icon: <Waves className="h-4 w-4" /> },
        { name: 'Quảng trường Lâm Viên', desc: t('tripDetail.tips.daLat.lamVien'), icon: <Building2 className="h-4 w-4" /> },
        { name: 'Đồi chè Cầu Đất', desc: t('tripDetail.tips.daLat.doiChe'), icon: <Mountain className="h-4 w-4" /> },
        { name: 'Ga xe lửa Trai Mat', desc: t('tripDetail.tips.daLat.gaTraiMat'), icon: <Compass className="h-4 w-4" /> },
        { name: 'Thác Prenn', desc: t('tripDetail.tips.daLat.thacPrenn'), icon: <Waves className="h-4 w-4" /> },
      ],
      food: [
        { name: 'Bánh tráng nướng Đà Lạt', desc: t('tripDetail.tips.daLat.banhTrangNuong') },
        { name: 'Lẩu gà lá é', desc: t('tripDetail.tips.daLat.lauGaLaE') },
        { name: 'Bánh căn', desc: t('tripDetail.tips.daLat.banhCan') },
        { name: 'Sữa đậu nành nóng', desc: t('tripDetail.tips.daLat.suaDauNanh') },
      ],
      etiquette: [
        t('tripDetail.tips.daLat.bringWarmClothes'),
        t('tripDetail.tips.daLat.askPhotoPrice'),
        t('tripDetail.tips.daLat.respectLandscape'),
        t('tripDetail.tips.daLat.rentMotorbike'),
      ],
      emergency: [
        { label: t('tripDetail.tips.policeProvince'), phone: '0263' },
        { label: t('tripDetail.tips.emergency115'), phone: '115' },
        { label: t('tripDetail.tips.taxiDaLat'), phone: '0263 38 22 22 22' },
      ],
      payment: t('tripDetail.tips.daLat.payment'),
    },
    'nha trang': {
      attractions: [
        { name: 'VinWonders Nha Trang', desc: t('tripDetail.tips.nhaTrang.vinWonders'), icon: <Compass className="h-4 w-4" /> },
        { name: 'Tháp Bà Ponagar', desc: t('tripDetail.tips.nhaTrang.thapBa'), icon: <Landmark className="h-4 w-4" /> },
        { name: 'Bãi biển Tran Phu', desc: t('tripDetail.tips.nhaTrang.baiBien'), icon: <Waves className="h-4 w-4" /> },
        { name: 'Hòn Chồng', desc: t('tripDetail.tips.nhaTrang.honChong'), icon: <Mountain className="h-4 w-4" /> },
        { name: 'Nhà thờ Núi', desc: t('tripDetail.tips.nhaTrang.nhaThoNui'), icon: <Building2 className="h-4 w-4" /> },
      ],
      food: [
        { name: 'Bún cá sứa Nha Trang', desc: t('tripDetail.tips.nhaTrang.bunCaSua') },
        { name: 'Nem nướng Nha Trang', desc: t('tripDetail.tips.nhaTrang.nemNuong') },
        { name: 'Chả cá Nha Trang', desc: t('tripDetail.tips.nhaTrang.chaCa') },
        { name: 'Hải sản tươi sống', desc: t('tripDetail.tips.nhaTrang.haiSan') },
      ],
      etiquette: [
        t('tripDetail.tips.nhaTrang.lifeVest'),
        t('tripDetail.tips.nhaTrang.uv'),
        t('tripDetail.tips.nhaTrang.askTourPrice'),
        t('tripDetail.tips.nhaTrang.noOceanLitter'),
      ],
      emergency: [
        { label: t('tripDetail.tips.policeProvince'), phone: '0258' },
        { label: t('tripDetail.tips.emergency115'), phone: '115' },
        { label: t('tripDetail.tips.taxiNhaTrang'), phone: '0258 38 18 18 18' },
      ],
      payment: t('tripDetail.tips.nhaTrang.payment'),
    },
    'hue': {
      attractions: [
        { name: 'Đại nội Huế', desc: t('tripDetail.tips.hue.daiNoi'), icon: <Landmark className="h-4 w-4" /> },
        { name: 'Chùa Thiên Mụ', desc: t('tripDetail.tips.hue.chuaThienMu'), icon: <Landmark className="h-4 w-4" /> },
        { name: 'Các lăng tẩm', desc: t('tripDetail.tips.hue.langTam'), icon: <Building2 className="h-4 w-4" /> },
        { name: 'Sông Hương', desc: t('tripDetail.tips.hue.songHuong'), icon: <Waves className="h-4 w-4" /> },
        { name: 'Cầu Trường Tiền', desc: t('tripDetail.tips.hue.cauTruongTien'), icon: <Building2 className="h-4 w-4" /> },
      ],
      food: [
        { name: 'Bún bò Huế', desc: t('tripDetail.tips.hue.bunBo') },
        { name: 'Cơm hến', desc: t('tripDetail.tips.hue.comHen') },
        { name: 'Bánh bèo, nậm, lọc', desc: t('tripDetail.tips.hue.banhBeo') },
        { name: 'Nem lụi Huế', desc: t('tripDetail.tips.hue.nemLui') },
      ],
      etiquette: [
        t('tripDetail.tips.hue.modestDress'),
        t('tripDetail.tips.hue.keepQuiet'),
        t('tripDetail.tips.hue.respectRoyal'),
        t('tripDetail.tips.hue.askBeforePhoto'),
      ],
      emergency: [
        { label: t('tripDetail.tips.policeProvince'), phone: '0234' },
        { label: t('tripDetail.tips.emergency115'), phone: '115' },
        { label: t('tripDetail.tips.taxiHue'), phone: '0234 38 28 28 28' },
      ],
      payment: t('tripDetail.tips.hue.payment'),
    },
  }
}

/* Generic fallback tips (used for unknown destinations). */
function defaultTips(t: ReturnType<typeof useT>): TravelTipData {
  return {
    attractions: [
      { name: t('tripDetail.tips.def.cityCenter'), desc: t('tripDetail.tips.def.cityCenterDesc'), icon: <Building2 className="h-4 w-4" /> },
      { name: t('tripDetail.tips.def.traditionalMarket'), desc: t('tripDetail.tips.def.traditionalMarketDesc'), icon: <Building2 className="h-4 w-4" /> },
      { name: t('tripDetail.tips.def.beachOrLake'), desc: t('tripDetail.tips.def.beachOrLakeDesc'), icon: <Waves className="h-4 w-4" /> },
      { name: t('tripDetail.tips.def.temple'), desc: t('tripDetail.tips.def.templeDesc'), icon: <Landmark className="h-4 w-4" /> },
      { name: t('tripDetail.tips.def.viewpoint'), desc: t('tripDetail.tips.def.viewpointDesc'), icon: <Mountain className="h-4 w-4" /> },
    ],
    food: [
      { name: t('tripDetail.tips.def.localNoodles'), desc: t('tripDetail.tips.def.localNoodlesDesc') },
      { name: t('tripDetail.tips.def.freshSeafood'), desc: t('tripDetail.tips.def.freshSeafoodDesc') },
      { name: t('tripDetail.tips.def.streetFood'), desc: t('tripDetail.tips.def.streetFoodDesc') },
      { name: t('tripDetail.tips.def.localCoffee'), desc: t('tripDetail.tips.def.localCoffeeDesc') },
    ],
    etiquette: [
      t('tripDetail.tips.def.askPriceFirst'),
      t('tripDetail.tips.def.smallCash'),
      t('tripDetail.tips.def.respectCulture'),
      t('tripDetail.tips.def.keepClean'),
    ],
    emergency: [
      { label: t('tripDetail.tips.police'), phone: '113' },
      { label: t('tripDetail.tips.emergency'), phone: '115' },
      { label: t('tripDetail.tips.hotlineDatXeVui'), phone: '1900 6067' },
    ],
    payment: t('tripDetail.tips.def.payment'),
  }
}

export function TravelTipsTab({ destination }: { destination: string }) {
  const t = useT()
  const tips = useMemo(() => {
    const db = travelTipsDb(t)
    const normalized = noTones(destination).toLowerCase()
    // Try direct match
    if (db[normalized]) return db[normalized]
    // Try partial match
    for (const key of Object.keys(db)) {
      if (normalized.includes(key) || key.includes(normalized)) {
        return db[key]
      }
    }
    // Try alias matches
    if (normalized.includes('sai gon') || normalized.includes('saigon')) return db['ho chi minh']
    return defaultTips(t)
  }, [destination, t])

  return (
    <div className="space-y-5">
      {/* Top attractions */}
      <div>
        <h3 className="text-sm font-bold flex items-center gap-2 mb-3">
          <MapPinned className="h-4 w-4 text-blue-700" />
          {t('tripDetail.tips.topAttractions', { destination })}
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
          {t('tripDetail.tips.localFood')}
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
          {t('tripDetail.tips.etiquetteTitle')}
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
          {t('tripDetail.tips.emergencyTitle')}
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
            <span className="font-bold text-sm">{t('tripDetail.tips.paymentTitle')}</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{tips.payment}</p>
          <div className="mt-2 flex items-center gap-1.5 text-[10px] text-blue-800">
            <Banknote className="h-3 w-3" />
            <span>{t('tripDetail.tips.currencyUnit')}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
