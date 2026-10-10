//! Which country an IP address belongs to, from the regional internet
//! registries' delegation statistics — what the call gate uses to accept
//! calls from Vietnam only.
//!
//! The registries publish every block they delegate, with the country it
//! went to, in the "RIR statistics exchange format"
//! (`registry|cc|type|start|value|date|status`). Vietnamese ISPs and
//! carriers use the blocks VNNIC/APNIC delegated to them, so this is the
//! usual basis for country gating, without a commercial database.
//!
//! A snapshot of Vietnam's blocks is compiled in (`apnic-vn.txt`), so the
//! gate works with no setup. Production also refreshes APNIC's full file
//! once a day ([`spawn_refresh`]) and keeps it on disk, so new allocations
//! are picked up without a release.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use parking_lot::RwLock;

/// Vietnam's blocks as of the last `deploy/geo-snapshot.sh`.
const BUILT_IN: &str = include_str!("apnic-vn.txt");

/// How often production re-downloads the registry file.
const REFRESH_EVERY: Duration = Duration::from_secs(24 * 3600);

/// The registry file is ~4 MB; anything far larger is not it.
const MAX_DOWNLOAD_BYTES: usize = 64 * 1024 * 1024;

/// The address blocks of some countries, merged and sorted for lookup.
#[derive(Debug, Default)]
pub struct CountryRanges {
    v4: Vec<(u32, u32)>,
    v6: Vec<(u128, u128)>,
}

impl CountryRanges {
    /// The blocks a registry statistics file delegated to `countries`
    /// (ISO 3166 alpha-2, any case). Lines that don't parse are skipped.
    pub fn from_delegated(text: &str, countries: &[String]) -> Self {
        let mut v4 = Vec::new();
        let mut v6 = Vec::new();
        for line in text.lines() {
            let fields: Vec<&str> = line.trim().split('|').collect();
            let [_, cc, kind, start, value, _, status, ..] = fields[..] else {
                continue;
            };
            if !matches!(status, "allocated" | "assigned")
                || !countries.iter().any(|c| c.eq_ignore_ascii_case(cc))
            {
                continue;
            }
            match kind {
                // ipv4 `value` is the number of addresses (not always a power of two).
                "ipv4" => {
                    let (Ok(start), Ok(count)) = (start.parse::<Ipv4Addr>(), value.parse::<u64>())
                    else {
                        continue;
                    };
                    let first = u64::from(u32::from(start));
                    if let Some(last) = count.checked_sub(1).map(|n| first + n) {
                        v4.push((first as u32, last.min(u64::from(u32::MAX)) as u32));
                    }
                }
                // ipv6 `value` is the prefix length.
                "ipv6" => {
                    let (Ok(start), Ok(len)) = (start.parse::<Ipv6Addr>(), value.parse::<u32>())
                    else {
                        continue;
                    };
                    if len <= 128 {
                        let first = u128::from(start);
                        let span = u128::MAX.checked_shr(len).unwrap_or(0);
                        v6.push((first, first.saturating_add(span)));
                    }
                }
                _ => {}
            }
        }
        Self {
            v4: merge(v4),
            v6: merge(v6),
        }
    }

    pub fn contains(&self, ip: IpAddr) -> bool {
        match canonical(ip) {
            IpAddr::V4(a) => within(&self.v4, u32::from(a)),
            IpAddr::V6(a) => within(&self.v6, u128::from(a)),
        }
    }

