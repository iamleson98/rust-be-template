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
  amenity_restaurant: "mapPage.ptRestaurant",
  amenity_cafe: "mapPage.ptCafe",
  amenity_fuel: "mapPage.ptFuel",
  amenity_bank: "mapPage.ptBank",
  amenity_pharmacy: "mapPage.ptPharmacy",
  amenity_kindergarten: "mapPage.ptKindergarten",
  amenity_community_centre: "mapPage.ptCommunityCentre",
  amenity_fast_food: "mapPage.ptFastFood",
  amenity_atm: "mapPage.ptAtm",
  amenity_police: "mapPage.ptPolice",
  amenity_clinic: "mapPage.ptClinic",
  amenity_bar: "mapPage.ptBar",
  amenity_post_office: "mapPage.ptPostOffice",
  amenity_courthouse: "mapPage.ptCourthouse",
  amenity_dentist: "mapPage.ptDentist",
  amenity_pub: "mapPage.ptPub",
  amenity_food_court: "mapPage.ptFoodCourt",
  amenity_parking: "mapPage.ptParking",
  amenity_charging_station: "mapPage.ptCharging",
  shop_convenience: "mapPage.ptConvenience",
  shop_supermarket: "mapPage.ptSupermarket",
  shop_car_repair: "mapPage.ptCarRepair",
  shop_motorcycle_repair: "mapPage.ptMotoRepair",
  shop_travel_agency: "mapPage.ptTravelAgency",
  tourism_information: "mapPage.ptTourInfo",
  tourism_apartment: "mapPage.ptApartment",
  tourism_artwork: "mapPage.ptArtwork",
  tourism_viewpoint: "mapPage.ptViewpoint",
  leisure_pitch: "mapPage.ptPitch",
  leisure_sports_centre: "mapPage.ptSportsCentre",
  leisure_fitness_centre: "mapPage.ptFitness",
  leisure_swimming_pool: "mapPage.ptPool",
  landuse_industrial: "mapPage.ptIndustrial",
  landuse_residential: "mapPage.ptResidential",
  landuse_commercial: "mapPage.ptCommercial",
  landuse_cemetery: "mapPage.ptCemetery",
  landuse_military: "mapPage.ptMilitary",
  waterway_river: "mapPage.ptRiver",
  waterway_canal: "mapPage.ptCanal",
  waterway_stream: "mapPage.ptStream",
  waterway_dam: "mapPage.ptDam",
  natural_water: "mapPage.ptWater",
  man_made_bridge: "mapPage.ptBridge",
  public_transport_platform: "mapPage.ptBusStopPlatform",
  highway_bus_stop: "mapPage.ptBusStopSign",
  railway_stop: "mapPage.ptRailStop",
  highway_service: "mapPage.ptServiceRoad",
  office_government: "mapPage.ptOfficeGov",
  office_company: "mapPage.ptOfficeCompany",
  building: "mapPage.ptBuilding",
  address: "mapPage.ptAddress",
  place_other: "mapPage.ptPlaceOther",
};

/**
 * Generic `<osm key>_<value>` kinds the index emits for everything else
 * (there are hundreds): the most common have a label above, the rest fall
 * back to their key's label here rather than showing raw English slugs.
 */
export const PLACE_TYPE_PREFIX_KEYS: Array<[prefix: string, key: string]> = [
  ["amenity_", "mapPage.ptAmenity"],
  ["shop_", "mapPage.ptShop"],
  ["office", "mapPage.ptOffice"],
  ["landuse_", "mapPage.ptLanduse"],
  ["waterway_", "mapPage.ptWaterway"],
  ["tourism_", "mapPage.ptTourism"],
  ["leisure_", "mapPage.ptLeisure"],
  ["historic_", "mapPage.ptHistoricSite"],
  ["healthcare_", "mapPage.ptHealthcare"],
  ["craft_", "mapPage.ptCraft"],
  ["sport_", "mapPage.ptSport"],
  ["man_made_", "mapPage.ptManMade"],
  ["natural_", "mapPage.ptNaturalFeature"],
  ["highway_", "mapPage.ptRoadOther"],
  ["railway_", "mapPage.ptRailwayOther"],
  ["public_transport_", "mapPage.ptTransitOther"],
];

/** Humanise a place type slug for display in search results. */
export function formatPlaceType(type: string, t: ReturnType<typeof useT>): string {
  const key =
    PLACE_TYPE_KEYS[type] ??
    PLACE_TYPE_PREFIX_KEYS.find(([prefix]) => type.startsWith(prefix))?.[1];
  if (key) return t(key);
  // Unknown slug: strip prefix and replace _ with space
  return type.replace(/^(road_|amenity_|tourism_|leisure_|shop_)/, "").replace(/_/g, " ");
}
