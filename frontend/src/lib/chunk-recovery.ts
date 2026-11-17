/**
 * Recovery from a stale release: a page loaded from an older release imports a
 * hashed chunk the server no longer carries, the import rejects and the screen
 * would stay broken. One automatic reload fetches the current release; a
 * timestamp in sessionStorage stops a reload loop (a second failure within
 * `RELOAD_WINDOW_MS` falls through to the error screen and its reload button).
 */

const STORAGE_KEY = 'dxv:chunk-reload-at'
export const RELOAD_WINDOW_MS = 30_000

const CHUNK_ERROR =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i

export function isChunkLoadError(error: unknown): boolean {
  const message =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : (error as { message?: unknown } | null)?.message
  return typeof message === 'string' && CHUNK_ERROR.test(message)
}

interface Env {
  now: () => number
  storage: Pick<Storage, 'getItem' | 'setItem'> | null
  reload: () => void
}

function browserEnv(): Env {
  let storage: Env['storage'] = null
  try {
    storage = window.sessionStorage
  } catch {
    storage = null
  }
  return { now: Date.now, storage, reload: () => window.location.reload() }
}

/**
 * Reloads the page once for a chunk-load error. Returns true when a reload was
 * started, false when the error is not a chunk error or a reload already
 * happened within the window (the caller then shows its error UI).
 */
export function recoverFromChunkError(error: unknown, env: Env = browserEnv()): boolean {
  if (!isChunkLoadError(error)) return false
  const now = env.now()
  try {
    const last = Number(env.storage?.getItem(STORAGE_KEY))
    if (Number.isFinite(last) && last > 0 && now - last < RELOAD_WINDOW_MS) return false
    env.storage?.setItem(STORAGE_KEY, String(now))
  } catch {
    // Storage blocked: cannot guard against a loop, so do not reload.
    return false
  }
  if (!env.storage) return false
  env.reload()
  return true
}

/** Listens for Vite's preload failures and bare dynamic-import rejections. */
export function installChunkRecovery(): void {
  window.addEventListener('vite:preloadError', (event) => {
    if (recoverFromChunkError((event as Event & { payload?: unknown }).payload)) {
      event.preventDefault()
    }
  })
  window.addEventListener('unhandledrejection', (event) => {
    recoverFromChunkError(event.reason)
  })
}
