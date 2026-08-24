'use client'

import { memo } from 'react'
import { Check, Smartphone, Play, Bell, Ticket, Star, Zap, Gift } from 'lucide-react'

const FEATURES = [
  { icon: Bell, label: 'Thông báo giá rẻ tức thì' },
  { icon: Ticket, label: 'Quản lý vé offline' },
  { icon: Star, label: 'Tích điểm đổi vé miễn phí' },
  { icon: Smartphone, label: 'Hỗ trợ 24/7 qua chat' },
]

function AppDownloadImpl() {
  return (
    <section
      className="relative overflow-hidden bg-linear-to-br from-slate-900 via-slate-800 to-rose-900"
      aria-labelledby="app-download-heading"
    >
      {/* Decorative blurred blobs */}
      <div
        className="pointer-events-none absolute -left-24 -top-24 size-72 rounded-full bg-rose-500/20 blur-3xl"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -right-20 bottom-0 size-80 rounded-full bg-amber-500/20 blur-3xl"
        aria-hidden="true"
      />

      <div className="container relative mx-auto max-w-6xl py-16 px-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
          {/* Left column — copy + CTAs */}
          <div className="text-center md:text-left">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white ring-1 ring-white/15 backdrop-blur">
              📱 Tải app VeXeVN
            </span>

            <h2
              id="app-download-heading"
              className="mt-4 text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight text-white"
            >
              Đặt vé xe mọi lúc, mọi nơi
            </h2>

            <p className="mt-4 text-sm md:text-base text-white/70 max-w-lg mx-auto md:mx-0">
              Tải app VeXeVN để nhận thông báo giá rẻ, quản lý vé dễ dàng, tích điểm đổi quà.
              Hơn <span className="font-semibold text-white">125.000 người</span> đã tải.
            </p>

            {/* Feature list */}
            <ul className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg mx-auto md:mx-0 text-left">
              {FEATURES.map((f) => (
                <li
                  key={f.label}
                  className="flex items-center gap-2.5 rounded-lg bg-white/5 px-3 py-2 ring-1 ring-white/10"
                >
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-rose-500/30 text-rose-200">
                    <Check className="size-3.5" />
                  </span>
                  <span className="text-sm text-white/90">{f.label}</span>
                </li>
              ))}
            </ul>

            {/* CTA buttons */}
            <div className="mt-7 flex flex-col sm:flex-row gap-3 justify-center md:justify-start">
              <button
                type="button"
                className="group inline-flex items-center justify-center gap-3 rounded-full bg-white px-5 py-3 text-slate-900 transition-transform hover:scale-[1.03] active:scale-100"
              >
                <Smartphone className="size-5 text-slate-900" />
                <span className="text-left leading-tight">
                  <span className="block text-[10px] uppercase tracking-wide text-slate-500">
                    Tải trên
                  </span>
                  <span className="block text-sm font-semibold">App Store</span>
                </span>
              </button>

              <button
                type="button"
                className="group inline-flex items-center justify-center gap-3 rounded-full bg-white px-5 py-3 text-slate-900 transition-transform hover:scale-[1.03] active:scale-100"
              >
                <Play className="size-5 fill-slate-900 text-slate-900" />
                <span className="text-left leading-tight">
                  <span className="block text-[10px] uppercase tracking-wide text-slate-500">
                    Tải trên
                  </span>
                  <span className="block text-sm font-semibold">Google Play</span>
                </span>
              </button>
            </div>
          </div>

          {/* Right column — phone mockup */}
          <div className="relative flex justify-center md:justify-end">
            <div className="relative">
              {/* Phone frame */}
              <div className="relative w-60 sm:w-65 aspect-9/19 rounded-4xl ring-8 ring-white/20 bg-linear-to-br from-rose-500 to-amber-500 overflow-hidden">
                {/* Notch */}
                <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 h-5 w-20 rounded-full bg-black/40" />

                {/* Phone screen content — mini ticket UI */}
                <div className="absolute inset-0 flex flex-col gap-3 p-4 pt-8">
                  {/* App header */}
                  <div className="flex items-center justify-between text-white">
                    <div>
                      <div className="text-[10px] opacity-80">Xin chào,</div>
                      <div className="text-sm font-bold">Vé của bạn</div>
                    </div>
                    <div className="size-8 rounded-full bg-white/20 backdrop-blur" />
                  </div>

                  {/* Ticket card */}
                  <div className="rounded-2xl bg-white p-3">
                    <div className="flex items-center justify-between text-[9px] text-slate-400">
                      <span>Vé điện tử</span>
                      <span className="inline-flex items-center gap-1 text-rose-600 font-semibold">
                        <span className="size-1.5 rounded-full bg-emerald-500" />
                        Đã xác nhận
                      </span>
                    </div>

                    <div className="mt-2 flex items-center justify-between">
                      <div>
                        <div className="text-base font-bold text-slate-900">Hà Nội</div>
                        <div className="text-[9px] text-slate-500">Bến Mỹ Đình</div>
                      </div>
                      <div className="flex-1 mx-2 relative">
                        <div className="h-px border-t border-dashed border-slate-300" />
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 size-5 rounded-full bg-rose-100 flex items-center justify-center">
                          <span className="text-[8px]">🚌</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-base font-bold text-slate-900">Đà Nẵng</div>
                        <div className="text-[9px] text-slate-500">Bến Trung Tâm</div>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2 text-[9px]">
                      <div>
                        <div className="text-slate-400">Giờ đi</div>
                        <div className="font-semibold text-slate-900">20:00</div>
                      </div>
                      <div>
                        <div className="text-slate-400">Ghế</div>
                        <div className="font-semibold text-slate-900">A07</div>
                      </div>
                      <div>
                        <div className="text-slate-400">Ngày</div>
                        <div className="font-semibold text-slate-900">28/06</div>
                      </div>
                    </div>

                    <div className="mt-3 flex items-end justify-between border-t border-dashed border-slate-200 pt-2">
                      <div>
                        <div className="text-[9px] text-slate-400">Tổng tiền</div>
                        <div className="text-sm font-bold text-rose-600">320.000đ</div>
                      </div>
                      <div className="grid grid-cols-3 gap-0.5">
                        {Array.from({ length: 9 }).map((_, i) => (
                          <div
                            key={i}
                            className="size-1 rounded-sm bg-slate-900"
                          />
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Secondary mini card */}
                  <div className="rounded-xl bg-white/15 backdrop-blur p-2.5 ring-1 ring-white/20">
                    <div className="flex items-center justify-between text-white">
                      <div className="text-[10px] opacity-90">⚡ Flash Sale 12.000 vé</div>
                      <div className="text-[10px] font-bold">-50K</div>
                    </div>
                    <div className="mt-1.5 h-1.5 rounded-full bg-white/20 overflow-hidden">
                      <div className="h-full w-3/5 rounded-full bg-white" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Floating badges */}
              <div className="absolute -top-3 -left-6 z-20 animate-[float-slow_3s_ease-in-out_infinite] rounded-xl bg-amber-400 px-3 py-1.5 ring-1 ring-black/5">
                <div className="flex items-center gap-1.5">
                  <Zap className="size-3.5 text-amber-900" />
                  <span className="text-xs font-bold text-amber-900">⚡ Flash Sale</span>
                </div>
              </div>

              <div className="absolute top-1/2 -right-6 z-20 animate-[float-slow_3.4s_ease-in-out_infinite_0.3s] rounded-xl bg-white px-3 py-1.5 ring-1 ring-black/5">
                <div className="flex items-center gap-1.5">
                  <Gift className="size-3.5 text-rose-600" />
                  <span className="text-xs font-bold text-slate-900">🎁 -50K</span>
                </div>
              </div>

              <div className="absolute -bottom-3 left-2 z-20 animate-[float-slow_3.2s_ease-in-out_infinite_0.6s] rounded-xl bg-white px-3 py-1.5 ring-1 ring-black/5">
                <div className="flex items-center gap-1.5">
                  <Star className="size-3.5 fill-amber-400 text-amber-400" />
                  <span className="text-xs font-bold text-slate-900">⭐ 4.8/5</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export const AppDownload = memo(AppDownloadImpl)
