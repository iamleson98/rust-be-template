import { Headset } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { useT } from '@/lib/i18n'
import { ConversationHeader } from './conversation-header'
import { PANES_HEIGHT } from './layout'
import { MessageList } from './message-list'
import { ReplyComposer } from './reply-composer'
import type { AdminChat } from './use-admin-chat'

type Props = {
  chat: AdminChat
  canRelease: boolean
  onBook: () => void
  onViewTicket?: (bookingCode: string) => void
}

/** Right card: the open conversation, or a prompt to pick one. */
export function ConversationCard({ chat, canRelease, onBook, onViewTicket }: Props) {
  const t = useT()
  const { active, conversation } = chat

  return (
    <Card className="xl:col-span-3 flex flex-col xl:h-160">
      {active ? (
        <>
          <ConversationHeader
            channel={active}
            userOnline={conversation.userOnline}
            typingUser={conversation.typingUser}
            busy={chat.assignmentBusy}
            canRelease={canRelease}
            onBook={onBook}
            onClaim={chat.claim}
            onRelease={chat.release}
            onClose={chat.close}
            onBlock={chat.block}
          />
          <MessageList key={active.id} conversation={conversation} onViewTicket={onViewTicket} />
          <ReplyComposer
            value={conversation.replyText}
            onChange={conversation.setReplyText}
            onSend={conversation.sendReply}
            sending={conversation.sending}
          />
        </>
      ) : (
        <div className={`${PANES_HEIGHT} xl:h-auto xl:flex-1 flex items-center justify-center p-8`}>
          <div className="text-center">
            <div className="inline-flex h-16 w-16 rounded-full bg-slate-100 items-center justify-center mb-4">
              <Headset className="h-8 w-8 text-slate-400" />
            </div>
            <h3 className="font-semibold text-sm">{t('chat.selectChannel')}</h3>
            <p className="text-xs text-muted-foreground mt-1">{t('chat.selectChannelDesc')}</p>
          </div>
        </div>
      )}
    </Card>
  )
}
