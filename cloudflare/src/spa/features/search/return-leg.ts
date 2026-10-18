import type { SearchParams } from "@spa/lib/search-params";

/**
 * A round trip books one leg at a time: while the outbound results are on
 * screen the search is kept here (this tab only), so the booking's success
 * screen can offer the way back.
 */
const KEY = "pending_return_leg";

export function rememberReturnLeg(search: SearchParams) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(search));
  } catch {
    // storage unavailable: the success screen simply offers no return leg
  }
}

export function forgetReturnLeg() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // nothing stored
  }
}

/** The round trip whose outbound day is `day` (`YYYY-MM-DD`), if one is pending. */
export function pendingReturnLeg(day: string): SearchParams | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    const search = raw ? (JSON.parse(raw) as SearchParams) : null;
    return search?.returnDate && search.date === day ? search : null;
  } catch {
    return null;
  }
}
