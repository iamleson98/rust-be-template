/** `localStorage` that never throws (SSR, private mode, quota). */
export const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key: string, value: string | null) {
    try {
      if (value === null) localStorage.removeItem(key)
      else localStorage.setItem(key, value)
    } catch {
      // storage unavailable — state simply isn't persisted
    }
  },
  getJson<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : fallback
    } catch {
      return fallback
    }
  },
  setJson(key: string, value: unknown) {
    this.set(key, JSON.stringify(value))
  },
}