    /// Number of (merged) blocks.
    pub fn len(&self) -> usize {
        self.v4.len() + self.v6.len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// Integers that address blocks are made of.
trait Addr: Ord + Copy {
    fn next(self) -> Option<Self>;
}
impl Addr for u32 {
    fn next(self) -> Option<Self> {
        self.checked_add(1)
    }
}
impl Addr for u128 {
    fn next(self) -> Option<Self> {
        self.checked_add(1)
    }
}

/// Sort, and join overlapping or touching ranges.
fn merge<T: Addr>(mut ranges: Vec<(T, T)>) -> Vec<(T, T)> {
    ranges.sort_unstable();
    let mut out: Vec<(T, T)> = Vec::with_capacity(ranges.len());
    for (first, last) in ranges {
        match out.last_mut() {
            Some(prev) if prev.1.next().is_none_or(|after| first <= after) => {
                prev.1 = prev.1.max(last);
            }
            _ => out.push((first, last)),
        }
    }
    out.shrink_to_fit();
    out
}

fn within<T: Addr>(ranges: &[(T, T)], x: T) -> bool {
    let i = ranges.partition_point(|&(first, _)| first <= x);
    i > 0 && ranges[i - 1].1 >= x
}

/// IPv4-mapped IPv6 (`::ffff:a.b.c.d`, what dual-stack sockets report) as IPv4.
fn canonical(ip: IpAddr) -> IpAddr {
    match ip {
        IpAddr::V6(a) => a.to_ipv4_mapped().map_or(ip, IpAddr::V4),
        v4 => v4,
    }
}

/// Whether `ip` is a public internet address — one a registry delegated to
/// someone. Loopback, private, shared (CGNAT), link-local, documentation,
/// benchmarking, multicast and unspecified addresses are not.
pub fn is_public(ip: IpAddr) -> bool {
    match canonical(ip) {
        IpAddr::V4(a) => {
            let [o1, o2, ..] = a.octets();
            !(a.is_private()
                || a.is_loopback()
                || a.is_link_local()
                || a.is_unspecified()
                || a.is_broadcast()
                || a.is_documentation()
                || a.is_multicast()
                || o1 == 0
                || (o1 == 100 && (64..128).contains(&o2)) // 100.64.0.0/10 shared (CGNAT)
                || (o1 == 198 && (18..20).contains(&o2)) // 198.18.0.0/15 benchmarking
                || o1 >= 240)
        }
        IpAddr::V6(a) => {
            let s0 = a.segments()[0];
            !(a.is_loopback()
                || a.is_unspecified()
                || a.is_multicast()
                || (s0 & 0xfe00) == 0xfc00 // fc00::/7 unique local
                || (s0 & 0xffc0) == 0xfe80 // fe80::/10 link-local
                || (s0 == 0x2001 && a.segments()[1] == 0x0db8)) // documentation
        }
    }
}

/// Who may place calls: everyone when no country is configured, otherwise
/// callers whose public address lies in one of the allowed countries.
/// Addresses no registry delegates (loopback, private networks) belong to
/// no country and are let through: they only reach the app from a local
/// machine or LAN, never from the internet.
pub struct CallGate {
    countries: Vec<String>,
    ranges: RwLock<Arc<CountryRanges>>,
}

impl CallGate {
    /// A gate that lets everyone through.
    pub fn open() -> Self {
        Self::with(Vec::new(), CountryRanges::default())
    }

    fn with(countries: Vec<String>, ranges: CountryRanges) -> Self {
        Self {
            countries,
            ranges: RwLock::new(Arc::new(ranges)),
        }
    }

    /// A gate for `countries`, reading their blocks from the registry file
    /// at `path` when it is there and covers them, else from the built-in
    /// Vietnam snapshot.
    pub fn load(countries: Vec<String>, path: Option<&Path>) -> Self {
        if countries.is_empty() {
            return Self::open();
        }
        let from_file = path
            .and_then(|p| std::fs::read_to_string(p).ok())
            .map(|text| CountryRanges::from_delegated(&text, &countries))
            .filter(|r| !r.is_empty());
        let (ranges, source) = match from_file {
            Some(r) => (r, "registry file"),
            None => (
                CountryRanges::from_delegated(BUILT_IN, &countries),
                "built-in snapshot",
            ),
        };
        if ranges.is_empty() {
            tracing::error!(
                countries = ?countries,
                "call gate: no address blocks for these countries — every public caller \
                 is refused; point GEO_RANGES_PATH at a registry file that covers them"
            );
        } else {
            tracing::info!(countries = ?countries, blocks = ranges.len(), source, "call gate ready");
        }
        Self::with(countries, ranges)
    }

    /// Whether only some countries may call.
    pub fn restricted(&self) -> bool {
        !self.countries.is_empty()
    }

    pub fn allows(&self, ip: IpAddr) -> bool {
        !self.restricted() || !is_public(ip) || self.ranges.read().contains(ip)
    }

    /// Swap in the blocks from a freshly downloaded registry file. A file
    /// with under half the blocks currently known is treated as truncated
    /// or wrong and refused; returns the new block count otherwise.
    pub fn refresh(&self, text: &str) -> Result<usize, String> {
        let fresh = CountryRanges::from_delegated(text, &self.countries);
        let known = self.ranges.read().len();
        if fresh.is_empty() || fresh.len() * 2 < known {
            return Err(format!(
                "{} blocks for {:?}, {known} known — keeping the current ones",
                fresh.len(),
                self.countries
            ));
        }
        let n = fresh.len();
        *self.ranges.write() = Arc::new(fresh);
        Ok(n)
    }
}

static GATE: OnceLock<CallGate> = OnceLock::new();

/// The process-wide call gate ([`install`]ed at startup; open until then).
pub fn call_gate() -> &'static CallGate {
    GATE.get_or_init(CallGate::open)
}

/// Make `gate` the process-wide call gate. First caller wins.
pub fn install(gate: CallGate) {
    if GATE.set(gate).is_err() {
        tracing::warn!("call gate already installed; keeping the first");
    }
}

/// Re-download the registry file from `url` every day, swap it into the
/// gate and keep it at `path` so a restart starts from it. Does nothing
/// for an open gate.
pub fn spawn_refresh(url: String, path: Option<PathBuf>) {
    if url.is_empty() || !call_gate().restricted() {
        return;
    }
    tokio::spawn(async move {
        let client = match reqwest::Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
        {
            Ok(c) => c,
            Err(e) => return tracing::error!(error = %e, "call gate refresh: no HTTP client"),
        };
        // First pass shortly after boot (the snapshot may be months old),
        // then daily.
        let mut wait = Duration::from_secs(60);
        loop {
            tokio::time::sleep(wait).await;
            wait = REFRESH_EVERY;
            match download(&client, &url).await {
                Ok(text) => match call_gate().refresh(&text) {
                    Ok(blocks) => {
                        tracing::info!(blocks, "call gate refreshed");
                        if let Some(path) = &path {
                            if let Err(e) = save(path, &text).await {
                                tracing::warn!(error = %e, path = %path.display(), "call gate: could not keep the registry file");
                            }
                        }
                    }
                    Err(e) => tracing::warn!(error = %e, "call gate refresh refused"),
                },
                Err(e) => tracing::warn!(error = %e, url = %url, "call gate refresh failed"),
            }
        }
    });
}

async fn download(client: &reqwest::Client, url: &str) -> Result<String, String> {
    let resp = client
        .get(url)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|e| e.to_string())?;
    let body = resp.bytes().await.map_err(|e| e.to_string())?;
    if body.len() > MAX_DOWNLOAD_BYTES {
        return Err(format!("{} bytes is not a registry file", body.len()));
    }
    String::from_utf8(body.to_vec()).map_err(|e| e.to_string())
}

