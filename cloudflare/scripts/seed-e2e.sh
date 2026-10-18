#!/bin/bash
# Seed script for local E2E validation of the search→booking flow.
# Runs against a LIVE backend on :8080 (anti-scrape requires browser UA
# + an allowed Origin on mutations).
# All data lands in /tmp/vexevn/app.db — persists across process restarts.
set -u
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
BASE="http://localhost:8080"
JAR="/tmp/seed-cookies.txt"
rm -f "$JAR"

api() { # method path [json-body]
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -s -A "$UA" -b "$JAR" -c "$JAR" -H "Origin: http://localhost:3000" -H 'Content-Type: application/json' -X "$method" "$BASE$path" -d "$body"
  else
    curl -s -A "$UA" -b "$JAR" -c "$JAR" -H "Origin: http://localhost:3000" -X "$method" "$BASE$path"
  fi
}

py() { python3 -c "$1"; }

echo "── 1. Login / register the admin ──"
REG=$(api POST /api/auth/register '{"fullName":"E2E Admin","email":"e2e-admin@datxevui.test","password":"Passw0rd!123"}')
if ! echo "$REG" | grep -q '"user"'; then
  api POST /api/auth/login '{"email":"e2e-admin@datxevui.test","password":"Passw0rd!123"}' > /dev/null
fi
ME=$(api GET /api/auth/me)
echo "auth: $(echo "$ME" | py "import sys,json; d=json.load(sys.stdin); print(d['user']['role'], d['user']['email'])" 2>/dev/null || echo FAILED)"

echo "── 1b. Register a regular customer (role: user) for the funnel ──"
REG2=$(api POST /api/auth/register '{"fullName":"E2E Khách","email":"e2e-user@datxevui.test","password":"Passw0rd!123"}')
echo "$REG2" | grep -q '"user"' && echo "customer created" || echo "(customer exists or failed)"
# Re-login as admin for the admin CRUD below
api POST /api/auth/login '{"email":"e2e-admin@datxevui.test","password":"Passw0rd!123"}' > /dev/null

echo "── 2. Brands ──"
BRANDS=$(api GET /api/admin/brands)
if ! echo "$BRANDS" | grep -q 'Phương Trang E2E'; then
  api POST /api/admin/brands '{"name":"Phương Trang E2E","slug":"phuong-trang-e2e","description":"E2E seed brand","contactPhone":"0901234567","rating":4.6,"status":"active","accentColor":"#1d4ed8"}' > /dev/null
fi
if ! echo "$BRANDS" | grep -q 'Thanh Bình E2E'; then
  api POST /api/admin/brands '{"name":"Thanh Bình E2E","slug":"thanh-binh-e2e","description":"E2E seed brand 2","contactPhone":"0901234568","rating":4.2,"status":"active","accentColor":"#0e9f6e"}' > /dev/null
fi
BRANDS=$(api GET /api/admin/brands)
B1=$(echo "$BRANDS" | py "import sys,json; d=json.load(sys.stdin); print([b['id'] for b in d['items'] if b['name']=='Phương Trang E2E'][0])")
B2=$(echo "$BRANDS" | py "import sys,json; d=json.load(sys.stdin); print([b['id'] for b in d['items'] if b['name']=='Thanh Bình E2E'][0])")
echo "B1=$B1 B2=$B2"

echo "── 3. Vehicle types (migration-seeded catalog) ──"
VT=$(api GET /api/admin/vehicle-types)
VT_SLEEPER=$(echo "$VT" | py "import sys,json; d=json.load(sys.stdin); print([v['id'] for v in d['items'] if v['code']=='sleeper'][0])")
VT_LIMO=$(echo "$VT" | py "import sys,json; d=json.load(sys.stdin); print([v['id'] for v in d['items'] if v['code']=='limousine'][0])")
echo "sleeper=$VT_SLEEPER limo=$VT_LIMO"

echo "── 4. Bus layouts ──"
LAYOUTS=$(api GET /api/admin/bus-layouts)
if ! echo "$LAYOUTS" | grep -q 'E2E Sleeper 40'; then
  api POST /api/admin/bus-layouts "{\"name\":\"E2E Sleeper 40\",\"brandId\":\"$B1\",\"vehicleType\":\"sleeper\",\"seatGrid\":{\"rows\":5,\"cols\":4,\"floors\":2}}" > /dev/null
fi
if ! echo "$LAYOUTS" | grep -q 'E2E Limo 11'; then
  api POST /api/admin/bus-layouts "{\"name\":\"E2E Limo 11\",\"brandId\":\"$B2\",\"vehicleType\":\"limousine\",\"seatGrid\":{\"rows\":3,\"cols\":3,\"floors\":1}}" > /dev/null
