import { ShieldCheck, Lock, FileCheck, Eye } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'

const TRUST_ITEMS = [
  {
    icon: Lock,
    label: 'trust.sslLabel',
    description: 'trust.sslDesc',
  },
  {
    icon: ShieldCheck,
    label: 'trust.dataProtection',
    description: 'trust.noThirdParty',
  },
  {
    icon: FileCheck,
    label: 'trust.decree',
    description: 'trust.decreeCompliance',
  },
]

/** Compact trust bar — shows 3 trust badges in a row. */
export function TrustBar({ className }: { className?: string }) {
  const t = useT()
  return (
    <div
      className={cn('flex items-center justify-center gap-4 sm:gap-6 py-3', 'flex-wrap', className)}
      role="region"
      aria-label={t('trust.regionLabel')}
    >
      {TRUST_ITEMS.map((item) => {
        const Icon = item.icon
        return (
          <div key={item.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Icon className="h-3.5 w-3.5 text-success" />
            <span className="font-medium">{t(item.label)}</span>
            <span className="hidden sm:inline text-muted-foreground/70">
              · {t(item.description)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Privacy notice — affirms data protection + consumer rights.
 * Place near the contact-info form in the booking dialog.
 */
export function PrivacyNotice({ className }: { className?: string }) {
  const t = useT()
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-lg bg-info/5 border border-info/20 p-3',
        'text-xs text-muted-foreground',
        className,
      )}
      role="note"
      aria-label={t('trust.privacyNoteLabel')}
    >
      <ShieldCheck className="h-4 w-4 text-info shrink-0 mt-0.5" />
      <div className="space-y-1">
        <p className="font-semibold text-info">{t('trust.privacyTitle')}</p>
        <p>
          {t('trust.privacyBody')}
          <strong className="text-foreground"> {t('trust.privacyNoShare')}</strong> —
          {` ${t('trust.privacyDecree')}`}
        </p>
        <p className="text-muted-foreground/80">{t('trust.privacyRights')}</p>
      </div>
    </div>
  )
}

/**
 * Payment trust badges — small row of trust indicators near the
 * "Pay now" button in the payment dialog.
 */
export function PaymentTrustBadges({ className }: { className?: string }) {
  const t = useT()
  return (
    <div
      className={cn(
        'flex items-center justify-center gap-3 text-[10px] text-muted-foreground',
        className,
      )}
    >
      <span className="flex items-center gap-1">
        <Lock className="h-3 w-3" /> {t('trust.sslEncryption')}
      </span>
      <span className="text-border">•</span>
      <span className="flex items-center gap-1">
        <ShieldCheck className="h-3 w-3" /> PCI DSS
      </span>
      <span className="text-border">•</span>
      <span className="flex items-center gap-1">
        <Eye className="h-3 w-3" /> {t('trust.refund24h')}
      </span>
    </div>
  )
}
