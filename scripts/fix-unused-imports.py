#!/usr/bin/env python3
"""
Remove unused imports/variables flagged by tsc --noUnusedLocals.
Reads the tsc error output and removes the offending lines.
"""
import re
import sys
from collections import defaultdict

# Parse tsc errors
errors = []
for line in sys.stdin:
    m = re.match(r'.+?\((\d+),(\d+)\): error TS6133: \'(.+?)\' is declared but .+', line)
    if m:
        errors.append((int(m.group(1)), int(m.group(2)), m.group(3)))
        continue
    m = re.match(r'.+?\((\d+),(\d+)\): error TS6196: \'(.+?)\' is declared .+', line)
    if m:
        errors.append((int(m.group(1)), int(m.group(2)), m.group(3)))

# Group by file
by_file = defaultdict(list)
for line in sys.stdin:
    pass  # already read

print(f"Found {len(errors)} unused imports")
for line_no, col, name in errors:
    print(f"  Line {line_no}, col {col}: {name}")
