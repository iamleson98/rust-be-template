import os
#!/usr/bin/env python3
"""Seed the dev SQLite DB through the public/admin API.

Registers the first user (auto-admin), then creates:
  3 brands → 3 bus layouts → 3 routes (HN-DN, HN-SG, SG-DL)
  → schedules (several departure times per route, daily)
  → pickup/drop points per route (via schedule `points`).

All requests use a browser UA + Origin header so the anti-scraping
middleware lets them through (mirrors real browser traffic).
"""
import json
import urllib.request
import urllib.error
import sys

BASE = "http://localhost:8080"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
ORIGIN = "http://localhost:3000"
COOKIES = {}

ADMIN_EMAIL = "${ADMIN_EMAIL}"
ADMIN_PASS = "${ADMIN_PASSWORD}"


def req(method, path, body=None, auth=False):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header("User-Agent", UA)
    r.add_header("Origin", ORIGIN)
    r.add_header("Referer", ORIGIN + "/")
    r.add_header("Content-Type", "application/json")
    r.add_header("Accept", "application/json")
    if auth:
        r.add_header("Cookie", "; ".join(f"{k}={v}" for k, v in COOKIES.items()))
    try:
        resp = urllib.request.urlopen(r, timeout=20)
        for hdr in resp.headers.get_all("Set-Cookie") or []:
            kv = hdr.split(";")[0]
            if "=" in kv:
                k, v = kv.split("=", 1)
                COOKIES[k] = v
        payload = resp.read().decode()
        return json.loads(payload) if payload else {}
    except urllib.error.HTTPError as e:
        print(f"!! {method} {path} -> {e.code}: {e.read().decode()[:300]}", file=sys.stderr)
        return None


