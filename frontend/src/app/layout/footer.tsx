import { memo, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { Headphones, Mail, MessageCircle, ShieldCheck } from 'lucide-react'
import { routesOptions } from '@/api'
import { useT } from '@/lib/i18n'
import { useEnabledProviders, type PaymentProvider } from '@/lib/payment'
import { buildSearchInput, vnDate } from '@/lib/search-params'
import { useSession } from '@/stores/session'
import { useUi } from '@/stores/ui'

const PROVIDER_LABEL: Record<PaymentProvider, string> = {
  momo: 'payment.momo',
  vnpay: 'payment.vnpay',
  zalopay: 'payment.zalopay',
  vietqr: 'payment.vietqr',
  cod: 'bookingFlow.cash',
}

const LINK = 'text-slate-600 transition-colors hover:text-primary'

function Column({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold text-slate-900">{title}</h3>
      <ul className="space-y-2.5 text-sm">{children}</ul>
    </div>
  )
}

/**
 * Site footer: the routes people can actually book, how to reach support,
 * the policies, and the payment methods this deployment takes — all real.
 */
export const Footer = memo(function Footer() {
  const setChatOpen = useUi((s) => s.setChatOpen)
  const user = useSession((s) => s.user)
  const navigate = useNavigate()
  const t = useT()
  const providers = useEnabledProviders()
  const { data } = useQuery(routesOptions())

  // The first few distinct corridors on the platform (a route per brand can repeat a pair).
  const routes = useMemo(() => {
    const seen = new Set<string>()
    return (data?.items ?? [])
      .filter((r) => {
        const key = `${r.from.name}→${r.to.name}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, 5)
  }, [data])

  const search = (from: string, to: string) => {
    navigate({ to: '/search', search: buildSearchInput({ from, to, date: vnDate(1) }) })
  }

  return (
    <footer className="mt-auto border-t border-slate-200 bg-white">
      <div className="page-x py-12 md:py-14">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-12">
          <div className="col-span-2 sm:col-span-3 lg:col-span-4">
            <Link to="/" className="inline-flex items-center gap-2.5">
              <img src="/logo.svg" alt="" aria-hidden className="size-9 shrink-0" />
              <span className="text-lg font-extrabold tracking-tight text-slate-900">DatXeVui</span>
            </Link>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-slate-600">
              {t('layout.footer.brandIntro')}
            </p>
            <a
              href="tel:19006067"
              className="mt-5 inline-flex items-center gap-3 rounded-2xl bg-slate-50 py-2.5 pr-4 pl-2.5 ring-1 ring-slate-200 transition-colors hover:bg-slate-100"
            >
              <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary">
                <Headphones className="size-4.5" />
              </span>
              <span className="leading-tight">
                <span className="block text-[11px] text-slate-500">{t('footer.hotline')}</span>
                <span className="block text-base font-bold text-slate-900 tabular-nums">
                  1900 6067
                </span>
              </span>
            </a>
          </div>

          {routes.length > 0 && (
            <div className="lg:col-span-3">
              <Column title={t('search.popularRoutes')}>
                {routes.map((r) => (
                  <li key={r.id}>
                    <button
                      onClick={() => search(r.from.name, r.to.name)}
                      className={`${LINK} text-left`}
                    >
                      {r.from.name} → {r.to.name}
                    </button>
                  </li>
                ))}
              </Column>
            </div>
          )}

          <div className="min-w-0 lg:col-span-2">
            <Column title={t('nav.support')}>
              <li>
                <button
                  onClick={() => (user ? setChatOpen(true) : navigate({ to: '/login' }))}
                  className={`${LINK} inline-flex items-center gap-1.5 text-left`}
                >
                  <MessageCircle className="size-3.5" /> {t('home.trustChat')}
                </button>
              </li>
              <li>
                <a
                  href="mailto:cskh@datxevui.com"
                  className={`${LINK} inline-flex max-w-full items-center gap-1.5`}
                >
                  <Mail className="size-3.5 shrink-0" />
                  <span className="truncate">cskh@datxevui.com</span>
                </a>
              </li>
            </Column>
          </div>

          <div className="lg:col-span-3">
            <Column title={t('layout.footer.policies')}>
              <li>
                <Link to="/terms" className={LINK}>
                  {t('layout.footer.termsOfUse')}
                </Link>
              </li>
              <li>
                <Link to="/terms" hash="cancellation" className={LINK}>
                  {t('cancel.refundPolicy')}
                </Link>
              </li>
              <li>
                <Link to="/privacy" className={LINK}>
                  {t('layout.footer.privacyPolicy')}
                </Link>
              </li>
              <li>
                <Link to="/privacy" hash="data-deletion" className={LINK}>
                  {t('layout.footer.dataDeletion')}
                </Link>
              </li>
            </Column>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-4 border-t border-slate-200 pt-6 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1 text-xs text-slate-500">
            <div>{t('layout.footer.copyright', { year: new Date().getFullYear() })}</div>
            <div>{t('layout.footer.registration')}</div>
          </div>
          {providers && providers.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                <ShieldCheck className="size-3.5 text-emerald-600" />
                {t('layout.footer.payWith')}
              </span>
              {providers.map((p) => (
                <span
                  key={p}
                  className="rounded-lg bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200"
                >
                  {t(PROVIDER_LABEL[p] ?? p)}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </footer>
  )
})
