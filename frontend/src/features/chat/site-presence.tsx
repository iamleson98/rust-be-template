import { isStaffUser, useSession } from '@/stores/session'
import { useChatSocket } from './use-chat-socket'

/**
 * Holds a signed-in customer's chat socket while the site is open in this
 * tab — that is what support sees as "online". Renders nothing.
 */
export function SitePresence() {
  const user = useSession((s) => s.user)
  useChatSocket({ enabled: !!user && !isStaffUser(user), userId: user?.id })
  return null
}
