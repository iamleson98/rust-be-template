import { Banknote, Landmark, QrCode, Smartphone, Wallet, type LucideIcon } from 'lucide-react'
import type { PaymentProvider } from '@/lib/payment'
import { cn } from '@/lib/utils'

/** Each provider's icon on a brand-adjacent tile (emoji would render differently per platform). */
const TILES: Record<PaymentProvider, { Icon: LucideIcon; tile: string }> = {
  momo: { Icon: Smartphone, tile: 'bg-fuchsia-100 text-fuchsia-600 ring-fuchsia-200' },
  vnpay: { Icon: QrCode, tile: 'bg-blue-100 text-blue-600 ring-blue-200' },
  zalopay: { Icon: Wallet, tile: 'bg-sky-100 text-sky-600 ring-sky-200' },
  vietqr: { Icon: Landmark, tile: 'bg-indigo-100 text-indigo-600 ring-indigo-200' },
  cod: { Icon: Banknote, tile: 'bg-emerald-100 text-emerald-600 ring-emerald-200' },
}

export function ProviderTile({
  provider,
  className,
}: {
  provider: PaymentProvider
  className?: string
}) {
  const { Icon, tile } = TILES[provider]
  return (
    <span
      className={cn(
        'h-10 w-10 shrink-0 rounded-lg ring-1 flex items-center justify-center',
        tile,
        className,
      )}
    >
      <Icon className="h-5 w-5" />
    </span>
  )
}
