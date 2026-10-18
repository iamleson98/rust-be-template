/**
 * Global window augmentations for third-party scripts and app-internal
 * debug channels (carried over from the Vite build's vite-env.d.ts).
 */
interface Window {
  /** Google Analytics 4 gtag() — injected by the GA4 bootstrap script. */
  gtag?: (...args: unknown[]) => void
  /** Firebug presence probe (console-protection). */
  firebug?: { isEnabled: boolean }
  /** Safari's legacy prefixed AudioContext (sound-effects). */
  webkitAudioContext?: typeof AudioContext
}
