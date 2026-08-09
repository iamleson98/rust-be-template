'use client'

import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useApp } from '@/lib/store'
import { useNavigate } from '@/router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form'
import {
  phoneSchema,
  emailSchema,
  fullNameSchema,
  otpSchema,
} from '@/lib/forms'
import { toast } from 'sonner'
import {
  Phone,
  ShieldCheck,
  Loader2,
  ChevronRight,
  Check,
  RefreshCw,
  KeyRound,
  Mail,
  Lock,
  Bus,
  User,
  Briefcase,
  ArrowLeft,
  Sparkles,
  TrendingUp,
  UserPlus,
  Eye,
  EyeOff,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type Tab = 'customer' | 'register' | 'employee'
type CustomerStep = 'phone' | 'otp' | 'success'

export function LoginPage() {
  const { user } = useApp()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('customer')

  // If already logged in, redirect to the right place.
  // The user object comes from /api/auth/me (server-verified) — see store.tsx.
  useEffect(() => {
    if (user) {
      if (user.type === 'employee') navigate({ to: '/admin' })
      else navigate({ to: '/bookings' })
    }
  }, [user, navigate])

  return (
    <div className="relative min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-10 overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 -z-10 bg-slate-900">
        <div className="absolute inset-0 bg-linear-to-br from-slate-900 via-slate-800 to-slate-900" />
        <div className="absolute inset-0 bg-linear-to-t from-slate-900/80 via-transparent to-slate-900/40" />
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)',
            backgroundSize: '28px 28px',
          }}
        />
        <div className="absolute top-1/4 right-[10%] h-48 w-48 rounded-full bg-amber-400/10 blur-3xl" />
        <div className="absolute bottom-1/4 left-[10%] h-40 w-40 rounded-full bg-blue-400/10 blur-3xl" />
      </div>

      <div className="w-full max-w-md">
        <button
          onClick={() => navigate({ to: '/' })}
          className="inline-flex items-center gap-1.5 text-sm text-blue-200 hover:text-white transition-colors mb-5"
        >
          <ArrowLeft className="h-4 w-4" />
          Về trang chủ
        </button>

        <div className="rounded-2xl bg-white shadow-2xl overflow-hidden ring-1 ring-black/5">
          {/* Header */}
          <div className="relative bg-linear-to-br from-blue-600 via-blue-700 to-blue-800 px-6 pt-6 pb-7 text-white">
            <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_top_right,white,transparent_60%)]" />
            <div className="relative flex items-center gap-3">
              <div className="h-11 w-11 rounded-xl bg-white/15 ring-1 ring-white/30 backdrop-blur inline-flex items-center justify-center">
                <Bus className="h-6 w-6" />
              </div>
              <div>
                <h1 className="font-bold text-xl leading-tight">VeXeVN</h1>
                <p className="text-[12px] text-blue-100 mt-0.5">
                  Đăng nhập để quản lý vé, đánh giá và ưu đãi
                </p>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-slate-200">
            <TabButton
              active={tab === 'customer'}
              onClick={() => setTab('customer')}
              icon={<User className="h-4 w-4" />}
              label="Khách hàng"
            />
            <TabButton
              active={tab === 'register'}
              onClick={() => setTab('register')}
              icon={<UserPlus className="h-4 w-4" />}
              label="Đăng ký"
            />
            <TabButton
              active={tab === 'employee'}
              onClick={() => setTab('employee')}
              icon={<Briefcase className="h-4 w-4" />}
              label="Nhân viên"
            />
          </div>

          {/* Content */}
          <div className="p-6">
            {tab === 'customer' && <CustomerLogin />}
            {tab === 'register' && <RegisterForm />}
            {tab === 'employee' && <EmployeeLogin />}
          </div>
        </div>

        {/* Trust note */}
        <div className="mt-5 flex items-center justify-center gap-2 text-xs text-blue-200/80">
          <ShieldCheck className="h-3.5 w-3.5" />
          Bảo mật bởi JWT + Refresh Token, mật khẩu mã hoá bcrypt
        </div>
      </div>
    </div>
  )
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex-1 flex items-center justify-center gap-1.5 py-3.5 text-xs sm:text-sm font-semibold transition-colors relative',
        active ? 'text-blue-700' : 'text-slate-500 hover:text-slate-700',
      )}
    >
      {icon}
      {label}
      {active && <div className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 w-10 rounded-full bg-blue-600" />}
    </button>
  )
}

