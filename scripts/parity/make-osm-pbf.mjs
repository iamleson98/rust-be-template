#!/usr/bin/env node
// Writes a tiny, hand-made OpenStreetMap extract (nodes only, uncompressed blobs) so the
// place search of both servers can be exercised without Geofabrik's 333 MB Vietnam file:
//
//   node scripts/parity/make-osm-pbf.mjs <out.osm.pbf> [--pad]
//
// `places-build` refuses a download under 100 MiB (a failed download must never replace the
// live index), so --pad appends data blocks that carry only an unused string table until the
// file passes that floor; the extractor reads them and finds no places in them.
//
// About 15 100 named nodes: the 63 province seats of the city list, a bus station for each of
// them, three airports, the big Hà Nội and Sài Gòn stations and a few suburbs, plus 15 000
// numbered hamlets so the index clears `places-build`'s 15 000-place sanity floor. Each of the
// 63 provinces is a square administrative boundary (relation, admin_level 4) around its seat,
// because places outside a served province are dropped. Coordinates are the towns' own,
// rounded: good enough to tell near from far, not a survey.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const CITIES = [
  ['Hà Nội', 21.0285, 105.8542, 'city'],
  ['Thành phố Hồ Chí Minh', 10.7769, 106.7009, 'city', ['Sài Gòn', 'TP. Hồ Chí Minh', 'Ho Chi Minh City']],
  ['Đà Nẵng', 16.0544, 108.2022, 'city', ['Da Nang']],
  ['Hải Phòng', 20.8449, 106.6881, 'city'],
  ['Cần Thơ', 10.0452, 105.7469, 'city'],
  ['Huế', 16.4637, 107.5909, 'city'],
  ['Nha Trang', 12.2388, 109.1967, 'city'],
  ['Đà Lạt', 11.9404, 108.4583, 'city'],
  ['Vũng Tàu', 10.346, 107.0843, 'city'],
  ['Quy Nhơn', 13.7765, 109.2237, 'city'],
  ['Hải Dương', 20.9373, 106.3146, 'city'],
  ['Lào Cai', 22.4809, 103.9755, 'city'],
  ['Sa Pa', 22.3363, 103.8438, 'town'],
  ['Vinh', 18.6796, 105.6813, 'city'],
  ['Thanh Hóa', 19.8067, 105.7852, 'city'],
  ['Nam Định', 20.4388, 106.1621, 'city'],
  ['Ninh Bình', 20.2506, 105.9745, 'city'],
  ['Hạ Long', 20.9717, 107.0448, 'city'],
  ['Buôn Ma Thuột', 12.6667, 108.0383, 'city'],
  ['Pleiku', 13.9833, 108.0, 'city'],
  ['Phan Thiết', 10.9333, 108.1, 'city'],
  ['Biên Hòa', 10.9574, 106.8426, 'city'],
  ['Thủ Dầu Một', 10.9804, 106.6519, 'city'],
  ['Mỹ Tho', 10.36, 106.36, 'city'],
  ['Rạch Giá', 10.0125, 105.0809, 'city'],
  ['Cà Mau', 9.1769, 105.15, 'city'],
  ['Long Xuyên', 10.3864, 105.4352, 'city'],
  ['Bắc Giang', 21.2731, 106.1946, 'city'],
  ['Thái Nguyên', 21.5942, 105.8482, 'city'],
  ['Việt Trì', 21.3227, 105.4019, 'city'],
  ['Hòa Bình', 20.8133, 105.3383, 'city'],
  ['Sơn La', 21.3256, 103.9188, 'city'],
  ['Điện Biên Phủ', 21.386, 103.0169, 'city'],
  ['Hà Giang', 22.8233, 104.9836, 'city'],
  ['Cao Bằng', 22.6667, 106.25, 'city'],
  ['Lạng Sơn', 21.8537, 106.7615, 'city'],
  ['Tuy Hòa', 13.0955, 109.3209, 'city'],
  ['Quảng Ngãi', 15.1214, 108.8044, 'city'],
  ['Tam Kỳ', 15.5736, 108.474, 'city'],
  ['Đồng Hới', 17.4689, 106.6223, 'city'],
  ['Đông Hà', 16.8163, 107.1003, 'city'],
  ['Hội An', 15.8801, 108.338, 'city'],
  ['Tây Ninh', 11.3, 106.1, 'city'],
  ['Bạc Liêu', 9.285, 105.7244, 'city'],
  ['Sóc Trăng', 9.6, 105.9667, 'city'],
  ['Vĩnh Long', 10.2536, 105.9722, 'city'],
  ['Trà Vinh', 9.9347, 106.3453, 'city'],
  ['Cam Ranh', 11.9214, 109.1591, 'city'],
  ['Phan Rang - Tháp Chàm', 11.5667, 108.9833, 'city'],
  ['Kon Tum', 14.35, 108.0, 'city'],
  ['Hưng Yên', 20.6464, 106.0511, 'city'],
  ['Phủ Lý', 20.5411, 105.9139, 'city'],
  ['Bắc Ninh', 21.1861, 106.0763, 'city'],
  ['Vĩnh Yên', 21.3089, 105.6049, 'city'],
  ['Yên Bái', 21.7168, 104.8986, 'city'],
  ['Tuyên Quang', 21.8233, 105.2181, 'city'],
  ['Bắc Kạn', 22.1471, 105.8348, 'city'],
  ['Lai Châu', 22.3964, 103.4703, 'city'],
  ['Hà Tĩnh', 18.3428, 105.9057, 'city'],
  ['Đồng Xoài', 11.5333, 106.9, 'city'],
  ['Cao Lãnh', 10.4602, 105.6322, 'city'],
  ['Bến Tre', 10.2434, 106.3756, 'city'],
  ['Tân An', 10.5333, 106.4167, 'city'],
  ['Gia Nghĩa', 12.0033, 107.69, 'city'],
];

