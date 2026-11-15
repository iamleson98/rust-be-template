//! Derive the REAL client IP from the proxy chain.
//!
//! Two deployments, chosen by `CLIENT_IP_SOURCE` (see [`ClientIpSource`]):
//!
//! * **`cf-connecting-ip`** — Cloudflare Tunnel (`cloudflared` on the same
//!   host forwards to the app on loopback). Every connection's TCP peer is
//!   `127.0.0.1`, so the peer says nothing about the visitor; Cloudflare's
//!   `CF-Connecting-IP` does, and `cloudflared` passes it through. The header
//!   is honoured ONLY when the peer is loopback: anything else reaching the
//!   port could have written it, so it is dropped and the peer is the client.
//!   `X-Forwarded-For` is never used here: Cloudflare appends to a
//!   client-supplied list, so its entries are forgeable.
//! * **`xff`** (default) — a reverse proxy in front that appends to
//!   `X-Forwarded-For` (`TRUSTED_PROXY_HOPS` appends, default 1): the true
//!   client is `hops + 1` entries from the RIGHT, since the client's own
//!   entries sit at the front. When the selected entry is a Cloudflare edge or
//!   a private address (a proxy that does not trust Cloudflare's header and
//!   recorded its own peer), `CF-Connecting-IP` names the visitor.
//!
//! [`trusted_forwarding_headers`] enforces the first rule once, at the top of
//! the stack, by deleting the headers that cannot be trusted; every consumer
//! ([`real_client_ip`], [`header_client_ip`]) then reads what is left.
//!
//! Why this matters: keying a per-IP limit (HTTP rate limits, the WebSocket
//! caps `WS_MAX_PER_IP`) on the socket peer puts EVERY visitor in one bucket
//! behind any proxy ("site works for 10 users, then nobody can chat"; the
//! 2026-10-15 load test shared ONE ~100 rps bucket the same way).
//!
//! Tradeoff (documented) in `xff` mode: a client connecting DIRECTLY to the
//! origin with a spoofed `X-Forwarded-For` can choose its bucket. That only
//! weakens a per-IP convenience cap; the global caps and authentication are
//! unaffected.

use std::net::{IpAddr, SocketAddr};

use axum::extract::{ConnectInfo, Request, State};
use axum::http::HeaderMap;
use axum::middleware::Next;
use axum::response::Response;

use crate::config::CLIENT_IP_SOURCE_CF;

/// Which header names the client (`CLIENT_IP_SOURCE`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ClientIpSource {
    /// A proxy appends to `X-Forwarded-For`.
    Xff,
    /// Cloudflare Tunnel on this host sets `CF-Connecting-IP`.
    CfConnectingIp,
}

impl ClientIpSource {
    /// The config value is validated at startup; anything but the Cloudflare
    /// spelling is the `X-Forwarded-For` chain.
    pub fn from_config(value: &str) -> Self {
        if value == CLIENT_IP_SOURCE_CF {
            Self::CfConnectingIp
        } else {
            Self::Xff
        }
    }
}

/// Warns at boot about the one setting that silently weakens per-IP limits:
/// `xff` while the listener is bound to loopback. Then every peer is a
/// same-host proxy (`cloudflared`), whose `X-Forwarded-For` Cloudflare
/// appends to a client-supplied list, so visitors can pick their own bucket;
/// `cf-connecting-ip` is the mode for that deployment.
pub fn warn_if_xff_behind_loopback(source: ClientIpSource, bind_host: &str) {
    if xff_behind_loopback(source, bind_host) {
        tracing::warn!(
            bind = bind_host,
            "CLIENT_IP_SOURCE=xff but the server listens on loopback only, so every \
             connection comes from a local proxy; if that is cloudflared, set \
             CLIENT_IP_SOURCE={CLIENT_IP_SOURCE_CF} (X-Forwarded-For is client-forgeable there)"
        );
    }
}

fn xff_behind_loopback(source: ClientIpSource, bind_host: &str) -> bool {
    source == ClientIpSource::Xff
        && (bind_host == "localhost"
            || bind_host
                .trim_matches(['[', ']'])
                .parse::<IpAddr>()
                .is_ok_and(|ip| ip.to_canonical().is_loopback()))
}

