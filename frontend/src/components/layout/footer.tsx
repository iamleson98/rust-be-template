'use client'

import { memo, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useApp } from '@/lib/store'
import { useNavigate } from '@/router'
import { useT } from '@/lib/i18n'
import { EXCHANGE_RATE_NOTE } from '@/lib/currency'
import {
  Bus, Phone, Mail, MapPin, Facebook, Youtube, ShieldCheck,
  CreditCard, Heart, Globe, FileText, HelpCircle, MessageCircle,
  Award, Send, Headphones, Stamp, TrendingUp,
  Sparkles, Users, Route as RouteIcon, Building2, MapPinned
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormField,
  FormItem,
  FormControl,
  FormMessage,
} from '@/components/ui/form'
import { emailSchema } from '@/lib/forms'
import { toast } from 'sonner'
import { buildSearchInput } from '@/lib/search-params'
const partners = ['Phương Trang', 'Thanh Bình', 'Hà Thành', 'Limousine Việt', 'Xe Việt', 'Hoàng Long', 'Mai Linh', 'Futa Bus']

const newsletterSchema = z.object({
  email: emailSchema,
})
type NewsletterValues = z.infer<typeof newsletterSchema>

export const Footer = memo(function Footer() {
  const { setChatOpen, user } = useApp()
  const navigate = useNavigate()
  const t = useT()

  const form = useForm<NewsletterValues>({
    resolver: zodResolver(newsletterSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: { email: '' },
  })

  const onSubscribe = useCallback((values: NewsletterValues) => {
    // Existing behavior: just confirm subscription with a toast.
    // (No dedicated newsletter API exists yet — preserving the original
    // success-only flow. The validation layer is what's been upgraded here.)
    toast.success(t('footer.newsletterSuccess'))
    form.reset({ email: '' })
  }, [form])

  return (
    <footer className="mt-auto bg-slate-950 text-slate-300">
      {/* ── Newsletter Subscription Banner ── */}
      <div className="relative bg-linear-to-r from-blue-600 via-blue-500 to-blue-500 overflow-hidden">
        {/* Decorative wave at top */}
        <svg className="absolute -top-6 left-0 w-full h-6 text-slate-950" viewBox="0 0 1440 24" preserveAspectRatio="none" fill="currentColor">
          <path d="M0,24 C360,0 720,24 1080,8 C1260,0 1380,12 1440,24 L1440,24 L0,24 Z" />
        </svg>
        <div className="container mx-auto px-4 py-10 md:py-12">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="text-center md:text-left">
              <h3 className="text-2xl md:text-3xl font-bold text-white mb-1">
                🎫 {t('footer.newsletter')}
              </h3>
              <p className="text-blue-100/90 text-sm md:text-base">
                Đăng ký nhận bản tin để không bỏ lỡ mã giảm giá, ưu đãi cuối tuần
              </p>
            </div>
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubscribe)}
                className="w-full md:w-auto max-w-md"
                noValidate
              >
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex w-full md:w-auto gap-2">
                        <FormControl>
                          <Input
                            {...field}
                            type="email"
                            placeholder="Nhập email của bạn"
                            className="h-12 bg-white/20 border-white/30 text-white placeholder:text-white/60 focus-visible:ring-white/40 focus-visible:border-white/50 backdrop-blur-sm text-base"
                          />
                        </FormControl>
                        <Button
                          type="submit"
                          className="h-12 px-6 bg-white text-blue-700 hover:bg-white/90 font-semibold shrink-0 text-base"
                        >
                          <Send className="h-4 w-4 mr-1.5" />
                          Đăng ký
                        </Button>
                      </div>
                      <FormMessage className="mt-1.5 text-xs" />
                    </FormItem>
                  )}
                />
              </form>
            </Form>
          </div>
        </div>
      </div>

      {/* ── Animated wave SVG at top ── */}
      <div className="relative -mt-1">
        <svg className="w-full h-8 text-slate-950" viewBox="0 0 1440 32" preserveAspectRatio="none" fill="none">
          <path
            d="M0,16 C240,32 480,0 720,16 C960,32 1200,0 1440,16 L1440,32 L0,32 Z"
            fill="oklch(0.556 0.13 250)"
            opacity="0.15"
          />
          <path
            d="M0,20 C360,4 720,28 1080,12 C1260,4 1380,20 1440,16 L1440,32 L0,32 Z"
            fill="oklch(0.596 0.12 220)"
            opacity="0.1"
          />
        </svg>
      </div>

      {/* ── Animated gradient top border (shifting colors) ── */}
      <div className="h-1 bg-linear-to-r from-blue-500 via-amber-400 to-blue-500" />

      {/* ── Main Footer Content ── */}
      <div className="container mx-auto px-4 py-12">
        {/* ── Quick stats mini-section ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10 pb-10 border-b border-slate-800/60">
          <QuickStat icon={<Users className="h-4 w-4" />} value="125K+" label="Khách hàng" />
          <QuickStat icon={<RouteIcon className="h-4 w-4" />} value="680+" label="Tuyến đường" />
          <QuickStat icon={<Building2 className="h-4 w-4" />} value="42" label="Hãng xe" />
          <QuickStat icon={<Sparkles className="h-4 w-4" />} value="4.8/5" label="Đánh giá" />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="h-10 w-10 rounded-xl bg-linear-to-br from-blue-400 to-blue-500 flex items-center justify-center">
                <Bus className="h-5 w-5 text-white" />
              </div>
              <div>
                <div className="font-extrabold text-white text-lg tracking-tight">DatXeVui</div>
                <div className="text-[10px] text-blue-400 font-medium -mt-0.5">Đặt vé xe online</div>
              </div>
            </div>
            <p className="text-sm text-slate-400 leading-relaxed mb-4">
              Nền tảng đặt vé xe khách hàng đầu Việt Nam. Kết nối hành khách với hàng trăm hãng xe uy tín trên cả nước.
            </p>

            {/* Hotline */}
            <div className="rounded-lg bg-slate-900/80 ring-1 ring-slate-800 p-3 mb-4">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-1">{t('footer.hotline')}</div>
              <a href="tel:19006067" className="flex items-center gap-2 group">
                <div className="h-8 w-8 rounded-lg bg-blue-500/15 flex items-center justify-center group-hover:bg-blue-500/25 transition-colors">
                  <Headphones className="h-4 w-4 text-blue-400" />
                </div>
                <span className="text-lg font-bold text-white group-hover:text-blue-400 transition-colors">1900 6067</span>
              </a>
            </div>

            {/* Social media with icons */}
            <div className="flex items-center gap-2">
              <a href="#" aria-label="Facebook" className="h-9 w-9 rounded-lg bg-slate-800 hover:bg-blue-600 flex items-center justify-center transition-all">
                <Facebook className="h-4 w-4" />
              </a>
              <a href="#" aria-label="Youtube" className="h-9 w-9 rounded-lg bg-slate-800 hover:bg-rose-600 flex items-center justify-center transition-all">
                <Youtube className="h-4 w-4" />
              </a>
              <a href="#" aria-label="Website" className="h-9 w-9 rounded-lg bg-slate-800 hover:bg-blue-600 flex items-center justify-center transition-all">
                <Globe className="h-4 w-4" />
              </a>
              <a href="#" aria-label="Zalo" className="h-9 w-9 rounded-lg bg-slate-800 hover:bg-blue-500 flex items-center justify-center transition-all">
                <MessageCircle className="h-4 w-4" />
              </a>
            </div>
          </div>

          {/* Popular routes — with teal underline slide-in on hover */}
          <div>
            <h4 className="font-semibold text-white text-sm mb-3">Tuyến phổ biến</h4>
            <ul className="space-y-2 text-sm">
              {['Hà Nội → Đà Nẵng', 'Hà Nội → Hồ Chí Minh', 'Hồ Chí Minh → Đà Lạt', 'Hồ Chí Minh → Nha Trang', 'Đà Nẵng → Hà Nội'].map((r) => {
                // Parse "From → To" into separate legs so we can prefill
                // the /search route's typed search params.
                const [from, to] = r.split(' → ')
                return (
                  <li key={r}>
                    <button
                      onClick={() =>
                        navigate({
                          to: '/search',
                          search: buildSearchInput({ from, to }),
                        })
                      }
                      className="relative text-slate-400 hover:text-blue-400 transition-colors after:content-[''] after:absolute after:-bottom-0.5 after:left-0 after:w-0 after:h-[1.5px] after:bg-blue-400 after:transition-all after:duration-300 hover:after:w-full"
                    >
                      {r}
                    </button>
                  </li>
                )
              })}
              <li>
                <button
                  onClick={() => navigate({ to: '/map' })}
                  className="relative inline-flex items-center gap-1.5 text-blue-300 hover:text-blue-200 transition-colors after:content-[''] after:absolute after:-bottom-0.5 after:left-0 after:w-0 after:h-[1.5px] after:bg-blue-400 after:transition-all after:duration-300 hover:after:w-full"
                >
                  <MapPinned className="h-3.5 w-3.5" />
                  Bản đồ tuyến đường
                </button>
              </li>
            </ul>
          </div>

          {/* Support — with teal underline slide-in on hover */}
          <div>
            <h4 className="font-semibold text-white text-sm mb-3">Hỗ trợ</h4>
            <ul className="space-y-2 text-sm">
              <li>
                <button onClick={() => user ? setChatOpen(true) : navigate({ to: '/login' })} className="relative text-slate-400 hover:text-blue-400 transition-colors flex items-center gap-1.5 after:content-[''] after:absolute after:-bottom-0.5 after:left-0 after:w-0 after:h-[1.5px] after:bg-blue-400 after:transition-all after:duration-300 hover:after:w-full">
                  <HelpCircle className="h-3.5 w-3.5" /> Chat trực tuyến
                </button>
              </li>
              <li>
                <a href="tel:19006067" className="relative flex items-center gap-1.5 text-slate-400 hover:text-blue-400 transition-colors after:content-[''] after:absolute after:-bottom-0.5 after:left-0 after:w-0 after:h-[1.5px] after:bg-blue-400 after:transition-all after:duration-300 hover:after:w-full">
                  <Phone className="h-3.5 w-3.5" /> 1900 6067
                </a>
              </li>
              <li>
                <a href="mailto:cskh@datxevui.vn" className="relative flex items-center gap-1.5 text-slate-400 hover:text-blue-400 transition-colors after:content-[''] after:absolute after:-bottom-0.5 after:left-0 after:w-0 after:h-[1.5px] after:bg-blue-400 after:transition-all after:duration-300 hover:after:w-full">
                  <Mail className="h-3.5 w-3.5" /> cskh@datxevui.vn
                </a>
              </li>
              <li className="flex items-center gap-1.5 text-slate-400">
                <MapPin className="h-3.5 w-3.5" /> Hà Nội, Việt Nam
              </li>
              <li>
                <button onClick={() => navigate({ to: '/bookings' })} className="relative text-slate-400 hover:text-blue-400 transition-colors flex items-center gap-1.5 after:content-[''] after:absolute after:-bottom-0.5 after:left-0 after:w-0 after:h-[1.5px] after:bg-blue-400 after:transition-all after:duration-300 hover:after:w-full">
                  <FileText className="h-3.5 w-3.5" /> Tra cứu vé
                </button>
              </li>
            </ul>
          </div>

          {/* Company — with teal underline slide-in on hover */}
          <div>
            <h4 className="font-semibold text-white text-sm mb-3">Công ty</h4>
            <ul className="space-y-2 text-sm">
              {['Về chúng tôi', 'Tuyển dụng', 'Đối tác hãng xe', 'Chính sách hoàn vé', 'Điều khoản sử dụng'].map((item) => (
                <li key={item}>
                  <a href="#" className="relative text-slate-400 hover:text-blue-400 transition-colors after:content-[''] after:absolute after:-bottom-0.5 after:left-0 after:w-0 after:h-[1.5px] after:bg-blue-400 after:transition-all after:duration-300 hover:after:w-full">{item}</a>
                </li>
              ))}
            </ul>
          </div>

          {/* Payment */}
          <div>
            <h4 className="font-semibold text-white text-sm mb-3">Thanh toán</h4>
            <div className="flex flex-wrap gap-2">
              {['MoMo', 'VNPay', 'ZaloPay', 'Visa', 'Mastercard', 'Banking'].map((p) => (
                <span key={p} className="rounded-md bg-slate-800 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-700 transition-colors cursor-default">
                  {p}
                </span>
              ))}
            </div>
            <div className="mt-4 space-y-1.5 text-xs text-slate-400">
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-blue-500" />
                Bảo mật SSL 256-bit
              </div>
              <div className="flex items-center gap-1.5">
                <CreditCard className="h-3.5 w-3.5 text-blue-500" />
                PCI DSS Compliant
              </div>
            </div>

            {/* Certification badges */}
            <div className="mt-4 space-y-2">
              <div className="flex items-center gap-2 rounded-lg bg-blue-500/10 ring-1 ring-blue-500/20 px-2.5 py-1.5">
                <Award className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                <span className="text-xs text-blue-300 font-medium">Bộ GTVT cấp phép</span>
              </div>
              <div className="flex items-center gap-2 rounded-lg bg-blue-500/10 ring-1 ring-blue-500/20 px-2.5 py-1.5">
                <Stamp className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                <span className="text-xs text-blue-300 font-medium">Bảo hiểm hành khách</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Partner Transport Logos — with hover scale effects ── */}
        <div className="mt-10 pt-8 border-t border-slate-800/60">
          <h4 className="font-semibold text-white text-sm mb-4 text-center">Đối tác vận chuyển</h4>
          <div className="flex flex-wrap justify-center gap-3">
            {partners.map((name) => (
              <span
                key={name}
                className="rounded-full bg-slate-800/80 ring-1 ring-slate-700/50 px-4 py-2 text-sm text-slate-300 hover:bg-blue-500/15 hover:text-blue-300 hover:ring-blue-500/30 transition-all cursor-default"
              >
                {name}
              </span>
            ))}
          </div>
        </div>

        {/* ── Bottom bar ── */}
        <div className="mt-10 pt-6 border-t border-slate-800 flex flex-col md:flex-row items-center justify-between gap-3">
          <div className="flex flex-col items-center md:items-start gap-1">
            <div className="flex items-center gap-1 text-sm text-slate-400">
              © 2025 DatXeVui. Bản quyền thuộc về Công ty TNHH DatXeVui
              <Heart className="h-3 w-3 text-rose-500 inline mx-0.5" />
            </div>
            <div className="text-xs text-slate-500">
              Số ĐKKD: 0301234567 | Cấp bởi Sở KH&amp;ĐT TP.HCM
            </div>
          </div>
          <div className="flex flex-col items-center md:items-end gap-2">
            <div className="flex items-center gap-4 text-xs text-slate-500">
              <a href="#" className="relative hover:text-blue-400 transition-colors after:content-[''] after:absolute after:-bottom-0.5 after:left-0 after:w-0 after:h-px after:bg-blue-400 after:transition-all after:duration-300 hover:after:w-full">Điều khoản sử dụng</a>
              <a href="#" className="relative hover:text-blue-400 transition-colors after:content-[''] after:absolute after:-bottom-0.5 after:left-0 after:w-0 after:h-px after:bg-blue-400 after:transition-all after:duration-300 hover:after:w-full">Chính sách bảo mật</a>
              <a href="#" className="relative hover:text-blue-400 transition-colors after:content-[''] after:absolute after:-bottom-0.5 after:left-0 after:w-0 after:h-px after:bg-blue-400 after:transition-all after:duration-300 hover:after:w-full">Quyền riêng tư</a>
            </div>
            <div className="flex items-center gap-2 flex-wrap justify-center md:justify-end">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 ring-1 ring-slate-800 px-3 py-1 text-[11px] text-slate-400">
                <TrendingUp className="h-3 w-3 text-blue-400" />
                {EXCHANGE_RATE_NOTE}
              </div>
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
})

function QuickStat({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-slate-900/60 ring-1 ring-slate-800/60 px-3 py-2.5 hover:ring-blue-500/30 hover:bg-slate-900 transition-all">
      <div className="h-8 w-8 rounded-lg bg-blue-500/15 flex items-center justify-center text-blue-400 shrink-0">
        {icon}
      </div>
      <div className="leading-tight min-w-0">
        <div className="text-base font-bold text-white truncate">{value}</div>
        <div className="text-[11px] text-slate-400 truncate">{label}</div>
      </div>
    </div>
  )
}
