/**
 * Reverse geocoding without Leaflet: the admin address dialog names a clicked
 * point before the map chunk has loaded, so this lives apart from the map.
 */
import { placesReverse as sdkReverseGeocode } from "@spa/api";

export type PickedPlace = {
  name: string;
  lat: number;
  lon: number;
  type?: string;
  province?: string | null;
  district?: string | null;
};

export type PlaceHit = {
  id?: string | null;
  name: string;
  type: string;
  province?: string | null;
  district?: string | null;
  lat: number;
  lon: number;
};

// ── Reverse geocode helper (Tantivy) ────────────────────────
// Returns a PickedPlace with the NAME of the nearest known place
// (for display) but keeps the EXACT lat/lon the user clicked (so
// the marker doesn't jump to a nearby indexed place).
export async function reverseGeocode(lat: number, lon: number): Promise<PickedPlace> {
  try {
    const { data } = await sdkReverseGeocode({ query: { lat, lon, limit: 1 } });
    const hits: PlaceHit[] = (data ?? []) as PlaceHit[];
    const h = hits[0];
    if (!h) return { name: `${lat.toFixed(3)}, ${lon.toFixed(3)}`, lat, lon };
    return {
      name: h.name,
      // Keep the EXACT clicked coordinates — NOT h.lat/h.lon (which is
      // the nearest indexed place, potentially hundreds of meters away).
      lat,
      lon,
      type: h.type,
      province: h.province,
      district: h.district,
    };
  } catch {
    return { name: `${lat.toFixed(3)}, ${lon.toFixed(3)}`, lat, lon };
  }
}
