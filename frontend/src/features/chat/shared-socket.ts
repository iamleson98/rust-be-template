import { WsClient } from '@/api/ws-client'

let shared: { client: WsClient; holders: number } | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((listener) => listener())

/**
 * The tab's one chat socket. Everything that needs it — the presence that
 * tells support a customer is on the site, the support panel, the staff
 * workspace — holds it while mounted; it closes when the last holder lets go.
 * One socket per tab keeps "online" honest: it ends when the tab closes.
 */
export function holdChatSocket(): { client: WsClient; release: () => void } {
  if (!shared) {
    const client = new WsClient()
    client.on('_open', notify).on('_close', notify)
    shared = { client, holders: 0 }
  }
  shared.holders++
  const held = shared
  let released = false
  return {
    client: held.client,
    release: () => {
      if (released) return
      released = true
      if (--held.holders > 0 || shared !== held) return
      held.client.close()
      shared = null
      notify()
    },
  }
}

/** Is the shared socket open? (A `useSyncExternalStore` snapshot.) */
export const chatSocketOpen = () => shared?.client.connected ?? false

/** Call `listener` whenever the shared socket opens or closes. */
export function onChatSocketChange(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
