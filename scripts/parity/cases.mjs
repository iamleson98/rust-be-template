// The GET requests both servers answer. Ids come from the stage database (the importer
// keeps them), dates are relative to today in Vietnam, so the run never goes stale.
// A case is {name, group, path} or {name, group, path: (side) => string} where `side`
// is "ref" | "rust" (trip ids differ per side until both servers have opened a trip).
import { execFileSync } from 'node:child_process';

export function vnDate(offsetDays = 0) {
  const now = Date.now() + offsetDays * 86_400_000;
  return new Date(now + 7 * 3_600_000).toISOString().slice(0, 10);
}

function sql(stage, query) {
  return execFileSync('sqlite3', ['-separator', '\t', stage, query], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split('\t'));
}

export function loadFixtureIds(stage) {
  return {
    brands: sql(stage, 'select id, slug from brand order by slug').map(([id, slug]) => ({ id, slug })),
    routes: sql(stage, 'select id, brand_id from route order by id').map(([id, brandId]) => ({ id, brandId })),
    reviews: sql(stage, 'select id, brand_id, route_id from review order by id').map(([id, brandId, routeId]) => ({ id, brandId, routeId })),
    schedules: sql(stage, 'select id from schedule order by id').map(([id]) => id),
    users: Object.fromEntries(sql(stage, 'select email, id from user').map(([email, id]) => [email, id])),
    posts: sql(stage, 'select id from posts').map(([id]) => id),
    payments: sql(stage, 'select id, booking_id from payment').map(([id, bookingId]) => ({ id, bookingId })),
    bookings: sql(stage, 'select id, code from booking').map(([id, code]) => ({ id, code })),
  };
}

const q = (path, params = {}) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) s.set(k, String(v));
  const qs = s.toString();
  return qs ? `${path}?${qs}` : path;
};

// City pairs of the fixture (name as a traveller types it) and a point near each end.
export const HN = { name: 'Hà Nội', lat: 21.03, lon: 105.85 };
export const DN = { name: 'Đà Nẵng', lat: 16.05, lon: 108.21 };
export const HCM = { name: 'TP. Hồ Chí Minh', lat: 10.78, lon: 106.7 };
export const NT = { name: 'Nha Trang', lat: 12.24, lon: 109.19 };
export const DL = { name: 'Đà Lạt', lat: 11.94, lon: 108.44 };
export const SP = { name: 'Sa Pa', lat: 22.34, lon: 103.84 };

export const PAIRS = [
  [HN, DN],
  [HCM, NT],
  [HCM, DL],
  [HN, SP],
];

