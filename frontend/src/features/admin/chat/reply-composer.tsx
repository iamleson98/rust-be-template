import { Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useT } from '@/lib/i18n'

const QUICK_REPLIES = [
  'adminChat.quickReplyGreeting',
  'adminChat.quickReplyBookingCode',
  'adminChat.quickReplyConfirmed',
  'adminChat.quickReplyChecking',
]

const PREVIEW_CHARS = 30

type Props = {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  sending: boolean
}

/** Canned replies (they fill the box, the agent still sends) and the message input. */
export function ReplyComposer({ value, onChange, onSend, sending }: Props) {
  const t = useT()
  return (
    <div className="shrink-0 border-t bg-background px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-4">
      <div className="flex gap-1.5 mb-2 overflow-x-auto pb-1">
        {QUICK_REPLIES.map((key) => {
          const text = t(key)
          return (
            <button
              key={key}
              onClick={() => onChange(text)}
              className="shrink-0 rounded-full border bg-background px-2.5 py-1 text-[11px] transition-colors hover:border-primary/40 hover:bg-primary/5"
            >
              {text.length > PREVIEW_CHARS ? text.slice(0, PREVIEW_CHARS) + '…' : text}
            </button>
          )
        })}
      </div>
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              onSend()
            }
          }}
          placeholder={t('adminChat.replyPlaceholder')}
          className="flex-1"
        />
        <Button
          onClick={onSend}
          disabled={!value.trim() || sending}
          size="icon"
          className="shrink-0"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
