/**
 * Shared types + helpers for the ChatWidget module.
 *
 * Extracted from the original `chat-widget.tsx` so the header, list,
 * conversation, input and auth sub-components can share the same
 * `Channel`, `Message` and `View` types without re-declaring them.
 */

export type Channel = {
  id: string
  topic: string
  status: string
  brand?: { name: string | null; accentColor: string | null } | null
  lastMessageAt: string | null
  lastMessagePreview: string | null
  unreadUser: number
  assignments?: { employee: { id: string; name: string; avatarUrl: string | null } }[]
}

export type Message = {
  id: string
  channelId: string
  senderType: string
  senderId: string
  senderName: string | null
  content: string
  kind: string
  createdAt: string
  /** Optional client-side correlation id used to dedup optimistic messages. */
  clientMsgId?: string
}

export type View = 'list' | 'conversation' | 'auth' | 'login-required'

/**
 * Normalize a raw WS message from the Rust backend into our local `Message`
 * shape. The backend broadcasts `{ type: "message", id, channelId,
 * senderType, senderId, senderName, text, createdAt }` — the field is
 * `text`, but our local shape uses `content` for historical reasons.
 */
export function normalizeWsMessage(raw: Record<string, unknown>): Message {
  return {
    id: String(raw.id ?? ''),
    channelId: String(raw.channelId ?? ''),
    senderType: String(raw.senderType ?? ''),
    senderId: String(raw.senderId ?? ''),
    senderName: (raw.senderName as string | null) ?? null,
    content: String(raw.content ?? raw.text ?? ''),
    kind: String(raw.kind ?? 'text'),
    createdAt: String(raw.createdAt ?? ''),
    clientMsgId: raw.clientMsgId as string | undefined,
  }
}

export const QUICK_ACTIONS = [
  { label: 'Đặt vé xe', message: 'Xin chào, tôi muốn đặt vé xe' },
  { label: 'Đổi/hoàn vé', message: 'Tôi cần đổi hoặc hoàn vé' },
  { label: 'Kiểm tra chuyến', message: 'Tôi muốn kiểm tra tình trạng chuyến' },
  { label: 'Khiếu nại', message: 'Tôi cần khiếu nại về dịch vụ' },
] as const
