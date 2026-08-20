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

/** Play two tones in sequence (for ringtones / connect sounds). */
function playSequence(tones: Array<{ freq: number; dur: number; type?: OscillatorType; vol?: number }>) {
  const ctx = getCtx()
  if (!ctx) return

  let offset = 0
  for (const tone of tones) {
    setTimeout(() => playTone(tone.freq, tone.dur, tone.type, tone.vol), offset)
    offset += tone.dur
  }
}

const sounds = {
  /** Outgoing call — repeating ring tone. */
  ring: () => {
    playTone(440, 300, 'sine', 0.12)
    setTimeout(() => playTone(550, 300, 'sine', 0.12), 350)
  },

  /** Incoming call — repeating double-beep. */
  incoming: () => {
    playTone(800, 150, 'sine', 0.15)
    setTimeout(() => playTone(1000, 150, 'sine', 0.15), 200)
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

/** Start a repeating ring/incoming tone. Returns a stop function. */
export function startRingTone(type: 'ring' | 'incoming'): () => void {
  const interval = type === 'ring' ? 1500 : 3000
  sounds[type]()
  const id = setInterval(() => sounds[type](), interval)
  return () => clearInterval(id)
}
