// Normalisation, diffing and classification for the differential run (run.mjs).
//
// A response is reduced to {status, contentType, cacheControl, body}. JSON bodies are
// walked: timestamps with an offset become one canonical instant, trip and seat ids
// (which each side generates on its own when a trip is first opened) become names built
// from what they identify, and everything else is compared as is.

const TIMESTAMP = /^\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:?\d\d)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function canonicalInstant(value) {
  if (!TIMESTAMP.test(value)) return value;
  const t = Date.parse(value.replace(' ', 'T'));
  return Number.isNaN(t) ? value : new Date(t).toISOString();
}

/** Every `{tripId|id, scheduleId, departureDate}` object in a body, as id -> stable name. */
export function collectTripNames(node, names = new Map()) {
  if (Array.isArray(node)) {
    for (const n of node) collectTripNames(n, names);
  } else if (node && typeof node === 'object') {
    const id = node.tripId ?? (node.scheduleId && node.departureDate ? node.id : undefined);
    if (typeof id === 'string' && UUID.test(id) && node.scheduleId && node.departureDate) {
      names.set(id, `trip[${String(node.scheduleId).slice(0, 8)}@${node.departureDate}]`);
    } else if (names.has(id)) {
      // already named by a fuller object
    } else if (typeof id === 'string' && UUID.test(id) && node.routeId && node.date && node.departureTime) {
      // brand profile: no schedule id, the route, day and time name the trip
      names.set(id, `trip[route ${String(node.routeId).slice(0, 8)} @${node.date} ${node.departureTime}]`);
    }
    for (const v of Object.values(node)) collectTripNames(v, names);
  }
  return names;
}

/** Seats of a trip detail: seat id -> `seat[<trip>:<label>]`. */
export function collectSeatNames(body, tripNames) {
  const names = new Map();
  const trip = body?.trip;
  if (!trip || !Array.isArray(body.seats)) return names;
  const tripName = tripNames.get(trip.id) ?? 'trip';
  for (const s of body.seats) {
    if (typeof s.id === 'string' && s.label !== undefined) names.set(s.id, `seat[${tripName}:${s.label}]`);
  }
  return names;
}

// Fields that differ on every call by design.
// (`score` is each place engine's own ranking number: only the order of hits is compared.)
const VOLATILE = new Set(['serverTime', 'time', 'latencyMs', 'score']);

function mapIds(node, names) {
  if (typeof node === 'string') {
    const hit = names.get(node);
    return hit ?? canonicalInstant(node);
  }
  if (Array.isArray(node)) return node.map((n) => mapIds(n, names));
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      // The Worker writes `null` where the Rust API leaves the key out: both mean "no value".
      if (v === null || VOLATILE.has(k)) continue;
      out[k] = mapIds(v, names);
    }
    return out;
  }
  return node;
}

export function normaliseJson(body, names) {
  return mapIds(body, names);
}

const KEYS = ['tripId', 'id', 'slug', 'key', 'value', 'code', 'label'];
function keyOf(el) {
  if (!el || typeof el !== 'object') return undefined;
  for (const k of KEYS) if (typeof el[k] === 'string' || typeof el[k] === 'number') return `${k}=${el[k]}`;
  return undefined;
}

function isPrimitive(v) {
  return v === null || typeof v !== 'object';
}

/**
 * Differences between two JSON values: {path, kind, ref, rust}. kind is one of
 * changed | missing (in Rust) | extra (in Rust) | order | length | type.
 * Array items that carry an id-like key are matched by it, the rest by position.
 */
export function diffJson(ref, rust, path = '$', out = []) {
  if (isPrimitive(ref) || isPrimitive(rust)) {
    if (ref !== rust) out.push({ path, kind: ref === undefined ? 'extra' : rust === undefined ? 'missing' : 'changed', ref, rust });
    return out;
  }
  if (Array.isArray(ref) !== Array.isArray(rust)) {
    out.push({ path, kind: 'type', ref, rust });
    return out;
  }
  if (Array.isArray(ref)) {
    const rk = ref.map(keyOf);
    const tk = rust.map(keyOf);
    const keyed = rk.every(Boolean) && tk.every(Boolean) && new Set(rk).size === rk.length && new Set(tk).size === tk.length;
    if (keyed) {
      const rustBy = new Map(rust.map((e, i) => [tk[i], e]));
      const refBy = new Map(ref.map((e, i) => [rk[i], e]));
      for (const [i, k] of rk.entries()) {
        if (!rustBy.has(k)) out.push({ path: `${path}[${k}]`, kind: 'missing', ref: ref[i], rust: undefined });
        else diffJson(ref[i], rustBy.get(k), `${path}[${k}]`, out);
      }
      for (const [i, k] of tk.entries()) {
        if (!refBy.has(k)) out.push({ path: `${path}[${k}]`, kind: 'extra', ref: undefined, rust: rust[i] });
      }
      const common = rk.filter((k) => rustBy.has(k));
      const rustOrder = tk.filter((k) => refBy.has(k));
      if (common.join('|') !== rustOrder.join('|')) {
        out.push({ path, kind: 'order', ref: common.map((k) => k.split('=')[1]), rust: rustOrder.map((k) => k.split('=')[1]) });
      }
      return out;
    }
    if (ref.length !== rust.length) out.push({ path, kind: 'length', ref: ref.length, rust: rust.length });
    for (let i = 0; i < Math.min(ref.length, rust.length); i++) diffJson(ref[i], rust[i], `${path}[${i}]`, out);
    return out;
  }
  for (const k of new Set([...Object.keys(ref), ...Object.keys(rust)])) {
    if (!(k in rust)) out.push({ path: `${path}.${k}`, kind: 'missing', ref: ref[k], rust: undefined });
    else if (!(k in ref)) out.push({ path: `${path}.${k}`, kind: 'extra', ref: undefined, rust: rust[k] });
    else diffJson(ref[k], rust[k], `${path}.${k}`, out);
  }
  return out;
}

/** A line diff for text bodies (sitemap, robots): first differing lines only. */
export function diffText(ref, rust) {
  const a = ref.split('\n');
  const b = rust.split('\n');
  const out = [];
  const bs = new Set(b);
  const as = new Set(a);
  for (const l of a) if (!bs.has(l)) out.push({ path: '$text', kind: 'missing', ref: l, rust: undefined });
  for (const l of b) if (!as.has(l)) out.push({ path: '$text', kind: 'extra', ref: undefined, rust: l });
  return out;
}

/** The rule of `rules` explaining a diff of case `name`, or null. */
export function explain(rules, name, diff) {
  for (const r of rules) {
    if (r.case && !r.case.test(name)) continue;
    if (r.path && !r.path.test(diff.path)) continue;
    if (r.kind && r.kind !== diff.kind) continue;
    if (r.when && !r.when(diff)) continue;
    return r;
  }
  return null;
}

export function show(v) {
  if (v === undefined) return '(absent)';
  const s = JSON.stringify(v);
  return s.length > 140 ? `${s.slice(0, 137)}...` : s;
}