const EXTRA = [
  { name: 'Bến xe Mỹ Đình', lat: 21.0288, lon: 105.7782, tags: { amenity: 'bus_station' } },
  { name: 'Bến xe Giáp Bát', lat: 20.9806, lon: 105.8414, tags: { amenity: 'bus_station' } },
  { name: 'Bến xe Nước Ngầm', lat: 20.9622, lon: 105.8457, tags: { amenity: 'bus_station' } },
  { name: 'Bến xe Miền Đông', lat: 10.8142, lon: 106.711, tags: { amenity: 'bus_station' } },
  { name: 'Bến xe Miền Tây', lat: 10.7424, lon: 106.6349, tags: { amenity: 'bus_station' } },
  { name: 'Bến xe Đà Nẵng', lat: 16.0471, lon: 108.2062, tags: { amenity: 'bus_station' } },
  { name: 'Sân bay quốc tế Nội Bài', lat: 21.2212, lon: 105.8072, tags: { aeroway: 'aerodrome', 'name:en': 'Noi Bai International Airport', iata: 'HAN' } },
  { name: 'Sân bay quốc tế Tân Sơn Nhất', lat: 10.8188, lon: 106.6519, tags: { aeroway: 'aerodrome', 'name:en': 'Tan Son Nhat International Airport', iata: 'SGN' } },
  { name: 'Sân bay quốc tế Đà Nẵng', lat: 16.0439, lon: 108.1993, tags: { aeroway: 'aerodrome', 'name:en': 'Da Nang International Airport', iata: 'DAD' } },
  { name: 'Ga Hà Nội', lat: 21.0245, lon: 105.8412, tags: { railway: 'station' } },
  { name: 'Ga Sài Gòn', lat: 10.7821, lon: 106.6785, tags: { railway: 'station' } },
  { name: 'Ga Đà Nẵng', lat: 16.0714, lon: 108.2099, tags: { railway: 'station' } },
  { name: 'Cầu Giấy', lat: 21.0333, lon: 105.7937, tags: { place: 'suburb' } },
  { name: 'Hoàn Kiếm', lat: 21.0287, lon: 105.8522, tags: { place: 'suburb' } },
  { name: 'Quận 1', lat: 10.7757, lon: 106.7004, tags: { place: 'suburb' } },
  { name: 'Phú Quốc', lat: 10.2899, lon: 103.984, tags: { place: 'island' } },
  { name: 'Cát Bà', lat: 20.7272, lon: 107.0495, tags: { place: 'island' } },
];

const nodes = [];
let id = 1000;
for (const [name, lat, lon, place, alt] of CITIES) {
  nodes.push({ id: id++, lat, lon, tags: { name, place, ...(alt ? { alt_name: alt.join(';') } : {}) } });
  nodes.push({ id: id++, lat: lat + 0.01, lon: lon + 0.01, tags: { name: `Bến xe ${name.replace(/^Thành phố /, '')}`, amenity: 'bus_station' } });
}
for (const e of EXTRA) nodes.push({ id: id++, lat: e.lat, lon: e.lon, tags: { name: e.name, ...e.tags } });

