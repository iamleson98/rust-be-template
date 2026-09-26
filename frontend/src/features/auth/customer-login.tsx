'use client'

/**
 * CustomerLogin — unified email + password login form for all users.
 *
 * Extracted from the original `login-page.tsx`. Uses the shared
 * `makeCustomerSchema` from `./_shared` so the validation rules stay
 * in sync with the registration form's email/password rules.
 *
 * Backend route: `POST /api/auth/login` with body `{ email, password }`
 * (camelCase — matches `LoginRequest` in `src/routes/auth.rs`).
 * Response: `{ user: SessionUser, expiresAt }` + sets `access_token` /
 * `refresh_token` httpOnly cookies.
 */

import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useApp } from '@/lib/store'
import { useT } from '@/lib/i18n'
import { useNavigate } from '@tanstack/react-router'
import { useLogin } from '@/lib/queries'
import { isStaffUser } from '@/lib/store'
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
  Mail,
  Lock,
  Sparkles,
  TrendingUp,
  Eye,
  EyeOff,
} from 'lucide-react'
import {
  makeCustomerSchema,
  type CustomerFormValues,
} from './_shared'
import { SocialAuthButtons } from './social-buttons'

export function CustomerLogin() {
  const { setUser, setGuestPhone } = useApp()
  const navigate = useNavigate()
  const t = useT()
  const [showPwd, setShowPwd] = useState(false)
  const customerSchema = useMemo(() => makeCustomerSchema(t), [t])

  const form = useForm<CustomerFormValues>({
    resolver: zodResolver(customerSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: { email: '', password: '' },
  })
  const { control, handleSubmit } = form

  const loginMut = useLogin({
    onSuccess: (data) => {
      const user = (((data ?? {}) as { user?: unknown; data?: { user?: unknown } }).user ??
      ((data ?? {}) as { data?: { user?: unknown } }).data?.user) as Parameters<typeof setUser>[0] | undefined
      if (!user) return
      setUser(user)
      if (user.phone) setGuestPhone(user.phone)
      toast.success(t('authPage.loginWelcome', { name: user.name ?? t('authPage.you') }))
      navigate({ to: isStaffUser(user) ? '/admin' : '/bookings' })
    },
    onError: () => {
      toast.error(t('authPage.loginFailedCheck'))
    },
  })

  const onSubmit = (values: CustomerFormValues) => {
    loginMut.mutate({ body: { email: values.email, password: values.password } } as unknown as Parameters<typeof loginMut.mutate>[0])
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
                {t('auth.email')} <span className="text-destructive">*</span>
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
                {t('auth.password')} <span className="text-destructive">*</span>
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
                  aria-label={showPwd ? t('authPage.hidePassword') : t('authPage.showPassword')}
                  aria-pressed={showPwd}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
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
          {t('auth.login')}
          <ChevronRight className="h-4 w-4" />
        </Button>

        <div className="pt-4 border-t border-slate-100 space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t('authPage.benefitsTitle')}
          </div>
          <div className="space-y-1.5 text-xs text-slate-600">
            <div className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-amber-500 shrink-0" />
              {t('authPage.benefitSync')}
            </div>
            <div className="flex items-center gap-2">
              <TrendingUp className="h-3.5 w-3.5 text-blue-500 shrink-0" />
              {t('authPage.benefitPoints')}
            </div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-3.5 w-3.5 text-blue-500 shrink-0" />
              {t('authPage.benefitReviews')}
            </div>
          </div>
        </div>
      </form>

      <SocialAuthButtons />
    </Form>
  )
}
