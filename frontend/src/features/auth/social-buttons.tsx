import { useEffect, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { oauthProvidersOptions } from '@/api'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'

type Provider = 'google' | 'facebook' | 'twitter'

const BUTTONS: Record<
  Provider,
  { name: string; labelKey: string; className: string; icon: ReactNode }
> = {
  google: {
    name: 'Google',
    labelKey: 'authPage.loginWithGoogle',
    className: 'border bg-background text-foreground hover:bg-muted',
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
        <path
          fill="#4285F4"
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        />
        <path
          fill="#34A853"
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        />
        <path
          fill="#FBBC05"
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        />
        <path
          fill="#EA4335"
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        />
      </svg>
    ),
  },
  facebook: {
    name: 'Facebook',
    labelKey: 'authPage.loginWithFacebook',
    className: 'bg-[#1877F2] text-white hover:bg-[#166FE5]',
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
      </svg>
    ),
  },
  twitter: {
    name: 'X',
    labelKey: 'authPage.loginWithX',
    className: 'bg-black text-white hover:bg-neutral-800',
    icon: (
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current" aria-hidden="true">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
  },
}

/**
 * Sign in with Google / Facebook / X — only the providers the server has
 * set up, so no button ends in an error; nothing at all when none are.
 */
export function SocialAuthButtons() {
  const t = useT()
  const { data } = useQuery({ ...oauthProvidersOptions(), staleTime: 5 * 60_000 })
  const providers = (data?.providers ?? []).filter((p): p is Provider => p in BUTTONS)

  // Surface OAuth errors passed back from the backend via ?oauth_error=.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const err = params.get('oauth_error')
    if (err) {
      toast.error(decodeURIComponent(err), { duration: 8000 })
      // Clean the URL so the toast doesn't re-appear on refresh.
      const url = new URL(window.location.href)
      url.searchParams.delete('oauth_error')
      window.history.replaceState({}, '', url.toString())
    }
  }, [])

  if (providers.length === 0) return null
  // Three buttons on a phone: icons only; fewer have room for the name.
  const compact = providers.length === 3

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 py-1">
        <div className="h-px flex-1 bg-border" />
        <span className="text-[11px] tracking-wider text-muted-foreground uppercase">
          {t('authPage.or')}
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <div
        className={cn(
          'grid gap-2',
          providers.length === 1
            ? 'grid-cols-1'
            : providers.length === 2
              ? 'grid-cols-2'
              : 'grid-cols-3',
        )}
      >
        {providers.map((p) => {
          const b = BUTTONS[p]
          return (
            <a
              key={p}
              href={`/api/auth/oauth/${p}/start`}
              className={cn(
                'flex h-10 items-center justify-center gap-1.5 rounded-md text-sm font-medium transition-colors',
                b.className,
              )}
              aria-label={t(b.labelKey)}
            >
              {b.icon}
              <span className={cn(compact && 'hidden sm:inline')}>{b.name}</span>
            </a>
          )
        })}
      </div>

      <p className="text-center text-[11px] text-muted-foreground">{t('authPage.socialNote')}</p>
    </div>
  )
}
