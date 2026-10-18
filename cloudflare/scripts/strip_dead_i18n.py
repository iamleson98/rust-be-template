#!/usr/bin/env python3
"""Remove dead i18n keys from vi.ts/en.ts, handling multi-line values.

A dictionary entry starts with `  'key':` at line start and ends at the
line whose trailing non-space chars are `,` after a closing quote or the
closing `}` of an object literal value. Entries are removed whole-line.
"""
import re, os

frontend = '/home/z/rust-be-template/frontend'
vi_path = f'{frontend}/src/lib/i18n/vi.ts'
en_path = f'{frontend}/src/lib/i18n/en.ts'
vi = open(vi_path).read()
keys = re.findall(r"^\s*'([^']+)':", vi, re.M)

src_files = []
for root, dirs, files in os.walk(f'{frontend}/src'):
    dirs[:] = [d for d in dirs if os.path.join(root, d) != f'{frontend}/src/lib/i18n']
    for f in files:
        if f.endswith(('.tsx', '.ts')):
            src_files.append(os.path.join(root, f))
blob = ''
for p in src_files:
    blob += open(p, encoding='utf-8', errors='replace').read()
for extra in ('e2e', 'e2e-admin'):
    d = os.path.join(frontend, extra)
    if os.path.isdir(d):
        for root, dirs, files in os.walk(d):
            for f in files:
                if f.endswith(('.ts', '.tsx')):
                    blob += open(os.path.join(root, f), encoding='utf-8', errors='replace').read()

KEEP = {'accountPage.console.greetingMorning', 'accountPage.console.greetingAfternoon',
        'accountPage.console.greetingEvening'}
dead = {k for k in keys if k not in blob and k not in KEEP}
print(f"{len(dead)} dead keys")

ENTRY_START = re.compile(r"^\s*'([^']+)':")
def strip_dead(text: str, dead_keys: set[str]) -> tuple[str, int]:
    lines = text.split('\n')
    out = []
    i = 0
    removed = 0
    while i < len(lines):
        m = ENTRY_START.match(lines[i])
        if m and m.group(1) in dead_keys:
            # Consume the entry: continue until the value closes at a
            # line ending with `',` ``,`` `'},` `},` or a bare `,` that
            # terminates the entry (handles multi-line template literals
            # and object values).
            j = i
            depth_open = False
            while j < len(lines):
                stripped = lines[j].rstrip()
                if j == i and ENTRY_START.match(lines[j]):
                    # first line: if it already terminates the value
                    if re.search(r"""\s(?:'[^']*'|`[^`]*`|\d|true|false)\s*,\s*$""", lines[j]) or stripped.endswith('},'):
                        j += 1
                        break
                    depth_open = True
                elif depth_open:
                    if stripped.endswith("',") or stripped.endswith('`,') or stripped.endswith('},') or stripped.endswith('",'):
                        j += 1
                        break
                j += 1
            else:
                j = len(lines)
            i = j
            removed += 1
            continue
        out.append(lines[i])
        i += 1
    return '\n'.join(out), removed

for path in (vi_path, en_path):
    text = open(path).read()
    new, removed = strip_dead(text, dead)
    open(path, 'w').write(new)
    print(f"{os.path.basename(path)}: removed {removed} entries")

vi2 = set(re.findall(r"^\s*'([^']+)':", open(vi_path).read(), re.M))
en2 = set(re.findall(r"^\s*'([^']+)':", open(en_path).read(), re.M))
assert vi2 == en2, f"parity broken: {sorted(vi2 ^ en2)[:10]}"
assert not (vi2 & dead), "dead keys remain"
print(f"parity OK ({len(vi2)} keys)")