// Province centres (the city list's own names) and the half-width of the square drawn around them.
const PROVINCES = [
  ['Hà Nội', 21.03, 105.85], ['TP. Hồ Chí Minh', 10.78, 106.7], ['Hải Phòng', 20.84, 106.69], ['Đà Nẵng', 16.05, 108.2],
  ['Cần Thơ', 10.05, 105.75], ['Hà Giang', 22.82, 104.98], ['Cao Bằng', 22.67, 106.25], ['Bắc Kạn', 22.15, 105.83],
  ['Tuyên Quang', 21.82, 105.22], ['Lào Cai', 22.48, 103.98], ['Điện Biên', 21.39, 103.02], ['Lai Châu', 22.4, 103.47],
  ['Sơn La', 21.33, 103.92], ['Yên Bái', 21.72, 104.9], ['Hoà Bình', 20.81, 105.34], ['Thái Nguyên', 21.59, 105.85],
  ['Lạng Sơn', 21.85, 106.76], ['Quảng Ninh', 20.97, 107.04], ['Bắc Giang', 21.27, 106.19], ['Vĩnh Phúc', 21.31, 105.6],
  ['Bắc Ninh', 21.19, 106.08], ['Hải Dương', 20.94, 106.31], ['Hưng Yên', 20.65, 106.05], ['Phú Thọ', 21.32, 105.4],
  ['Hà Nam', 20.54, 105.91], ['Thái Bình', 20.45, 106.34], ['Nam Định', 20.44, 106.16], ['Ninh Bình', 20.25, 105.97],
  ['Ninh Thuận', 11.57, 108.98], ['Thanh Hóa', 19.81, 105.79], ['Nghệ An', 18.68, 105.68], ['Hà Tĩnh', 18.34, 105.91],
  ['Quảng Bình', 17.47, 106.62], ['Quảng Trị', 16.82, 107.1], ['Thừa Thiên Huế', 16.46, 107.59], ['Quảng Nam', 15.57, 108.47],
  ['Quảng Ngãi', 15.12, 108.8], ['Bình Định', 13.78, 109.22], ['Phú Yên', 13.1, 109.32], ['Khánh Hòa', 12.24, 109.2],
  ['Bình Thuận', 10.93, 108.1], ['Kon Tum', 14.35, 108.0], ['Gia Lai', 13.98, 108.0], ['Đắk Lắk', 12.67, 108.04],
  ['Đắk Nông', 12.0, 107.69], ['Lâm Đồng', 11.94, 108.46], ['Bà Rịa - Vũng Tàu', 10.35, 107.08], ['Bình Dương', 10.98, 106.65],
  ['Bình Phước', 11.53, 106.9], ['Đồng Nai', 10.96, 106.84], ['Tây Ninh', 11.3, 106.1], ['Long An', 10.53, 106.42],
  ['Tiền Giang', 10.36, 106.36], ['Bến Tre', 10.24, 106.38], ['Trà Vinh', 9.93, 106.35], ['Vĩnh Long', 10.25, 105.97],
  ['Đồng Tháp', 10.46, 105.63], ['An Giang', 10.39, 105.44], ['Kiên Giang', 10.01, 105.08], ['Hậu Giang', 9.78, 105.47],
  ['Sóc Trăng', 9.6, 105.97], ['Bạc Liêu', 9.29, 105.72], ['Cà Mau', 9.18, 105.15],
];
const HALF = 0.2;
const ways = [];
const relations = [];
let cornerId = 5_000_000;
PROVINCES.forEach(([name, lat, lon], i) => {
  const ring = [
    [lat - HALF, lon - HALF],
    [lat - HALF, lon + HALF],
    [lat + HALF, lon + HALF],
    [lat + HALF, lon - HALF],
  ].map(([la, lo]) => ({ id: cornerId++, lat: la, lon: lo, tags: {} }));
  nodes.push(...ring);
  ways.push({ id: i + 1, refs: [...ring.map((n) => n.id), ring[0].id], tags: {} });
  relations.push({ id: i + 1, tags: { type: 'boundary', boundary: 'administrative', admin_level: '4', name }, members: [{ way: i + 1, role: 'outer' }] });
});
// Numbered hamlets, spread over the squares (deterministic).
const WORDS = ['Tân', 'Phú', 'Thạnh', 'Long', 'Hòa', 'Bình', 'Mỹ', 'An', 'Lộc', 'Đông', 'Hưng', 'Thọ'];
for (let n = 0; n < 15_000; n++) {
  const [, lat, lon] = PROVINCES[n % PROVINCES.length];
  const dx = (((n * 7919) % 1000) / 1000 - 0.5) * 2 * (HALF - 0.01);
  const dy = (((n * 104729) % 1000) / 1000 - 0.5) * 2 * (HALF - 0.01);
  nodes.push({ id: id++, lat: lat + dy, lon: lon + dx, tags: { name: `${WORDS[n % 12]} ${WORDS[(n * 5 + 3) % 12]} ${n}`, place: n % 3 ? 'hamlet' : 'village' } });
}

