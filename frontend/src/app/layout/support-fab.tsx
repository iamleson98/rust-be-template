import { isStaffUser, useSession } from '@/stores/session'
import { useUi } from '@/stores/ui'
import { useNavigate } from '@tanstack/react-router'
import { useT } from '@/lib/i18n'
import { Headset } from 'lucide-react'

/**
 * The support button in the bottom-right corner on wider screens. Phones
 * reach support from the bottom tab bar instead, so nothing covers content.
 */
export function SupportFab() {
  const chatOpen = useUi((s) => s.chatOpen)
  const setChatOpen = useUi((s) => s.setChatOpen)
  const user = useSession((s) => s.user)
  const navigate = useNavigate()
  const t = useT()

  if (chatOpen) return null

  const open = () => {
    if (!user) navigate({ to: '/login' })
    // Staff answer support from the admin inbox, not the customer widget.
    else if (isStaffUser(user)) navigate({ to: '/admin/chat' })
    else setChatOpen(true)
  }

  return (
    <button
      type="button"
      data-slot="fab"
      onClick={open}
      aria-label={t('layout.support.open')}
      title={t('chat.title')}
      className="group fixed right-5 bottom-5 z-40 hidden size-14 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-105 focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/40 md:inline-flex"
    >
      <Headset className="size-6 transition-transform group-hover:-rotate-12" />
      <span className="sr-only">{t('chat.title')}</span>
    </button>
  )
}
