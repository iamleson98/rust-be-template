'use client'

/**
 * SocialAuthButtons — renders the three social-auth buttons (Facebook,
 * Google, X/Twitter) that link to the backend OAuth start routes.
 *
 * The buttons are pure anchor tags — they navigate to
 * `/api/auth/oauth/<provider>/start` which issues a 302 to the
 * provider's authorization URL. The backend handles the entire flow.
 *
 * All three buttons are rendered unconditionally; if a provider isn't
 * configured on the backend, the start route returns 404 and the user
 * sees a friendly error. (We don't query the backend's enabled-state
 * to avoid an extra round-trip on page load.)
 *
 * After a successful OAuth flow, the backend redirects to the frontend
 * URL with auth cookies set. If there's an error, the redirect
 * includes `?oauth_error=<message>` which the login page surfaces via
 * a toast.
 */

import { useEffect } from 'react'
import { toast } from 'sonner'

const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') || ''

export function SocialAuthButtons() {
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

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 py-1">
        <div className="flex-1 h-px bg-slate-200" />
        <span className="text-[11px] text-slate-400 uppercase tracking-wider">
          hoặc
        </span>
        <div className="flex-1 h-px bg-slate-200" />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <a
          href={`${API_BASE}/api/auth/oauth/facebook/start`}
          className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs font-semibold transition-colors"
          aria-label="Đăng nhập bằng Facebook"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
            <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
          </svg>
          <span className="hidden sm:inline">Facebook</span>
        </a>

        <a
          href={`${API_BASE}/api/auth/oauth/google/start`}
          className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold border border-slate-200 transition-colors"
          aria-label="Đăng nhập bằng Google"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          <span className="hidden sm:inline">Google</span>
        </a>

        <a
          href={`${API_BASE}/api/auth/oauth/twitter/start`}
          className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-black hover:bg-slate-900 text-white text-xs font-semibold transition-colors"
          aria-label="Đăng nhập bằng X"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current" aria-hidden="true">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
          <span className="hidden sm:inline">X</span>
        </a>
      </div>

      <p className="text-[11px] text-slate-400 text-center">
        Đăng nhập nhanh — không cần mật khẩu
      </p>
    </div>
  )
}
