'use client'

/**
 * CustomerLogin — email + password login form for end-customers.
 *
 * Extracted from the original `login-page.tsx`. Uses the shared
 * `customerZodSchema` from `./_shared` so the validation rules stay
 * in sync with the registration form's email/password rules.
 *
 * Backend route: `POST /api/auth/login` with body `{ email, password }`
 * (camelCase — matches `LoginRequest` in `src/routes/auth.rs`).
 * Response: `{ user: SessionUser, expiresAt }` + sets `access_token` /
 * `refresh_token` httpOnly cookies.
 */

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useApp } from '@/lib/store'
import { useNavigate } from '@/router'
import { useLogin } from '@/lib/queries'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form'
import { toast } from 'sonner'
import {
  ShieldCheck,
  Loader2,
  ChevronRight,
  Check,
  Mail,
  Lock,
  Sparkles,
  TrendingUp,
  Eye,
  EyeOff,
} from 'lucide-react'
import {
  customerZodSchema,
  type CustomerFormValues,
  type CustomerStep,
} from './_shared'

export function CustomerLogin() {
  const { setUser, setGuestPhone } = useApp()
  const navigate = useNavigate()
  const [step, setStep] = useState<CustomerStep>('credentials')
  const [showPwd, setShowPwd] = useState(false)

  const form = useForm<CustomerFormValues>({
    resolver: zodResolver(customerZodSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: { email: '', password: '' },
  })
  const { control, handleSubmit } = form

  const loginMut = useLogin({
    onSuccess: (data: any) => {
      const user = data?.user ?? data?.data?.user
      if (!user) return
      setUser(user)
      if (user.phone) setGuestPhone(user.phone)
      setStep('success')
      toast.success(`Chào ${user.name ?? 'bạn'}, đăng nhập thành công!`)
    },
    onError: () => {
      toast.error('Đăng nhập thất bại. Vui lòng kiểm tra email/mật khẩu.')
    },
  })

  const onSubmit = (values: CustomerFormValues) => {
    loginMut.mutate({ body: { email: values.email, password: values.password } } as any)
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

  return (
    <Form {...form}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <FormField
          control={control}
          name="email"
          render={({ field }) => (
            <FormItem className="space-y-1.5">
              <FormLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Email <span className="text-destructive">*</span>
              </FormLabel>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
                <FormControl>
                  <Input
                    {...field}
                    placeholder="email@example.com"
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
          disabled={loginMut.isPending}
          className="w-full gap-2 bg-linear-to-r from-blue-600 to-blue-600 hover:from-blue-700 hover:to-blue-700 text-white h-11"
        >
          {loginMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          Đăng nhập
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
      </form>
    </Form>
  )
}
