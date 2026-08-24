/**
 * Sound effects for calls and messages.
 *
 * Uses Web Audio API to generate musical tones (no audio files needed).
 * All sounds are short (< 800ms), musical, and respect the user's
 * system volume.
 *
 * ## Sound design
 *
 * The previous implementation used harsh sine tones at low volume —
 * functional but not pleasant. The new design uses:
 *
 *   - **Triangle waves** for melodies (warmer than sine, less buzzy
 *     than square). Sine is still used for soft "connect" tones.
 *   - **Chord arpeggios** for call sounds — bright major-triad patterns
 *     that are pleasant to hear repeatedly (think Slack/WhatsApp).
 *   - **Two-tone "pop"** for the message sound — the classic
 *     Messenger-style high-low beep, louder (0.35 volume) so it cuts
 *     through background noise.
 *   - **Ascending major chord** for call-connected — cheerful.
 *   - **Descending pattern** for call-ended — gentle resolution.
 *
 * ## Ring-tone cancellation
 *
 * `startRingTone()` returns a stop function. When called, it cancels
 * BOTH the repeating interval AND any pending one-shot tones that
 * were scheduled by the last `sounds[type]()` invocation. Without the
 * pending-timer cancellation, the stop function would clear the
 * interval but a half-second later a final scheduled tone would
 * still fire — which is exactly the "user cancels call but still
 * hears a beep" bug.
 */

let audioCtx: AudioContext | null = null

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
    } catch {
      return null
    }
  }
  // Resume if suspended (browser auto-suspends until user interaction).
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {})
  }
  return audioCtx
}

/**
 * Play a single tone at the given frequency for `duration` ms.
 *
 * `volume` defaults to 0.2 (a comfortable listening level). The
 * message sound overrides this to 0.35 so it's loud enough to hear
 * over background noise (Facebook Messenger style).
 */
function playTone(freq: number, duration: number, type: OscillatorType = 'triangle', volume = 0.2) {
  const ctx = getCtx()
  if (!ctx) return

  const oscillator = ctx.createOscillator()
  const gain = ctx.createGain()

  oscillator.connect(gain)
  gain.connect(ctx.destination)

  oscillator.type = type
  oscillator.frequency.value = freq

  // Envelope: quick attack, sustain, quick release.
  // The attack is 5ms (fast enough to feel instant, slow enough to
  // avoid the click-pop a 0ms attack causes). Release is 50ms so
  // the tone fades smoothly rather than cutting off abruptly.
  const now = ctx.currentTime
  const durSec = duration / 1000
  gain.gain.setValueAtTime(0, now)
  gain.gain.linearRampToValueAtTime(volume, now + 0.005)
  gain.gain.setValueAtTime(volume, now + durSec - 0.05)
  gain.gain.linearRampToValueAtTime(0, now + durSec)

  oscillator.start(now)
  oscillator.stop(now + durSec)
}

/**
 * Track all pending `setTimeout` IDs from `playSequence` so that a
 * ring-tone stop can cancel them. Without this, cancelling a ring
 * tone mid-cycle would still let the next scheduled tone fire ~300ms
 * later (the "phantom beep" bug).
 */
const pendingToneTimers = new Set<ReturnType<typeof setTimeout>>()

/** Play a sequence of tones (for ringtones / connect sounds). */
function playSequence(
  tones: Array<{ freq: number; dur: number; type?: OscillatorType; vol?: number; gap?: number }>,
) {
  const ctx = getCtx()
  if (!ctx) return

  let offset = 0
  for (const tone of tones) {
    const id = setTimeout(() => {
      pendingToneTimers.delete(id)
      playTone(tone.freq, tone.dur, tone.type, tone.vol)
    }, offset)
    pendingToneTimers.add(id)
    // `gap` is the silence between this tone and the next; default
    // to 0 (back-to-back). Used for the "pop" pattern.
    offset += tone.dur + (tone.gap ?? 0)
  }
}

/** Cancel ALL pending one-shot tones. Called by `startRingTone`'s
 *  stop function so a cancelled ring tone doesn't leak a final beep. */
function cancelPendingTones() {
  for (const id of pendingToneTimers) {
    clearTimeout(id)
  }
  pendingToneTimers.clear()
}

