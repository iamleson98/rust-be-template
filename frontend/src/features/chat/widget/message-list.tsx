import { CheckCheck, ChevronUp, Loader2, Sparkles } from 'lucide-react'
import type { RefObject } from 'react'
import type { ChatMessageOut } from '@/api'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { messageTime } from '../format'
import { TypingDots } from '../typing-dots'

const BUBBLE = {
  user: 'bg-rose-600 text-white rounded-br-sm',
  system: 'bg-amber-50 text-amber-800 text-center text-xs border border-amber-100',
  assistant: 'bg-violet-50 border border-violet-200 text-slate-800 rounded-bl-sm',
  other: 'bg-white border rounded-bl-sm',
}

function Bubble({ message, startsRun }: { message: ChatMessageOut; startsRun: boolean }) {
  const mine = message.senderType === 'user'
  const system = message.senderType === 'system'
  const assistant = message.senderType === 'assistant'
  const kind = mine ? 'user' : system ? 'system' : assistant ? 'assistant' : 'other'

  return (
    <div
      className={cn(
        'flex animate-in fade-in slide-in-from-bottom-1 duration-200',
        mine ? 'justify-end' : 'justify-start',
      )}
    >
      <div className={cn('max-w-[78%]', system && 'mx-auto')}>
        {assistant && startsRun && (
          <div className="text-[10px] text-muted-foreground mb-0.5 px-1 flex items-center gap-1">
            <Sparkles className="h-2.5 w-2.5 text-violet-500" />
          </div>
        )}
        <div className={cn('rounded-2xl px-3 py-2 text-sm wrap-break-word', BUBBLE[kind])}>
          {message.content}
        </div>
        {mine && (
          <div className="text-[10px] text-muted-foreground mt-0.5 px-1 text-right flex items-center justify-end gap-0.5">
            <CheckCheck className="h-2.5 w-2.5 text-rose-500" />
            {messageTime(message.createdAt)}
          </div>
        )}
      </div>
    </div>
  )
}

type Props = {
  scrollRef: RefObject<HTMLDivElement | null>
  messages: ChatMessageOut[]
  loading: boolean
  peerTyping: boolean
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
}

/** The conversation: oldest first, own messages on the right, load-more at the top. */
export function MessageList({ scrollRef, messages, loading, peerTyping, hasMore, loadingMore, onLoadMore }: Props) {
  const t = useT()
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-3 space-y-2 bg-linear-to-b from-slate-50 to-white max-h-120"
      >
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="text-center py-2">
              <span className="inline-block rounded-full bg-emerald-50 px-3 py-1 text-[10px] text-emerald-700 ring-1 ring-emerald-200">
                <Sparkles className="inline h-2.5 w-2.5 mr-1" />
                {t('chatWidget.agentAlwaysReady')}
              </span>
            </div>

            {loadingMore && (
              <div className="flex items-center justify-center py-3">
                <div className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-[11px] text-muted-foreground">
                  <span className="h-3 w-3 rounded-full border-2 border-slate-300 border-t-slate-600 animate-spin" />
                  {t('chat.loadingMore')}
                </div>
              </div>
            )}
            {!loadingMore && hasMore && (
              <div className="flex items-center justify-center py-2">
                <button
                  onClick={onLoadMore}
                  className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700 hover:underline"
                >
                  <ChevronUp className="h-3 w-3" />
                  {t('chat.loadMore')}
                </button>
              </div>
            )}

            {messages.map((message, i) => (
              <Bubble
                key={message.id}
                message={message}
                startsRun={messages[i - 1]?.senderType !== message.senderType}
              />
            ))}
            {peerTyping && (
              <div className="flex justify-start">
                <TypingDots />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
