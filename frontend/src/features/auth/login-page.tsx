import { isStaffUser, useSession } from '@/stores/session'
import { useEffect, useState } from 'react'
import { useT } from '@/lib/i18n'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { ShieldCheck, User, UserPlus } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Tab } from './_shared'
import { CustomerLogin } from './customer-login'
import { RegisterForm } from './register-form'

export function LoginPage() {
  const user = useSession((s) => s.user)
  const t = useT()
  const navigate = useNavigate()
  const { redirect } = useSearch({ from: '/login' })
  const [tab, setTab] = useState<Tab>('customer')

  // Signed in (here, by registering, or already): back to where they came from.
  useEffect(() => {
    if (!user) return
    if (redirect) navigate({ href: redirect, replace: true })
    else navigate({ to: isStaffUser(user) ? '/admin' : '/account', replace: true })
  }, [user, redirect, navigate])

  return (
    <div className="flex min-h-[calc(100dvh-var(--header-h))] items-start justify-center px-4 py-8 sm:items-center sm:py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <img src="/logo.svg" alt="" aria-hidden className="mx-auto size-14" />
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900">
            {tab === 'customer' ? t('auth.login') : t('auth.register')}
          </h1>
          <p className="mt-1 text-sm text-slate-500">{t('authPage.headerSubtitle')}</p>
        </div>

        <div className="rounded-3xl bg-white p-5 shadow-float ring-1 ring-slate-200/80 sm:p-7">
          <div role="tablist" className="mb-6 grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1">
            {(
              [
                ['customer', User, t('auth.login')],
                ['register', UserPlus, t('auth.register')],
              ] as const
            ).map(([key, Icon, label]) => (
              <button
                key={key}
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={cn(
                  'inline-flex h-10 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-colors',
                  tab === key
                    ? 'bg-white text-slate-900 shadow-soft'
                    : 'text-slate-500 hover:text-slate-900',
                )}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </div>
          {tab === 'customer' ? <CustomerLogin /> : <RegisterForm />}
        </div>

        <p className="mt-5 flex items-center justify-center gap-1.5 text-xs text-slate-500">
          <ShieldCheck className="size-3.5 text-emerald-600" />
          {t('authPage.trustNote')}
        </p>
      </div>
    </div>
  )
}