def main():
    # 1) Register admin (first user wins) or login if already registered
    out = req("POST", "/api/auth/register", {
        "email": ADMIN_EMAIL,
        "fullName": "Lê Minh Sơn",
        "password": ADMIN_PASS,
        "phone": "0901234567",
    })
    if out is None:
        out = req("POST", "/api/auth/login", {"email": ADMIN_EMAIL, "password": ADMIN_PASS})
        if out is None:
            sys.exit("cannot register or login")
    print("auth ok:", json.dumps(out)[:120])

    me = req("GET", "/api/auth/me", auth=True)
    print("me:", json.dumps(me)[:160])
    if not me or not (me.get("user") or {}).get("roles") or "admin" not in str(me):
        print("WARNING: user may not be admin — check /api/auth/me")

    stats = req("GET", "/api/stats")
    print("stats before:", json.dumps(stats))
    if stats and stats.get("brands", 0) > 0:
        print("already seeded — skipping")
        return

    brands = [
        {"name": "Hoàng Long Express", "slug": "hoang-long-express", "accentColor": "#1d4ed8", "rating": 4.6, "status": "active", "contactPhone": "0900123456", "description": "Nhà xe giường nằm chất lượng cao tuyến Bắc - Nam."},
        {"name": "Đà Nẵng Travel", "slug": "da-nang-travel", "accentColor": "#0d9488", "rating": 4.8, "status": "active", "contactPhone": "0900567890", "description": "Limousine sang trọng miền Trung."},
        {"name": "Phương Đông Limousine", "slug": "phuong-dong-limousine", "accentColor": "#b91c1c", "rating": 4.4, "status": "active", "contactPhone": "0900909090", "description": "Limousine 9 chỗ tuyến Sài Gòn - Đà Lạt."},
    ]
    brand_ids = []
    for b in brands:
        out = req("POST", "/api/admin/brands", b, auth=True)
        if out:
            bid = out.get("id")
            brand_ids.append(bid)
            print("brand:", b["name"], bid)
        else:
            sys.exit("brand create failed")

    # 2) bus layouts — limousine 3x3 (9 seats, 1 floor), sleeper 3x2x2 (12, 2 floors), standard 5x2+... keep grids simple
    layouts = [
        {"name": "Limousine 9 chỗ", "brandId": brand_ids[1], "vehicleType": "limousine", "seatGrid": {"rows": 3, "cols": 3, "floors": 1}},
        {"name": "Giường nằm 2 tầng", "brandId": brand_ids[0], "vehicleType": "sleeper", "seatGrid": {"rows": 3, "cols": 2, "floors": 2}},
        {"name": "Ghế ngồi 28 chỗ", "brandId": brand_ids[2], "vehicleType": "standard", "seatGrid": {"rows": 6, "cols": 2, "floors": 1}},
    ]
    layout_ids = []
    for l in layouts:
        out = req("POST", "/api/admin/bus-layouts", l, auth=True)
        if out:
            layout_ids.append(out.get("id"))
            print("layout:", l["name"], out.get("id"))
        else:
            sys.exit("layout create failed")

    # 3) routes
    routes = [
        {"name": "Hà Nội - Đà Nẵng", "brandId": brand_ids[0], "startLocationId": "ha-noi", "endLocationId": "da-nang", "status": "active"},
        {"name": "Đà Nẵng - Hà Nội", "brandId": brand_ids[1], "startLocationId": "da-nang", "endLocationId": "ha-noi", "status": "active"},
        {"name": "Sài Gòn - Đà Lạt", "brandId": brand_ids[2], "startLocationId": "ho-chi-minh", "endLocationId": "da-lat", "status": "active"},
    ]
    route_ids = []
    for rt in routes:
        out = req("POST", "/api/admin/routes", rt, auth=True)
        if out:
            route_ids.append(out.get("id"))
            print("route:", rt["name"], out.get("id"))
        else:
            sys.exit("route create failed")

    # 4) schedules with points (2 per schedule: departure + arrival)
    amen = "wifi,ac,water,charging"
    schedules = [
        # HN -> DN, brand0 sleeper layout
        {"routeId": route_ids[0], "busLayoutId": layout_ids[1], "vehicleTypeId": None, "departureTime": "08:00", "daysOfWeek": "1111111", "basePriceAdult": 350000, "basePriceChild": 200000, "amenities": amen,
         "points": [{"arrivalTime": None}, {"arrivalTime": "16:30"}]},
        {"routeId": route_ids[0], "busLayoutId": layout_ids[1], "vehicleTypeId": None, "departureTime": "21:30", "daysOfWeek": "1111111", "basePriceAdult": 320000, "basePriceChild": 180000, "amenities": amen,
         "points": [{"arrivalTime": None}, {"arrivalTime": "06:00"}]},
        {"routeId": route_ids[0], "busLayoutId": layout_ids[0], "vehicleTypeId": None, "departureTime": "14:00", "daysOfWeek": "1111111", "basePriceAdult": 450000, "basePriceChild": 260000, "amenities": "wifi,ac,water,charging,blanket",
         "points": [{"arrivalTime": None}, {"arrivalTime": "22:00"}]},
        # DN -> HN, brand1 limousine
        {"routeId": route_ids[1], "busLayoutId": layout_ids[0], "vehicleTypeId": None, "departureTime": "07:30", "daysOfWeek": "1111111", "basePriceAdult": 420000, "basePriceChild": 240000, "amenities": amen,
         "points": [{"arrivalTime": None}, {"arrivalTime": "15:45"}]},
        # SG -> DL, brand2
        {"routeId": route_ids[2], "busLayoutId": layout_ids[0], "vehicleTypeId": None, "departureTime": "22:00", "daysOfWeek": "1111111", "basePriceAdult": 280000, "basePriceChild": 160000, "amenities": amen,
         "points": [{"arrivalTime": None}, {"arrivalTime": "05:30"}]},
        {"routeId": route_ids[2], "busLayoutId": layout_ids[2], "vehicleTypeId": None, "departureTime": "09:15", "daysOfWeek": "1111111", "basePriceAdult": 220000, "basePriceChild": 130000, "amenities": "wifi,ac",
         "points": [{"arrivalTime": None}, {"arrivalTime": "17:00"}]},
    ]
    for sc in schedules:
        out = req("POST", "/api/admin/schedules", sc, auth=True)
        print("schedule:", sc["departureTime"], "->", "ok" if out else "FAIL")

    stats = req("GET", "/api/stats")
    print("stats after:", json.dumps(stats))


if __name__ == "__main__":
    main()
