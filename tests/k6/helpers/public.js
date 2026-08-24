/**
 * public.js — public catalog + search helpers for k6 tests.
 *
 * These endpoints don't require auth — they're the read-heavy
 * surface that drives the homepage, search results, brand pages,
 * + trip details. Great candidates for high-RPS load tests.
 *
 * ## Endpoints covered
 *
 *   GET /api/brands                    — list brands
 *   GET /api/brands/{slug}             — brand detail by slug
 *   GET /api/routes                    — list bus routes
 *   GET /api/trips/{id}                — trip detail
 *   GET /api/search                    — search trips (from/to/date)
 *   GET /api/recommendations           — homepage recommendations
 *   GET /api/campaigns                 — list active campaigns
 *   GET /api/campaigns/validate        — validate a campaign code
 *   GET /api/stats                      — public stats (counts)
 *   GET /api/places                     — list OSM places
 *   GET /api/places/search             — place autocomplete
 *   GET /api/places/reverse            — reverse geocode
 *   GET /api/reviews                   — list reviews
 *   GET /api/reviews/tags              — review tag list
 *   GET /api/routing/directions        — Valhalla directions proxy
 *   GET /api/routing/matrix           — Valhalla matrix proxy
 *   GET /api/routing/isochrone        — Valhalla isochrone proxy
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, withAuth } from '../config.js';

/**
 * List brands.
 *
 * @param {number} [limit=20]
 * @returns {object} the k6 response
 */
export function listBrands(limit = 20) {
  const res = http.get(`${BASE_URL}/api/brands?limit=${limit}`, withAuth());
  check(res, {
    'listBrands status 200': (r) => r.status === 200,
  });
  return res;
}

/**
 * Fetch a brand by slug.
 *
 * @param {string} slug — the brand's URL slug
 * @returns {object} the k6 response
 */
export function getBrand(slug) {
  const res = http.get(`${BASE_URL}/api/brands/${slug}`, withAuth());
  check(res, {
    'getBrand status 200 or 404': (r) => r.status === 200 || r.status === 404,
  });
  return res;
}

/**
 * List bus routes.
 *
 * @param {string} [brandId] — optional brand filter
 * @param {number} [limit=20]
 * @returns {object} the k6 response
 */
export function listRoutes(brandId, limit = 20) {
  let url = `${BASE_URL}/api/routes?limit=${limit}`;
  if (brandId) url += `&brandId=${brandId}`;
  const res = http.get(url, withAuth());
  check(res, {
    'listRoutes status 200': (r) => r.status === 200,
  });
  return res;
}

/**
 * Fetch a trip detail by id.
 *
 * @param {string} tripId — the trip UUID
 * @returns {object} the k6 response
 */
export function getTrip(tripId) {
  const res = http.get(`${BASE_URL}/api/trips/${tripId}`, withAuth());
  check(res, {
    'getTrip status 200 or 404': (r) => r.status === 200 || r.status === 404,
  });
  return res;
}

/**
 * Search trips — the primary search endpoint.
 *
 * @param {object} params — { from, to, date, limit?, vehicleTypes?, sort?, minSeats? }
 * @returns {object} the k6 response
 */
export function searchTrips(params) {
  let url = `${BASE_URL}/api/search?from=${encodeURIComponent(params.from)}&to=${encodeURIComponent(params.to)}&date=${params.date}`;
  url += `&limit=${params.limit || 20}`;
  if (params.vehicleTypes) url += `&vehicleTypes=${params.vehicleTypes}`;
  if (params.sort) url += `&sort=${params.sort}`;
  if (params.minSeats) url += `&minSeats=${params.minSeats}`;
  const res = http.get(url, withAuth());
  check(res, {
    'searchTrips status 200': (r) => r.status === 200,
  });
  return res;
}

/**
 * Fetch homepage recommendations.
 *
 * @returns {object} the k6 response
 */
export function getRecommendations() {
  const res = http.get(`${BASE_URL}/api/recommendations`, withAuth());
  check(res, {
    'getRecommendations status 200': (r) => r.status === 200,
  });
  return res;
}

/**
 * List active campaigns.
 *
 * @returns {object} the k6 response
 */
export function listCampaigns() {
  const res = http.get(`${BASE_URL}/api/campaigns`, withAuth());
  check(res, {
    'listCampaigns status 200': (r) => r.status === 200,
  });
  return res;
}

