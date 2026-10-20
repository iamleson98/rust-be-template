/**
 * Display labels for place `type` slugs returned by /api/places/*. The
 * vocabulary (city, bus_station, road_primary, amenity_hospital…) is shared
 * by the place index builder (src/lib/places) — add a slug there, add its
 * label here and in both i18n dictionaries.
 */
import type { useT } from "@spa/lib/i18n";

export const PLACE_TYPE_KEYS: Record<string, string> = {
  city: "mapPage.ptCity",
  town: "mapPage.ptTown",
  village: "mapPage.ptVillage",
  hamlet: "mapPage.ptHamlet",
  suburb: "mapPage.ptSuburb",
  quarter: "mapPage.ptWard",
  neighbourhood: "mapPage.ptNeighbourhood",
  ward: "mapPage.ptWard",
  district: "mapPage.ptDistrict",
  province: "mapPage.ptProvince",
  island: "mapPage.ptIsland",
  bus_station: "mapPage.ptBusStation",
  transit_stop: "mapPage.ptTransitStop",
  rail_station: "mapPage.ptRailStation",
  airport: "mapPage.ptAirport",
  ferry_terminal: "mapPage.ptFerryTerminal",
  attraction: "mapPage.ptAttraction",
  worship: "mapPage.ptWorship",
  mall: "mapPage.ptMall",
  park: "mapPage.ptPark",
  historic: "mapPage.ptHistoric",
  nature: "mapPage.ptNature",
  lodging: "mapPage.ptLodging",
  road_primary: "mapPage.ptRoadPrimary",
  road_secondary: "mapPage.ptRoadSecondary",
  road_tertiary: "mapPage.ptRoadTertiary",
  road_residential: "mapPage.ptRoadResidential",
  road_motorway: "mapPage.ptMotorway",
  road_trunk: "mapPage.ptTrunk",
  amenity_school: "mapPage.ptSchool",
  amenity_hospital: "mapPage.ptHospital",
  amenity_university: "mapPage.ptUniversity",
  amenity_college: "mapPage.ptCollege",
  amenity_marketplace: "mapPage.ptMarket",
  amenity_townhall: "mapPage.ptTownhall",
};

/** Humanise a place type slug for display in search results. */
export function formatPlaceType(type: string, t: ReturnType<typeof useT>): string {
  const key = PLACE_TYPE_KEYS[type];
  if (key) return t(key);
  // Unknown slug: strip prefix and replace _ with space
  return type.replace(/^(road_|amenity_|tourism_|leisure_|shop_)/, "").replace(/_/g, " ");
}
