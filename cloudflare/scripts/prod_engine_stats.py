#!/usr/bin/env python3
"""Query live /api/admin/system engine stats via loopback Caddy (runs ON SERVER)."""
import base64
import hashlib
import hmac
import json
import subprocess
import sys
import time

CID = subprocess.run(["docker", "ps", "-q", "-f", "name=datxevui_backend"],
                     capture_output=True, text=True).stdout.strip()


def env(name: str, default: str = "") -> str:
    v = subprocess.run(["docker", "exec", CID, "printenv", name],
                       capture_output=True, text=True).stdout.strip()
    return v or default


SECRET = env("JWT_SECRET")
ISSUER = env("JWT_ISSUER", "backend")
USER_ID = sys.argv[1] if len(sys.argv) > 1 else "e27a432c-f861-47b9-bda6-a060fa9bc6fb"


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


now = int(time.time())
claims = {"sub": USER_ID, "iss": ISSUER, "iat": now, "exp": now + 3600, "typ": "access"}
header = {"alg": "HS256", "typ": "JWT"}
signing = b64url(json.dumps(header).encode()) + "." + b64url(json.dumps(claims).encode())
sig = hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest()
token = signing + "." + b64url(sig)

path = sys.argv[2] if len(sys.argv) > 2 else "/api/admin/system"
url = f"https://datxevui.com:8443{path}"
out = subprocess.run(
    ["curl", "-sk", "-m", "20", "-H", f"Authorization: Bearer {token}",
     "-H", "Content-Type: application/json", url,
     "--resolve", "datxevui.com:8443:127.0.0.1"],
    capture_output=True, text=True)
if out.returncode != 0 or not out.stdout.strip().startswith("{"):
    print(f"curl rc={out.returncode}: {out.stdout[:300]!r} {out.stderr[:200]!r}")
    sys.exit(1)

body = json.loads(out.stdout)
if "database" not in body:
    print(json.dumps(body, indent=2)[:2000])
    sys.exit(0)

eng = body.get("database", {}).get("engine", {})
print(json.dumps({
    "engineVersion": eng.get("version"),
    "memory": eng.get("memory"),
    "cache": eng.get("cache"),
    "connections": eng.get("connections"),
    "contention": eng.get("contention"),
    "files": [
        {k: f.get(k) for k in ("name", "cacheMb", "cacheCapacityMb", "hitRatePct",
                                "cacheHits", "cacheMisses", "sizeMb", "pageCount",
                                "liveConnections", "walFrames", "freelistPages")}
        for f in eng.get("files", [])
    ],
}, indent=2))
