#!/usr/bin/env python3
"""Find i18n keys defined in vi.ts but not referenced anywhere in src/
(excluding the dictionary files themselves and tests that enumerate keys)."""
import re, subprocess, sys, os

frontend = '/home/z/rust-be-template/frontend'
vi = open(f'{frontend}/src/lib/i18n/vi.ts').read()
keys = re.findall(r"^\s*'([a-zA-Z0-9.]+)':", vi, re.M)
print(f"total keys: {len(keys)}", file=sys.stderr)

# grep the whole src tree for each key occurrence outside dictionaries
src_files = []
for root, dirs, files in os.walk(f'{frontend}/src'):
    dirs[:] = [d for d in dirs if d not in ('lib/i18n', '__tests__')]
    for f in files:
        if f.endswith(('.tsx', '.ts')):
            src_files.append(os.path.join(root, f))

blob = ''
for p in src_files:
    blob += open(p, encoding='utf-8', errors='replace').read()

dead = [k for k in keys if k not in blob]
# Dynamic prefixes like tripDetail.stopKindPickup constructed via STOP_KIND_KEY map are literal — ok.
for k in dead:
    print(k)
