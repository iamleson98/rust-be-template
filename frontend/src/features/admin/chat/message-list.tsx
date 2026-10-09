import { ScrollArea } from '@/components/ui/scroll-area'
import { dayBreak } from '@/features/chat/format'
import { TypingDots } from '@/features/chat/typing-dots'
import { useMessageScroll } from '@/features/chat/use-message-scroll'
import { useT } from '@/lib/i18n'
import { PANES_HEIGHT } from './layout'
import { MessageRow } from './message-row'
import type { AdminChat } from './use-admin-chat'

const Pill = ({ children }: { children: string }) => (
  <div className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs text-muted-foreground">
    <span className="h-3 w-3 rounded-full border-2 border-slate-300 border-t-slate-600 animate-spin" />
    {children}
  </div>
)

type Props = {
  conversation: AdminChat['conversation']
  onViewTicket?: (bookingCode: string) => void
}

/**
 * The open conversation. From `xl` it fills the space between header and composer
 * of a card with a definite height; stacked, it takes a fixed height.
 */
export function MessageList({ conversation: c, onViewTicket }: Props) {
  const t = useT()
  const scrollRef = useMessageScroll({
    messages: c.messages,
    trailing: c.typingUser,
    hasMore: c.hasMore,
    loadingMore: c.loadingMore,
    onLoadMore: c.loadMore,
  })

  return (
    <ScrollArea
      viewportRef={scrollRef}
      className={`${PANES_HEIGHT} xl:h-auto xl:flex-1 xl:min-h-0 p-4`}
    >
      <div className="space-y-2.5">
        {c.loadingMore && (
          <div className="flex items-center justify-center py-3">
            <Pill>{t('chat.loadingMore')}</Pill>
          </div>
        )}
        {!c.loadingMore && c.hasMore && (
          <div className="flex items-center justify-center py-2">
            <button
              onClick={c.loadMore}
              className="text-[11px] text-blue-600 hover:text-blue-700 hover:underline"
            >
              {t('chat.loadMore')}
            </button>
          </div>
        )}
        {c.messages.map((message, i) => (
          <MessageRow
            key={message.id}
            message={message}
            dayLabel={dayBreak(c.messages[i - 1]?.createdAt, message.createdAt, t)}
            isLast={i === c.messages.length - 1}
            onViewTicket={onViewTicket}
          />
        ))}
        {c.loading && (
          <div className="flex items-center justify-center py-10">
            <Pill>{t('adminChat.loadingMessages')}</Pill>
          </div>
        )}
        {!c.loading && c.messages.length === 0 && (
          <div className="py-10 text-center text-xs text-muted-foreground">
            {t('adminChat.noMessages')}
          </div>
        )}
      </div>

      {c.typingUser && (
        <div className="flex justify-start pb-2 px-1 mt-2">
          <TypingDots />
        </div>
      )}
    </ScrollArea>
  )
}
