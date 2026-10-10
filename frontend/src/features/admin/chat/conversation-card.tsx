import { Headset } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { useT } from '@/lib/i18n'
import { ConversationHeader } from './conversation-header'
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
    <Card className="flex h-full min-h-0 flex-col gap-0 overflow-hidden py-0">
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
            onBack={chat.back}
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
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="text-center">
            <div className="mb-4 inline-flex size-14 items-center justify-center rounded-full bg-muted">
              <Headset className="size-7 text-muted-foreground" />
            </div>
            <h3 className="font-semibold text-sm">{t('chat.selectChannel')}</h3>
            <p className="text-xs text-muted-foreground mt-1">{t('chat.selectChannelDesc')}</p>
          </div>
        </div>
      )}
    </Card>
  )
}
