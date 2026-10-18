#!/usr/bin/env python3
"""Surgically sync frontend/openapi.json with the current backend DTOs.

Mirrors exactly what `cargo test --lib dump_openapi_spec_for_the_frontend_sdk`
writes (verified byte-identical round-trip: json.dumps(indent=2,
ensure_ascii=False), no trailing newline, insertion order preserved):

1. RouteOut.priceFrom — added in src/dto/public.rs (Option<i64>,
   skip_serializing_if) but missing from the checked-in spec.
2. /api/bookings/lookup path + BookingLookupResponse schema — endpoint
   removed from the backend (guest-lookup UI was dropped in 6921483);
   the stale spec entries made the SDK regen emit lookupOptions that
   queries/index.ts no longer imports.
"""
import json

PATH = '/home/z/rust-be-template/frontend/openapi.json'

raw = open(PATH, encoding='utf-8').read()
spec = json.loads(raw)

# ── 1. Add priceFrom to RouteOut (alphabetical slot: name < priceFrom <
#       scheduleCount — utoipa's BTreeMap emits properties sorted) ──
route_out = spec['components']['schemas']['RouteOut']
props = route_out['properties']
if 'priceFrom' in props:
    print('priceFrom already present — skipping insert')
else:
    new_props = {}
    for key, value in props.items():
        if key == 'scheduleCount':
            new_props['priceFrom'] = {
                'type': ['integer', 'null'],
                'format': 'int64',
                'description': (
                    "Lowest adult base price across the route's schedules (VND).\n"
                    '`None` when the route has no schedules yet — the frontend must\n'
                    'NOT invent a price in that case.'
                ),
            }
        new_props[key] = value
    route_out['properties'] = new_props
    print('added RouteOut.priceFrom')

# ── 2. Drop the removed lookup endpoint (path + response schema) ──
if spec['paths'].pop('/api/bookings/lookup', None) is not None:
    print('removed /api/bookings/lookup path')
if spec['components']['schemas'].pop('BookingLookupResponse', None) is not None:
    print('removed BookingLookupResponse schema')

out = json.dumps(spec, indent=2, ensure_ascii=False)
with open(PATH, 'w', encoding='utf-8') as f:
    f.write(out)
print('rewrote', PATH, f'({len(out)} bytes)')
