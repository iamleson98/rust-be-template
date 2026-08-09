'use client'

import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useApp } from '@/lib/store'
import { useNavigate } from '@/router'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
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
import { phoneSchema, otpSchema } from '@/lib/forms'
import { toast } from 'sonner'
import {
  Phone,
  ShieldCheck,
  Loader2,
  ChevronRight,
  Check,
  RefreshCw,
  Sparkles,
  KeyRound,
} from 'lucide-react'

type Step = 'phone' | 'otp' | 'success'

const authSchema = z.object({
  phone: phoneSchema,
  code: otpSchema,
})
type AuthFormValues = z.infer<typeof authSchema>

export function AuthDialog() {
  const { authOpen, setAuthOpen, user, setUser, setGuestPhone, guestPhone } = useApp()
  const navigate = useNavigate()

  const [step, setStep] = useState<Step>('phone')
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [resendIn, setResendIn] = useState(0)
  const [resolvedName, setResolvedName] = useState<string>('')
  const [devHint, setDevHint] = useState<string>('')
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const form = useForm<AuthFormValues>({
    resolver: zodResolver(authSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: { phone: '', code: '' },
  })
  const { watch, setValue, reset, trigger, getValues } = form
  const phone = watch('phone')

  // Pre-fill with guest phone if present.
  useEffect(() => {
    if (authOpen && guestPhone && !phone) {
      setValue('phone', guestPhone)
    }
  }, [authOpen, guestPhone, phone, setValue])

  // Reset everything when dialog closes.
  useEffect(() => {
    if (!authOpen) {
      const t = setTimeout(() => {
        setStep('phone')
        setResendIn(0)
        setResolvedName('')
        setDevHint('')
        setSending(false)
        setVerifying(false)
        reset({ phone: '', code: '' })
      }, 250)
      return () => clearTimeout(t)
    }
  }, [authOpen, reset])

  // Countdown timer for resend.
  useEffect(() => {
    if (resendIn <= 0) {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      return
    }
    timerRef.current = setInterval(() => {
      setResendIn((s) => Math.max(0, s - 1))
    }, 1000)
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
        toast.info(`Mã demo: ${data.devCode}`, {
          description: 'Dùng mã này để xác thực thử (chỉ dev)',
        })
      }
    } catch {
      toast.error('Lỗi mạng, vui lòng thử lại')
    } finally {
      setSending(false)
    }
  }

  const resendOtp = async () => {
    if (resendIn > 0) return
    setSending(true)
    try {
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error?.message ?? data.error ?? 'Không thể gửi lại mã OTP')
        return
      }
      setResendIn(60)
      if (data.devCode) {
        setDevHint(data.devCode)
        toast.success('Đã gửi lại mã OTP')
      } else {
        toast.success('Đã gửi lại mã OTP')
      }
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
      // data.user is a SessionUser { id, type, role, name, phone, email, ... }
      setUser(data.user)
      if (data.user.phone) setGuestPhone(data.user.phone)
      setResolvedName(data.user.name ?? '')
      setStep('success')
      toast.success('Đăng nhập thành công!')
    } catch {
      toast.error('Lỗi mạng, vui lòng thử lại')
    } finally {
      setVerifying(false)
    }
  }

  const close = () => {
    setAuthOpen(false)
    // After successful login, route the user based on type.
    // Use a microtask defer so the dialog close animation starts first
    // and React Router doesn't navigate while the overlay is mid-close.
    const dest = user?.type === 'employee' ? '/admin' : user?.type === 'user' ? '/bookings' : null
    if (dest) {
      setTimeout(() => navigate({ to: dest }), 0)
    }
  }

  const displayName = resolvedName || user?.name || 'Hành khách'

  return (
    <Dialog
      open={authOpen}
      onOpenChange={(v) => {
        if (!v) close()
      }}
    >
      <DialogContent className="sm:max-w-md p-0 overflow-hidden">
        <DialogTitle className="sr-only">Đăng nhập bằng số điện thoại</DialogTitle>
        <DialogDescription className="sr-only">
          Nhập số điện thoại và mã OTP để đăng nhập hoặc tạo tài khoản VeXeVN.
        </DialogDescription>

        {/* Teal gradient header */}
        <div className="relative bg-linear-to-br from-blue-600 via-blue-700 to-blue-700 px-6 pt-6 pb-8 text-white">
          <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_top_right,white,transparent_60%)]" />
          <div className="relative flex items-center gap-2.5">
            <div className="h-10 w-10 rounded-xl bg-white/15 ring-1 ring-white/30 backdrop-blur inline-flex items-center justify-center">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="font-bold text-lg leading-tight">Đăng nhập VeXeVN</div>
              <div className="text-[11px] text-blue-100/90 mt-0.5">
                Xác thực số điện thoại để đồng bộ vé và ưu đãi
              </div>
            </div>
          </div>
          {/* Step indicator */}
          <div className="relative mt-5 flex items-center gap-1.5 text-[10px]">
            {(['phone', 'otp', 'success'] as Step[]).map((s, i) => {
              const active = step === s
              const done = stepIndex(step) > i
              return (
                <div
                  key={s}
                  className={`h-1.5 flex-1 rounded-full transition-all ${
                    active ? 'bg-white' : done ? 'bg-blue-200' : 'bg-white/25'
                  }`}
                />
              )
            })}
          </div>
        </div>

        <div className="p-6">
          <Form {...form}>
            {step === 'phone' && (
              <div key="phone" className="space-y-4">
                <FormField
                  control={form.control}
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
                            className="pl-9"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') sendOtp()
                            }}
                          />
                        </FormControl>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Chúng tôi sẽ gửi mã OTP 6 chữ số tới số điện thoại này.
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button
                  onClick={sendOtp}
                  disabled={sending}
                  className="w-full gap-2 bg-linear-to-r from-blue-600 to-blue-600 hover:from-blue-700 hover:to-blue-700 text-white"
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                  Gửi mã OTP
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}

            {step === 'otp' && (
              <div key="otp" className="space-y-4">
                <div className="space-y-1.5">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Nhập mã OTP
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Mã đã gửi tới <span className="font-semibold text-foreground">{phone}</span>
                  </p>
                </div>

                <FormField
                  control={form.control}
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
                      Mã demo: <span className="font-bold tracking-widest">{devHint}</span> hoặc bất kỳ 6 số nào bắt đầu bằng 1 hoặc 2
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between text-xs">
                  <button
                    type="button"
                    onClick={() => setStep('phone')}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    ← Đổi số điện thoại
                  </button>
                  <button
                    type="button"
                    onClick={resendOtp}
                    disabled={resendIn > 0 || sending}
                    className="inline-flex items-center gap-1 text-blue-700 font-medium hover:text-blue-800 disabled:text-muted-foreground disabled:cursor-not-allowed"
                  >
                    <RefreshCw className={`h-3 w-3 ${sending ? 'animate-spin' : ''}`} />
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
            )}
          </Form>

          {step === 'success' && (
            <div key="success" className="text-center py-4">
              <div className="inline-flex h-20 w-20 rounded-full bg-linear-to-br from-blue-400 to-blue-500 items-center justify-center mb-4">
                <Check className="h-10 w-10 text-white" strokeWidth={3} />
              </div>
              <h3 className="font-bold text-xl mb-1">Xin chào, {displayName}!</h3>
              <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                Đăng nhập thành công. Vé và đánh giá của bạn sẽ được đồng bộ với số điện thoại{' '}
                <span className="font-semibold text-foreground">{phone}</span>.
              </p>
              <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-blue-50 ring-1 ring-blue-200 px-3 py-1.5">
                <Sparkles className="h-3.5 w-3.5 text-blue-500" />
                <span className="text-xs font-medium text-blue-700">Tài khoản đã được xác thực</span>
              </div>
              <div className="mt-6">
                <Button
                  onClick={close}
                  className="gap-2 bg-linear-to-r from-blue-600 to-blue-600 hover:from-blue-700 hover:to-blue-700 text-white"
                >
                  Tiếp tục
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function stepIndex(s: Step): number {
  return s === 'phone' ? 0 : s === 'otp' ? 1 : 2
}
