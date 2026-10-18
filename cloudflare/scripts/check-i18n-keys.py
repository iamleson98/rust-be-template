#!/usr/bin/env python3
"""Scan all src/**/*.tsx? for t('key') / t("key") usages and verify each
key exists in both i18n dictionaries (en.ts, vi.ts)."""
import re
import glob
import sys

ROOT = '/home/z/rust-be-template/frontend/src'

# Collect defined keys from i18n files (both quote styles).
defined = {'en': set(), 'vi': set()}
for lang in defined:
    path = f'{ROOT}/lib/i18n/{lang}.ts'
    text = open(path, encoding='utf-8').read()
    for m in re.finditer(r"['\"]([a-zA-Z0-9_.]+)['\"]\s*:", text):
        defined[lang].add(m.group(1))

# Dynamic-prefix keys (t with template literals) can't be checked
# statically; collect them for a manual note.
dynamic = []

used = {}
pattern = re.compile(r"""\bt\(\s*['"]([a-zA-Z0-9_.]+)['"]\s*[,)]""")
for path in glob.glob(f'{ROOT}/**/*.ts*', recursive=True):
    if '/lib/i18n/' in path or '/lib/api/' in path:
        continue
    text = open(path, encoding='utf-8').read()
    for m in pattern.finditer(text):
        used.setdefault(m.group(1), []).append(path.replace(ROOT + '/', ''))

missing_en = sorted(k for k in used if k not in defined['en'])
missing_vi = sorted(k for k in used if k not in defined['vi'])

print(f'total used static keys: {len(used)}')
print(f'missing in en.ts: {len(missing_en)}')
for k in missing_en:
    files = sorted(set(used[k]))[:3]
    print(f'  {k}  <- {", ".join(files)}')
print(f'missing in vi.ts: {len(missing_vi)}')
for k in missing_vi:
    files = sorted(set(used[k]))[:3]
    print(f'  {k}  <- {", ".join(files)}')

# keys defined but never used (informational only)
unused = sorted(k for k in defined['en'] if k not in used)
print(f'defined-but-unused (informational): {len(unused)}')
sys.exit(1 if missing_en or missing_vi else 0)
