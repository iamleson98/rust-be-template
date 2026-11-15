#!/usr/bin/env node
// Differential run: the same GET requests against the Cloudflare reference (REF, `next dev`
// on a local D1) and the Rust server (on the imported copy of the same stage database).
//
//   node scripts/parity/run.mjs --stage <stage.db> [--ref http://localhost:3001]
//        [--rust http://localhost:3102] [--out <dir>] [--only <regex>] [--doc docs/PARITY.md]
//
// Needs: both servers up (serve-ref.sh, serve-rust.sh), JWT_SECRET equal on both (env.sh
// does that), the sqlite3 CLI. Writes <out>/results.json and <out>/report.md; with --doc,
// the summary table is spliced into that file between the PARITY-RESULTS markers.
import { createHmac, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { adminCases, buildCases, loadFixtureIds, PAIRS, tripDetailCases, userCases, vnDate } from './cases.mjs';
import { collectSeatNames, collectTripNames, diffJson, diffText, explain, normaliseJson, show } from './lib.mjs';
import { rules } from './rules.mjs';

const { values: args } = parseArgs({
  options: {
    stage: { type: 'string' },
    ref: { type: 'string', default: 'http://localhost:3001' },
    rust: { type: 'string', default: 'http://localhost:3102' },
    out: { type: 'string', default: 'parity-out' },
    only: { type: 'string' },
    doc: { type: 'string' },
    secret: { type: 'string', default: process.env.JWT_SECRET ?? 'local-parity-secret-at-least-32-bytes-long-aaaa' },
  },
});
if (!args.stage) throw new Error('--stage <stage.db> is required');
const base = { ref: args.ref, rust: args.rust };
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const b64u = (b) => Buffer.from(b).toString('base64url');
function mintAccessToken(userId) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ typ: 'access', sub: userId, iss: 'backend', iat: now, exp: now + 3600, jti: randomUUID() }));
  const sig = createHmac('sha256', args.secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

async function get(side, path, cookie) {
  const headers = { 'user-agent': UA, accept: 'application/json, text/plain, */*' };
  if (cookie) headers.cookie = cookie;
  const started = Date.now();
  try {
    const res = await fetch(base[side] + path, { headers, redirect: 'manual' });
    const text = await res.text();
    return {
      status: res.status,
      contentType: (res.headers.get('content-type') ?? '').split(';')[0].trim(),
      cacheControl: res.headers.get('cache-control') ?? '',
      location: res.headers.get('location') ?? '',
      text,
      ms: Date.now() - started,
    };
  } catch (e) {
    return { status: 0, contentType: '', cacheControl: '', location: '', text: String(e), ms: 0 };
  }
}

async function login(side, email, password) {
  const res = await fetch(`${base[side]}/api/auth/login`, {
    method: 'POST',
    headers: { 'user-agent': UA, 'content-type': 'application/json', origin: base[side] },
    body: JSON.stringify({ email, password }),
    redirect: 'manual',
  });
  const cookies = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).filter((c) => c.startsWith('access_token') || c.startsWith('refresh_token'));
  return { status: res.status, cookie: cookies.join('; ') };
}

/** What two place engines must agree on: the hit's fields, and the first hit. */
function placeView(body) {
  const items = Array.isArray(body.items) ? body.items : [];
  const [first] = items;
  return {
    engine: body.engine,
    topFields: first ? Object.keys(first).filter((k) => k !== 'score').sort() : [],
    top: first ? `${first.id} ${first.name}` : '(none)',
    answered: items.length > 0,
  };
}

const ids = loadFixtureIds(args.stage);
const sides = ['ref', 'rust'];

