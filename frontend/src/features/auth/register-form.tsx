import { useSession } from '@/stores/session'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useT } from '@/lib/i18n'
import { useNavigate } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { authRegisterMutation } from '@/api'
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
import { SocialAuthButtons } from './social-buttons'
import { makeRegisterSchema, scorePassword, type RegisterFormValues } from './_shared'

export function RegisterForm() {
  const setUser = useSession((s) => s.setUser)
  const navigate = useNavigate()
  const t = useT()
  const [showPwd, setShowPwd] = useState(false)
  const [success, setSuccess] = useState(false)
  const registerSchema = useMemo(() => makeRegisterSchema(t), [t])

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

  const registerMut = useMutation({
    ...authRegisterMutation(),
    onSuccess: ({ user }) => {
      setUser(user)
      setSuccess(true)
      toast.success(t('authPage.accountCreated'))
    },
    onError: () => toast.error(t('authPage.registerFailedEmail')),
  })

  const onSubmit = (values: RegisterFormValues) => {
    registerMut.mutate({
      body: {
        fullName: values.fullName,
        email: values.email || undefined,
        phone: values.phone || undefined,
        password: values.password,
      },
    })
  }

  if (success) {
    return (
      <div className="text-center py-4">
        <div className="inline-flex h-16 w-16 rounded-full bg-linear-to-br from-blue-400 to-blue-500 items-center justify-center mb-4">
          <Check className="h-8 w-8 text-white" strokeWidth={3} />
        </div>
        <h3 className="font-bold text-lg mb-1">{t('auth.registerSuccess')}</h3>
        <p className="text-sm text-muted-foreground mb-5">{t('authPage.registerReady')}</p>
        <Button onClick={() => navigate({ to: '/' })} className="w-full gap-2">
          {t('authPage.startSearch')}
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
                {t('auth.fullName')} <span className="text-destructive">*</span>
              </FormLabel>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
                <FormControl>
                  <Input
                    {...field}
                    placeholder={t('authPage.fullNamePh')}
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
          name="email"
          render={({ field }) => (
            <FormItem className="space-y-1.5">
              <FormLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('auth.email')}{' '}
                <span className="text-muted-foreground/60 normal-case font-normal">
                  {t('authPage.orPhone')}
                </span>{' '}
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
                {t('auth.password')} <span className="text-destructive">*</span>
              </FormLabel>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
                <FormControl>
                  <Input
                    {...field}
                    placeholder={t('authPage.passwordMin6')}
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
                  <span className="ml-2 text-[11px] text-muted-foreground w-16 text-right">
                    {pwdStrength.label}
                  </span>
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
                {t('auth.confirmPassword')} <span className="text-destructive">*</span>
              </FormLabel>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
                <FormControl>
                  <Input
                    {...field}
                    placeholder={t('authPage.confirmPasswordPh')}
                    type={showPwd ? 'text' : 'password'}
                    className="pl-10 h-11"
                  />
                </FormControl>
              </div>
              {confirm && password !== confirm && (
                <p className="text-[11px] text-red-500">{t('validation.passwordMatch')}</p>
              )}
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" disabled={registerMut.isPending} className="h-11 w-full gap-2">
          {registerMut.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <UserPlus className="h-4 w-4" />
          )}
          {t('authPage.createAccount')}
          <ChevronRight className="h-4 w-4" />
        </Button>

        <p className="text-[11px] text-muted-foreground text-center">{t('authPage.termsAgree')}</p>
      </form>

      <SocialAuthButtons />
    </Form>
  )
}
