'use client'

/**
 * ChatConversation — the conversation view of the customer-facing chat
 * widget.
 *
 * Extracted from the original `chat-widget.tsx`. Renders:
 *   - A "secured conversation" header pill
 *   - The waiting-for-agent banner (when no employee is online)
 *   - The agent-joined banner (when an employee has joined the channel)
 *   - The message list (bubbles aligned by sender, with read receipts)
 *   - The typing indicator
 *
 * The view does NOT own the input bar — that's `<ChatInput />` so the
 * parent can decide when to show the quick-action chips (only on the
 * first message). The parent passes `scrollRef` so it can auto-scroll
 * on new messages.
 */

import type React from 'react'
import { Loader2, Check, CheckCheck, Users, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Message } from './_shared'

export function ChatConversation({
  scrollRef,
  loadingMessages,
  messages,
  typing,
  waitingForAgent,
  agentJoinedName,
  employeesOnline,
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>
  loadingMessages: boolean
  messages: Message[]
  typing: { name: string } | null
  waitingForAgent: boolean
  agentJoinedName: string | null
  employeesOnline: number
}) {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-3 space-y-2 bg-linear-to-b from-slate-50 to-white max-h-120"
      >
        {loadingMessages ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="text-center py-2">
              <span className="inline-block rounded-full bg-emerald-50 px-3 py-1 text-[10px] text-emerald-700 ring-1 ring-emerald-200">
                <Sparkles className="inline h-2.5 w-2.5 mr-1" />
                Trợ lý AI luôn sẵn sàng • Phản hồi tức thì
              </span>
            </div>

            {/* Waiting-for-agent banner — kept for legacy compatibility,
                but the always-on ZeroClaw local provider means a real
                human is no longer required to acknowledge a message.
                The banner is now informational only. */}
            {waitingForAgent && (
              <div className="flex justify-center py-2">
                <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 border border-amber-200 px-3 py-1.5 text-xs text-amber-800">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>Đang chuyển tới nhân viên hỗ trợ...</span>
                </div>
              </div>
            )}

            {/* Agent joined banner */}
            {!waitingForAgent && agentJoinedName && employeesOnline > 0 && (
              <div className="flex justify-center py-2">
                <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 border border-blue-200 px-3 py-1.5 text-xs text-blue-800">
                  <Users className="h-3 w-3" />
                  <span>
                    Nhân viên <strong>{agentJoinedName}</strong> đã tham gia
                  </span>
                </div>
              </div>
            )}

            {messages.map((m, i) => {
              const isMe = m.senderType === 'user'
              const isSystem = m.senderType === 'system'
              const isAssistant = m.senderType === 'assistant'
              const showName =
                !isMe && !isSystem && (i === 0 || messages[i - 1].senderType !== m.senderType)
              return (
                <div key={m.id} className={cn('flex', isMe ? 'justify-end' : 'justify-start')}>
                  <div className={cn('max-w-[78%]', isSystem && 'mx-auto')}>
                    {showName && (
                      <div className="text-[10px] text-muted-foreground mb-0.5 px-1 flex items-center gap-1">
                        {isAssistant && <Sparkles className="h-2.5 w-2.5 text-violet-500" />}
                        {m.senderName}
                      </div>
                    )}
                    <div
                      className={cn(
                        'rounded-2xl px-3 py-2 text-sm wrap-break-word',
                        isSystem
                          ? 'bg-amber-50 text-amber-800 text-center text-xs border border-amber-100'
                          : isMe
                            ? 'bg-rose-600 text-white rounded-br-sm'
                            : isAssistant
                              ? 'bg-violet-50 border border-violet-200 text-slate-800 rounded-bl-sm'
                              : 'bg-white border rounded-bl-sm',
                      )}
                    >
                      {m.content}
                    </div>
                    {isMe && (
                      <div className="text-[9px] text-muted-foreground mt-0.5 px-1 text-right flex items-center justify-end gap-0.5">
                        {m.id.startsWith('tmp-') ? (
                          <Check className="h-2.5 w-2.5" />
                        ) : (
                          <CheckCheck className="h-2.5 w-2.5 text-rose-500" />
                        )}
                        {new Date(m.createdAt).toLocaleTimeString('vi-VN', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
            {typing && (
              <div className="flex justify-start">
                <div className="bg-white border rounded-2xl rounded-bl-sm px-3 py-2.5">
                  <div className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-slate-400" style={{ animationDelay: '0ms' }} />
                    <span className="h-1.5 w-1.5 rounded-full bg-slate-400" style={{ animationDelay: '150ms' }} />
                    <span className="h-1.5 w-1.5 rounded-full bg-slate-400" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