// 1. Open the trips: each server creates a trip on demand the first time it is searched, with
//    ids of its own. Learn them per side, keyed by schedule and date.
const tripIds = { ref: new Map(), rust: new Map() };
for (const side of sides) {
  for (const [from, to] of PAIRS) {
    for (let n = 0; n <= 6; n++) {
      const date = vnDate(n);
      const path = `/api/search?${new URLSearchParams({ from: from.name, to: to.name, date, limit: '100' })}`;
      const r = await get(side, path);
      if (r.status !== 200) continue;
      for (const [id, name] of collectTripNames(JSON.parse(r.text))) tripIds[side].set(name, id);
    }
  }
}
const common = [...tripIds.ref.keys()].filter((k) => tripIds.rust.has(k)).sort();
const detailKeys = common.slice(0, 16).map((key) => ({ key, label: key.replace('trip', '').replace(/[[\]]/g, '') }));

// 2. Sessions.
const userLogin = { ref: await login('ref', 'worker.user@example.com', 'mật-khẩu Ü 123'), rust: await login('rust', 'worker.user@example.com', 'mật-khẩu Ü 123') };
const adminToken = mintAccessToken(ids.users['admin@example.com']);
const cookieFor = { user: { ref: userLogin.ref.cookie, rust: userLogin.rust.cookie }, admin: { ref: `access_token=${adminToken}`, rust: `access_token=${adminToken}` } };

const all = [
  ...buildCases(ids),
  ...tripDetailCases(tripIds, detailKeys),
  ...userCases(ids),
  ...adminCases(),
];
const only = args.only ? new RegExp(args.only, 'i') : null;
const selected = all.filter((c) => !only || only.test(c.name));

// 3. Fetch everything, learn trip and seat names, then normalise and diff.
const raw = [];
for (const c of selected) {
  const session = c.group === 'user' ? 'user' : c.group === 'admin' ? 'admin' : null;
  const row = { case: c, res: {} };
  for (const side of sides) {
    const path = typeof c.path === 'function' ? c.path(side) : c.path;
    row.res[side] = await get(side, path, session ? cookieFor[session][side] : undefined);
    row.res[side].path = path;
  }
  raw.push(row);
}

const names = { ref: new Map(), rust: new Map() };
for (const side of sides) {
  for (const [name, id] of tripIds[side]) names[side].set(id, name);
  for (const { res } of raw) {
    try {
      collectTripNames(JSON.parse(res[side].text), names[side]);
    } catch {
      /* not JSON */
    }
  }
  for (const { res } of raw) {
    try {
      for (const [k, v] of collectSeatNames(JSON.parse(res[side].text), names[side])) names[side].set(k, v);
    } catch {
      /* not JSON */
    }
  }
}

const results = [];
for (const { case: c, res } of raw) {
  const parse = (side) => {
    const r = res[side];
    if (!r.contentType.includes('json')) return { json: undefined, text: r.text };
    try {
      return { json: normaliseJson(JSON.parse(r.text), names[side]), text: undefined };
    } catch {
      return { json: undefined, text: r.text };
    }
  };
  let a = parse('ref');
  let b = parse('rust');
  if (c.group === 'places' && /^\/api\/places(\/search)?(\?|$)/.test(c.path) && a.json && b.json) {
    // Two different engines rank their own way: compare the response shape and the best hit.
    a = { json: placeView(a.json) };
    b = { json: placeView(b.json) };
  }
  const diffs = [];
  for (const f of ['status', 'contentType']) {
    if (res.ref[f] !== res.rust[f]) diffs.push({ path: `$${f}`, kind: 'changed', ref: res.ref[f], rust: res.rust[f] });
  }
  if (res.ref.cacheControl !== res.rust.cacheControl) diffs.push({ path: '$cacheControl', kind: 'changed', ref: res.ref.cacheControl, rust: res.rust.cacheControl });
  if (res.ref.location !== res.rust.location) diffs.push({ path: '$location', kind: 'changed', ref: res.ref.location, rust: res.rust.location });
  if (a.json !== undefined && b.json !== undefined) diffJson(a.json, b.json, '$', diffs);
  else if (a.text !== undefined && b.text !== undefined && res.ref.status === res.rust.status && /^(text|application\/xml)/.test(res.ref.contentType)) diffs.push(...diffText(a.text, b.text));
  else if (a.json !== undefined || b.json !== undefined) diffs.push({ path: '$body', kind: 'type', ref: res.ref.text.slice(0, 100), rust: res.rust.text.slice(0, 100) });
  const classified = diffs.map((d) => {
    const rule = explain(rules, c.name, d);
    return { ...d, class: rule ? rule.class : 'BUG', rule: rule?.id, reason: rule?.reason };
  });
  const status = classified.length === 0 ? 'identical' : classified.every((d) => d.class === 'explained') ? 'explained' : 'BUG';
  results.push({ name: c.name, group: c.group, refPath: res.ref.path, rustPath: res.rust.path, status, refStatus: res.ref.status, rustStatus: res.rust.status, diffs: classified });
}