export function buildCases(ids) {
  const d = (n) => vnDate(n);
  const cases = [];
  const add = (group, name, path) => cases.push({ group, name: `${group}: ${name}`, path });

  // ---- city search: matching, dates, errors
  for (const n of [0, 1, 2, 3, 4, 6]) add('search', `Hà Nội → Đà Nẵng, today+${n}`, q('/api/search', { from: HN.name, to: DN.name, date: d(n) }));
  for (const [from, to] of [
    ['ha noi', 'da nang'],
    ['HN', 'DN'],
    ['Hanoi', 'Danang'],
    ['  Hà Nội  ', 'Đà Nẵng'],
    ['Đà Nẵng', 'Hà Nội'],
    ['Hà Nội', 'Sài Gòn'],
    ['Hà Nội', 'Sa Pa'],
    ['Hà Nội', 'Lào Cai'],
    ['TP. Hồ Chí Minh', 'Nha Trang'],
    ['Sài Gòn', 'Nha Trang'],
    ['hcm', 'đà lạt'],
    ['Huế', 'Vinh'],
  ]) add('search', `"${from}" → "${to}"`, q('/api/search', { from, to, date: d(3) }));
  for (const [what, params] of [
    ['no from', { to: DN.name, date: d(3) }],
    ['no to', { from: HN.name, date: d(3) }],
    ['blank from', { from: ' ', to: DN.name, date: d(3) }],
    ['no date', { from: HN.name, to: DN.name }],
    ['bad date', { from: HN.name, to: DN.name, date: '2026-02-30' }],
    ['date format', { from: HN.name, to: DN.name, date: '18/11/2026' }],
    ['past date', { from: HN.name, to: DN.name, date: '2026-01-05' }],
    ['far future', { from: HN.name, to: DN.name, date: d(200) }],
  ]) add('search-errors', what, q('/api/search', params));

  // ---- city search: filters, facets, sort, paging (the REF trip-search/-results/-options tests)
  const base = { from: HN.name, to: DN.name, date: d(3) };
  const variants = [
    ['limit 1', { limit: 1 }],
    ['limit 2 offset 1', { limit: 2, offset: 1 }],
    ['limit 2 offset 2', { limit: 2, offset: 2 }],
    ['offset past the end', { offset: 50 }],
    ['limit 0 clamps to 1', { limit: 0 }],
    ['limit 1000 clamps to 100', { limit: 1000 }],
    ['limit abc', { limit: 'abc' }],
    ['offset 1.5', { offset: '1.5' }],
    ['sort price', { sort: 'price' }],
    ['sort rating', { sort: 'rating' }],
    ['sort departure', { sort: 'departure' }],
    ['sort distance is the default here', { sort: 'distance' }],
    ['sort bogus', { sort: 'cheapest' }],
    ['sort price paged', { sort: 'price', limit: 1, offset: 1 }],
    ['minSeats 1', { minSeats: 1 }],
    ['minSeats 4', { minSeats: 4 }],
    ['minSeats 5', { minSeats: 5 }],
    ['minSeats 17', { minSeats: 17 }],
    ['minSeats 0 clamps to 1', { minSeats: 0 }],
    ['minSeats x', { minSeats: 'x' }],
    ['vehicleTypes limousine', { vehicleTypes: 'limousine' }],
    ['vehicleTypes limousine, sleeper', { vehicleTypes: 'limousine, sleeper' }],
    ['vehicleTypes unknown', { vehicleTypes: 'rocket' }],
    ['brands viet-bus', { brands: 'viet-bus' }],
    ['brands viet-bus,phuong-trang', { brands: 'viet-bus,phuong-trang' }],
    ['brands blanks', { brands: 'viet-bus,,' }],
    ['priceMin 300000', { priceMin: 300000 }],
    ['priceMax 300000', { priceMax: 300000 }],
    ['priceMin+Max band', { priceMin: 280000, priceMax: 450000 }],
    ['priceMax 0 is ignored', { priceMax: 0 }],
    ['priceMin 1.5', { priceMin: '1.5' }],
    ['hours 0-6', { hours: '0-6' }],
    ['hours 6-12', { hours: '6-12' }],
    ['hours 12-18,18-24', { hours: '12-18,18-24' }],
    ['hours unknown band', { hours: '6-12,noon' }],
    ['minRating 4.5', { minRating: 4.5 }],
    ['minRating 4.1', { minRating: 4.1 }],
    ['minRating 0', { minRating: 0 }],
    ['minRating high', { minRating: 'high' }],
    ['plentyOfSeats true', { plentyOfSeats: 'true' }],
    ['plentyOfSeats false', { plentyOfSeats: 'false' }],
    ['plentyOfSeats yes', { plentyOfSeats: 'yes' }],
    ['amenities wifi', { amenities: 'wifi' }],
    ['amenities wifi,blanket', { amenities: 'wifi,blanket' }],
    ['amenities snack', { amenities: 'snack' }],
    ['amenities unknown', { amenities: 'jacuzzi' }],
    ['departAfter 06:30', { departAfter: '06:30' }],
    ['departAfter 08:00', { departAfter: '08:00' }],
    ['departAfter 12:00', { departAfter: '12:00' }],
    ['departAfter 23:59', { departAfter: '23:59' }],
    ['departAfter blank', { departAfter: '%20' }],
    ['departAfter 24:00', { departAfter: '24:00' }],
    ['departAfter morning', { departAfter: 'morning' }],
    ['departAfter 06:30:00', { departAfter: '06:30:00' }],
    ['filters combined', { vehicleTypes: 'limousine,sleeper', priceMax: 500000, minSeats: 2, sort: 'price', amenities: 'wifi' }],
    ['filters + page', { brands: 'viet-bus,phuong-trang', sort: 'rating', limit: 1, offset: 1 }],
  ];
  for (const [what, extra] of variants) add('search-options', what, q('/api/search', { ...base, ...extra }));
  // The same filters on another city pair and on a date with every schedule running.
  for (const [what, extra] of [
    ['HCM→Nha Trang price asc', { sort: 'price' }],
    ['HCM→Nha Trang rating', { sort: 'rating' }],
    ['HCM→Nha Trang hours 18-24', { hours: '18-24' }],
    ['HCM→Nha Trang minRating 4.3', { minRating: 4.3 }],
  ]) add('search-options', what, q('/api/search', { from: HCM.name, to: NT.name, date: d(3), ...extra }));
  add('search-options', 'HCM→Đà Lạt default', q('/api/search', { from: HCM.name, to: DL.name, date: d(2) }));
  add('search-options', 'Hà Nội→Sa Pa default', q('/api/search', { from: HN.name, to: SP.name, date: d(2) }));
  for (const n of [1, 2, 4, 5]) add('search-options', `Hà Nội→Đà Nẵng sort price, today+${n}`, q('/api/search', { ...base, date: d(n), sort: 'price' }));

  // ---- coordinate search
  const geo = (a, b, extra = {}) => ({ fromLat: a.lat, fromLon: a.lon, toLat: b.lat, toLon: b.lon, date: d(3), ...extra });
  add('geo', 'HN → ĐN default (distance)', q('/api/search/geo', geo(HN, DN)));
  add('geo', 'HN → ĐN with fromCity+toCity', q('/api/search/geo', geo(HN, DN, { fromCity: 'Hà Nội', toCity: 'Đà Nẵng' })));
  add('geo', 'HN → ĐN cities only one given', q('/api/search/geo', geo(HN, DN, { fromCity: 'Hà Nội' })));
  add('geo', 'HN → ĐN cities, reverse direction', q('/api/search/geo', geo(DN, HN, { fromCity: 'Đà Nẵng', toCity: 'Hà Nội' })));
  add('geo', 'HN → ĐN reverse coordinates', q('/api/search/geo', geo(DN, HN)));
  add('geo', 'HCM → NT', q('/api/search/geo', geo(HCM, NT)));
  add('geo', 'HCM → NT with cities', q('/api/search/geo', geo(HCM, NT, { fromCity: 'TP. Hồ Chí Minh', toCity: 'Nha Trang' })));
  add('geo', 'HCM → ĐL with cities', q('/api/search/geo', geo(HCM, DL, { fromCity: 'TP. Hồ Chí Minh', toCity: 'Đà Lạt' })));
  add('geo', 'HN → Sa Pa with cities', q('/api/search/geo', geo(HN, SP, { fromCity: 'Hà Nội', toCity: 'Lào Cai' })));
  add('geo', 'maxDistanceKm 1', q('/api/search/geo', geo(HN, DN, { maxDistanceKm: 1 })));
  add('geo', 'maxDistanceKm 5', q('/api/search/geo', geo(HN, DN, { maxDistanceKm: 5 })));
  add('geo', 'maxDistanceKm 500 (clamp)', q('/api/search/geo', geo(HN, DN, { maxDistanceKm: 500 })));
  add('geo', 'maxDistanceKm 0 (clamp)', q('/api/search/geo', geo(HN, DN, { maxDistanceKm: 0 })));
  add('geo', 'near a stop, not a city centre', q('/api/search/geo', geo({ lat: 21.0, lon: 105.8 }, { lat: 16.1, lon: 108.2 })));
  add('geo', 'sort price', q('/api/search/geo', geo(HN, DN, { sort: 'price' })));
  add('geo', 'sort rating', q('/api/search/geo', geo(HN, DN, { sort: 'rating' })));
  add('geo', 'sort departure', q('/api/search/geo', geo(HN, DN, { sort: 'departure' })));
  add('geo', 'sort bogus', q('/api/search/geo', geo(HN, DN, { sort: 'cheapest' })));
  add('geo', 'minSeats 4', q('/api/search/geo', geo(HN, DN, { minSeats: 4 })));
  add('geo', 'minSeats 17', q('/api/search/geo', geo(HN, DN, { minSeats: 17 })));
  add('geo', 'departAfter 07:00', q('/api/search/geo', geo(HN, DN, { departAfter: '07:00' })));
  add('geo', 'departAfter 13:00 + cities', q('/api/search/geo', geo(HN, DN, { departAfter: '13:00', fromCity: 'Hà Nội', toCity: 'Đà Nẵng' })));
  add('geo', 'limit 1', q('/api/search/geo', geo(HN, DN, { limit: 1 })));
  add('geo', 'limit 1 offset 1', q('/api/search/geo', geo(HN, DN, { limit: 1, offset: 1 })));
  add('geo', 'filters (vehicle, price, amenities)', q('/api/search/geo', geo(HN, DN, { vehicleTypes: 'limousine', priceMax: 300000, amenities: 'wifi' })));
  add('geo', 'filters hours + brands', q('/api/search/geo', geo(HN, DN, { hours: '6-12', brands: 'viet-bus,phuong-trang' })));
  add('geo', 'plentyOfSeats', q('/api/search/geo', geo(HN, DN, { plentyOfSeats: 'true' })));
  add('geo', 'minRating 4.3', q('/api/search/geo', geo(HN, DN, { minRating: 4.3 })));
  add('geo', 'no results (sea)', q('/api/search/geo', geo({ lat: 10, lon: 115 }, { lat: 9, lon: 116 })));
  add('geo', 'date +1', q('/api/search/geo', geo(HN, DN, { date: d(1) })));
  add('geo', 'date +5', q('/api/search/geo', geo(HN, DN, { date: d(5) })));
  add('geo-errors', 'missing fromLat', q('/api/search/geo', { fromLon: 1, toLat: 1, toLon: 1, date: d(3) }));
  add('geo-errors', 'missing toLon', q('/api/search/geo', { fromLat: 1, fromLon: 1, toLat: 1, date: d(3) }));
  add('geo-errors', 'fromLat NaN', q('/api/search/geo', geo(HN, DN, { fromLat: 'abc' })));
  add('geo-errors', 'latitude out of range', q('/api/search/geo', geo(HN, DN, { fromLat: 91 })));
  add('geo-errors', 'bad date', q('/api/search/geo', geo(HN, DN, { date: 'tomorrow' })));
  add('geo-errors', 'no date', q('/api/search/geo', { fromLat: 1, fromLon: 1, toLat: 1, toLon: 1 }));

  // ---- recommendations, stats, catalog
  add('catalog', 'recommendations', '/api/recommendations');
  add('catalog', 'stats', '/api/stats');
  add('catalog', 'brands', '/api/brands');
  add('catalog', 'brands limit 2', q('/api/brands', { limit: 2 }));
  add('catalog', 'routes', '/api/routes');
  add('catalog', 'routes limit 3 offset 2', q('/api/routes', { limit: 3, offset: 2 }));
  add('catalog', 'routes limit 0', q('/api/routes', { limit: 0 }));
  add('catalog', 'routes limit abc', q('/api/routes', { limit: 'abc' }));
  for (const b of ids.brands) {
    add('brand', `brand ${b.slug}`, `/api/brands/${b.slug}`);
    add('brand', `profile ${b.slug}`, `/api/brands/${b.slug}/profile`);
    add('catalog', `routes of ${b.slug}`, q('/api/routes', { brand_id: b.id }));
  }
  add('brand', 'brand by id', `/api/brands/${ids.brands[0].id}`);
  add('brand', 'unknown brand slug', '/api/brands/khong-co');
  add('brand', 'unknown brand profile', '/api/brands/khong-co/profile');
  add('brand', 'brand slug uppercase', '/api/brands/VIET-BUS');
  add('catalog', 'routes bad brand_id', q('/api/routes', { brand_id: 'nope' }));
  for (const r of ids.routes) add('pictures', `route ${r.id.slice(0, 8)}`, `/api/routes/${r.id}/pictures`);
  add('pictures', 'bad id', '/api/routes/not-a-uuid/pictures');
  add('pictures', 'unknown id', '/api/routes/00000000-0000-4000-8000-000000000000/pictures');

  // ---- reviews
  add('reviews', 'list', '/api/reviews');
  add('reviews', 'limit 1', q('/api/reviews', { limit: 1 }));
  add('reviews', 'limit 1 offset 1', q('/api/reviews', { limit: 1, offset: 1 }));
  add('reviews', 'limit 1000', q('/api/reviews', { limit: 1000 }));
  add('reviews', 'limit abc', q('/api/reviews', { limit: 'abc' }));
  add('reviews', 'bad brand_id', q('/api/reviews', { brand_id: 'nope' }));
  add('reviews', 'tags', '/api/reviews/tags');
  add('reviews', 'stats (all)', '/api/reviews/stats');
  for (const b of ids.brands) {
    add('reviews', `list of ${b.slug}`, q('/api/reviews', { brand_id: b.id }));
    add('reviews', `stats of ${b.slug}`, q('/api/reviews/stats', { brand_id: b.id }));
  }
  for (const r of ids.reviews) {
    add('reviews', `list route ${r.routeId.slice(0, 8)}`, q('/api/reviews', { route_id: r.routeId }));
    add('reviews', `stats route ${r.routeId.slice(0, 8)}`, q('/api/reviews/stats', { route_id: r.routeId }));
    add('reviews', `review ${r.id.slice(0, 8)}`, `/api/reviews/${r.id}`);
  }

  // ---- places (the REF has no index of its own locally: structure and top results only)
  add('places', 'popular', '/api/places');
  add('places', 'popular limit 3', q('/api/places', { limit: 3 }));
  add('places', 'search blank', q('/api/places/search', { q: '' }));
  for (const text of ['ha noi', 'Hồ Gươm', 'ben xe my dinh', 'san bay noi bai', 'da nang', 'x', 'zzzzqq'])
    add('places', `search "${text}"`, q('/api/places/search', { q: text }));
  add('places', 'search near a point', q('/api/places/search', { q: 'ben xe', lat: 21.03, lon: 105.85 }));
  add('places', 'search lat without lon', q('/api/places/search', { q: 'ben xe', lat: 21.03 }));
  add('places', 'search limit 2', q('/api/places/search', { q: 'ha noi', limit: 2 }));
  add('places', 'search limit 500', q('/api/places/search', { q: 'ha noi', limit: 500 }));
  add('places', 'search no q', '/api/places/search');
  add('places', 'reverse Hà Nội', q('/api/places/reverse', { lat: 21.0285, lon: 105.8542 }));
  add('places', 'reverse the sea', q('/api/places/reverse', { lat: 10, lon: 115 }));
  add('places', 'reverse out of range', q('/api/places/reverse', { lat: 200, lon: 105 }));
  add('places', 'reverse no lon', q('/api/places/reverse', { lat: 21 }));
  add('places', 'reverse text', q('/api/places/reverse', { lat: 'a', lon: 'b' }));

  // ---- public odds and ends
  add('misc', 'campaigns', '/api/campaigns');
  add('misc', 'posts', '/api/posts');
  for (const id of ids.posts) add('misc', `post ${id.slice(0, 8)}`, `/api/posts/${id}`);
  add('misc', 'payment providers', '/api/payments/providers');
  add('misc', 'oauth providers', '/api/auth/oauth/providers');
  add('misc', 'me without a session', '/api/auth/me');
  add('misc', 'bookings without a session', '/api/bookings');
  add('misc', 'unknown API route', '/api/khong-co-route-nay');
  add('misc', 'media missing', '/api/media/routes/none/none.webp');
  add('misc', 'media bad key', '/api/media/..%2Fetc%2Fpasswd');
  add('misc', 'nullclaw status', '/api/nullclaw/status');
  add('misc', 'presence without a session', '/api/presence/staff');
  add('misc', 'trip detail bad id', '/api/trips/not-a-uuid');
  add('misc', 'trip detail unknown id', '/api/trips/00000000-0000-4000-8000-000000000000');

  // ---- SEO files
  add('seo', 'robots.txt', '/robots.txt');
  add('seo', 'sitemap.xml', '/sitemap.xml');
  add('seo', 'ads.txt', '/ads.txt');
  return cases;
}

