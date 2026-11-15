# Contract diff: REF `types.gen.ts` vs the Rust-generated SDK

The REF SPA was built against a hand-maintained SDK
(`cloudflare/src/spa/api/generated`; there is no `openapi.json` in REF). The
SDK in `frontend/src/api/generated` is now generated from Rust's utoipa spec
(`cargo test --lib dump_openapi_spec_for_the_frontend_sdk`, then
`cd frontend && bun run openapi`). This file lists every remaining difference
between the two `types.gen.ts` files and why it stays.

Method: both files were parsed into their top-level `export type` blocks (doc
comments dropped) and compared block by block. Of 824 types present in both,
809 are identical. The generated functions (`sdk.gen.ts`,
`@tanstack/react-query.gen.ts`) match in name, method and URL; the only
additions are `brandProfile` and `uploadBrandLogo` with their
`*Options`/`*QueryKey`/`*Mutation` helpers. Doc comments differ (Rust's are
more specific); that is not a contract change.

## Types only in REF (7)

| Type | Why it stays out |
|---|---|
| `EngineCacheOut`, `EngineConnectionsOut`, `EngineContentionOut`, `EngineFileOut`, `EngineThroughputOut`, `EngineTransactionsOut` | Counters of the old embedded rustqlite engine. The database is real C SQLite now, which reports its version, source id and heap usage only (`EngineStatsOut`, `EngineMemoryOut`). The admin system page shows exactly those (`database-engine-section.tsx`). |
| `PlaceOut` | A row of REF's D1 `place` table (with `population`). `GET /api/places` now answers from the in-memory place index and returns `PlaceSearchHit` items, like search and reverse. The only SPA reader (the pickup-point form) needs `id`, `name`, `lat` and `lon`, which the hit has. |

## Types only in Rust (20)

| Types | Why |
|---|---|
| `BrandProfile`, `ProfileBrand`, `ProfileLocation`, `ProfileRoute`, `ProfileSchedule`, `ProfileTrip`, `BrandProfileData/Response(s)/Errors` | `GET /api/brands/{slug}/profile`. REF's SPA called it with a hand-typed client (`features/brand/api.ts`) because its SDK lacked it. The SPA now uses the generated query and types; fields match REF's hand types one to one (`rating`, `priceFrom`, `daysOfWeek`, `vehicleType` are nullable). |
| `BrandLogoUploadResponse`, `UploadBrandLogoData/Response(s)/Errors` | `POST /api/uploads/brand-logo`, likewise hand-typed in REF (`api/uploads.ts`). |
| `PlaceEngine` | `engine: "index" \| "unavailable"` on place answers; `unavailable` until the first place index exists. REF typed it `string`. |
| `SortOrder` | `order` query parameter (`asc` \| `desc`). It was referenced but not registered, so REF's SDK had `unknown`. Now registered in `openapi.rs`. |
| `PlacesSearchErrors`, `PlacesReverseErrors`, `SitemapErrors` | 400 on `lat` without `lon` or a point off the globe; 503 on the sitemap when the catalogue cannot be read. |

## Types that differ (15)

| Type | REF | Rust | Verdict |
|---|---|---|---|
| `AdminAddressOut.stopCount` | `number` | `number \| null` | Only the list endpoint computes it; create and update leave it out. Honest: absent, not 0. |
| `AdminSchedulePointOut.cityId` | present | absent | The point nests its `address: AdminAddressOut`, which carries `cityId`. The SPA reads the address. |
| `AuthLoginErrors` | | adds 403, 429 | 403: the account is not active. 429: the account is locked after too many wrong passwords (`Retry-After`), REF's lockout. |
| `EmployeeLoginErrors` | | adds 429 | Same lockout. |
| `EngineMemoryOut` | `cacheMb`, `cacheCapacityMb`, `dbSizeMb`, `walFrames`, `freelistPages`, `utilizationPct` | `heapMb`, `heapPeakMb` | See the Engine types above. |
| `EngineStatsOut` | `cache`, `connections`, `contention`, `throughput`, `transactions`, `files` | `sqliteVersion` (plus `version`, `memory`) | Same. |
| `LoginRequest` | `email` required | `email` optional, `phone` optional | Rust accepts the phone given at registration (REF parity); exactly one of the two is required at runtime. The SPA still sends `email`. |
| `RegisterRequest` | | adds `locale` | The account's language, `vi` (default) or `en`. The SPA does not send it yet. |
| `PlaceListResponse` | `items: PlaceOut[]` | `items: PlaceSearchHit[]` | See `PlaceOut`. |
| `PlaceSearchHit` | every field optional (`osmId`, `placeKind`, `houseNumber`, `city`, `distanceKm`, `id`, `lat`, `lon`, `score`, `type`) | `id`, `lat`, `lon`, `type`, `score`, `nameNoTones` required; no `osmId`, `placeKind`, `houseNumber`, `city`, `distanceKm` | The Rust hit is what the in-memory engine produces; `id` is the OSM type letter plus id (`n123`). Nothing in the SPA read the dropped fields except one `osmId` fallback for a list key, now `id`. |
| `PlaceSearchResponse.engine` | `string \| null` | `PlaceEngine` | See `PlaceEngine`. |
| `PlacesSearchData` | `q`, `limit` | adds `lat`, `lon` | Geo-bias for autocomplete; both or neither. Optional. |
| `PriceAlertsListData.order` | `unknown` | `SortOrder` | See `SortOrder`. |
| `ReportConversionErrors` | 400 | adds 404 | Rust verifies the booking code (a purchase needs a completed payment). |
| `SearchTripsGeoData` | `fromCity`, `toCity` | same fields in another position | No change; the generator orders by schema position. |

## Gaps in the Rust contract (not worked around in the SPA)

See "Rust fixes needed" in the WP12 report: multipart request bodies are
typed as `Array<number>` (`UploadBrandLogoData`, `UploadPictureData`), so the
SPA sends them by hand or with a cast, as REF did; `ReportConversionRequest.transactionId`
is documented as required but typed optional.
