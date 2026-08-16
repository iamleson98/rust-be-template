'use client'

import { memo, type ReactNode } from 'react'
import { ShieldCheck, Headset, Wallet, Clock, Bus, BadgePercent } from 'lucide-react'

const features = [
  {
    icon: <Wallet className="h-6 w-6" />,
    title: 'Giá tốt nhất',
    desc: 'So sánh giá từ hàng chục hãng xe. Cam kết hoàn tiền nếu tìm giá rẻ hơn.',
    color: '#2563eb',
  },
  {
    icon: <ShieldCheck className="h-6 w-6" />,
    title: 'Thanh toán an toàn',
    desc: 'Mã hoá SSL 256-bit, đối tác MoMo, VNPay, ngân hàng hàng đầu Việt Nam.',
    color: '#7c3aed',
  },
  {
    icon: <Bus className="h-6 w-6" />,
    title: 'Chọn ghế trực quan',
    desc: 'Sơ đồ ghế chi tiết theo loại xe: limousine, giường nằm, ghế ngồi.',
    color: '#e11d48',
  },
  {
    icon: <Headset className="h-6 w-6" />,
    title: 'Hỗ trợ 24/7',
    desc: 'Chat trực tuyến với nhân viên hãng xe, phản hồi trong vòng 2 phút.',
    color: '#1d4ed8',
  },
  {
    icon: <Clock className="h-6 w-6" />,
    title: 'Đổi vé dễ dàng',
    desc: 'Đổi giờ, đổi tuyến online trong vài cú chạm. Hoàn vé linh hoạt.',
    color: '#d97706',
  },
  {
    icon: <BadgePercent className="h-6 w-6" />,
    title: 'Ưu đãi mỗi ngày',
    desc: 'Hàng trăm mã giảm giá, ưu đãi cuối tuần, mùa lễ Tết.',
    color: '#16a34a',
  },
]

const steps = [
  { step: '01', title: 'Tìm chuyến', desc: 'Nhập điểm đi, điểm đến và ngày', icon: '🔍' },
  { step: '02', title: 'Chọn ghế', desc: 'Sơ đồ ghế trực quan theo loại xe', icon: '💺' },
  { step: '03', title: 'Thanh toán', desc: 'MoMo, VNPay, chuyển khoản', icon: '💳' },
  { step: '04', title: 'Nhận vé', desc: 'Vé điện tử qua SMS & email', icon: '📱' },
]

function FeaturesImpl() {
  return (
    <section className="bg-slate-50">
      <div className="container mx-auto px-4 py-16">
      <div className="text-center max-w-2xl mx-auto mb-10">
        <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 mb-3">
          Tại sao chọn VeXeVN?
        </div>
        <h2 className="text-balance text-3xl md:text-4xl font-extrabold tracking-tight">
          Đặt vé xe dễ dàng, an toàn, tiết kiệm
        </h2>
        <p className="text-muted-foreground mt-3">
          Nền tảng đặt vé xe khách hàng đầu Việt Nam với hơn 125.000 hành khách tin dùng
        </p>
      </div>

      {/* Feature cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {features.map((f, i) => (
          <FeatureCard key={i} feature={f} index={i} />
        ))}
      </div>

      {/* Process strip — "How it works" with numbered gradient circles */}
      <div className="mt-14 rounded-2xl bg-linear-to-r from-blue-900 to-blue-900 p-8 md:p-10 text-white overflow-hidden relative">
        {/* Decorative circles */}
        <div className="absolute -right-20 -top-20 h-60 w-60 rounded-full bg-blue-500/10 blur-2xl" />
        <div className="absolute -left-10 -bottom-10 h-40 w-40 rounded-full bg-blue-500/10 blur-2xl" />

        {/* Section label */}
        <div className="text-center mb-8 relative">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-blue-200 backdrop-blur-sm">
            🚀 Cách thức đặt vé
          </div>
          <h3 className="text-2xl md:text-3xl font-extrabold mt-2">Chỉ 4 bước đơn giản</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 relative">
          {steps.map((s, i) => (
            <div key={s.step} className="relative text-center md:text-left">
              {/* Numbered circle with gradient background */}
              <div className="relative mx-auto md:mx-0 h-14 w-14 rounded-full bg-linear-to-br from-blue-400 to-blue-500 flex items-center justify-center mb-3">
                <span className="text-lg font-extrabold text-white">{s.step}</span>
                {/* Glow ring */}
                <div className="absolute inset-0 rounded-full ring-2 ring-blue-400/30" />
              </div>
              <div className="text-2xl mb-1">{s.icon}</div>
              <h4 className="font-bold text-lg">{s.title}</h4>
              <p className="text-sm text-blue-100/80">{s.desc}</p>
              {/* Connecting dotted line between steps on desktop */}
              {i < steps.length - 1 && (
                <div className="hidden md:block absolute -right-3 top-7 w-6 border-t-2 border-dashed border-blue-400/30" />
              )}
            </div>
          ))}
        </div>
      </div>
      </div>
    </section>
  )
}

export const Features = memo(FeaturesImpl)

type Feature = {
  icon: ReactNode
  title: string
  desc: string
  color: string
}

const FeatureCard = memo(function FeatureCard({ feature, index }: { feature: Feature; index: number }) {
  const f = feature

  return (
    <div>
      <div
        className="group relative rounded-2xl bg-white p-[1.5px] transition-colors duration-300"
        style={{
          background: `linear-gradient(135deg, oklch(0.92 0 0), oklch(0.96 0 0))`,
        }}
      >
        <div
          className="relative rounded-2xl bg-white p-6 overflow-hidden h-full shadow-sm transition-shadow duration-300"
        >
          {/* Subtle gradient overlay on hover */}
          <div
            className="absolute inset-0 opacity-0 group-hover:opacity-[0.06] transition-opacity duration-300"
            style={{ background: f.color }}
          />

          <div
            className="relative h-14 w-14 rounded-2xl flex items-center justify-center mb-4 transition-colors duration-300"
            style={{ background: `${f.color}15`, color: f.color }}
          >
            {f.icon}
          </div>
          <h3 className="relative font-bold text-lg mb-1.5 transition-colors group-hover:text-blue-700 duration-300">{f.title}</h3>
          <p className="relative text-sm text-muted-foreground leading-relaxed">{f.desc}</p>

          {/* Connecting dotted line to next card (on desktop, right side) */}
          {(index + 1) % 3 !== 0 && index < features.length - 1 && (
            <div className="hidden lg:block absolute -right-2.5 top-1/2 w-5 border-t-2 border-dashed border-slate-200" />
          )}
        </div>
      </div>
    </div>
  )
})
