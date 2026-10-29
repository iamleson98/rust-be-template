/**
 * Vietnamese cities — the 5 centrally-governed municipalities + 58 provinces.
 *
 * Used by the route creation form as the start/end location options.
 * Brands define pickup/drop at the city level; specific pickup points
 * (bus stations, curbside) are defined at the schedule level.
 *
 * The `id` is a URL-safe slug used as the `startLocationId`/`endLocationId`
 * when creating a route. It's NOT a UUID — the backend stores it as a
 * TEXT field reference that the frontend can resolve back to a name.
 *
 * After the 2025 administrative reorganization, Vietnam has:
 * - 5 centrally-governed municipalities (thành phố trực thuộc trung ương)
 * - 58 provinces (tỉnh)
 * Total: 63 first-level administrative divisions.
 *
 * NOTE: The 2025 reorganization merged several provinces. This list
 * reflects the post-merger structure. If further reorganizations occur,
 * update `cities.json`.
 *
 * The data lives in `cities.json` so the place-search service in `vps/`
 * (Rust) maps OpenStreetMap province names onto exactly this list too.
 */
import cities from "./cities.json";

export type VietnameseCity = {
  id: string;
  name: string;
  region: "north" | "central" | "south";
  /** Popular city names travelers actually type (the province list uses
   *  official names like "Lâm Đồng" — nobody types that; they type "Đà Lạt").
   *  Matched diacritic-insensitively by the search autocomplete, and shown
   *  as the row label so "Đà Lạt" resolves to a bookable province. */
  aliases?: string[];
};

export const VIETNAMESE_CITIES = cities as VietnameseCity[];