const sounds = {
  /**
   * Outgoing call — repeating bright arpeggio (C5 → E5 → G5).
   *
   * A major triad played as a rising arpeggio is pleasant to hear
   * repeatedly (unlike the previous two-tone sine pattern, which
   * got annoying fast). The 350ms gap between cycles gives the
   * listener's ear a moment of rest.
   */
  ring: () => {
    playSequence([
      { freq: 523.25, dur: 180, type: 'triangle', vol: 0.18 }, // C5
      { freq: 659.25, dur: 180, type: 'triangle', vol: 0.18 }, // E5
      { freq: 783.99, dur: 280, type: 'triangle', vol: 0.18 }, // G5
    ])
  },

  /**
   * Incoming call — repeating bright ascending melody (E5 → G5 → B5 → E6).
   *
   * The pattern rises through a major triad + octave, which feels
   * uplifting + attention-grabbing without being harsh. Louder than
   * the outgoing ring (0.22 vs 0.18) because incoming calls are more
   * urgent.
   */
  incoming: () => {
    playSequence([
      { freq: 659.25, dur: 150, type: 'triangle', vol: 0.22 }, // E5
      { freq: 783.99, dur: 150, type: 'triangle', vol: 0.22 }, // G5
      { freq: 987.77, dur: 150, type: 'triangle', vol: 0.22 }, // B5
      { freq: 1318.51, dur: 250, type: 'triangle', vol: 0.22 }, // E6
    ])
  },

  /**
   * Message sent/received — Messenger-style two-tone "pop".
   *
   * A quick high-low beep (B5 → F#5) at 0.35 volume so it's loud
   * enough to hear over background noise. The two tones are played
   * back-to-back with no gap, ~100ms each — total duration ~200ms.
   * This is the classic Facebook Messenger "pop" sound, redesigned
   * with a triangle wave for warmth.
   */
  message: () => {
    playSequence([
      { freq: 987.77, dur: 90, type: 'triangle', vol: 0.35 }, // B5 — high
      { freq: 739.99, dur: 130, type: 'triangle', vol: 0.35 }, // F#5 — low
    ])
  },

  /**
   * Call connected — cheerful ascending major chord (C5 → E5 → G5 → C6).
   *
   * A bright major triad arpeggio that resolves on the high C —
   * feels like "yes, we're connected!". Sine wave (not triangle)
   * for a softer, more pleasant tone since this plays once + doesn't
   * need to grab attention.
   */
  connect: () => {
    playSequence([
      { freq: 523.25, dur: 110, type: 'sine', vol: 0.22 }, // C5
      { freq: 659.25, dur: 110, type: 'sine', vol: 0.22 }, // E5
      { freq: 783.99, dur: 110, type: 'sine', vol: 0.22 }, // G5
      { freq: 1046.50, dur: 180, type: 'sine', vol: 0.22 }, // C6
    ])
  },

  /**
   * Call ended — gentle descending pattern (G5 → E5 → C5).
   *
   * A soft descending major triad — feels like a natural "goodbye".
   * Sine wave + lower volume (0.18) so it doesn't feel abrupt or
   * harsh. The final C5 is held longer (250ms) for resolution.
   */
  end: () => {
    playSequence([
      { freq: 783.99, dur: 130, type: 'sine', vol: 0.18 }, // G5
      { freq: 659.25, dur: 130, type: 'sine', vol: 0.18 }, // E5
      { freq: 523.25, dur: 250, type: 'sine', vol: 0.18 }, // C5
    ])
  },
}

export type SoundType = keyof typeof sounds

/** Play a sound effect. No-op if AudioContext is unavailable. */
export function playSound(type: SoundType): void {
  sounds[type]?.()
}

/**
 * Start a repeating ring/incoming tone. Returns a stop function that:
 *   1. Cancels the repeating interval (so no NEW tones get scheduled).
 *   2. Cancels any pending one-shot tones from the LAST scheduled
 *      cycle (so the half-finished beep doesn't leak).
 *
 * Without step 2, calling `stop()` immediately after a ring cycle
 * started would still let the second tone of the cycle fire ~300ms
 * later — which is exactly the bug where cancelling an unanswered
 * call still played a sound.
 */
export function startRingTone(type: 'ring' | 'incoming'): () => void {
  const interval = type === 'ring' ? 1500 : 3000
  sounds[type]()
  const id = setInterval(() => sounds[type](), interval)
  return () => {
    clearInterval(id)
    cancelPendingTones()
  }
}
