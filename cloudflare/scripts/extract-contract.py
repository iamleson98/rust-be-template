#!/usr/bin/env python3
"""Extract the API contract from the frontend's openapi.json into a compact
reference for implementing the Next.js API routes (path, method, params,
request/response schema names)."""
import json, pathlib

spec = json.load(open('/home/z/my-project/repo/frontend/openapi.json'))

def resolve_name(ref):
    return ref.split('/')[-1] if ref else None

out = []
for path, methods in spec['paths'].items():
    for method, op in methods.items():
        if method not in ('get', 'post', 'put', 'patch', 'delete'):
            continue
        params = []
        for p in op.get('parameters', []):
            params.append(f"{p['name']}({p.get('in','?')}{',req' if p.get('required') else ''})")
        body = ''
        rb = op.get('requestBody', {}).get('content', {}).get('application/json', {}).get('schema', {})
        if rb:
            body = resolve_name(rb.get('$ref')) or json.dumps(rb)[:60]
        resp = ''
        for code, r in op.get('responses', {}).items():
            if code.startswith('2'):
                s = r.get('content', {}).get('application/json', {}).get('schema', {})
                resp = resolve_name(s.get('$ref')) or json.dumps(s)[:80]
        out.append(f"{method.upper():6} {path}  params=[{','.join(params)}]  body={body}  resp={resp}")

pathlib.Path('/home/z/my-project/scripts/api-contract.txt').write_text('\n'.join(out))
print(f"{len(out)} operations written to scripts/api-contract.txt")

# Schema field dumps for the most important response types
IMPORTANT = ['RouteOut', 'RouteEndpoint', 'RouteBrandPreview', 'RecommendationOut', 'BrandOut',
             'BrandListOut', 'StatsOut', 'SearchResultOut', 'SearchMeta', 'TripDetailOut',
             'TripSummaryOut', 'BookingOut', 'BookingListItemOut', 'PaymentOut', 'PaymentProviderOut',
             'ReviewOut', 'LoyaltyOut', 'CouponOut', 'CampaignOut', 'NotificationOut',
             'StaffPresenceSnapshot', 'ChatChannelOut', 'ChatMessageOut', 'UserOut', 'VehicleTypeOut',
             'BusLayoutOut', 'ScheduleOut', 'PickupPointOut', 'AddressOut', 'PriceAlertOut', 'PostOut']
schemas = spec.get('components', {}).get('schemas', {})
lines = []
for name in IMPORTANT:
    if name not in schemas:
        lines.append(f"--- {name}: NOT FOUND")
        continue
    s = schemas[name]
    lines.append(f"--- {name} ({s.get('type','?')}):")
    props = s.get('properties', {})
    required = set(s.get('required', []))
    for pn, pv in props.items():
        t = pv.get('type') or resolve_name(pv.get('$ref')) or pv.get('anyOf', [{}])[0].get('type', '?')
        if 'anyOf' in pv:
            t = '|'.join((x.get('type') or resolve_name(x.get('$ref')) or '?') for x in pv['anyOf'])
        if pv.get('type') == 'array':
            items = pv.get('items', {})
            it = items.get('type') or resolve_name(items.get('$ref')) or '?'
            t = f'array<{it}>'
        req = '' if pn in required else '?'
        lines.append(f"    {pn}{req}: {t}")
pathlib.Path('/home/z/my-project/scripts/api-schemas.txt').write_text('\n'.join(lines))
print("key schemas written to scripts/api-schemas.txt")
