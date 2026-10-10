//! Derive the REAL client IP from the proxy chain.
//!
//! Deployment chain for browser traffic is:
//!
//! ```text
//! Cloudflare (orange-cloud) ─► nginx stream SNI router ─► Caddy ─► app
//! ```
//!
//! * nginx's SNI router is a `stream{}` block — it passes TLS bytes
//!   through untouched and never rewrites HTTP headers.
//! * Caddy (`reverse_proxy`) appends its immediate peer (a Cloudflare
//!   edge IP) to `X-Forwarded-For`.
//! * Cloudflare appends the true client IP to `X-Forwarded-For` AND sets
//!   the authoritative `CF-Connecting-IP`.
//! * The client's own `X-Forwarded-For` entries (spoofable padding) sit
//!   at the FRONT of the list.
//!
//! So the true client IP is `TRUSTED_PROXY_HOPS + 1` entries from the
//! RIGHT of `X-Forwarded-For` (default hops = 1: exactly the one append
//! Caddy makes). Mobile/programmatic clients may bypass Cloudflare and
//! hit nginx/Caddy directly — then `X-Forwarded-For` only has Caddy's
//! append (the socket peer) and the same right-anchored parse yields it.
//!
//! Why this matters for the WS hubs: `ConnectInfo<SocketAddr>` behind
//! this chain is always CADDY's overlay IP. Keying the per-IP connection
//! caps (`WS_MAX_PER_IP`, both `/ws` and `/ws-call`) on the socket peer
//! puts EVERY user in one bucket — the hub rejects connection #11 while
//! the real per-user count is 1 (production incident class: "site works
//! for 10 users, then nobody can chat"). The HTTP rate limiter already
//! derives its key this way (`ClientIpKeyExtractor` in `routes/router.rs`,
//! SEC-2026-RL); the WS hubs used to be the odd one out.
//!
//! Tradeoff (documented): when a client connects DIRECTLY to the origin
//! with a spoofed `X-Forwarded-For`, the spoofed entry can be selected.
//! That only weakens the per-IP convenience cap — the global cap
//! (`WS_MAX_CONNECTIONS`) and authentication are unaffected. Forensic
//! accuracy is not the goal; fairness of the per-IP bucket is.

use axum::http::HeaderMap;
use std::net::IpAddr;

/// `TRUSTED_PROXY_HOPS` — number of trusted proxies that APPEND to
/// `X-Forwarded-For` before the request reaches the app. Default 1
/// (just Caddy). Read once per process.
pub fn trusted_proxy_hops() -> usize {
    static HOPS: std::sync::OnceLock<usize> = std::sync::OnceLock::new();
    *HOPS.get_or_init(|| {
        std::env::var("TRUSTED_PROXY_HOPS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(1)
    })
}

/// Best-effort parse of one `X-Forwarded-For` entry.
fn parse_ip(s: &str) -> Option<IpAddr> {
    // Entries may carry an optional port (`ip:port`) — strip it for
    // IPv4 before parsing; IPv6 bracketed forms are rare in XFF, but
    // handle `[::1]` too rather than failing the whole entry.
    let s = s.trim();
    if let Some(rest) = s.strip_prefix('[') {
        let end = rest.find(']')?;
        return rest[..end].parse::<IpAddr>().ok();
    }
    if let Some((ip, _port)) = s.rsplit_once(':') {
        if ip.contains('.') {
            // IPv4 with port — but only when the remainder is a port
            // (a bare IPv6 has multiple colons and no dots).
            return ip.parse::<IpAddr>().ok();
        }
    }
    s.parse::<IpAddr>().ok()
}

/// Cloudflare's edge networks (<https://www.cloudflare.com/ips/>), as
/// `(network, prefix length)`.
const CLOUDFLARE_V4: [([u8; 4], u8); 15] = [
    ([173, 245, 48, 0], 20),
    ([103, 21, 244, 0], 22),
    ([103, 22, 200, 0], 22),
    ([103, 31, 4, 0], 22),
    ([141, 101, 64, 0], 18),
    ([108, 162, 192, 0], 18),
    ([190, 93, 240, 0], 20),
    ([188, 114, 96, 0], 20),
    ([197, 234, 240, 0], 22),
    ([198, 41, 128, 0], 17),
    ([162, 158, 0, 0], 15),
    ([104, 16, 0, 0], 13),
    ([104, 24, 0, 0], 14),
    ([172, 64, 0, 0], 13),
    ([131, 0, 72, 0], 22),
];
const CLOUDFLARE_V6: [(u128, u8); 7] = [
    (0x2400_cb00 << 96, 32),
    (0x2606_4700 << 96, 32),
    (0x2803_f800 << 96, 32),
    (0x2405_b500 << 96, 32),
    (0x2405_8100 << 96, 32),
    (0x2a06_98c0 << 96, 29),
    (0x2c0f_f248 << 96, 32),
];

/// Whether `ip` is one of Cloudflare's edge servers.
fn is_cloudflare_edge(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(a) => {
            let a = u32::from(a);
            CLOUDFLARE_V4
                .iter()
                .any(|&(net, len)| (a ^ u32::from_be_bytes(net)) >> (32 - len) == 0)
        }
        IpAddr::V6(a) => {
            let a = u128::from(a);
            CLOUDFLARE_V6
                .iter()
                .any(|&(net, len)| (a ^ net) >> (128 - len) == 0)
        }
    }
}

