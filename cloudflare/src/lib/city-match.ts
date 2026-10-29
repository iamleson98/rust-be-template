/**
 * Resolving what a traveller typed to the cities routes are stored under —
 * port of the matching half of `src/cities.rs` (`match_city_slugs`,
 * `find_by_slug`, `name_for_slug`).
 *
 * Routes keep `start_location_id` / `end_location_id` as city slugs, so a
 * search for "Sài Gòn" or "danang" must become `ho-chi-minh` / `da-nang`
 * before routes can be matched structurally.
 */
import { VIETNAMESE_CITIES } from "@/lib/cities";
import { CITY_COORDS } from "@/lib/city-coords";

/**
 * Colloquial names that do not derive from the official province name
 * (`Sài Gòn`, `hcm`, `Đà Lạt`, …), already normalised the way a query is.
 * Rust: `CITY_ALIASES`.
 */
const CITY_ALIASES: Record<string, string[]> = {
  "ho-chi-minh": ["saigon", "sagon", "sg", "hcm", "hcmc", "tphcm"],
  "ha-noi": ["hn"],
  "da-nang": ["dn"],
  "hai-phong": ["hp"],
  "can-tho": ["ct"],
  "quang-ninh": ["halong"],
  "nghe-an": ["vinh"],
  hue: ["hue"],
  "quang-nam": ["hoian"],
  "binh-dinh": ["quynhon"],
  "phu-yen": ["tuyhoa"],
  "khanh-hoa": ["nhatrang"],
  "binh-thuan": ["phanthiet"],
  "gia-lai": ["pleiku"],
  "dak-lak": ["buonmathuot", "buonmathuat"],
  "lam-dong": ["dalat", "daliat"],
  "ba-ria-vung-tau": ["vungtau", "baria"],
  "dong-nai": ["bienhoa"],
  "tien-giang": ["mytho"],
  "dong-thap": ["sadec", "caolanh"],
  "an-giang": ["chaudoc", "longxuyen"],
  "kien-giang": ["rachgia", "phuquoc"],
  "hau-giang": ["vithanh"],
};

/** Lower-case, strip Vietnamese diacritics (`đ` → `d`), keep letters and digits only. */
export function normalizeForMatch(input: string): string {
  return input
    .replace(/[đĐ]/g, "d")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** A city the way the search shows it: official name and province-seat coordinates. */
export interface CityInfo {
  slug: string;
  name: string;
  lat: number;
  lon: number;
}

const bySlug = new Map(VIETNAMESE_CITIES.map((c) => [c.id, c]));

/** The city with this slug; null when unknown (Rust `find_by_slug`). */
export function findCity(slug: string): CityInfo | null {
  const city = bySlug.get(slug);
  if (!city) return null;
  const at = CITY_COORDS[slug];
  return { slug, name: city.name, lat: at?.lat ?? 0, lon: at?.lon ?? 0 };
}

/** The display name for a slug, or the slug itself when unknown (Rust `name_for_slug`). */
export function nameForSlug(slug: string): string {
  return bySlug.get(slug)?.name ?? slug;
}

const FORMS = VIETNAMESE_CITIES.map((c) => ({
  slug: c.id,
  name: normalizeForMatch(c.name),
  slugForm: c.id.replaceAll("-", ""),
  aliases: CITY_ALIASES[c.id] ?? [],
}));

/**
 * The slugs a free-text query could mean (Rust `match_city_slugs`): its
 * normalised form equals a city's name, slug or alias, or — for queries of
 * four characters or more — contains, or is contained in, a long enough
 * city form (`danangairport` → `da-nang`). Short queries never match by
 * containment, so `an` is not half of Vietnam.
 */
export function matchCitySlugs(query: string): string[] {
  const q = normalizeForMatch(query);
  if (!q) return [];
  return FORMS.filter((c) => {
    const exact = c.name === q || c.slugForm === q || c.aliases.includes(q);
    const contains =
      q.length >= 4 &&
      ((c.name.length >= 5 && (c.name.includes(q) || q.includes(c.name))) ||
        (c.slugForm.length >= 5 && q.includes(c.slugForm)));
    return exact || contains;
  }).map((c) => c.slug);
}

/** "Thành phố", "TP." or "Tỉnh" before a province name, normalised. */
const PROVINCE_PREFIX = /^(thanhpho|tp|tinh)/;

/**
 * The one city a place search's province name means ("Hà Nội", "Thành phố
 * Huế", "Tỉnh Lâm Đồng"); null when it names none of ours, or several.
 */
export function cityForProvince(province: string | null | undefined): string | null {
  if (!province?.trim()) return null;
  const matches = matchCitySlugs(province);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) return null;
  const bare = normalizeForMatch(province).replace(PROVINCE_PREFIX, "");
  const exact = FORMS.filter(
    (c) => c.name === bare || c.slugForm === bare || c.aliases.includes(bare),
  );
  return exact.length === 1 ? exact[0].slug : null;
}
