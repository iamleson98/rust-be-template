// Extracted from the original 'my-bookings.tsx'.

const RECENT_SEARCHES_KEY = 'vexevn_booking_recent_searches'
const MAX_RECENT = 3

export function getRecentSearches(): string[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) || '[]')
  } catch {
    return []
  }
}

export function addRecentSearch(term: string) {
  if (!term.trim()) return
  try {
    const existing = getRecentSearches().filter((s) => s !== term.trim())
    const updated = [term.trim(), ...existing].slice(0, MAX_RECENT)
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated))
  } catch {
    // noop
  }
}

export function removeRecentSearch(term: string) {
  try {
    const existing = getRecentSearches().filter((s) => s !== term)
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(existing))
  } catch {
    // noop
  }
}
