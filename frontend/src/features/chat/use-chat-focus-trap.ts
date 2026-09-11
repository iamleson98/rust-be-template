'use client'

/**
 * useChatFocusTrap — ESC-to-close + focus trap for the floating chat
 * panel (WCAG 2.1.2 "No Keyboard Trap" + 2.4.3 "Focus Order").
 *
 * Extracted from the original `chat-widget.tsx`. While the panel is
 * open it:
 *   - Closes the call surface + chat on Escape.
 *   - Traps Tab/Shift+Tab inside the panel (cycles first ↔ last
 *     focusable element, skipping hidden ones).
 *   - Moves initial focus into the panel and restores focus to the
 *     trigger element on close.
 */

import { useEffect, type RefObject } from 'react'

export function useChatFocusTrap({
  chatOpen,
  panelRef,
  triggerRef,
  setCallOpen,
  setChatOpen,
}: {
  chatOpen: boolean
  panelRef: RefObject<HTMLDivElement | null>
  triggerRef: RefObject<HTMLButtonElement | null>
  setCallOpen: (open: boolean) => void
  setChatOpen: (open: boolean) => void
}) {
  // ─── ESC to close + focus trap (WCAG 2.1.2 + 2.4.3) ───
  useEffect(() => {
    if (!chatOpen) return
    triggerRef.current = document.activeElement as HTMLButtonElement | null

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setCallOpen(false)
        setChatOpen(false)
        return
      }
      if (e.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const focusable = panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      const visible = Array.from(focusable).filter((el) => {
        const rect = el.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
      })
      if (visible.length === 0) return
      const first = visible[0]
      const last = visible[visible.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey) {
        if (active === first || !panel.contains(active)) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (active === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown, true)
    const t = setTimeout(() => {
      const panel = panelRef.current
      if (!panel) return
      const first = panel.querySelector<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      first?.focus()
    }, 50)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      clearTimeout(t)
      triggerRef.current?.focus()
    }
  }, [chatOpen, setCallOpen, setChatOpen])
}
