'use client'

/**
 * RegisterForm — new-account form for end-customers.
 *
 * Extracted from the original `login-page.tsx`. Uses the shared
 * `registerZodSchema` from `./_shared` so the email/phone/password
 * validation rules stay consistent with the customer-login schema.
 *
 * Backend route: `POST /api/auth/register` with body
 * `{ fullName, email?, phone?, password }` (camelCase — matches
 * `RegisterRequest` in `src/routes/auth.rs`).
 */

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useApp } from '@/lib/store'
import { useNavigate } from '@/router'
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
  Loader2,
  ChevronRight,
  Check,
  Mail,
  Lock,
  User,
  UserPlus,
  Eye,
  EyeOff,
  Phone,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  registerZodSchema,
  scorePassword,
  type RegisterFormValues,
} from './_shared'

export function RegisterForm() {
  const { setUser } = useApp()
  const navigate = useNavigate()
  const [showPwd, setShowPwd] = useState(false)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerZodSchema),
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
        credentials: 'include',
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
