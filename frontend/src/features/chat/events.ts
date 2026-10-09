/** A staff member online right now, from a `staff_presence` snapshot. */
export type StaffPresenceEntry = {
  userId: string
  name: string
  role: string
  online: boolean
  busy: boolean
  activeChats: number
  lastSeenAt?: string | null
}

/** Staff who were active recently but have dropped off. */
export type OfflineStaffEntry = {
  userId: string
  name: string
  role: string
  lastSeenAt: string
}

export type StaffPresenceSnapshot = {
  staff: StaffPresenceEntry[]
  offline: OfflineStaffEntry[]
  /** True while no human is online and the assistant answers. */
  botActive: boolean
}

/**
 * Frames the chat hub pushes over `/ws` (see `src/ws/handler.rs`), reduced to
 * the fields the UI reads. Frames this union does not name are ignored.
 */
export type ChatEvent =
  | {
      type: 'message'
      channelId: string
      senderType: string
      senderName?: string
      text?: string
    }
  | { type: 'typing'; channelId: string; userId?: string; name: string; isTyping: boolean }
  | { type: 'presence'; channelId: string; online: boolean }
  | { type: 'joined'; channelId: string; botActive?: boolean }
  | { type: 'channel_assigned'; channelId: string; employeeId?: string; employeeName?: string }
  | { type: 'channel_released' | 'channel_closed'; channelId: string }
  | { type: 'channel_message'; channelId: string }
  | { type: 'channel_created' | 'channels_changed' }
  | ({ type: 'staff_presence'; botActive?: boolean } & Partial<StaffPresenceSnapshot>)
  | { type: 'error'; message?: string }
  | { type: 'abuse:warned' | 'abuse:banned'; reason?: string }