/// Write via a temporary file and rename, so a reader never sees half a file.
async fn save(path: &Path, text: &str) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        tokio::fs::create_dir_all(dir).await?;
    }
    let tmp = path.with_extension("tmp");
    tokio::fs::write(&tmp, text).await?;
    tokio::fs::rename(&tmp, path).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    fn vn() -> Vec<String> {
        vec!["VN".into()]
    }

    const SAMPLE: &str = "\
2|apnic|20261009|89444|19830613|20261008|+1000
apnic|*|ipv4|*|58261|summary
apnic|VN|ipv4|14.160.0.0|2097152|20100816|allocated
apnic|VN|ipv4|14.192.0.0|1024|20100816|assigned
apnic|VN|ipv4|27.64.0.0|768|20100816|allocated
apnic|SG|ipv4|8.128.0.0|65536|20100816|allocated
apnic|VN|ipv4|1.2.3.0|256|20100816|reserved
apnic|VN|ipv6|2001:ee0::|32|20100816|allocated
apnic|VN|ipv6|2402:800::|32|20100816|allocated
apnic|VN|asn|7552|1|20100816|allocated
garbage line
";

    #[test]
    fn reads_the_blocks_of_the_requested_countries_only() {
        let r = CountryRanges::from_delegated(SAMPLE, &vn());
        // 14.160.0.0 + 2^21 addresses = 14.160.0.0 – 14.191.255.255, and the
        // next block starts right after it, so the two merge.
        assert!(r.contains(ip("14.160.0.1")));
        assert!(r.contains(ip("14.191.255.255")));
        assert!(r.contains(ip("14.192.3.255")));
        assert!(!r.contains(ip("14.192.4.0")));
        // 768 addresses: not a power of two.
        assert!(r.contains(ip("27.64.2.255")));
        assert!(!r.contains(ip("27.64.3.0")));
        // Another country, a reserved block, and nothing in between.
        assert!(!r.contains(ip("8.128.0.1")));
        assert!(!r.contains(ip("1.2.3.4")));
        assert!(!r.contains(ip("20.0.0.1")));
        // IPv6 by prefix, and IPv4-mapped IPv6 as IPv4.
        assert!(r.contains(ip("2001:ee0:1234::1")));
        assert!(!r.contains(ip("2001:ee1::1")));
        assert!(r.contains(ip("::ffff:14.160.0.9")));
        assert_eq!(r.len(), 4, "two v4 blocks merged, one more v4, two v6");
    }

    #[test]
    fn the_built_in_snapshot_knows_vietnamese_carriers() {
        let r = CountryRanges::from_delegated(BUILT_IN, &vn());
        assert!(r.len() > 500, "{} blocks", r.len());
        // VNPT, Viettel and FPT address space; Google DNS and Cloudflare are not Vietnamese.
        for vietnamese in ["14.160.0.1", "27.72.0.1", "42.112.0.1", "2402:800::1"] {
            assert!(r.contains(ip(vietnamese)), "{vietnamese}");
        }
        for foreign in ["8.8.8.8", "1.1.1.1", "2606:4700::1"] {
            assert!(!r.contains(ip(foreign)), "{foreign}");
        }
    }

    #[test]
    fn public_addresses_are_the_ones_registries_delegate() {
        for local in [
            "127.0.0.1",
            "10.0.1.2",
            "172.20.0.5",
            "192.168.1.9",
            "100.64.3.1",
            "169.254.0.1",
            "0.0.0.0",
            "::1",
            "fd00::1",
            "fe80::1",
            "::ffff:192.168.1.1",
        ] {
            assert!(!is_public(ip(local)), "{local}");
        }
        for public in ["14.160.0.1", "8.8.8.8", "2402:800::1", "100.128.0.1"] {
            assert!(is_public(ip(public)), "{public}");
        }
    }

    #[test]
    fn a_gate_for_vietnam_lets_vietnam_and_local_networks_through() {
        let gate = CallGate::load(vn(), None);
        assert!(gate.restricted());
        assert!(gate.allows(ip("14.160.0.1")));
        assert!(gate.allows(ip("192.168.1.9")), "LAN: no country to check");
        assert!(!gate.allows(ip("8.8.8.8")));
        assert!(!gate.allows(ip("2606:4700::1")));

        let open = CallGate::load(Vec::new(), None);
        assert!(!open.restricted());
        assert!(open.allows(ip("8.8.8.8")));
    }

    #[test]
    fn a_file_on_disk_wins_over_the_snapshot_and_refreshes_must_look_complete() {
        let dir = std::env::temp_dir().join(format!("geo-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("delegated");
        std::fs::write(&path, SAMPLE).unwrap();

        let gate = CallGate::load(vn(), Some(&path));
        assert!(gate.allows(ip("27.64.0.1")));
        assert!(
            !gate.allows(ip("42.112.0.1")),
            "the file, not the snapshot, is in use"
        );

        // A truncated download (one block where four are known) is refused.
        let truncated = "apnic|VN|ipv4|42.112.0.0|256|20100816|allocated\n";
        assert!(gate.refresh(truncated).is_err());
        assert!(!gate.allows(ip("42.112.0.1")));
        // A complete one replaces the blocks.
        assert_eq!(gate.refresh(BUILT_IN).ok().map(|n| n > 500), Some(true));
        assert!(gate.allows(ip("42.112.0.1")));

        std::fs::remove_dir_all(dir).ok();
    }
}
