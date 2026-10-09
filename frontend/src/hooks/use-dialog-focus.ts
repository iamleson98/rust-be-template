import { useEffect, useEffectEvent, type RefObject } from 'react'

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

const isShown = (el: HTMLElement) => {
  const { width, height } = el.getBoundingClientRect()
  return width > 0 && height > 0
}

/**
 * Keyboard behaviour of a floating dialog (WCAG 2.1.2, 2.4.3): focus moves in
 * on mount and returns to where it was on unmount, Tab cycles inside the
 * panel, and Escape calls `onClose`.
 */
export function useDialogFocus(panel: RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useEffectEvent(onClose)

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const focusable = () =>
      Array.from(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(isShown)

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        close()
        return
      }
      if (e.key !== 'Tab') return
      const items = focusable()
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey && (active === first || !panel.current?.contains(active))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    const focusTimer = setTimeout(() => focusable()[0]?.focus(), 50)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      clearTimeout(focusTimer)
      opener?.focus()
    }
  }, [panel])
}
