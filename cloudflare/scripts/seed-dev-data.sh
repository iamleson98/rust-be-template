#!/bin/bash
# Seed dev data: register first user (auto-admin), then vehicle type,
# brand, route, schedules. Verifies public search returns trips.
set -u
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36"
BASE="http://localhost:8080"
JAR=/tmp/seed-cookies.txt
TOMORROW=$(date -d "+1 day" +%Y-%m-%d)
NEXTWEEK=$(date -d "+7 days" +%Y-%m-%d)
rm -f "$JAR"

req() { curl -s -m 10 -A "$UA" -b "$JAR" -c "$JAR" -H 'Content-Type: application/json' -H 'Origin: http://localhost:3000' "$@"; }

echo "── 1. Register/login first user (auto-admin)"
REG=$(req -X POST "$BASE/api/auth/register" -d '{
  "email": "$ADMIN_EMAIL",
  "fullName": "Le Minh Son",
  "password": "$ADMIN_PASSWORD"
}')
if echo "$REG" | rg -q '"error"'; then
  echo "  (already registered — logging in)"
  REG=$(req -X POST "$BASE/api/auth/login" -d '{
    "email": "$ADMIN_EMAIL",
    "password": "$ADMIN_PASSWORD"
  }')
fi
echo "$REG" | head -c 300; echo

echo "── 2. Find seeded limousine vehicle type"
VT_ID=$(req "$BASE/api/admin/vehicle-types" | python3 -c '
import json,sys
items = json.load(sys.stdin).get("items", [])
vt = next((v for v in items if v.get("code")=="limousine"), items[0] if items else None)
print(vt["id"] if vt else "")' 2>/dev/null)
echo "vehicle type id: $VT_ID"

echo "── 3. Create brand"
BR=$(req -X POST "$BASE/api/admin/brands" -d '{
  "name": "VexEvn Limousine", "slug": "vexevn-limousine",
  "description": "Premium limousine lines", "contactPhone": "0918000123",
  "contactEmail": "cskh@datxevui.vn", "rating": 4.8, "status": "active",
  "accentColor": "#2563eb"
}')
echo "$BR" | head -c 200; echo
BR_ID=$(echo "$BR" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("id",""))' 2>/dev/null)
echo "brand id: $BR_ID"

echo "── 4. Create route HN → HCM"
RT=$(req -X POST "$BASE/api/admin/routes" -d "{
  \"name\": \"Hà Nội → TP Hồ Chí Minh\", \"brandId\": \"$BR_ID\",
  \"startLocationId\": \"ha-noi\", \"endLocationId\": \"ho-chi-minh\", \"status\": \"active\"
}")
echo "$RT" | head -c 200; echo
RT_ID=$(echo "$RT" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("id",""))' 2>/dev/null)
echo "route id: $RT_ID"

echo "── 5. Create schedules (08:00 + 20:00 daily)"
for T in 08:00 20:00; do
  S=$(req -X POST "$BASE/api/admin/schedules" -d "{
    \"routeId\": \"$RT_ID\", \"departureTime\": \"$T\",
    \"effectiveFrom\": \"$TOMORROW\", \"effectiveTo\": \"$NEXTWEEK\",
    \"daysOfWeek\": \"1111111\", \"vehicleTypeId\": \"$VT_ID\",
    \"basePriceAdult\": 450000, \"basePriceChild\": 300000
  }")
  echo "  $T → $(echo "$S" | head -c 150)"
done

echo "── 6. Public routes list (priceFrom populated?)"
req "$BASE/api/routes" | python3 -m json.tool 2>/dev/null | head -30

echo "── 7. Search trips (d Tomorrow, diacritics-tolerant)"
for Q in "Hà Nội" "Ha Noi" "Sài Gòn" "sai gon" "TP Hồ Chí Minh"; do
  ENC=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$Q")
  N=$(req "$BASE/api/search?from=$ENC&to=$(python3 -c "import urllib.parse; print(urllib.parse.quote('Sài Gòn'))")&date=$TOMORROW" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d.get("items",[])))' 2>/dev/null)
  echo "  from='$Q' to='Sài Gòn' → $N trips"
done

echo "── 8. Search HCM → HN (reverse)"
req "$BASE/api/search?from=TP%20H%E1%BB%93%20Ch%C3%AD%20Minh&to=H%C3%A0%20N%E1%BB%99i&date=$TOMORROW" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("reverse trips:", len(d.get("items",[])))'

echo "── done"
