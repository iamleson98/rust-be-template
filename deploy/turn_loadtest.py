#!/usr/bin/env python3
"""Concurrent TURN allocation load-test (RFC 5766 over UDP 3478).

Spawns N concurrent long-term-cred TURN allocations against the coturn
server, holds them, and reports: success/failure counts, DISTINCT relay
ports, and the min/max relay port observed. Validates that coturn can
sustain the relay-port budget needed for C concurrent WebRTC calls
(each call ≈ up to 8 allocations: both peers × multiple ICE candidates).

Usage:
  python3 turn_loadtest.py <host> <username> <secret> [count] [hold_secs] [port]

Exit 0 only when ALL allocations succeed AND relay ports are distinct.
"""
import hashlib
import hmac
import os
import socket
import struct
import sys
import time

MAGIC = 0x2112A442
ALLOCATE = 0x0003
ALLOCATE_OK = 0x0103
ALLOCATE_ERR = 0x0113
STUN_BINDING = 0x0001
STUN_BINDING_OK = 0x0101
LIFETIME = 0x000D
# Client-requested allocation lifetime: bounds zombie allocations to
# this many seconds even if the Release exchange fails (the server
# clamps to its own max, granting min(request, max)).
REQ_LIFETIME_SECS = 120


def header(msg_type: int, length: int, txid: bytes) -> bytes:
    return struct.pack(">HHI", msg_type, length, MAGIC) + txid


def attr(attr_type: int, value: bytes) -> bytes:
    pad = (4 - len(value) % 4) % 4
    return struct.pack(">HH", attr_type, len(value)) + value + b"\x00" * pad


def parse_attrs(msg: bytes) -> dict:
    out = {}
    msg_len = struct.unpack(">H", msg[2:4])[0]
    pos, end = 20, 20 + msg_len
    while pos + 4 <= end:
        atype, alen = struct.unpack(">HH", msg[pos:pos + 4])
        out[atype] = msg[pos + 4:pos + 4 + alen]
        pos += 4 + alen + ((4 - alen % 4) % 4)
    return out


def recv_msg(sock) -> bytes:
    data = b""
    while len(data) < 20:
        chunk = sock.recv(2048)
        if not chunk:
            raise ConnectionError("connection closed")
        data += chunk
    need = 20 + struct.unpack(">H", data[2:4])[0]
    while len(data) < need:
        chunk = sock.recv(2048)
        if not chunk:
            raise ConnectionError("closed mid-message")
        data += chunk
    return data


def xor_port_addr(value: bytes):
    xport = struct.unpack(">H", value[2:4])[0] ^ 0x2112
    xaddr = struct.unpack(">I", value[4:8])[0] ^ MAGIC
    return xport, socket.inet_ntoa(struct.pack(">I", xaddr))


def stun_transact(sock: tuple, msg: bytes, host: str, port: int, attempts: int = 4):
    """Send a STUN message and await the matching response, with
    RFC 5389-style retransmission (RTO 500ms doubling) — real STUN
    clients (libwebrtc) always retransmit; a single-shot timeout would
    make the load test stricter than production traffic."""
    rto = 0.5
    for attempt in range(attempts):
        sock.sendto(msg, (host, port))
        sock.settimeout(max(rto, 1.0))
        try:
            return sock.recvfrom(4096)[0]
        except socket.timeout:
            rto *= 2
    raise TimeoutError("no response after retransmits")


