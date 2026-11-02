import { useQuery } from "@tanstack/react-query";
import { tripDetailOptions } from "@spa/api";

/**
 * How long a trip's seat map counts as current. Seats sell by the second, so
 * this is short: long enough for a hover prefetch to serve the click that
 * follows it, and the hold re-checks the seats anyway.
 */
export const TRIP_FRESH_MS = 10_000;

/** Trip detail (seat map, stops, pricing); idle until an id is given. */
export function useTripDetail(tripId: string | undefined) {
  return useQuery({
    ...tripDetailOptions({ path: { id: tripId ?? "" } }),
    enabled: !!tripId,
    staleTime: TRIP_FRESH_MS,
  });
}
