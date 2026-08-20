'use client'

/**
 * ChatInput — the input bar of the customer-facing chat widget.
 *
 * Extracted from the original `chat-widget.tsx`. Owns:
 *   - The text input (controlled by parent's `input`/`onInputChange`)
 *   - The send button (calls `onSend()`)
 *   - Optional quick-action chips (shown on the first message in a
 *     fresh conversation via `showQuickActions && messagesCount === 0`)
 *   - Character counter + length guard (500 char max). When the input
 *     exceeds 500 chars, the send button is disabled and a small red
 *     counter appears under the input. This is the first line of defense
 *     against message-length abuse — the backend's abuse guard still
 *     runs as a safety net for clients that bypass this UI.
 *
 * Mobile-first: 44px touch target for the send button, safe-area padding
 * for iPhone home indicator, 16px input font to prevent iOS zoom-on-focus.
 */

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, Send } from 'lucide-react'
import { QUICK_ACTIONS } from './_shared'

/** Hard character limit for a single chat message. */
export const MAX_MESSAGE_CHARS = 500

export function ChatInput({
  input,
  onInputChange,
  onSend,
  sending,
  showQuickActions,
  onQuickAction,
}: {
  input: string
  onInputChange: (v: string) => void
  onSend: () => void
  sending: boolean
  showQuickActions: boolean
  onQuickAction: (message: string) => void
}) {
  // Use Array.from to count code points (not UTF-16 code units) —
  // a Vietnamese message with diacritics would otherwise report a
  // misleadingly high count from `input.length`.
  const charCount = Array.from(input).length
  const overLimit = charCount > MAX_MESSAGE_CHARS

  return (
    <>
      {showQuickActions && (
        <div className="border-t px-3 py-2 bg-linear-to-b from-rose-50/50 to-white">
          <div className="text-[10px] text-muted-foreground mb-1.5 font-medium">Chọn nhanh:</div>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5" style={{ scrollbarWidth: 'none' }}>
            {QUICK_ACTIONS.map((qa) => (
              <button
                key={qa.label}
                onClick={() => onQuickAction(qa.message)}
                className="inline-flex items-center whitespace-nowrap rounded-full border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-600 hover:text-white hover:border-rose-600 transition-colors shrink-0"
              >
                {qa.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div
        className="border-t p-2.5 flex items-center gap-2 bg-white"
        style={{ paddingBottom: 'max(0.625rem, env(safe-area-inset-bottom, 0px))' }}
      >
        <div className="flex-1 relative">
          <Input
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                // Block Enter-to-send when over the limit — the user
                // must trim their message first. (The send button is
                // also disabled, but Enter doesn't go through the
                // disabled check.)
                if (!overLimit) onSend()
              }
            }}
            placeholder="Nhập tin nhắn..."
            // text-base = 16px → iOS Safari won't zoom on focus (it zooms
            // when the input font-size is <16px).
            className="flex-1 h-11 text-base"
            // Set the browser maxLength slightly above our 500-char limit
            // so users can paste a long message and SEE the counter turn
            // red (rather than having the paste silently truncated).
            maxLength={MAX_MESSAGE_CHARS + 200}
            autoComplete="off"
            autoCorrect="off"
            enterKeyHint="send"
            aria-invalid={overLimit}
          />
          {/* Character counter — appears once the user is within 50 chars
              of the limit, turns red when over. */}
          {charCount >= MAX_MESSAGE_CHARS - 50 && (
            <div
              className={`absolute -bottom-4 right-1 text-[10px] tabular-nums ${
                overLimit ? 'text-red-500 font-medium' : 'text-muted-foreground'
              }`}
              aria-live="polite"
            >
              {charCount}/{MAX_MESSAGE_CHARS}
              {overLimit && ' — vượt giới hạn'}
            </div>
          )}
        </div>
        <Button
          onClick={onSend}
          // Disable on empty input, while sending, OR when the message
          // exceeds the 500-char limit.
          disabled={!input.trim() || sending || overLimit}
          size="icon"
          // h-11 w-11 = 44px — Apple HIG minimum touch target.
          className="bg-rose-600 hover:bg-rose-700 shrink-0 h-11 w-11"
          aria-label="Gửi tin nhắn"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
      {overLimit && (
        <div className="px-3 pb-1 text-[11px] text-red-500">
          Tin nhắn quá dài ({charCount}/{MAX_MESSAGE_CHARS}). Vui lòng rút gọn xuống {MAX_MESSAGE_CHARS} ký tự để gửi.
        </div>
      )}
    </>
  )
}
