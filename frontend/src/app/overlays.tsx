import { lazy, Suspense, type ComponentType, type ReactNode } from 'react'
import { useUi } from '@/stores/ui'

/** `lazy()` for a named export. */
function lazyNamed<M extends Record<string, ComponentType>, K extends keyof M>(
  load: () => Promise<M>,
  name: K,
) {
  return lazy(() => load().then((m) => ({ default: m[name] })))
}

export const Footer = lazyNamed(() => import('./layout/footer'), 'Footer')
export const MobileNav = lazyNamed(() => import('./layout/mobile-nav'), 'MobileNav')
export const SupportFab = lazyNamed(() => import('./layout/support-fab'), 'SupportFab')
const ChatWidget = lazyNamed(() => import('@/features/chat/widget/chat-widget'), 'ChatWidget')
const AudioCallWidget = lazyNamed(() => import('@/features/call/audio-call-widget'), 'AudioCallWidget')
const TripCompare = lazyNamed(() => import('@/features/search/compare/trip-compare'), 'TripCompare')
const LoyaltyWidget = lazyNamed(() => import('@/features/loyalty/loyalty-widget'), 'LoyaltyWidget')
const CancelDialog = lazyNamed(() => import('@/features/booking/history/cancel-dialog'), 'CancelDialog')
const PriceAlertDialog = lazyNamed(
  () => import('@/features/price-alert/price-alert-dialog'),
  'PriceAlertDialog',
)
const ShareDialog = lazyNamed(() => import('@/features/share/share-dialog'), 'ShareDialog')

/** Render lazily, with nothing in the meantime. */
export const Deferred = ({ children }: { children: ReactNode }) => (
  <Suspense fallback={null}>{children}</Suspense>
)

/** Panels and dialogs that float above every page; each mounts on first open. */
export function Overlays() {
  const chatOpen = useUi((s) => s.chatOpen)
  const compareOpen = useUi((s) => s.compareOpen && s.compareList.length > 0)
  const loyaltyOpen = useUi((s) => s.loyaltyOpen)
  const cancelOpen = useUi((s) => !!s.cancelBookingId)
  const priceAlertOpen = useUi((s) => !!s.priceAlert)
  const shareOpen = useUi((s) => !!s.shareTrip)

  return (
    <>
      {chatOpen && (
        <Deferred>
          <ChatWidget />
        </Deferred>
      )}
      {/* Always mounted: staff must receive inbound calls on any page. */}
      <Deferred>
        <AudioCallWidget />
      </Deferred>
      {compareOpen && (
        <Deferred>
          <TripCompare />
        </Deferred>
      )}
      {loyaltyOpen && (
        <Deferred>
          <LoyaltyWidget />
        </Deferred>
      )}
      {cancelOpen && (
        <Deferred>
          <CancelDialog />
        </Deferred>
      )}
      {priceAlertOpen && (
        <Deferred>
          <PriceAlertDialog />
        </Deferred>
      )}
      {shareOpen && (
        <Deferred>
          <ShareDialog />
        </Deferred>
      )}
    </>
  )
}