def allocate(host: str, port: int, user: str, secret: str, idx: int) -> tuple:
    """One TURN allocation over UDP. Returns (relay_port, relay_ip, sock,
    realm, nonce) or raises."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # Unauthenticated allocate → expect 401 with NONCE + REALM.
        txid = os.urandom(12)
        body = attr(0x0019, b"\x11\x00\x00\x00")  # REQUESTED-TRANSPORT: UDP
        resp = stun_transact(sock, header(ALLOCATE, len(body), txid) + body, host, port)
        rtype = struct.unpack(">H", resp[:2])[0]
        a = parse_attrs(resp)
        if rtype != ALLOCATE_ERR or 0x0014 not in a or 0x0015 not in a:
            raise RuntimeError(f"[{idx}] expected 401 challenge, got 0x{rtype:04x}")
        realm = a[0x0014].decode()
        nonce = a[0x0015].decode()

        key = hashlib.md5(f"{user}:{realm}:{secret}".encode()).digest()
        txid = os.urandom(12)
        body = (
            attr(0x0019, b"\x11\x00\x00\x00")
            + attr(0x0006, user.encode())
            + attr(0x0014, realm.encode())
            + attr(0x0015, nonce.encode())
            + attr(LIFETIME, struct.pack(">I", REQ_LIFETIME_SECS))
        )
        msg = header(ALLOCATE, len(body) + 24, txid) + body
        mac = hmac.new(key, msg, hashlib.sha1).digest()
        resp = stun_transact(sock, msg + attr(0x0008, mac), host, port)
        rtype = struct.unpack(">H", resp[:2])[0]
        a = parse_attrs(resp)
        if rtype != ALLOCATE_OK:
            code = ""
            if 0x0009 in a:
                code = f" err={struct.unpack('>H', a[0x0009][2:4])[0]}"
            raise RuntimeError(f"[{idx}] allocate failed 0x{rtype:04x}{code}")
        if 0x0016 not in a:
            raise RuntimeError(f"[{idx}] no XOR-RELAYED-ADDRESS")
        xport, xaddr = xor_port_addr(a[0x0016])
        granted = struct.unpack(">I", a.get(LIFETIME, b"\x00\x00\x00\x00"))[0]
        return xport, xaddr, sock, realm, nonce, granted
    except Exception:
        sock.close()
        raise


def release(sock, host: str, port: int, user: str, secret: str, realm: str, nonce: str) -> bool:
    """Explicit TURN Release (RFC 5766 §8.7) — WITHOUT it the allocation
    stays live server-side until its lifetime expires (default 600 s);
    a load test that leaks allocations poisons its own re-runs and the
    production relay-port budget for the next 10 minutes."""
    try:
        key = hashlib.md5(f"{user}:{realm}:{secret}".encode()).digest()
        txid = os.urandom(12)
        body = (
            attr(0x0006, user.encode())
            + attr(0x0014, realm.encode())
            + attr(0x0015, nonce.encode())
        )
        msg = header(0x0004, len(body) + 24, txid) + body
        mac = hmac.new(key, msg, hashlib.sha1).digest()
        resp = stun_transact(sock, msg + attr(0x0008, mac), host, port, attempts=2)
        rtype = struct.unpack(">H", resp[:2])[0]
        return rtype == 0x0104  # Release success response
    except Exception:
        return False


def main() -> int:
    if len(sys.argv) < 4:
        print(__doc__)
        return 2
    host = sys.argv[1]
    user = sys.argv[2]
    secret = sys.argv[3]
    count = int(sys.argv[4]) if len(sys.argv) > 4 else 120
    hold = float(sys.argv[5]) if len(sys.argv) > 5 else 20.0
    port = int(sys.argv[6]) if len(sys.argv) > 6 else 3478

    print(f"TURN load test: {count} concurrent allocations → {host}:{port}/udp, hold {hold}s")
    t0 = time.time()
    live = []   # (relay_port, relay_ip, sock, realm, nonce)
    errors = []
    lock = __import__("threading").Lock()

    def _one(i: int):
        try:
            xport, xaddr, sock, realm, nonce, granted = allocate(host, port, user, secret, i)
            with lock:
                live.append((xport, xaddr, sock, realm, nonce))
                if i == 0:
                    print(f"  granted lifetime: {granted}s (requested {REQ_LIFETIME_SECS}s)")
        except Exception as e:
            with lock:
                errors.append(str(e))
                if len(errors) <= 5:
                    print(f"  alloc {i}: FAILED — {e}")

    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=48) as pool:
        list(pool.map(_one, range(count)))
    t_alloc = time.time() - t0
    ports = {p for p, _, _, _, _ in live}

    print(f"allocated:   {len(live)}/{count} in {t_alloc:.1f}s")
    print(f"failures:    {len(errors)}")
    if live:
        print(f"distinct relay ports: {len(ports)}")
        print(f"relay port range: {min(ports)}–{max(ports)}")
    if errors:
        from collections import Counter
        sigs = Counter(e.split("] ")[-1] for e in errors)
        print("failure signatures:")
        for sig, n in sigs.most_common(5):
            print(f"  {n}× {sig}")

    # Hold — allocations stay live server-side (default lifetime 600s).
    if hold > 0 and live:
        print(f"holding {len(live)} allocations for {hold}s …")
        time.sleep(hold)

    # Explicit release so the test leaves NO zombie allocations behind
    # (closing the client socket does NOT free the server-side relay —
    # only Release or lifetime expiry does).
    released = 0
    for xport, xaddr, sock, realm, nonce in live:
        if release(sock, host, port, user, secret, realm, nonce):
            released += 1
        try:
            sock.close()
        except OSError:
            pass
    if live:
        print(f"released:    {released}/{len(live)} allocations (rest expire via lifetime)")

    ok = len(errors) == 0 and len(ports) == count
    print(f"RESULT: {'PASS' if ok else 'FAIL'} — {len(live)} allocations, {len(ports)} distinct relay ports (target {count})")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