/** Trip detail cases, built per side once both have opened the trips (run.mjs). */
export function tripDetailCases(tripIdsBySide, wanted) {
  return wanted.map(({ key, label }) => ({
    group: 'trip',
    name: `trip: detail ${label}`,
    path: (side) => `/api/trips/${tripIdsBySide[side].get(key)}`,
  }));
}

/** Logged-in GETs: the pbkdf2 user of the fixture. */
export function userCases(ids) {
  const mine = ids.bookings.at(0);
  const cases = [
    ['auth/me', '/api/auth/me'],
    ['my bookings', '/api/bookings'],
    ['my bookings limit 1', q('/api/bookings', { limit: 1 })],
    ['notifications', '/api/notifications'],
    ['loyalty', '/api/loyalty'],
    ['my coupons', '/api/coupons/mine'],
    ['my reviews', '/api/reviews/mine'],
    ['price alerts', '/api/price-alerts'],
    ['users list as a customer (forbidden)', '/api/users'],
    ['admin stats as a customer (forbidden)', '/api/admin/stats'],
  ].map(([name, path]) => ({ group: 'user', name: `user: ${name}`, path }));
  if (mine) {
    cases.push({ group: 'user', name: 'user: booking by id', path: `/api/bookings/${mine.id}` });
    cases.push({ group: 'user', name: 'user: booking by code', path: `/api/bookings/${mine.code}` });
    cases.push({ group: 'user', name: 'user: payment of a booking', path: `/api/payments/booking/${mine.id}` });
  }
  return cases;
}

/** Admin GETs, with an access token minted for the fixture's admin (same JWT secret on both sides). */
export function adminCases() {
  return [
    'stats',
    'brands',
    'routes',
    'schedules',
    'vehicle-types',
    'bus-layouts',
    'addresses',
    'pickup-points',
    'campaigns',
    'coupons',
    'payments',
    'payments/summary',
    'reviews',
    'reviews/summary',
    'bookings',
    'bookings/stats',
    'cron-jobs',
    'system',
  ].map((p) => ({ group: 'admin', name: `admin: ${p}`, path: `/api/admin/${p}` }));
}
