import type { ChatChannelOut } from '@/api'
import { tSync } from '@/lib/i18n'

const filled = (value?: string | null) => (value?.trim() ? value : undefined)

/** The customer's name, else email, phone or the channel topic. */
export function customerName(channel: ChatChannelOut): string {
  const { user } = channel
  return (
    filled(user?.fullName) ??
    filled(user?.email) ??
    filled(user?.phone) ??
    filled(channel.topic) ??
    tSync('adminChat.customer')
  )
}

export const customerInitial = (channel: ChatChannelOut) =>
  customerName(channel)[0]?.toUpperCase() || 'K'

/** The phone (more actionable for support) or email the name line did not already show. */
export function customerContact(channel: ChatChannelOut) {
  const { user } = channel
  const name = customerName(channel)
  const phone = filled(user?.phone)
  const email = filled(user?.email)
  if (phone && phone !== name) return { isPhone: true, text: phone }
  if (email && email !== name) return { isPhone: false, text: email }
  return null
}