fi
LAYOUTS=$(api GET /api/admin/bus-layouts)
L1=$(echo "$LAYOUTS" | py "import sys,json; d=json.load(sys.stdin); print([l['id'] for l in d['items'] if l['name']=='E2E Sleeper 40'][0])")
L2=$(echo "$LAYOUTS" | py "import sys,json; d=json.load(sys.stdin); print([l['id'] for l in d['items'] if l['name']=='E2E Limo 11'][0])")
echo "L1=$L1 L2=$L2"

echo "── 5. Routes ──"
ROUTES=$(api GET /api/admin/routes)
if ! echo "$ROUTES" | grep -q 'HN→ĐN E2E'; then
  api POST /api/admin/routes "{\"name\":\"HN→ĐN E2E\",\"brandId\":\"$B1\",\"startLocationId\":\"ha-noi\",\"endLocationId\":\"da-nang\",\"status\":\"active\"}" > /dev/null
fi
if ! echo "$ROUTES" | grep -q 'SG→ĐL E2E'; then
  api POST /api/admin/routes "{\"name\":\"SG→ĐL E2E\",\"brandId\":\"$B2\",\"startLocationId\":\"ho-chi-minh\",\"endLocationId\":\"da-lat\",\"status\":\"active\"}" > /dev/null
fi
ROUTES=$(api GET /api/admin/routes)
R1=$(echo "$ROUTES" | py "import sys,json; d=json.load(sys.stdin); print([r['id'] for r in d['items'] if r['name']=='HN→ĐN E2E'][0])")
R2=$(echo "$ROUTES" | py "import sys,json; d=json.load(sys.stdin); print([r['id'] for r in d['items'] if r['name']=='SG→ĐL E2E'][0])")
echo "R1=$R1 R2=$R2"

echo "── 6. Addresses (brand-scoped) ──"
find_addr() { # brandId name
  api GET "/api/admin/addresses?brandId=$1" | py "
import sys,json
d=json.load(sys.stdin)
m=[a['id'] for a in d.get('items',[]) if a.get('name')=='$2']
print(m[0] if m else '')" 2>/dev/null
}
A1=$(find_addr "$B1" "E2E Bến Mỹ Đình"); [ -z "$A1" ] && A1=$(api POST /api/admin/addresses "{\"brandId\":\"$B1\",\"name\":\"E2E Bến Mỹ Đình\",\"address\":\"Mỹ Đình, Hà Nội\",\"lat\":21.0245,\"lon\":105.796,\"province\":\"Hà Nội\"}" | py "import sys,json; print(json.load(sys.stdin).get('id',''))")
A2=$(find_addr "$B1" "E2E Bến Đà Nẵng"); [ -z "$A2" ] && A2=$(api POST /api/admin/addresses "{\"brandId\":\"$B1\",\"name\":\"E2E Bến Đà Nẵng\",\"address\":\"Đà Nẵng\",\"lat\":16.0544,\"lon\":108.2022,\"province\":\"Đà Nẵng\"}" | py "import sys,json; print(json.load(sys.stdin).get('id',''))")
A3=$(find_addr "$B2" "E2E Bến SG"); [ -z "$A3" ] && A3=$(api POST /api/admin/addresses "{\"brandId\":\"$B2\",\"name\":\"E2E Bến SG\",\"address\":\"Quận 1, TP.HCM\",\"lat\":10.7763,\"lon\":106.7014,\"province\":\"TP. Hồ Chí Minh\"}" | py "import sys,json; print(json.load(sys.stdin).get('id',''))")
A4=$(find_addr "$B2" "E2E Bến Đà Lạt"); [ -z "$A4" ] && A4=$(api POST /api/admin/addresses "{\"brandId\":\"$B2\",\"name\":\"E2E Bến Đà Lạt\",\"address\":\"Đà Lạt\",\"lat\":11.9401,\"lon\":108.4398,\"province\":\"Lâm Đồng\"}" | py "import sys,json; print(json.load(sys.stdin).get('id',''))")
echo "A1=$A1 A2=$A2 A3=$A3 A4=$A4"

