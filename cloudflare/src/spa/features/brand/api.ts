import { queryOptions, useQuery } from "@tanstack/react-query";
import { client } from "@spa/api/generated/client.gen";

/** One schedule of a route: a daily departure. Mirrors `services/brand-profile.ts`. */
export interface ProfileSchedule {
  id: string;
  /** `HH:MM`. */
  departureTime: string;
  /** Weekdays it runs, Monday first, as `1`/`0`; null when it runs every day. */
  daysOfWeek: string | null;
  vehicleType: string | null;
  priceAdult: number;
}

export interface ProfileEndpoint {
  name: string;
  lat: number;
  lon: number;
}

export interface ProfileRoute {
  id: string;
  name: string;
  from: ProfileEndpoint;
  to: ProfileEndpoint;
  /** Lowest adult base price across its schedules; null while it has none. */
  priceFrom: number | null;
  schedules: ProfileSchedule[];
}

export interface ProfileTrip {
  tripId: string;
  routeId: string;
  /** `YYYY-MM-DD`, Vietnam. */
  date: string;
  /** `HH:MM`. */
  departureTime: string;
  availableSeats: number;
  totalSeats: number;
  vehicleType: string | null;
  priceAdult: number;
}

export interface ProfileLocation {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  lat: number | null;
  lon: number | null;
}

export interface BrandProfile {
  brand: {
    id: string;
    slug: string;
    name: string;
    logoUrl: string | null;
    description: string | null;
    contactPhone: string | null;
    contactEmail: string | null;
    rating: number | null;
    reviewCount: number;
  };
  locations: ProfileLocation[];
  routes: ProfileRoute[];
  trips: ProfileTrip[];
}

/**
 * `GET /api/brands/{slug}/profile`. Tagged like the generated brand queries,
 * so a brand, route or schedule edit refreshes it; between edits the server
 * answers from the edge cache for a minute, so the page waits as long
 * before asking again (`staleTime`) instead of on every visit.
 */
export const brandProfileOptions = (slug: string) =>
  queryOptions({
    queryKey: [{ _id: "brandProfile", tags: ["brands", "routes", "trips"], path: { slug } }],
    queryFn: async ({ signal }) => {
      const { data } = await client.get<{ 200: BrandProfile }, unknown, true>({
        url: "/api/brands/{slug}/profile",
        path: { slug },
        signal,
        throwOnError: true,
      });
      return data as BrandProfile;
    },
    // Seats left move, so it waits only as long as the server's own cache does.
    staleTime: 60_000,
  });

export const useBrandProfile = (slug: string) => useQuery(brandProfileOptions(slug));