/// Real client IP from the proxy chain: right-anchored
/// `X-Forwarded-For` (TRUSTED_PROXY_HOPS + 1 from the right), falling
/// back to `CF-Connecting-IP`, then to the socket peer.
pub fn real_client_ip(headers: &HeaderMap, socket_ip: IpAddr) -> IpAddr {
    header_client_ip(headers).unwrap_or(socket_ip)
}

/// The client IP the proxy headers name, if any (see [`real_client_ip`]).
///
/// When the `X-Forwarded-For` entry is a Cloudflare edge server, the proxy
/// in front of the app recorded Cloudflare rather than the visitor (it does
/// not trust Cloudflare's own `X-Forwarded-For`); `CF-Connecting-IP` then
/// names the visitor. Cloudflare overwrites that header itself, so it
/// cannot be forged through Cloudflare, and a client that skips Cloudflare
/// does not arrive from an edge address.
pub fn header_client_ip(headers: &HeaderMap) -> Option<IpAddr> {
    let cf_connecting = || {
        headers
            .get("cf-connecting-ip")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.trim().parse::<IpAddr>().ok())
    };

    if let Some(xff) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
        let hops = trusted_proxy_hops();
        if hops > 0 {
            let ips: Vec<&str> = xff.split(',').collect();
            // Entry `hops` from the right (0-based): the one appended by
            // the proxy BEFORE the last `hops` trusted appends.
            let idx = ips.len().saturating_sub(hops + 1);
            if let Some(ip) = ips.get(idx).and_then(|s| parse_ip(s)) {
                return Some(if is_cloudflare_edge(ip) {
                    cf_connecting().unwrap_or(ip)
                } else {
                    ip
                });
            }
        }
    }

    // Cloudflare sets the authoritative client IP here (cannot be
    // spoofed through the public chain; only reachable from inside the
    // private overlay network, which is already post-compromise).
    cf_connecting()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn headers(pairs: &[(&str, &str)]) -> HeaderMap {
        let mut h = HeaderMap::new();
        for (k, v) in pairs {
            h.insert(
                axum::http::HeaderName::from_lowercase(k.as_bytes()).unwrap(),
                HeaderValue::from_str(v).unwrap(),
            );
        }
        h
    }

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    /// XFF with spoofed padding at the front: `[spoof, real, caddy]`,
    /// hops = 1 → the entry 2-from-the-right = real client IP.
    #[test]
    fn xff_right_anchored_skips_spoofed_padding() {
        let h = headers(&[("x-forwarded-for", "1.2.3.4, 203.0.113.7, 198.51.100.99")]);
        assert_eq!(
            real_client_ip(&h, ip("10.0.0.9")),
            ip("203.0.113.7") // real client; 198.51.100.99 = CF edge (Caddy's append)
        );
    }

    /// Direct (no Cloudflare): XFF = `[peer]` with Caddy's append would
    /// be `[realpeer]`... actually Caddy appends its peer, so a single
    /// non-spoofed entry IS the real peer when the client sent no XFF.
    #[test]
    fn xff_single_entry_is_the_socket_peer() {
        let h = headers(&[("x-forwarded-for", "203.0.113.7")]);
        assert_eq!(real_client_ip(&h, ip("10.0.0.9")), ip("203.0.113.7"));
    }

    /// XFF shorter than the hop count is still well-formed when it's a
    /// single entry — that entry IS Caddy's own append (the client sent
    /// nothing), so it wins over CF-Connecting-IP. For a chain where CF
    /// was skipped but the client spoofed a single entry, this is the
    /// documented spoof tradeoff.
    #[test]
    fn single_xff_entry_beats_cf_connecting_ip() {
        let h = headers(&[
            ("x-forwarded-for", "198.51.100.99"),
            ("cf-connecting-ip", "203.0.113.7"),
        ]);
        assert_eq!(real_client_ip(&h, ip("10.0.0.9")), ip("198.51.100.99"));
    }

    /// No XFF at all → CF-Connecting-IP (CF always sets it on proxied
    /// traffic even when the client sent no XFF).
    #[test]
    fn no_xff_uses_cf_connecting_ip() {
        let h = headers(&[("cf-connecting-ip", "203.0.113.7")]);
        assert_eq!(real_client_ip(&h, ip("10.0.0.9")), ip("203.0.113.7"));
    }

    /// Nothing trustworthy → the socket peer (dev server, health checks).
    #[test]
    fn no_headers_uses_socket_peer() {
        let h = headers(&[]);
        assert_eq!(real_client_ip(&h, ip("127.0.0.1")), ip("127.0.0.1"));
    }

    /// IPv6 clients (mobile carriers) survive the right-anchored parse.
    #[test]
    fn ipv6_client_parsed() {
        let h = headers(&[("x-forwarded-for", "2001:db8::1, 198.51.100.99")]);
        assert_eq!(real_client_ip(&h, ip("10.0.0.9")), ip("2001:db8::1"));
    }

    /// Entries with `ip:port` forms don't break the parse.
    #[test]
    fn xff_entry_with_port() {
        let h = headers(&[("x-forwarded-for", "203.0.113.7:54321, 198.51.100.99")]);
        assert_eq!(real_client_ip(&h, ip("10.0.0.9")), ip("203.0.113.7"));
    }

    /// The proxy recorded a Cloudflare edge (it doesn't trust Cloudflare's
    /// own `X-Forwarded-For`): the visitor is in `CF-Connecting-IP`.
    #[test]
    fn a_cloudflare_edge_defers_to_cf_connecting_ip() {
        for edge in ["172.70.1.2", "104.21.43.253", "2606:4700:10::ac43:c046"] {
            let h = headers(&[
                ("x-forwarded-for", edge),
                ("cf-connecting-ip", "14.160.0.9"),
            ]);
            assert_eq!(
                real_client_ip(&h, ip("10.0.0.9")),
                ip("14.160.0.9"),
                "{edge}"
            );
        }
        // No header to defer to: the edge is all there is.
        let h = headers(&[("x-forwarded-for", "172.70.1.2")]);
        assert_eq!(real_client_ip(&h, ip("10.0.0.9")), ip("172.70.1.2"));
        // Next to the edge ranges is not Cloudflare.
        assert!(!is_cloudflare_edge(ip("172.72.0.1")));
        assert!(!is_cloudflare_edge(ip("2606:4701::1")));
    }

    /// Garbage XFF entries fall through to the next source instead of
    /// poisoning the bucket with a shared bogus value.
    #[test]
    fn garbage_xff_falls_through() {
        let h = headers(&[
            ("x-forwarded-for", "not-an-ip"),
            ("cf-connecting-ip", "203.0.113.7"),
        ]);
        // idx 0 = "not-an-ip" fails parse → CF fallback.
        assert_eq!(real_client_ip(&h, ip("10.0.0.9")), ip("203.0.113.7"));
    }
}
