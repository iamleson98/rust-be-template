import { useSession } from '@/stores/session'
import { useUi } from '@/stores/ui'
import { useNavigate } from '@tanstack/react-router'
import { useT } from '@/lib/i18n'
import { Headset } from 'lucide-react'

export function SupportFab() {
  const chatOpen = useUi((s) => s.chatOpen)
  const setChatOpen = useUi((s) => s.setChatOpen)
  const user = useSession((s) => s.user)
  const navigate = useNavigate()
  const t = useT()

  if (chatOpen) return null

  return (
    <button
      type="button"
      data-slot="fab"
      onClick={() => (user ? setChatOpen(true) : navigate({ to: '/login' }))}
      aria-label={t('layout.support.open')}
      title={t('chat.title')}
      className="group fixed z-40 right-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] md:right-5 md:bottom-5 inline-flex h-11 w-11 md:h-14 md:w-14 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-105 focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/40"
    >
      <span
        aria-hidden="true"
        className="absolute inset-0 -z-10 rounded-full bg-orange-400/40 animate-ping"
        style={{ animationDuration: '2.4s' }}
      />
      <Headset className="h-5 w-5 md:h-6 md:w-6 transition-transform group-hover:-rotate-12" />
      <span className="sr-only">{t('chat.title')}</span>
    </button>
  )
}