echo "── 7. Schedules ──"
TOMORROW=$(date -d "+1 day" +%Y-%m-%d)
NEXTWEEK=$(date -d "+9 days" +%Y-%m-%d)
SCHEDS=$(api GET /api/admin/schedules)
if ! echo "$SCHEDS" | grep -q "\"routeId\":\"$R1\""; then
  api POST /api/admin/schedules "{\"routeId\":\"$R1\",\"departureTime\":\"08:30\",\"effectiveFrom\":\"$TOMORROW\",\"effectiveTo\":\"$NEXTWEEK\",\"daysOfWeek\":\"1111111\",\"busLayoutId\":\"$L1\",\"vehicleTypeId\":\"$VT_SLEEPER\",\"basePriceAdult\":350000,\"basePriceChild\":175000,\"amenities\":\"wifi,ac,water,charging\",\"points\":[{\"addressId\":\"$A1\"},{\"addressId\":\"$A2\"}]}" | head -c 200; echo
  api POST /api/admin/schedules "{\"routeId\":\"$R1\",\"departureTime\":\"20:00\",\"effectiveFrom\":\"$TOMORROW\",\"effectiveTo\":\"$NEXTWEEK\",\"daysOfWeek\":\"1111111\",\"busLayoutId\":\"$L1\",\"vehicleTypeId\":\"$VT_SLEEPER\",\"basePriceAdult\":320000,\"basePriceChild\":160000,\"amenities\":\"wifi,ac\",\"points\":[{\"addressId\":\"$A1\"},{\"addressId\":\"$A2\"}]}" | head -c 200; echo
fi
if ! echo "$SCHEDS" | grep -q "\"routeId\":\"$R2\""; then
  api POST /api/admin/schedules "{\"routeId\":\"$R2\",\"departureTime\":\"07:00\",\"effectiveFrom\":\"$TOMORROW\",\"effectiveTo\":\"$NEXTWEEK\",\"daysOfWeek\":\"1111111\",\"busLayoutId\":\"$L2\",\"vehicleTypeId\":\"$VT_LIMO\",\"basePriceAdult\":280000,\"basePriceChild\":140000,\"amenities\":\"wifi,ac,water\",\"points\":[{\"addressId\":\"$A3\"},{\"addressId\":\"$A4\"}]}" | head -c 200; echo
fi

echo "── 7b. Route pickup points (trip detail reads these) ──"
PP=$(api GET "/api/admin/pickup-points?routeId=$R1")
if ! echo "$PP" | grep -q 'E2E Bến Mỹ Đình'; then
  api POST /api/admin/pickup-points "{\"routeId\":\"$R1\",\"name\":\"E2E Bến Mỹ Đình\",\"address\":\"Mỹ Đình, Hà Nội\",\"lat\":21.0245,\"lon\":105.796,\"stopOrder\":1,\"kind\":\"pickup\"}" > /dev/null
  api POST /api/admin/pickup-points "{\"routeId\":\"$R1\",\"name\":\"E2E Bến Đà Nẵng\",\"address\":\"Đà Nẵng\",\"lat\":16.0544,\"lon\":108.2022,\"stopOrder\":2,\"kind\":\"dropoff\"}" > /dev/null
fi
PP2=$(api GET "/api/admin/pickup-points?routeId=$R2")
if ! echo "$PP2" | grep -q 'E2E Bến SG'; then
  api POST /api/admin/pickup-points "{\"routeId\":\"$R2\",\"name\":\"E2E Bến SG\",\"address\":\"Quận 1, TP.HCM\",\"lat\":10.7763,\"lon\":106.7014,\"stopOrder\":1,\"kind\":\"pickup\"}" > /dev/null
  api POST /api/admin/pickup-points "{\"routeId\":\"$R2\",\"name\":\"E2E Bến Đà Lạt\",\"address\":\"Đà Lạt\",\"lat\":11.9401,\"lon\":108.4398,\"stopOrder\":2,\"kind\":\"dropoff\"}" > /dev/null
fi
echo "R1 points: $(echo "$PP" | py "import sys,json; print(len(json.load(sys.stdin).get('items',[])))" 2>/dev/null)"
echo "R2 points: $(echo "$PP2" | py "import sys,json; print(len(json.load(sys.stdin).get('items',[])))" 2>/dev/null)"

echo "── 8. Verify public search API ──"
D=$(date -d "+1 day" +%Y-%m-%d)
api GET "/api/search?from=Hà%20Nội&to=Đà%20Nẵng&date=$D" | py "
import sys,json
d=json.load(sys.stdin)
items=d.get('items',[])
print(f'Hà Nội → Đà Nẵng ({D}): {len(items)} trips')
for t in items[:5]:
    print(' ', t.get('departureTime'), t.get('brandName'), t.get('vehicleTypeLabel'), t.get('minPrice'), 'seats:', t.get('availableSeats'), '/', t.get('totalSeats'))
" 2>&1 | head -8
api GET "/api/search?from=TP.%20Hồ%20Chí%20Minh&to=Đà%20Lạt&date=$D" | py "
import sys,json
d=json.load(sys.stdin)
items=d.get('items',[])
print(f'SG → Đà Lạt ({D}): {len(items)} trips')
for t in items[:5]:
    print(' ', t.get('departureTime'), t.get('brandName'), t.get('vehicleTypeLabel'), t.get('minPrice'), 'seats:', t.get('availableSeats'), '/', t.get('totalSeats'))
" 2>&1 | head -8
echo "── seed done ──"
