import { describe, expect, it, vi } from 'vitest'
import { isChunkLoadError, recoverFromChunkError, RELOAD_WINDOW_MS } from '../chunk-recovery'

function makeEnv(start = 1_000_000) {
  const data = new Map<string, string>()
  let t = start
  const reload = vi.fn()
  return {
    env: {
      now: () => t,
      storage: {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => void data.set(k, v),
      },
      reload,
    },
    advance: (ms: number) => (t += ms),
    reload,
  }
}
const chunkErr = new TypeError(
  'Failed to fetch dynamically imported module: https://x/assets/a-1.js',
)

describe('isChunkLoadError', () => {
  it.each([
    'Failed to fetch dynamically imported module: x',
    'Importing a module script failed.',
    'error loading dynamically imported module',
  ])('matches %s', (m) => expect(isChunkLoadError(new Error(m))).toBe(true))
  it('ignores other errors', () => {
    expect(isChunkLoadError(new Error('boom'))).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
  })
})

describe('recoverFromChunkError', () => {
  it('reloads once, then falls back to the error UI', () => {
    const { env, reload, advance } = makeEnv()
    expect(recoverFromChunkError(chunkErr, env)).toBe(true)
    expect(recoverFromChunkError(chunkErr, env)).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
    advance(RELOAD_WINDOW_MS + 1)
    expect(recoverFromChunkError(chunkErr, env)).toBe(true)
    expect(reload).toHaveBeenCalledTimes(2)
  })
  it('does nothing for unrelated errors', () => {
    const { env, reload } = makeEnv()
    expect(recoverFromChunkError(new Error('x'), env)).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })
  it('does not reload without storage (cannot guard a loop)', () => {
    const { env, reload } = makeEnv()
    expect(recoverFromChunkError(chunkErr, { ...env, storage: null })).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })
})
