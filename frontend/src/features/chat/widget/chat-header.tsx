import { ArrowLeft, Headset, Phone, WifiOff, X } from 'lucide-react'
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
      {assigneeName ? (
        <span className="truncate">{t('chatWidget.assigneeHelping', { name: assigneeName })}</span>
      ) : (
        <span>{bot ? t('chatWidget.aiHelping') : t('chatWidget.staffOnline')}</span>
      )}
    </>
  )
}

/** Title bar of the support panel: back, who is helping and whether they are online, call, close. */
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
    <div className="flex shrink-0 items-center gap-1 border-b bg-background px-2 pt-[env(safe-area-inset-top)] sm:px-3">
      {/* Phones: back closes the chat (or leaves the call), like any chat app. */}
      <button
        type="button"
        onClick={inCall ? onBack : onClose}
        className={`grid size-10 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted ${inCall ? '' : 'sm:hidden'}`}
        aria-label={inCall ? t('common.back') : t('common.close')}
      >
        <ArrowLeft className="size-5" />
      </button>
      <div className="flex min-w-0 flex-1 items-center gap-2.5 py-2.5">
        <div className="relative grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
          <Headset className="size-5" />
          {connected && (
            <span className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full bg-emerald-500 ring-2 ring-background" />
          )}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{title}</div>
          <div className="flex items-center gap-1 truncate text-xs text-muted-foreground">
            <Status connected={connected} assigneeName={assigneeName} botActive={botActive} />
          </div>
        </div>
      </div>
      {onCall && (
        <button
          type="button"
          onClick={onCall}
          className="grid size-10 shrink-0 place-items-center rounded-full text-primary hover:bg-primary/10"
          aria-label={t('chatWidget.callSupport')}
          title={t('chatWidget.callSupport')}
        >
          <Phone className="size-5" />
        </button>
      )}
      <button
        type="button"
        onClick={onClose}
        className="hidden size-10 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted sm:grid"
        aria-label={t('common.close')}
      >
        <X className="size-5" />
      </button>
    </div>
  )
}
