import { Loader2, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useT } from '@/lib/i18n'

/** The backend's abuse guard enforces the same limit; this is the first line of defence. */
export const MAX_MESSAGE_CHARS = 500

/** Counter appears this many characters before the limit. */
const COUNTER_FROM = MAX_MESSAGE_CHARS - 50

const QUICK_ACTIONS = [
  { label: 'chatWidget.qaBookTicket', message: 'Xin chào, tôi muốn đặt vé xe' },
  { label: 'chatWidget.qaChangeRefund', message: 'Tôi cần đổi hoặc hoàn vé' },
  { label: 'chatWidget.qaCheckTrip', message: 'Tôi muốn kiểm tra tình trạng chuyến' },
  { label: 'chatWidget.qaComplaint', message: 'Tôi cần khiếu nại về dịch vụ' },
]

type Props = {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  sending: boolean
  /** Offer canned first messages. */
  showQuickActions: boolean
  onQuickAction: (message: string) => void
}

/** Message box with quick-start chips and a length guard; touch targets and font size suit phones. */
export function ChatInput({
  value,
  onChange,
  onSend,
  sending,
  showQuickActions,
  onQuickAction,
}: Props) {
  const t = useT()
  // Count code points, not UTF-16 units: accented Vietnamese would otherwise read too long.
  const length = Array.from(value).length
  const overLimit = length > MAX_MESSAGE_CHARS

  return (
    <>
      {showQuickActions && (
        <div className="border-t bg-background px-3 py-2">
          <div className="text-[10px] text-muted-foreground mb-1.5 font-medium">
            {t('chat.quickActions')}
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5" style={{ scrollbarWidth: 'none' }}>
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.label}
                onClick={() => onQuickAction(action.message)}
                className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full border bg-background px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:border-primary/40 hover:bg-primary/5"
              >
                {t(action.label)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div
        className="flex shrink-0 items-center gap-2 border-t bg-background px-2.5 pt-2"
        style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom, 0px))' }}
      >
        <div className="flex-1 relative">
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                if (!overLimit) onSend()
              }
            }}
            placeholder={t('chat.inputPlaceholder')}
            // 16px stops iOS Safari zooming on focus.
            className="h-11 flex-1 rounded-full bg-muted/50 px-4 text-base md:text-sm"
            // Past the limit so a long paste is visible (counter turns red) rather than silently cut.
            maxLength={MAX_MESSAGE_CHARS + 200}
            autoComplete="off"
            autoCorrect="off"
            enterKeyHint="send"
            aria-invalid={overLimit}
          />
          {length >= COUNTER_FROM && (
            <div
              className={`absolute -bottom-4 right-1 text-[10px] tabular-nums ${
                overLimit ? 'text-red-500 font-medium' : 'text-muted-foreground'
              }`}
              aria-live="polite"
            >
              {length}/{MAX_MESSAGE_CHARS}
              {overLimit && ' — ' + t('chatWidget.overLimit')}
            </div>
          )}
        </div>
        <Button
          onClick={onSend}
          disabled={!value.trim() || sending || overLimit}
          size="icon"
          // 44px: Apple's minimum touch target.
          className="size-11 shrink-0 rounded-full"
          aria-label={t('chatWidget.sendMessage')}
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
      {overLimit && (
        <div className="px-3 pb-1 text-[11px] text-red-500">
          {t('chat.messageTooLong', { n: length, m: MAX_MESSAGE_CHARS })}
        </div>
      )}
    </>
  )
}
