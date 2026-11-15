#!/usr/bin/env bash
# Build the stage database both sides start from: the Worker's migrations 0000-0009,
# the Worker's seed script and the synthetic rows (tests/fixtures/d1). Dates in the
# synthetic file are relative to the day it runs, so it is built once per run and
# copied to the REF's local D1 and to the importer: one input, two systems.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/env.sh"
d="$ROOT/tests/fixtures/d1"
mkdir -p "$PARITY_WORK"
rm -f "$PARITY_WORK/stage.db"
{
  echo "PRAGMA foreign_keys=ON;"
  for f in "$d"/migrations/*.sql "$d/seed_cf.sql" "$d/synthetic.sql"; do cat "$f"; echo; done
} | sqlite3 "$PARITY_WORK/stage.db"
# Two columns of the fixture are hand-set and disagree with the rows they summarise. The
# importer recomputes both (brand.rating from the approved reviews, trip_session.available_seats
# from seat_inventory; tests/wp10_import.rs covers that), the Worker would only converge at its next
# review or booking event. Settle them here, so the two systems start from the same numbers and
# every difference the run reports is code, not data.
sqlite3 "$PARITY_WORK/stage.db" <<'SQL'
UPDATE brand SET rating = (SELECT AVG(r.rating) FROM review r WHERE r.brand_id = brand.id AND r.status = 'approved')
 WHERE EXISTS (SELECT 1 FROM review r WHERE r.brand_id = brand.id AND r.status = 'approved');
UPDATE trip_session SET available_seats = (SELECT COUNT(*) FROM seat_inventory si WHERE si.trip_session_id = trip_session.id AND si.status = 'available')
 WHERE EXISTS (SELECT 1 FROM seat_inventory si WHERE si.trip_session_id = trip_session.id);
SQL
echo "stage: $PARITY_WORK/stage.db"