/**
 * Validate a campaign code against a subtotal.
 *
 * @param {string} code — the campaign code
 * @param {number} subtotal — the order subtotal
 * @returns {object} the k6 response
 */
export function validateCampaign(code, subtotal) {
  const res = http.get(
    `${BASE_URL}/api/campaigns/validate?code=${encodeURIComponent(code)}&subtotal=${subtotal}`,
    withAuth(),
  );
  check(res, {
    'validateCampaign status 200': (r) => r.status === 200,
  });
  return res;
}

/**
 * Fetch public stats (brand/route/trip counts).
 *
 * @returns {object} the k6 response
 */
export function getStats() {
  const res = http.get(`${BASE_URL}/api/stats`, withAuth());
  check(res, {
    'getStats status 200': (r) => r.status === 200,
  });
  return res;
}

/**
 * Place autocomplete (OSM-backed).
 *
 * @param {string} q — the query string (e.g. "Hà Nội")
 * @param {number} [limit=10]
 * @returns {object} the k6 response
 */
export function searchPlaces(q, limit = 10) {
  const res = http.get(
    `${BASE_URL}/api/places/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    withAuth(),
  );
  check(res, {
    'searchPlaces status 200': (r) => r.status === 200,
  });
  return res;
}

/**
 * Reverse geocode.
 *
 * @param {number} lat
 * @param {number} lon
 * @param {number} [limit=5]
 * @returns {object} the k6 response
 */
export function reverseGeocode(lat, lon, limit = 5) {
  const res = http.get(
    `${BASE_URL}/api/places/reverse?lat=${lat}&lon=${lon}&limit=${limit}`,
    withAuth(),
  );
  check(res, {
    'reverseGeocode status 200': (r) => r.status === 200,
  });
  return res;
}

/**
 * List reviews.
 *
 * @param {object} [filters] — { brandId?, routeId?, userId?, status?, limit?, offset? }
 * @returns {object} the k6 response
 */
export function listReviews(filters = {}) {
  const params = new URLSearchParams();
  if (filters.brandId) params.set('brandId', filters.brandId);
  if (filters.routeId) params.set('routeId', filters.routeId);
  if (filters.userId) params.set('userId', filters.userId);
  if (filters.status) params.set('status', filters.status);
  params.set('limit', String(filters.limit || 20));
  if (filters.offset) params.set('offset', String(filters.offset));
  const res = http.get(
    `${BASE_URL}/api/reviews?${params.toString()}`,
    withAuth(),
  );
  check(res, {
    'listReviews status 200': (r) => r.status === 200,
  });
  return res;
}

/**
 * Fetch the review tag list.
 *
 * @returns {object} the k6 response
 */
export function listReviewTags() {
  const res = http.get(`${BASE_URL}/api/reviews/tags`, withAuth());
  check(res, {
    'listReviewTags status 200': (r) => r.status === 200,
  });
  return res;
}

/**
 * Valhalla directions proxy.
 *
 * @param {string} locations — `lat,lon;lat,lon;...` (semicolon-separated)
 * @param {string} [costing='auto'] — 'auto' | 'bus' | 'pedestrian' | ...
 * @param {string} [language='vi']
 * @returns {object} the k6 response
 */
export function directions(locations, costing = 'auto', language = 'vi') {
  const res = http.get(
    `${BASE_URL}/api/routing/directions?locations=${encodeURIComponent(locations)}&costing=${costing}&language=${language}`,
    withAuth(),
  );
  check(res, {
    'directions status 200': (r) => r.status === 200,
  });
  return res;
}

/**
 * Convenience: simulate a homepage browse session.
 *
 *   1. Fetch stats (counts).
 *   2. List brands.
 *   3. Fetch recommendations.
 *   4. List campaigns.
 *   5. Search places "Hà Nội".
 *   6. List reviews (first page).
 *
 * Each step has a short think-time sleep to mimic human pacing.
 */
export function simulateBrowseSession() {
  getStats();
  sleep(0.3);
  listBrands(20);
  sleep(0.4);
  getRecommendations();
  sleep(0.3);
  listCampaigns();
  sleep(0.3);
  searchPlaces('Hà Nội', 10);
  sleep(0.3);
  listReviews({ limit: 20 });
}