// ── Customer login (phone + OTP) ─────────────────────────
const customerSchema = z.object({
  phone: phoneSchema,
  code: otpSchema,
})
type CustomerFormValues = z.infer<typeof customerSchema>

function CustomerLogin() {
  const { setUser, setGuestPhone } = useApp()
  const navigate = useNavigate()
  const [step, setStep] = useState<CustomerStep>('phone')
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [resendIn, setResendIn] = useState(0)
  const [devHint, setDevHint] = useState('')
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const form = useForm<CustomerFormValues>({
    resolver: zodResolver(customerSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: { phone: '', code: '' },
  })
  const { control, trigger, watch, getValues } = form
  const phone = watch('phone')

  useEffect(() => {
    if (resendIn <= 0) {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      return
    }
    timerRef.current = setInterval(() => setResendIn((s) => Math.max(0, s - 1)), 1000)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [resendIn])

  const sendOtp = async () => {
    const ok = await trigger('phone')
    if (!ok) return
    setSending(true)
    try {
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error?.message ?? data.error ?? 'Không thể gửi mã OTP')
        return
      }
      setStep('otp')
      setResendIn(60)
      if (data.devCode) {
        setDevHint(data.devCode)
        toast.info(`Mã demo: ${data.devCode}`, { description: 'Dùng mã này để xác thực thử (chỉ ở môi trường dev)' })
      }
    } catch {
      toast.error('Lỗi mạng, vui lòng thử lại')
    } finally {
      setSending(false)
    }
  }

  const verifyOtp = async () => {
    const ok = await trigger('code')
    if (!ok) return
    const codeValue = getValues('code')
    setVerifying(true)
    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: getValues('phone'), code: codeValue }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error?.message ?? data.error ?? 'Xác thực thất bại')
        return
      }
      setUser(data.user)
      if (data.user.phone) setGuestPhone(data.user.phone)
      setStep('success')
      toast.success('Đăng nhập thành công!')
    } catch {
      toast.error('Lỗi mạng, vui lòng thử lại')
    } finally {
      setVerifying(false)
    }
  }

  if (step === 'success') {
    return (
      <div className="text-center py-4">
        <div className="inline-flex h-16 w-16 rounded-full bg-linear-to-br from-blue-400 to-blue-500 items-center justify-center mb-4">
          <Check className="h-8 w-8 text-white" strokeWidth={3} />
        </div>
        <h3 className="font-bold text-lg mb-1">Đăng nhập thành công!</h3>
        <p className="text-sm text-muted-foreground mb-5">
          Vé và đánh giá của bạn sẽ được đồng bộ.
        </p>
        <Button
          onClick={() => navigate({ to: '/bookings' })}
          className="w-full gap-2 bg-linear-to-r from-blue-600 to-blue-600 hover:from-blue-700 hover:to-blue-700 text-white"
        >
          Xem vé của tôi
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    )
  }

  if (step === 'otp') {
    return (
      <Form {...form}>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Nhập mã OTP
            </div>
            <p className="text-sm text-muted-foreground">
              Mã đã gửi tới <span className="font-semibold text-foreground">{phone}</span>
            </p>
          </div>
          <FormField
            control={control}
            name="code"
            render={({ field }) => (
              <FormItem className="space-y-1.5">
                <div className="flex justify-center">
                  <FormControl>
                    <InputOTP
                      value={field.value}
                      onChange={field.onChange}
                      maxLength={6}
                      autoFocus
                      onComplete={verifyOtp}
                    >
                      <InputOTPGroup>
                        <InputOTPSlot index={0} className="h-12 w-12 first:rounded-l-lg last:rounded-r-md" />
                        <InputOTPSlot index={1} className="h-12 w-12" />
                        <InputOTPSlot index={2} className="h-12 w-12" />
                        <InputOTPSlot index={3} className="h-12 w-12" />
                        <InputOTPSlot index={4} className="h-12 w-12" />
                        <InputOTPSlot index={5} className="h-12 w-12 last:rounded-r-lg" />
                      </InputOTPGroup>
                    </InputOTP>
                  </FormControl>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
          {devHint && (
            <div className="rounded-lg bg-amber-50 ring-1 ring-amber-200 px-3 py-2 text-center">
              <span className="text-xs text-amber-700">
                Mã demo (dev): <span className="font-bold tracking-widest">{devHint}</span>
              </span>
            </div>
          )}
          <div className="flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={() => setStep('phone')}
              className="text-muted-foreground hover:text-foreground"
            >
              ← Đổi số
            </button>
            <button
              type="button"
              onClick={sendOtp}
              disabled={resendIn > 0 || sending}
              className="inline-flex items-center gap-1 text-blue-700 font-medium hover:text-blue-800 disabled:text-muted-foreground disabled:cursor-not-allowed"
            >
              <RefreshCw className={cn('h-3 w-3', sending && 'animate-spin')} />
              {resendIn > 0 ? `Gửi lại sau ${resendIn}s` : 'Gửi lại mã'}
            </button>
          </div>
          <Button
            onClick={verifyOtp}
            disabled={verifying}
            className="w-full gap-2 bg-linear-to-r from-blue-600 to-blue-600 hover:from-blue-700 hover:to-blue-700 text-white"
          >
            {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Xác thực
          </Button>
        </div>
      </Form>
    )
  }

  return (
    <Form {...form}>
      <div className="space-y-4">
        <FormField
          control={control}
          name="phone"
          render={({ field }) => (
            <FormItem className="space-y-1.5">
              <FormLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Số điện thoại <span className="text-destructive">*</span>
              </FormLabel>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
                <FormControl>
                  <Input
                    {...field}
                    placeholder="VD: 0912345678"
                    inputMode="tel"
                    autoFocus
                    className="pl-10 h-11"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') sendOtp()
                    }}
                  />
                </FormControl>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Chúng tôi sẽ gửi mã OTP 6 chữ số tới số này.
              </p>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button
          onClick={sendOtp}
          disabled={sending}
          className="w-full gap-2 bg-linear-to-r from-blue-600 to-blue-600 hover:from-blue-700 hover:to-blue-700 text-white h-11"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
          Gửi mã OTP
          <ChevronRight className="h-4 w-4" />
        </Button>

        <div className="pt-4 border-t border-slate-100 space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Lợi ích khi đăng nhập
          </div>
          <div className="space-y-1.5 text-xs text-slate-600">
            <div className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-amber-500 shrink-0" />
              Đồng bộ vé và lịch sử đặt vé trên mọi thiết bị
            </div>
            <div className="flex items-center gap-2">
              <TrendingUp className="h-3.5 w-3.5 text-blue-500 shrink-0" />
              Tích điểm thưởng và nhận ưu đãi độc quyền
            </div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-3.5 w-3.5 text-blue-500 shrink-0" />
              Quản lý đánh giá và phản hồi chuyến đi
            </div>
          </div>
        </div>
      </div>
    </Form>
  )
}

// ── Register form (email/phone + password) ───────────────
const registerSchema = z
  .object({
    fullName: fullNameSchema,
    email: z
      .string()
      .trim()
      .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Email không hợp lệ'),
    phone: z
      .string()
      .trim()
      .refine((v) => !v || /^0\d{8,10}$/.test(v), 'Số điện thoại không hợp lệ'),
    password: z.string().min(6, 'Mật khẩu phải có ít nhất 6 ký tự'),
    confirm: z.string().min(1, 'Vui lòng xác nhận mật khẩu'),
  })
  .refine((d) => d.email || d.phone, {
    message: 'Vui lòng nhập email hoặc số điện thoại',
    path: ['email'],
  })
  .refine((d) => d.password === d.confirm, {
    message: 'Mật khẩu xác nhận không khớp',
    path: ['confirm'],
  })
type RegisterFormValues = z.infer<typeof registerSchema>

function RegisterForm() {
  const { setUser } = useApp()
  const navigate = useNavigate()
  const [showPwd, setShowPwd] = useState(false)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: {
      fullName: '',
      email: '',
      phone: '',
      password: '',
      confirm: '',
    },
  })
  const { control, watch, handleSubmit } = form
  const password = watch('password')
  const confirm = watch('confirm')
  const email = watch('email')

  // Live password strength meter
  const pwdStrength = scorePassword(password)

  const onSubmit = async (values: RegisterFormValues) => {
    setLoading(true)
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: values.fullName,
          email: values.email || undefined,
          phone: values.phone || undefined,
          password: values.password,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error?.message ?? data.error ?? 'Đăng ký thất bại')
        return
      }
      setUser(data.user)
      setSuccess(true)
      toast.success('Tài khoản đã được tạo!')
    } catch {
      toast.error('Lỗi mạng, vui lòng thử lại')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="text-center py-4">
        <div className="inline-flex h-16 w-16 rounded-full bg-linear-to-br from-blue-400 to-blue-500 items-center justify-center mb-4">
          <Check className="h-8 w-8 text-white" strokeWidth={3} />
        </div>
        <h3 className="font-bold text-lg mb-1">Đăng ký thành công!</h3>
        <p className="text-sm text-muted-foreground mb-5">
          Tài khoản của bạn đã sẵn sàng. Bắt đầu đặt vé ngay!
        </p>
        <Button
          onClick={() => navigate({ to: '/' })}
          className="w-full gap-2 bg-linear-to-r from-blue-600 to-blue-600 hover:from-blue-700 hover:to-blue-700 text-white"
        >
          Bắt đầu tìm vé
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    )
  }

  return (
    <Form {...form}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3.5" noValidate>
        <FormField
          control={control}
          name="fullName"
          render={({ field }) => (
            <FormItem className="space-y-1.5">
              <FormLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Họ và tên <span className="text-destructive">*</span>
              </FormLabel>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
                <FormControl>
                  <Input {...field} placeholder="Nguyễn Văn A" autoFocus className="pl-10 h-11" />
                </FormControl>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="email"
          render={({ field }) => (
            <FormItem className="space-y-1.5">
              <FormLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Email <span className="text-muted-foreground/60 normal-case font-normal">(hoặc số điện thoại)</span>{' '}
                <span className="text-destructive">*</span>
              </FormLabel>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
                <FormControl>
                  <Input
                    {...field}
                    placeholder="email@example.com"
                    type="email"
                    className="pl-10 h-11"
                  />
                </FormControl>
              </div>
              <FormMessage />
              {!email && (
                <FormField
                  control={control}
                  name="phone"
                  render={({ field: phoneField }) => (
                    <FormItem className="space-y-1.5">
                      <div className="relative">
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
                        <FormControl>
                          <Input
                            {...phoneField}
                            placeholder="0912345678"
                            inputMode="tel"
                            className="pl-10 h-11"
                          />
                        </FormControl>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="password"
          render={({ field }) => (
            <FormItem className="space-y-1.5">
              <FormLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Mật khẩu <span className="text-destructive">*</span>
              </FormLabel>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
                <FormControl>
                  <Input
                    {...field}
                    placeholder="Tối thiểu 6 ký tự"
                    type={showPwd ? 'text' : 'password'}
                    className="pl-10 pr-10 h-11"
                  />
                </FormControl>
                <button
                  type="button"
                  onClick={() => setShowPwd((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {password && (
                <div className="flex items-center gap-1">
                  {[0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className={cn(
                        'h-1 flex-1 rounded-full transition-colors',
                        i < pwdStrength.score
                          ? pwdStrength.score <= 2
                            ? 'bg-amber-400'
                            : 'bg-blue-500'
                          : 'bg-slate-200',
                      )}
                    />
                  ))}
                  <span className="ml-2 text-[11px] text-muted-foreground w-16 text-right">{pwdStrength.label}</span>
                </div>
              )}
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="confirm"
          render={({ field }) => (
            <FormItem className="space-y-1.5">
              <FormLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Xác nhận mật khẩu <span className="text-destructive">*</span>
              </FormLabel>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
                <FormControl>
                  <Input
                    {...field}
                    placeholder="Nhập lại mật khẩu"
                    type={showPwd ? 'text' : 'password'}
                    className="pl-10 h-11"
                  />
                </FormControl>
              </div>
              {confirm && password !== confirm && (
                <p className="text-[11px] text-red-500">Mật khẩu xác nhận không khớp</p>
              )}
              <FormMessage />
            </FormItem>
          )}
        />

        <Button
          type="submit"
          disabled={loading}
          className="w-full gap-2 bg-linear-to-r from-blue-600 to-blue-600 hover:from-blue-700 hover:to-blue-700 text-white h-11"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
          Tạo tài khoản
          <ChevronRight className="h-4 w-4" />
        </Button>

        <p className="text-[11px] text-muted-foreground text-center">
          Bằng việc đăng ký, bạn đồng ý với Điều khoản dịch vụ và Chính sách bảo mật của VeXeVN.
        </p>
      </form>
    </Form>
  )
}

// ── Employee login (email + password) ────────────────────
const employeeSchema = z.object({
  email: emailSchema,
  password: z.string().min(6, 'Mật khẩu phải có ít nhất 6 ký tự'),
})
type EmployeeFormValues = z.infer<typeof employeeSchema>

function EmployeeLogin() {
  const { setUser } = useApp()
  const navigate = useNavigate()
  const [showPwd, setShowPwd] = useState(false)
  const [loading, setLoading] = useState(false)

  const form = useForm<EmployeeFormValues>({
    resolver: zodResolver(employeeSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: { email: '', password: '' },
  })
  const { control, handleSubmit } = form

  const onSubmit = async (values: EmployeeFormValues) => {
    setLoading(true)
    try {
      const res = await fetch('/api/auth/employee-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: values.email, password: values.password }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error?.message ?? data.error ?? 'Đăng nhập thất bại')
        return
      }
      setUser(data.user)
      toast.success(`Chào mừng ${data.user.name}!`)
      navigate({ to: '/admin' })
    } catch {
      toast.error('Lỗi mạng, vui lòng thử lại')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <FormField
          control={control}
          name="email"
          render={({ field }) => (
            <FormItem className="space-y-1.5">
              <FormLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Email công ty <span className="text-destructive">*</span>
              </FormLabel>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
                <FormControl>
                  <Input
                    {...field}
                    placeholder="VD: admin@bus.vn"
                    type="email"
                    autoFocus
                    className="pl-10 h-11"
                  />
                </FormControl>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name="password"
          render={({ field }) => (
            <FormItem className="space-y-1.5">
              <FormLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Mật khẩu <span className="text-destructive">*</span>
              </FormLabel>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
                <FormControl>
                  <Input
                    {...field}
                    placeholder="••••••••"
                    type={showPwd ? 'text' : 'password'}
                    className="pl-10 pr-10 h-11"
                  />
                </FormControl>
                <button
                  type="button"
                  onClick={() => setShowPwd((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button
          type="submit"
          disabled={loading}
          className="w-full gap-2 bg-linear-to-r from-blue-600 to-blue-600 hover:from-blue-700 hover:to-blue-700 text-white h-11"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Briefcase className="h-4 w-4" />}
          Đăng nhập nhân viên
          <ChevronRight className="h-4 w-4" />
        </Button>

        <div className="rounded-lg bg-blue-50 ring-1 ring-blue-200 px-3 py-2.5">
          <div className="text-[11px] font-semibold text-blue-700 mb-1">Tài khoản nhân viên demo</div>
          <div className="text-[11px] text-blue-600 space-y-0.5">
            <div>• admin@bus.vn — mật khẩu: <code className="font-mono">admin123</code></div>
            <div>• an@phuongtrang.vn — mật khẩu: <code className="font-mono">staff123</code></div>
            <div className="text-blue-400 pt-0.5">Mật khẩu được mã hoá bcrypt, tài khoản khoá sau 5 lần sai.</div>
          </div>
        </div>
      </form>
    </Form>
  )
}

// ── Helpers ──────────────────────────────────────────────
function scorePassword(pwd: string): { score: number; label: string } {
  if (!pwd) return { score: 0, label: '' }
  let score = 0
  if (pwd.length >= 6) score++
  if (pwd.length >= 10) score++
  if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) score++
  if (/\d/.test(pwd) && /[^A-Za-z0-9]/.test(pwd)) score++
  const labels = ['Rất yếu', 'Yếu', 'Trung bình', 'Tốt', 'Mạnh']
  return { score, label: labels[score] || '' }
}
