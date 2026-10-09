import { ArrowLeft, CircleCheck, Headset, Minus, Phone, WifiOff, X } from 'lucide-react'
import { useT } from '@/lib/i18n'

type Props = {
  title: string
  connected: boolean
  /** Staff member handling the conversation, once assigned. */
  assigneeName?: string | null
  /** No staff online: the assistant answers. */
  botActive?: boolean
  /** The call surface replaces the conversation; the back button leaves it. */
  inCall?: boolean
  onCall?: () => void
  onBack: () => void
  onClose: () => void
}

function Status({
  connected,
  assigneeName,
  botActive,
}: Pick<Props, 'connected' | 'assigneeName' | 'botActive'>) {
  const t = useT()
  if (!connected) {
    return (
      <>
        <WifiOff className="h-3 w-3" /> {t('chatWidget.connecting')}
      </>
    )
  }
  const bot = !assigneeName && botActive
  return (
    <>
      <CircleCheck className={`h-3 w-3 ${bot ? 'text-violet-300' : 'text-emerald-300'} shrink-0`} />
      {assigneeName ? (
        <span className="truncate">{t('chatWidget.assigneeHelping', { name: assigneeName })}</span>
      ) : (
        <span>{bot ? t('chatWidget.aiHelping') : t('chatWidget.staffOnline')}</span>
      )}
    </>
  )
}

/** Title bar of the support panel: who is helping, connection state, call / minimise / close. */
export function ChatHeader({
  title,
  connected,
  assigneeName,
  botActive,
  inCall,
  onCall,
  onBack,
  onClose,
}: Props) {
  const t = useT()
  return (
    <div className="bg-linear-to-r from-rose-600 to-rose-700 text-white px-4 py-3 flex items-center justify-between">
      <div className="flex items-center gap-2.5 min-w-0">
        {inCall && (
          <button
            onClick={onBack}
            className="hover:bg-white/10 rounded p-1 -ml-1"
            aria-label={t('common.back')}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <div className="h-9 w-9 rounded-full bg-white/20 flex items-center justify-center shrink-0 relative">
          <Headset className="h-5 w-5" />
          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-400 ring-2 ring-rose-600 animate-pulse" />
        </div>
        <div className="min-w-0">
          <div className="font-bold text-sm truncate">{title}</div>
          <div className="text-[11px] text-rose-100 flex items-center gap-1 truncate">
            <Status connected={connected} assigneeName={assigneeName} botActive={botActive} />
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1">
        {onCall && (
          <button
            type="button"
            onClick={onCall}
            className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
            aria-label={t('chatWidget.callSupport')}
            title={t('chatWidget.callSupport')}
          >
            <Phone className="h-4 w-4" />
          </button>
        )}
        <button
          onClick={onClose}
          className="hover:bg-white/10 rounded p-1.5"
          aria-label={t('chatWidget.minimize')}
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          onClick={onClose}
          className="hover:bg-white/10 rounded p-1.5"
          aria-label={t('common.close')}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
