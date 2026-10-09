import { MessageCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useT } from '@/lib/i18n'

/** First visit: no conversation yet, one button to start. */
export function ChatEmpty({ onStart, starting }: { onStart: () => void; starting: boolean }) {
  const t = useT()
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="p-3 border-b">
        <Button
          onClick={onStart}
          disabled={starting}
          className="w-full gap-2 bg-linear-to-r from-rose-600 to-rose-700 hover:from-rose-700 hover:to-rose-800"
        >
          <MessageCircle className="h-4 w-4" />
          {t('chatWidget.startNewChat')}
        </Button>
      </div>
      <div className="text-center py-12 px-6">
        <div className="inline-flex h-14 w-14 rounded-full bg-rose-50 items-center justify-center mb-3">
          <MessageCircle className="h-7 w-7 text-rose-600" />
        </div>
        <h4 className="font-semibold text-sm">{t('chat.noChannels')}</h4>
        <p className="text-xs text-muted-foreground mt-1">{t('chatWidget.noChannelsHint')}</p>
      </div>
    </div>
  )
}
