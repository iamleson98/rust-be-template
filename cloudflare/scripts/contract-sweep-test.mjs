/**
 * Contract sweep: hits every path in the openapi spec (authed as admin)
 * and asserts each returns JSON (not the SPA HTML catch-all), 401/403/404
 * are acceptable "route exists" responses.
 */
const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const TEST_EMAIL = process.env.TEST_EMAIL ?? "admin@example.com";
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? "change-me";

const GET_PATHS = [
  "/api/admin/addresses?limit=5",
  "/api/admin/bookings?limit=5",
  "/api/admin/bookings/stats",
  "/api/admin/bookings/export",
  "/api/admin/brands",
  "/api/admin/bus-layouts",
  "/api/admin/bus-layouts/presets",
  "/api/admin/campaigns",
  "/api/admin/chat/stats",
  "/api/admin/coupons?limit=5",
  "/api/admin/coupons/payouts",
  "/api/admin/cron-jobs",
  "/api/admin/cron-jobs/runs?limit=5",
  "/api/admin/payments?limit=5",
  "/api/admin/payments/summary",
  "/api/admin/pickup-points?routeId=none",
  "/api/admin/reviews?limit=5",
  "/api/admin/reviews/summary",
  "/api/admin/routes?limit=5",
  "/api/admin/schedules?routeId=none",
  "/api/admin/system",
  "/api/admin/system/database",
  "/api/admin/system/memory",
  "/api/admin/system/metrics",
  "/api/admin/vehicle-types",
  "/api/auth/me",
  "/api/auth/oauth/providers",
  "/api/bookings?limit=5",
  "/api/brands",
  "/api/brands/phuong-trang",
  "/api/campaigns",
  "/api/chat/channels",
  "/api/chat/channels/online",
  "/api/coupons/mine",
  "/api/loyalty",
  "/api/notifications",
  "/api/nullclaw/exchanges",
  "/api/nullclaw/status",
  "/api/payments/providers",
  "/api/places?q=ha-noi&limit=5",
  "/api/places/search?q=da+lat",
  "/api/places/reverse?lat=21.03&lon=105.85",
  "/api/posts",
  "/api/presence/staff",
  "/api/price-alerts?limit=5",
  "/api/recommendations",
  "/api/reviews?limit=5",
  "/api/reviews/mine",
  "/api/reviews/stats",
  "/api/reviews/tags",
  "/api/routes",
  "/api/search?from=ha-noi&to=da-nang&date=2026-10-20",
  "/api/search/geo?fromLat=21.03&fromLon=105.85&toLat=16.07&toLon=108.22&date=2026-10-20",
  "/api/stats",
  "/api/users?limit=5",
  "/api/vitals/summary",
  "/health",
  "/ready",
  "/sitemap.xml",
];

const POST_PATHS = [
  ["/api/admin/coupons/settle", { brandId: null }],
  ["/api/admin/system/database/vacuum", {}],
  ["/api/payments/ipn/momo", { orderId: "none-such", resultCode: 0, signature: "x" }],
  ["/api/payments/ipn/zalopay", { data: "{}", mac: "x" }],
];

async function main() {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    }),
  });
  if (!login.ok) throw new Error("login failed");
  const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");

  let pass = 0;
  let fail = 0;
  for (const p of GET_PATHS) {
    const res = await fetch(`${BASE}${p}`, { headers: { cookie, accept: "application/json" } });
    const ct = res.headers.get("content-type") ?? "";
    const isJson = ct.includes("json") || ct.includes("xml");
    if (isJson) {
      pass++;
    } else {
      fail++;
      console.log(`HTML-FALLBACK ${res.status} ${p} (${ct.slice(0, 40)})`);
    }
  }
  for (const [p, body] of POST_PATHS) {
    const res = await fetch(`${BASE}${p}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify(body),
    });
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("json")) pass++;
    else {
      fail++;
      console.log(`HTML-FALLBACK ${res.status} POST ${p} (${ct.slice(0, 40)})`);
    }
  }
  // VNPAY IPN is a GET with query params.
  const vnp = await fetch(`${BASE}/api/payments/ipn/vnpay?vnp_TxnRef=none&vnp_ResponseCode=00&vnp_SecureHash=x`);
  if ((vnp.headers.get("content-type") ?? "").includes("json")) pass++;
  else {
    fail++;
    console.log(`HTML-FALLBACK ${vnp.status} /api/payments/ipn/vnpay`);
  }

  console.log(`\nSWEEP RESULT: ${pass} pass, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
