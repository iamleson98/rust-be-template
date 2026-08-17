'use client'

import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useApp } from '@/lib/store'
import { useNavigate } from '@/router'
import { useLogin } from '@/lib/queries'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
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
  Mail,
  Lock,
  ShieldCheck,
  Loader2,
  ChevronRight,
  Check,
  Sparkles,
  Eye,
  EyeOff,
} from 'lucide-react'
import { customerZodSchema, type CustomerFormValues, type CustomerStep } from './_shared'

export function AuthDialog() {
  const { authOpen, setAuthOpen, user, setUser, setGuestPhone, guestPhone } = useApp()
  const navigate = useNavigate()

  const [step, setStep] = useState<CustomerStep>('credentials')
  const [resolvedName, setResolvedName] = useState<string>('')
  const [showPwd, setShowPwd] = useState(false)

  const form = useForm<CustomerFormValues>({
    resolver: zodResolver(customerZodSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: { email: '', password: '' },
  })
  const { setValue, reset } = form

  // Pre-fill with guest phone if present (kept for backward compat — the
  // field is `email` now, so this is rarely useful, but a guest who
  // previously entered a phone-like string still sees it pre-filled).
  useEffect(() => {
    if (authOpen && guestPhone && !form.getValues('email')) {
      setValue('email', guestPhone)
    }
  }, [authOpen, guestPhone, setValue, form])

  // Reset everything when dialog closes.
  useEffect(() => {
    if (!authOpen) {
      const t = setTimeout(() => {
        setStep('credentials')
        setResolvedName('')
        reset({ email: '', password: '' })
      }, 250)
      return () => clearTimeout(t)
    }
  }, [authOpen, reset])

  const loginMut = useLogin({
    onSuccess: (data: any) => {
      const user = data?.user ?? data?.data?.user
      if (!user) return
      setUser(user)
      if (user.phone) setGuestPhone(user.phone)
      setResolvedName(user.name ?? '')
      setStep('success')
      toast.success('Đăng nhập thành công!')
    },
    onError: () => {
      toast.error('Đăng nhập thất bại. Vui lòng kiểm tra email/mật khẩu.')
    },
  })

  const onSubmit = (values: CustomerFormValues) => {
    loginMut.mutate({ body: { email: values.email, password: values.password } } as any)
  }

  const close = () => {
    setAuthOpen(false)
    // After successful login, route the user based on type.
    const dest = user?.type === 'employee' ? '/admin' : user?.type === 'user' ? '/bookings' : null
    if (dest) {
      setTimeout(() => navigate({ to: dest }), 0)
    }
  }

  const displayName = resolvedName || user?.name || 'Hành khách'
  const loading = loginMut.isPending

  return (
    <Dialog
      open={authOpen}
      onOpenChange={(v) => {
        if (!v) close()
      }}
    >
      <DialogContent className="sm:max-w-md p-0 overflow-hidden">
        <DialogTitle className="sr-only">Đăng nhập VeXeVN</DialogTitle>
        <DialogDescription className="sr-only">
          Nhập email và mật khẩu để đăng nhập hoặc tạo tài khoản VeXeVN.
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
                Đăng nhập để đồng bộ vé và ưu đãi
              </div>
            </div>
          </div>
          {/* Step indicator */}
          <div className="relative mt-5 flex items-center gap-1.5 text-[10px]">
            {(['credentials', 'success'] as CustomerStep[]).map((s, i) => {
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
            {step === 'credentials' && (
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
                <FormField
                  control={form.control}
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
                            className="pl-9"
                          />
                        </FormControl>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
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
                            className="pl-9 pr-9"
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
                  className="w-full gap-2 bg-linear-to-r from-blue-600 to-blue-600 hover:from-blue-700 hover:to-blue-700 text-white"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  Đăng nhập
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </form>
            )}

            {step === 'success' && (
              <div key="success" className="text-center py-4">
                <div className="inline-flex h-20 w-20 rounded-full bg-linear-to-br from-blue-400 to-blue-500 items-center justify-center mb-4">
                  <Check className="h-10 w-10 text-white" strokeWidth={3} />
                </div>
                <h3 className="font-bold text-xl mb-1">Xin chào, {displayName}!</h3>
                <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                  Đăng nhập thành công. Vé và đánh giá của bạn sẽ được đồng bộ.
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
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function stepIndex(s: CustomerStep): number {
  return s === 'credentials' ? 0 : 1
}