// ---- protobuf, by hand
const varint = (n) => {
  let v = BigInt(n);
  const out = [];
  while (v >= 0x80n) {
    out.push(Number(v & 0x7fn) | 0x80);
    v >>= 7n;
  }
  out.push(Number(v));
  return Buffer.from(out);
};
const zigzag = (n) => (BigInt(n) << 1n) ^ (BigInt(n) >> 63n);
const tag = (field, wire) => varint((field << 3) | wire);
const bytes = (field, buf) => Buffer.concat([tag(field, 2), varint(buf.length), buf]);
const uint = (field, n) => Buffer.concat([tag(field, 0), varint(n)]);
const sint = (field, n) => Buffer.concat([tag(field, 0), varint(zigzag(n))]);
const packed = (field, nums) => bytes(field, Buffer.concat(nums.map((n) => varint(n))));

const strings = [Buffer.alloc(0)];
const strIndex = new Map([['', 0]]);
const intern = (s) => {
  if (!strIndex.has(s)) {
    strIndex.set(s, strings.length);
    strings.push(Buffer.from(s, 'utf8'));
  }
  return strIndex.get(s);
};

const nodeGroup = Buffer.concat(
  nodes.map((n) => {
    const keys = Object.keys(n.tags);
    return bytes(
      1,
      Buffer.concat([
        sint(1, n.id),
        packed(2, keys.map((k) => intern(k))),
        packed(3, keys.map((k) => intern(n.tags[k]))),
        sint(8, Math.round(n.lat * 1e7)),
        sint(9, Math.round(n.lon * 1e7)),
      ]),
    );
  }),
);
const sintPacked = (field, nums) => bytes(field, Buffer.concat(nums.map((n) => varint(zigzag(n)))));
const delta = (nums) => nums.map((n, i) => (i === 0 ? n : n - nums[i - 1]));
const wayGroup = Buffer.concat(
  ways.map((w) => bytes(3, Buffer.concat([uint(1, w.id), sintPacked(8, delta(w.refs))]))),
);
const relationGroup = Buffer.concat(
  relations.map((r) => {
    const keys = Object.keys(r.tags);
    return bytes(
      4,
      Buffer.concat([
        uint(1, r.id),
        packed(2, keys.map((k) => intern(k))),
        packed(3, keys.map((k) => intern(r.tags[k]))),
        packed(8, r.members.map((m) => intern(m.role))),
        sintPacked(9, delta(r.members.map((m) => m.way))),
        packed(10, r.members.map(() => 1)),
      ]),
    );
  }),
);
// Interned strings are all known now: the table goes first in the block.
const block = Buffer.concat([
  bytes(1, Buffer.concat(strings.map((s) => bytes(1, s)))),
  bytes(2, nodeGroup),
  bytes(2, wayGroup),
  bytes(2, relationGroup),
]);

const blob = (payload) => bytes(1, payload); // raw, uncompressed
const frame = (type, body) => {
  const blobBytes = blob(body);
  const header = Buffer.concat([bytes(1, Buffer.from(type)), uint(3, blobBytes.length)]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(header.length);
  return Buffer.concat([len, header, blobBytes]);
};

const headerBlock = bytes(4, Buffer.from('OsmSchema-V0.6'));
const frames = [frame('OSMHeader', headerBlock), frame('OSMData', block)];

const out = process.argv[2];
if (!out) throw new Error('usage: make-osm-pbf.mjs <out.osm.pbf> [--pad]');
if (process.argv.includes('--pad')) {
  // A blob holds at most 32 MiB: pad with 16 MiB string tables, 7 of them (> 100 MiB).
  const padding = bytes(1, bytes(1, Buffer.alloc(16 * 1024 * 1024, 0x61)));
  for (let i = 0; i < 7; i++) frames.push(frame('OSMData', padding));
}
const file = Buffer.concat(frames);
writeFileSync(out, file);
// Geofabrik publishes "<md5>  <file name>" next to every extract; places-build checks it.
const name = out.split('/').pop();
writeFileSync(`${out}.md5`, `${createHash('md5').update(file).digest('hex')}  ${name}\n`);
console.log(`${nodes.length} places, ${file.length} bytes -> ${out}`);
