import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  chatMarkReadMutation,
  createChannelMutation,
  listChannelsOptions,
  type ChatChannelOut,
} from '@/api'
import { useAuthMe } from '@/features/auth/api'
import { useDialogFocus } from '@/hooks/use-dialog-focus'
import { getErrorMessage } from '@/lib/error-message'
import { tSync, useT } from '@/lib/i18n'
import { stopTitleNotification } from '@/lib/title-notifier'
import { isStaffUser, useSession } from '@/stores/session'
import { useUi } from '@/stores/ui'
import { ChatEmpty } from './chat-empty'
import { ChatHeader } from './chat-header'
import { Conversation } from './conversation'
import { useCustomerRoom } from './use-customer-room'

const NEW_CHAT_TOPIC = 'Hỗ trợ đặt vé'

/** The signed-in customer; closes the panel with a toast if the server rejects the session. */
function useChatUser(onFailed: () => void) {
  const storeUser = useSession((s) => s.user)
  const me = useAuthMe()
  const failed = !!me.error

  useEffect(() => {
    if (!failed) return
    toast.error(tSync('chat.authCheckFailed'))
    onFailed()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per failure
  }, [failed])

  return { user: failed ? null : (me.data?.user ?? storeUser), checking: me.isLoading }
}

function SupportPanel() {
  const t = useT()
  const callOpen = useUi((s) => s.callOpen)
  const setCallOpen = useUi((s) => s.setCallOpen)
  const setChatOpen = useUi((s) => s.setChatOpen)
  const panelRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState('')
  const [started, setStarted] = useState<ChatChannelOut | null>(null)

  const close = () => {
    setCallOpen(false)
    setChatOpen(false)
  }
  useDialogFocus(panelRef, close)
  const { user, checking } = useChatUser(close)

  // Resume the latest conversation (newest activity first) unless one was just started.
  const channels = useQuery({ ...listChannelsOptions({ query: { limit: 50 } }), enabled: !!user })
  const channel = started ?? channels.data?.items[0] ?? null
  const channelId = channel?.id

  const room = useCustomerRoom({ userId: user?.id, channelId, onBanned: () => setDraft('') })
  const createChannel = useMutation({
    ...createChannelMutation(),
    onSuccess: (data) => setStarted(data.channel),
    onError: (error) => toast.error(getErrorMessage(error, t('chatWidget.createChannelError'))),
  })

  const { mutate: markRead } = useMutation(chatMarkReadMutation())
  useEffect(() => {
    if (!channelId) return
    stopTitleNotification()
    markRead({ path: { id: channelId } })
  }, [channelId, markRead])

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={t('chatWidget.supportTitle')}
      className="fixed inset-0 z-50 flex h-dvh flex-col overflow-hidden bg-background animate-in slide-in-from-bottom-5 duration-300 sm:inset-auto sm:right-5 sm:bottom-5 sm:h-150 sm:max-h-[85dvh] sm:w-100 sm:rounded-2xl sm:border"
    >
      <ChatHeader
        title={channel?.topic || t('chatWidget.supportTitle')}
        connected={room.connected}
        assigneeName={room.assignee}
        botActive={room.botActive}
        inCall={callOpen}
        onCall={user && !callOpen ? () => setCallOpen(true) : undefined}
        onBack={() => setCallOpen(false)}
        onClose={close}
      />

      {callOpen && user ? (
        // The call widget renders its controls into this slot.
        <div id="customer-call-surface" className="flex min-h-0 flex-1 flex-col" />
      ) : checking || channels.isLoading ? (
        <div
          className="flex flex-1 items-center justify-center"
          aria-label={t('chatWidget.checkingLogin')}
        >
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : channel ? (
        <Conversation
          key={channel.id}
          channelId={channel.id}
          room={room}
          draft={draft}
          onDraftChange={setDraft}
        />
      ) : (
        <ChatEmpty
          onStart={() => createChannel.mutate({ body: { topic: NEW_CHAT_TOPIC, brandId: null } })}
          starting={createChannel.isPending}
        />
      )}
    </div>
  )
}

/** Floating support chat for customers; staff use the admin workspace instead. */
export function ChatWidget() {
  const user = useSession((s) => s.user)
  return isStaffUser(user) ? null : <SupportPanel />
}