// 4. Report.
const count = (s) => results.filter((r) => r.status === s).length;
const totals = { cases: results.length, identical: count('identical'), explained: count('explained'), BUG: count('BUG') };
const bugRules = new Map();
for (const r of results) for (const d of r.diffs) if (d.class === 'BUG') bugRules.set(d.rule ?? 'UNCLASSIFIED', (bugRules.get(d.rule ?? 'UNCLASSIFIED') ?? new Set()).add(r.name));
mkdirSync(args.out, { recursive: true });
writeFileSync(join(args.out, 'results.json'), JSON.stringify({ totals, results }, null, 1));

const lines = [];
lines.push(`${totals.cases} requests: ${totals.identical} identical, ${totals.explained} explained, ${totals.BUG} BUG.`, '');
lines.push('Defects seen:', '');
for (const [id, cases] of bugRules) lines.push(`- ${id}: ${cases.size} request(s)`);
lines.push('');
lines.push('| # | case | REF | Rust | result |', '|---|---|---|---|---|');
results.forEach((r, i) => lines.push(`| ${i + 1} | ${r.name.replaceAll('|', '/')} | ${r.refStatus} | ${r.rustStatus} | ${r.status} |`));
// The summary (counts, defects, one line per request) is what goes into the doc; the differences
// themselves, request by request, stay in report.md.
const summary = lines.length;
const details = results.filter((r) => r.status !== 'identical');
lines.push('', '### Differences', '');
for (const r of details) {
  lines.push(`#### ${r.name} (${r.status})`, '', `REF \`${r.refPath}\` / Rust \`${r.rustPath}\``, '');
  for (const d of r.diffs.slice(0, 12)) {
    lines.push(`- ${d.class === 'BUG' ? `**${d.rule ?? 'UNCLASSIFIED BUG'}**` : d.rule}: \`${d.path}\` ${d.kind}: REF ${show(d.ref)} | Rust ${show(d.rust)}${d.reason ? ` (${d.reason})` : ''}`);
  }
  if (r.diffs.length > 12) lines.push(`- ... ${r.diffs.length - 12} more`);
  lines.push('');
}
writeFileSync(join(args.out, 'report.md'), lines.join('\n'));
console.log(`${totals.cases} requests: ${totals.identical} identical, ${totals.explained} explained, ${totals.BUG} BUG`);
console.log(`report: ${join(args.out, 'report.md')}`);

if (args.doc) {
  const begin = '<!-- PARITY-RESULTS:BEGIN -->';
  const end = '<!-- PARITY-RESULTS:END -->';
  const doc = readFileSync(args.doc, 'utf8');
  const i = doc.indexOf(begin);
  const j = doc.indexOf(end);
  if (i < 0 || j < 0) throw new Error(`${args.doc} has no PARITY-RESULTS markers`);
  writeFileSync(args.doc, `${doc.slice(0, i + begin.length)}\n${lines.slice(0, summary).join('\n')}\n${doc.slice(j)}`);
}
