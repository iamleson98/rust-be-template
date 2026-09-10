#!/usr/bin/env python3
"""End-to-end TURN-over-TLS test: proves the corporate-network path
(turns:turn.datxevui.com:443?transport=tcp) works.

Usage:
  python3 turn_verify.py <host> <port> <sni> <username> <secret>

Steps:
  1. TLS connect (SNI = turn.datxevui.com) — nginx SNI-routes to coturn;
     the peer cert subject proves WHICH backend answered.
  2. STUN Binding request — coturn answers.
  3. TURN Allocate with long-term credentials (RFC 5766) — a
     XOR-RELAYED-ADDRESS in the response proves full TURN relaying.
Exit code 0 only if all steps pass.
"""
import hashlib
import hmac
import os
import socket
import ssl
import struct
import sys

MAGIC = 0x2112A442


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
            raise ConnectionError("connection closed mid-message")
        data += chunk
    return data


def xor_addr(value: bytes):
    fam = value[0]
    xport = struct.unpack(">H", value[2:4])[0] ^ 0x2112
    xaddr = struct.unpack(">I", value[4:8])[0] ^ MAGIC
    return fam, xport, socket.inet_ntoa(struct.pack(">I", xaddr))


def main() -> int:
    host, port, sni, user, secret = (
        sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4], sys.argv[5]
    )
    print(f"connecting: {host}:{port} SNI={sni} (TLS, no cert verify)")

    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    raw = socket.create_connection((host, port), timeout=15)
    sock = ctx.wrap_socket(raw, server_hostname=sni)
    print(f"TLS OK: {sock.version()}, cipher={sock.cipher()[0]}")
    cert = sock.getpeercert(binary_form=True)
    if cert:
        # print just the subject CN — enough to identify the backend
        der = ssl.DER_cert_to_PEM_cert(cert)
        import tempfile, subprocess
        with tempfile.NamedTemporaryFile(mode="w", suffix=".pem", delete=False) as f:
            f.write(der)
            path = f.name
        try:
            subj = subprocess.run(
                ["openssl", "x509", "-in", path, "-noout", "-subject"],
                capture_output=True, text=True
            ).stdout.strip()
            print(f"peer cert: {subj}")
        finally:
            os.unlink(path)

    # ── STUN binding ──
    txid = os.urandom(12)
    sock.sendall(header(0x0001, 0, txid))
    resp = recv_msg(sock)
    rtype = struct.unpack(">H", resp[:2])[0]
    if rtype != 0x0101:
        print(f"FAIL: STUN binding response type 0x{rtype:04x} (expected 0x0101)")
        return 1
    rtxid = resp[8:20]
    if rtxid != txid:
        print("FAIL: transaction id mismatch")
        return 1
    print("STUN binding: OK (server answered on the TLS listener)")

    # ── TURN allocate (long-term credentials) ──
    txid = os.urandom(12)
    body = attr(0x0019, b"\x11\x00\x00\x00")  # REQUESTED-TRANSPORT: UDP
    sock.sendall(header(0x0003, len(body), txid) + body)
    resp = recv_msg(sock)
    rtype = struct.unpack(">H", resp[:2])[0]
    a = parse_attrs(resp)
    if rtype != 0x0113 or 0x0014 not in a or 0x0015 not in a:
        print(f"FAIL: expected 401 challenge with realm+nonce, got 0x{rtype:04x} attrs={list(hex(k) for k in a)}")
        return 1
    realm = a[0x0014].decode()
    nonce = a[0x0015].decode()
    print(f"TURN 401 challenge: realm={realm!r} (non-empty realm — libwebrtc-compatible)")

    key = hashlib.md5(f"{user}:{realm}:{secret}".encode()).digest()
    txid = os.urandom(12)
    body = (
        attr(0x0019, b"\x11\x00\x00\x00")
        + attr(0x0006, user.encode())
        + attr(0x0014, realm.encode())
        + attr(0x0015, nonce.encode())
    )
    msg = header(0x0003, len(body) + 24, txid) + body
    mac = hmac.new(key, msg, hashlib.sha1).digest()
    sock.sendall(msg + attr(0x0008, mac))
    resp = recv_msg(sock)
    rtype = struct.unpack(">H", resp[:2])[0]
    a = parse_attrs(resp)
    if rtype != 0x0103:
        code = ""
        if 0x0009 in a:  # ERROR-CODE
            code = f" error {struct.unpack('>H', a[0x0009][2:4])[0]}"
        print(f"FAIL: allocate response 0x{rtype:04x}{code}")
        return 1
    if 0x0016 not in a:
        print("FAIL: no XOR-RELAYED-ADDRESS in allocate success")
        return 1
    fam, xport, xaddr = xor_addr(a[0x0016])
    lifetime = struct.unpack(">I", a.get(0x000D, b"\x00\x00\x03\x84"))[0]
    print(f"TURN allocate: SUCCESS — relayed address {xaddr}:{xport}, lifetime {lifetime}s")
    print("ALL CHECKS PASSED: turns:443 path is functional end-to-end")
    return 0


if __name__ == "__main__":
    sys.exit(main())
