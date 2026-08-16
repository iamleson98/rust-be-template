/** Admin route — `/admin/chat` — chat support management page. */
import { useCallback, useEffect, useState } from 'react'
import { ChatPanel } from '@/components/admin/chat/chat-panel'
import type { Channel, ChatMessage } from '@/components/admin/dashboard/types'
import { toast } from 'sonner'

export function AdminChatPage() {
  const [channels, setChannels] = useState<Channel[]>([])
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    fetch('/api/chat/channels?limit=50', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setChannels(d.items ?? []))
      .catch(() => {})
  }, [])

  const openChatWorkspace = useCallback(async (channel: Channel) => {
    setActiveChannel(channel)
    try {
      const res = await fetch(`/api/chat/channels/${channel.id}/messages?limit=50`, { credentials: 'include' })
      const data = await res.json()
      setChatMessages((data.items ?? []) as ChatMessage[])
    } catch {
      setChatMessages([])
    }
  }, [])

  const sendReply = useCallback(async () => {
    if (!replyText.trim() || !activeChannel) return
    setSending(true)
    try {
      const res = await fetch(`/api/chat/channels/${activeChannel.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ content: replyText.trim(), kind: 'text' }),
      })
      const data = await res.json()
      if (data.message) {
        setChatMessages((prev) => [...prev, data.message as ChatMessage])
        setReplyText('')
        toast.success('Đã gửi phản hồi')
      }
    } catch {
      toast.error('Không thể gửi tin nhắn')
    } finally {
      setSending(false)
    }
  }, [replyText, activeChannel])

  const blockChannel = useCallback((channelId: string) => {
    toast.success('Đã chặn cuộc trò chuyện')
    setChannels((prev) => prev.map((c) => (c.id === channelId ? { ...c, status: 'blocked' } : c)))
    if (activeChannel?.id === channelId) setActiveChannel(null)
  }, [activeChannel])

  const sendTicketCard = useCallback(async (payload: { bookingCode: string }) => {
    if (!activeChannel) return
    const attachments = JSON.stringify(payload)
    try {
      const res = await fetch(`/api/chat/channels/${activeChannel.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ content: `Đã đặt vé ${payload.bookingCode}`, kind: 'ticket', attachments }),
      })
      const data = await res.json()
      if (data.message) {
        setChatMessages((prev) => [...prev, data.message as ChatMessage])
      }
    } catch {
      // Silently fail
    }
  }, [activeChannel])

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="container mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold mb-4">Chat hỗ trợ</h1>
        <ChatPanel
          channels={channels}
          activeChannel={activeChannel}
          chatMessages={chatMessages}
          replyText={replyText}
          sending={sending}
          onOpenChannel={openChatWorkspace}
          onSendReply={sendReply}
          onBlockChannel={blockChannel}
          onSetReplyText={setReplyText}
          onSendTicketCard={sendTicketCard}
        />
      </div>
    </div>
  )
}
