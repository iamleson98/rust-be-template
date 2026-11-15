// Differences between REF and Rust that are understood, one rule each. A rule matches the case
// name, the JSON path of the difference (keyed array items appear as `[id=...]`, the rest of
// the segment names are literal) and its kind. Anything no rule matches is reported as BUG.
// `class: 'explained'`: a rule is written only after the cause is known; the reason says what it
// is. `class: 'BUG'`: a Rust defect, numbered here and described in docs/PARITY.md; the rule only
// attributes the difference to it. A difference no rule matches is an unclassified BUG: new.
const any = /./;

export const rules = [
  // ---- the fixture itself: rows the importer cannot or must not carry over (tests/wp10_import.rs)
  {
    id: 'import-skip-schedule-point',
    class: 'explained',
    case: /search|geo|trip|brand/,
    path: /arrivalAt$/,
    reason:
      'the importer skips the schedule stop whose address has no coordinates (synthetic row on purpose); the schedule then has no destination stop and Rust rolls the last remaining time over to the next day, as REF would with one stop',
  },
  {
    id: 'import-skip-address',
    class: 'explained',
    case: /profile/,
    path: /\.locations\[id=/,
    reason: 'address without lat/lon is skipped by the importer (the Rust address entity needs coordinates)',
  },
  {
    id: 'import-skip-route-picture',
    class: 'explained',
    case: /pictures/,
    path: /\.items\[id=/,
    kind: 'missing',
    reason: 'route_picture without width/height is skipped by the importer',
  },
  {
    id: 'import-stop-kind',
    class: 'explained',
    case: /trip/,
    path: /\.schedulePoints\[id=[^\]]*\]\.(kind|stopOrder)$/,
    reason: 'stop kinds are mapped departure/intermediate/destination (from 1) to pickup/middle/drop (from 0) by the importer',
  },
  {
    id: 'import-days-mask',
    class: 'explained',
    case: /profile/,
    path: /\.schedules\[id=[^\]]*\]\.daysOfWeek$/,
    kind: 'extra',
    reason: 'REF shows daysOfWeek only for a 0/1 mask and null for the legacy JSON weekday array; the importer converts the array to the mask',
  },
  {
    id: 'import-timestamps',
    class: 'explained',
    path: /\.(createdAt|updatedAt)$/,
    kind: 'changed',
    reason: 'REF returns the stored text (`YYYY-MM-DD HH:MM:SS` or the literal `(datetime(\'now\'))`), the importer writes one canonical RFC 3339 instant (B5); a literal default becomes the import time',
  },
  {
    id: 'import-order-by-created',
    class: 'explained',
    case: /notifications/,
    path: /\.items$/,
    kind: 'order',
    reason: 'sorted by createdAt: the row with the literal `(datetime(\'now\'))` gets the import time in Rust and sorts last in REF',
  },
  {
    id: 'import-booking-by-created',
    class: 'explained',
    case: /bookings\/stats/,
    path: /\.byDay/,
    reason: 'REF drops the booking whose created_at is `YYYY-MM-DD HH:MM:SS` (not an ISO instant) from its per-day tally; the imported row has a canonical instant and is counted',
  },
  {
    id: 'import-orphan-fk',
    class: 'explained',
    case: /reviews|admin: reviews/,
    path: /bookingId$/,
    kind: 'missing',
    reason: 'review.booking_id pointed at a booking that does not exist (synthetic orphan); the importer clears it',
  },
  {
    id: 'import-scheduled-jobs',
    class: 'explained',
    case: /cron-jobs/,
    path: any,
    reason: 'the importer prunes the Worker-only scheduled_job rows; Rust keeps its own (created at boot)',
  },

  // ---- Rust is the contract of the new SPA (its SDK is generated from the Rust spec)
  {
    id: 'rust-admin-requires-filter',
    class: 'explained',
    case: /admin: (schedules|addresses|pickup-points)/,
    path: any,
    reason: 'Rust requires routeId / brandId on these lists (the SPA always passes it); REF lists everything',
  },
  {
    id: 'rust-admin-shapes',
    class: 'explained',
    case: /admin: (brands|routes|bus-layouts|coupons|campaigns|payments|bookings)/,
    path: /\.(description|seatClasses|province|planned|owner\.[A-Za-z]+|booking\.[A-Za-z]+|brand\.logoUrl|sharedIp|sharedPhone|totals\.inUse)$/,
    reason: 'admin DTOs: Rust returns more or other fields than the Worker (province derived from cityId, seat class tally, owner/booking summary, system report with the SQLite engine); REF counts coupons `held` in totals.inUse where the status is `reserved`; planned is true in REF for any non-null layout, in Rust only for a plan that validates',
  },
  {
    id: 'rust-seeded-layout-presets',
    class: 'explained',
    case: /admin: bus-layouts/,
    path: /\.items\[id=|^\$\.total$/,
    reason: 'the Rust migrator seeds the shared preset seat layouts (brand-less); the Worker database has none',
  },
  {
    id: 'rust-admin-system',
    class: 'explained',
    case: /admin: system/,
    path: any,
    reason: 'a different report: Rust measures its own process, SQLite engine, sockets and calls; REF reports the Worker, D1 and the VPS link',
  },
  {
    id: 'review-tags-csv',
    class: 'explained',
    case: /my bookings|admin: bookings/,
    path: /\.review\.tags$/,
    reason: 'the fixture review stores tags as comma text (`wifi,sạch sẽ`); REF reads only the JSON form and shows none, Rust reads both',
  },
  {
    id: 'ref-only-admin-stats',
    class: 'explained',
    case: /admin: stats|admin stats as a customer/,
    path: any,
    reason: 'GET /api/admin/stats exists only in REF and no screen calls it (route-gap report); Rust serves /api/stats, /api/admin/bookings/stats and /api/admin/chat/stats',
  },
  {
    id: 'qr-renderer',
    class: 'explained',
    case: /booking by/,
    path: /ticketQr$/,
    reason: 'a different QR encoder draws the SVG; both encode the booking code',
  },

  // ---- envelope and configuration of the two runtimes
  {
    id: 'volatile-instants',
    class: 'explained',
    case: /auth\/me/,
    path: /\.expires_at$/,
    reason: 'two logins a few ms apart',
  },
  {
    id: 'error-code',
    class: 'explained',
    path: /^\$\.(error|message)$/,
    kind: 'changed',
    when: (d) => {
      const bare = (m) => m.replace(/^(validation failed|bad request): /, '').replace(/^Failed to deserialize query string: /, '');
      return (
        (d.ref === 'validation_error' && d.rust === 'bad_request') ||
        (typeof d.ref === 'string' && typeof d.rust === 'string' && bare(d.ref) === bare(d.rust))
      );
    },
    reason: 'REF names every 400 `validation_error` ("validation failed: ..."), Rust uses `bad_request` ("bad request: ..."); the SPA reads only `message` and the status',
  },
  {
    id: 'unknown-route-404',
    class: 'explained',
    case: /unknown API route/,
    path: any,
    reason: 'REF answers an unknown /api path with the Next.js HTML 404, Rust with a JSON 404',
  },
  {
    id: 'cache-header-ref-none',
    class: 'explained',
    path: /^\$cacheControl$/,
    kind: 'changed',
    when: (d) => d.ref === '',
    reason: 'REF sends no Cache-Control here, Rust a public 60 s (cache headers only)',
  },
  {
    id: 'return-url-host',
    class: 'explained',
    case: /payment of a booking/,
    path: /returnUrl$/,
    reason: 'each server builds the URL from its own PAYMENT_PUBLIC_BASE_URL (localhost:3001 vs :3102)',
  },
  {
    id: 'place-engine-name',
    class: 'explained',
    case: /places/,
    path: /^\$\.engine$/,
    reason: 'REF answers from its static shards here ("static-shards": its VPS engine is a remote binding that does not exist locally), Rust from its own index ("index")',
  },
  {
    id: 'place-cache-ttl',
    class: 'explained',
    case: /places/,
    path: /^\$cacheControl$/,
    when: (d) => d.ref === 'public, max-age=60',
    reason: 'REF caches an answer from its fallback engine for 60 s ("degraded"); Rust caches its own index answers 300 s (search) and 3600 s (popular, reverse)',
  },
  {
    id: 'static-file-cache',
    class: 'explained',
    case: /ads\.txt/,
    path: /^\$cacheControl$/,
    reason: 'a static file: REF revalidates every time, Rust caches it for a day',
  },
  {
    id: 'place-popular-ties',
    class: 'explained',
    case: /places: (popular|search blank)/,
    path: /^\$\.top$/,
    reason: 'the hand-made extract has no population, so every city ties and each engine breaks the tie its own way',
  },
  {
    id: 'place-near-static-engine',
    class: 'explained',
    case: /places: search near a point/,
    path: /^\$\.top$/,
    reason: 'REF\'s fallback shards barely bias towards `lat`/`lon`; its real engine (the VPS service) is a remote binding that is not available locally. Rust ranks the hit nearest the point first',
  },
  {
    id: 'harness-nullclaw',
    class: 'explained',
    case: /nullclaw status/,
    path: any,
    reason: 'the Rust server runs with NULLCLAW_ENABLED=false (noop provider); REF ships the nullclaw provider',
  },
  {
    id: 'robots-host',
    class: 'explained',
    case: /robots/,
    path: /^\$text$/,
    reason: 'the Sitemap line carries each server\'s own origin',
  },
  {
    id: 'sitemap-trailing-newline',
    class: 'explained',
    case: /sitemap/,
    path: /^\$text$/,
    kind: 'extra',
    reason: 'a trailing newline',
  },

  // ---- Rust defects found by this run (docs/PARITY.md, "Defects")
  {
    id: 'BUG-1 VIETQR_* never read',
    class: 'BUG',
    case: /payment providers|payment of a booking/,
    path: /providers|bankTransferInstructions/,
    reason: 'src/config/mod.rs:1143 builds `VietQrConfig::default()` (disabled, empty) instead of `from_env()`: VietQR is never offered and no bank instructions are returned',
  },
  {
    id: 'BUG-2 price alerts of a user',
    class: 'BUG',
    case: /price alerts/,
    path: /\.(items|total)/,
    reason: 'src/store/price_alert.rs:118 and :155 compare the TEXT user_id column with a Uuid (bound as BLOB): the signed-in owner\'s list is always empty',
  },
  {
    id: 'BUG-3 query rejections are plain text',
    class: 'BUG',
    path: /^\$(contentType|body)$/,
    when: (d) => d.rust === 'text/plain' || (typeof d.rust === 'string' && /^(Failed to deserialize|Invalid URL)/.test(d.rust)),
    reason: 'axum\'s default Query/Path rejection (text/plain "Failed to deserialize query string: ...") bypasses the JSON error envelope; REF answers 400 with {error, message}',
  },
  {
    id: 'BUG-4 reverse geocode out of range',
    class: 'BUG',
    case: /reverse out of range/,
    path: any,
    reason: 'Rust answers 400, REF 200 with an empty list (G1/G2 fix list item 9)',
  },
  {
    id: 'BUG-5 403 with code store_error',
    class: 'BUG',
    case: /users list as a customer/,
    path: /^\$\.(error|message)$/,
    reason: 'src/routes/users.rs: a missing permission surfaces as {error: "store_error", message: "store error: forbidden: ..."}, status 403; REF says `forbidden`',
  },
  {
    id: 'BUG-6 no cache header on reviews',
    class: 'BUG',
    case: /reviews/,
    path: /^\$cacheControl$/,
    reason: 'REF sends `public, max-age=60` on /api/reviews and /api/reviews/stats and /tags, Rust sends none (load only, not correctness)',
  },
];
