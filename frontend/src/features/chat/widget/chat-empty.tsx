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
          variant="destructive"
          className="w-full gap-2"
        >
          <MessageCircle className="h-4 w-4" />
          {t('chatWidget.startNewChat')}
        </Button>
      </div>
      <div className="text-center py-12 px-6">
        <div className="mb-3 inline-flex size-14 items-center justify-center rounded-full bg-primary/10">
          <MessageCircle className="size-7 text-primary" />
        </div>
        <h4 className="font-semibold text-sm">{t('chat.noChannels')}</h4>
        <p className="text-xs text-muted-foreground mt-1">{t('chatWidget.noChannelsHint')}</p>
      </div>
    </div>
  )
}