/// Deletes the forwarding headers this deployment cannot trust, so everything
/// downstream may read them as given. A no-op in `xff` mode; in
/// `cf-connecting-ip` mode `X-Forwarded-For` always goes (forgeable through
/// Cloudflare) and `CF-Connecting-IP` goes unless the TCP peer is loopback.
pub async fn trusted_forwarding_headers(
    State(source): State<ClientIpSource>,
    mut req: Request,
    next: Next,
) -> Response {
    if source == ClientIpSource::CfConnectingIp {
        let from_loopback = req
            .extensions()
            .get::<ConnectInfo<SocketAddr>>()
            .is_some_and(|peer| peer.0.ip().to_canonical().is_loopback());
        let headers = req.headers_mut();
        headers.remove("x-forwarded-for");
        if !from_loopback {
            headers.remove("cf-connecting-ip");
        }
    }
    next.run(req).await
}

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

/// Whether `ip` is a private / loopback / link-local address — a
/// proxy-chain artifact, never a real internet client.
///
/// When the right-anchored `X-Forwarded-For` entry is one of these, the
/// chain did NOT record the actual visitor. That is exactly what
/// happens when Caddy has no `trusted_proxies` for its peer: it
/// REPLACES the incoming `X-Forwarded-For` (which Cloudflare set to the
/// visitor IP) with its own docker-network peer (observed live:
/// `172.18.0.1` for every request — the whole site shared ONE rate-limit
/// bucket; load test 2026-10-15). In that degraded state,
/// `CF-Connecting-IP` — which Cloudflare overwrites authoritatively on
/// proxied traffic — is the only header that still names the visitor.
fn is_private_or_loopback(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(a) => {
            a.is_private() || a.is_loopback() || a.is_link_local() || a.is_unspecified()
        }
        IpAddr::V6(a) => {
            a.is_loopback()
                || a.is_unspecified()
                || a.is_unique_local()
                || (a.segments()[0] & 0xffc0) == 0xfe80 // link-local fe80::/10
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
/// does not arrive from an edge address. The same deferral applies when
/// the selected entry is private/loopback (a proxy artifact such as
/// Caddy's docker-gateway peer — see `is_private_or_loopback`).
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
                return Some(if is_cloudflare_edge(ip) || is_private_or_loopback(ip) {
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

    #[test]
    fn xff_on_a_loopback_listener_is_flagged() {
        use ClientIpSource::{CfConnectingIp, Xff};
        for host in ["127.0.0.1", "127.0.0.2", "::1", "[::1]", "localhost"] {
            assert!(xff_behind_loopback(Xff, host), "{host}");
            assert!(!xff_behind_loopback(CfConnectingIp, host), "{host}");
        }
        for host in ["0.0.0.0", "::", "10.0.0.5", "203.0.113.7", "example.com"] {
            assert!(!xff_behind_loopback(Xff, host), "{host}");
        }
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

    /// The degraded production shape (load test 2026-10-15): Caddy, with
    /// no `trusted_proxies`, replaced Cloudflare's visitor XFF with its
    /// docker-gateway peer. A private entry means "the chain lost the
    /// visitor" — `CF-Connecting-IP` (CF-authoritative) must win.
    #[test]
    fn private_xff_entry_defers_to_cf_connecting_ip() {
        let h = headers(&[
            ("x-forwarded-for", "172.18.0.1"),
            ("cf-connecting-ip", "14.160.0.9"),
        ]);
        assert_eq!(real_client_ip(&h, ip("10.0.0.9")), ip("14.160.0.9"));
    }

    /// Same rule for a longer chain and IPv6 ULA/link-local artifacts.
    /// Chain shape `visitor, caddy_peer`: the right-anchored slot is the
    /// FIRST entry — a private value there means the chain lost the
    /// visitor, so `CF-Connecting-IP` wins.
    #[test]
    fn private_entries_in_longer_chains_defer_too() {
        let h = headers(&[
            ("x-forwarded-for", "10.0.0.5, 172.18.0.1"),
            ("cf-connecting-ip", "14.160.0.9"),
        ]);
        // hops=1 → entry at len-2 = 10.0.0.5 (private) → CF wins.
        assert_eq!(real_client_ip(&h, ip("10.0.0.9")), ip("14.160.0.9"));
        for artifact in ["fd00::1", "fe80::1"] {
            let h = headers(&[
                ("x-forwarded-for", artifact),
                ("cf-connecting-ip", "2001:db8:aa::1"),
            ]);
            assert_eq!(
                real_client_ip(&h, ip("10.0.0.9")),
                ip("2001:db8:aa::1"),
                "{artifact}"
            );
        }
    }

    /// Without `CF-Connecting-IP` the private entry stands — direct
    /// (non-CF) traffic keeps one shared bucket, same as before.
    #[test]
    fn private_xff_entry_without_cf_stays() {
        let h = headers(&[("x-forwarded-for", "172.18.0.1")]);
        assert_eq!(real_client_ip(&h, ip("10.0.0.9")), ip("172.18.0.1"));
    }

    /// A real visitor's address is never "private": the deferral must
    /// not fire for legit public XFF entries (guard against
    /// over-eager classification).
    #[test]
    fn public_xff_entries_never_defer() {
        for visitor in ["203.0.113.7", "14.160.0.9", "2001:db8::1"] {
            let h = headers(&[
                ("x-forwarded-for", visitor),
                ("cf-connecting-ip", "203.0.113.99"),
            ]);
            assert_eq!(real_client_ip(&h, ip("10.0.0.9")), ip(visitor), "{visitor}");
        }
    }

    async fn client_seen_by_handler(
        source: ClientIpSource,
        peer: &str,
        pairs: &[(&str, &str)],
    ) -> IpAddr {
        use axum::body::Body;
        use axum::routing::get;
        use tower::ServiceExt;

        let app = axum::Router::new()
            .route(
                "/",
                get(
                    |ConnectInfo(peer): ConnectInfo<SocketAddr>, h: HeaderMap| async move {
                        real_client_ip(&h, peer.ip()).to_string()
                    },
                ),
            )
            .layer(axum::middleware::from_fn_with_state(
                source,
                trusted_forwarding_headers,
            ));
        let mut req = axum::http::Request::builder().uri("/");
        for (k, v) in pairs {
            req = req.header(*k, *v);
        }
        let mut req = req.body(Body::empty()).unwrap();
        req.extensions_mut()
            .insert(ConnectInfo(SocketAddr::new(ip(peer), 4000)));
        let body = app.oneshot(req).await.unwrap().into_body();
        let bytes = axum::body::to_bytes(body, 64).await.unwrap();
        String::from_utf8(bytes.to_vec()).unwrap().parse().unwrap()
    }

    /// Behind Cloudflare Tunnel the peer is loopback and `CF-Connecting-IP`
    /// names the visitor, whatever `X-Forwarded-For` claims.
    #[tokio::test]
    async fn tunnel_mode_trusts_cf_connecting_ip_from_a_loopback_peer() {
        for peer in ["127.0.0.1", "::1"] {
            let got = client_seen_by_handler(
                ClientIpSource::CfConnectingIp,
                peer,
                &[
                    ("cf-connecting-ip", "14.160.0.9"),
                    ("x-forwarded-for", "1.2.3.4, 14.160.0.9"),
                ],
            )
            .await;
            assert_eq!(got, ip("14.160.0.9"), "{peer}");
        }
    }

    /// Any other peer could have written the header: it is the client itself.
    #[tokio::test]
    async fn tunnel_mode_ignores_forwarding_headers_from_other_peers() {
        let got = client_seen_by_handler(
            ClientIpSource::CfConnectingIp,
            "203.0.113.50",
            &[
                ("cf-connecting-ip", "14.160.0.9"),
                ("x-forwarded-for", "14.160.0.9"),
            ],
        )
        .await;
        assert_eq!(got, ip("203.0.113.50"));
    }

    /// In `xff` mode nothing is removed: the proxy chain logic stands.
    #[tokio::test]
    async fn xff_mode_leaves_the_headers_alone() {
        let got = client_seen_by_handler(
            ClientIpSource::Xff,
            "10.0.0.9",
            &[("x-forwarded-for", "203.0.113.7, 198.51.100.99")],
        )
        .await;
        assert_eq!(got, ip("203.0.113.7"));
    }

    #[test]
    fn the_config_value_picks_the_source() {
        assert_eq!(
            ClientIpSource::from_config("cf-connecting-ip"),
            ClientIpSource::CfConnectingIp
        );
        assert_eq!(ClientIpSource::from_config("xff"), ClientIpSource::Xff);
    }
}
