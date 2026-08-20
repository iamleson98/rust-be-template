/**
 * Sound effects for calls and messages.
 *
 * Uses Web Audio API to generate simple tones (no audio files needed).
 * All sounds are short (< 500ms) and respect the user's system volume.
 *
 * Sound types:
 *   - 'ring' — outgoing call ringing (repeats every 2s until answered)
 *   - 'incoming' — incoming call ringtone (repeats every 3s until answered)
 *   - 'message' — message sent/received (short blip)
 *   - 'connect' — call connected (single ascending tone)
 *   - 'end' — call ended (descending tone)
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

/** Play a single tone at the given frequency for `duration` ms. */
function playTone(freq: number, duration: number, type: OscillatorType = 'sine', volume = 0.15) {
  const ctx = getCtx()
  if (!ctx) return

  const oscillator = ctx.createOscillator()
  const gain = ctx.createGain()

  oscillator.connect(gain)
  gain.connect(ctx.destination)

  oscillator.type = type
  oscillator.frequency.value = freq

  // Envelope: quick attack, sustain, quick release.
  const now = ctx.currentTime
  gain.gain.setValueAtTime(0, now)
  gain.gain.linearRampToValueAtTime(volume, now + 0.01)
  gain.gain.setValueAtTime(volume, now + duration / 1000 - 0.05)
  gain.gain.linearRampToValueAtTime(0, now + duration / 1000)

  oscillator.start(now)
  oscillator.stop(now + duration / 1000)
}

/**
 * Track all pending `setTimeout` IDs from `playSequence` so that a
 * ring-tone stop can cancel them. Without this, cancelling a ring
 * tone mid-cycle would still let the next scheduled tone fire ~300ms
 * later (the "phantom beep" bug).
 */
const pendingToneTimers = new Set<ReturnType<typeof setTimeout>>()

/** Play two tones in sequence (for ringtones / connect sounds). */
function playSequence(tones: Array<{ freq: number; dur: number; type?: OscillatorType; vol?: number }>) {
  const ctx = getCtx()
  if (!ctx) return

  let offset = 0
  for (const tone of tones) {
    const id = setTimeout(() => {
      pendingToneTimers.delete(id)
      playTone(tone.freq, tone.dur, tone.type, tone.vol)
    }, offset)
    pendingToneTimers.add(id)
    offset += tone.dur
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
  /** Outgoing call — repeating ring tone. */
  ring: () => {
    playTone(440, 300, 'sine', 0.12)
    const id1 = setTimeout(() => {
      pendingToneTimers.delete(id1)
      playTone(550, 300, 'sine', 0.12)
    }, 350)
    pendingToneTimers.add(id1)
  },

  /** Incoming call — repeating double-beep. */
  incoming: () => {
    playTone(800, 150, 'sine', 0.15)
    const id1 = setTimeout(() => {
      pendingToneTimers.delete(id1)
      playTone(1000, 150, 'sine', 0.15)
    }, 200)
    pendingToneTimers.add(id1)
  },

  /** Message sent/received — short blip. */
  message: () => {
    playTone(600, 80, 'sine', 0.1)
  },

  /** Call connected — ascending tone. */
  connect: () => {
    playSequence([
      { freq: 440, dur: 100 },
      { freq: 660, dur: 100 },
      { freq: 880, dur: 150 },
    ])
  },

  /** Call ended — descending tone. */
  end: () => {
    playSequence([
      { freq: 660, dur: 120 },
      { freq: 440, dur: 120 },
      { freq: 330, dur: 200 },
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
