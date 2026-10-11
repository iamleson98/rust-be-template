import { Link } from '@tanstack/react-router'
import {
  ArrowRight,
  BadgeCheck,
  Headphones,
  ReceiptText,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react'
import { useT } from '@/lib/i18n'
import { SUPPORT } from '@/lib/support'
import { HomeSection } from './section'

/**
 * What a customer can count on, stated plainly and only where the product
 * really does it: no booking fee (the server adds none), how a ticket gets
 * confirmed, where the cancellation rules are, and how to reach a person.
 */
export function TrustCommitments() {
  const t = useT()
  const items = [
    {
      icon: ReceiptText,
      title: t('trust.priceTitle'),
      body: t('trust.priceBody'),
    },
    {
      icon: BadgeCheck,
      title: t('trust.confirmTitle'),
      body: t('trust.confirmBody'),
    },
    {
      icon: RotateCcw,
      title: t('trust.cancelTitle'),
      body: t('trust.cancelBody'),
      link: (
        <Link to="/terms" hash="cancellation" className={LINK}>
          {t('trust.cancelLink')}
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      ),
    },
    {
      icon: Headphones,
      title: t('trust.supportTitle'),
      body: t('trust.supportBody', { hotline: SUPPORT.hotline, email: SUPPORT.email }),
      link: (
        <a href={SUPPORT.hotlineHref} className={LINK}>
          {t('trust.supportLink', { hotline: SUPPORT.hotline })}
          <ArrowRight className="size-3.5" aria-hidden />
        </a>
      ),
    },
  ]

  return (
    <HomeSection title={t('trust.title')} subtitle={t('trust.subtitle')}>
      <div className="rounded-3xl bg-white p-2 shadow-soft ring-1 ring-slate-200/80">
        <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((item) => (
            <li key={item.title} className="flex flex-col rounded-2xl p-4 sm:p-5">
              <span className="grid size-11 place-items-center rounded-2xl bg-primary/10 text-primary">
                <item.icon className="size-5.5" aria-hidden />
              </span>
              <h3 className="mt-4 font-semibold text-slate-900">{item.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{item.body}</p>
              {item.link && <div className="mt-auto pt-3">{item.link}</div>}
            </li>
          ))}
        </ul>
        <p className="flex items-start gap-2 rounded-2xl bg-slate-50 px-4 py-3 text-xs leading-relaxed text-slate-600 sm:items-center sm:px-5">
          <ShieldCheck className="size-4 shrink-0 text-emerald-600" aria-hidden />
          <span>
            {t('trust.privacy')}{' '}
            <Link to="/privacy" className="font-medium text-primary hover:underline">
              {t('trust.privacyLink')}
            </Link>
          </span>
        </p>
      </div>
    </HomeSection>
  )
}

const LINK =
  'inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline'
