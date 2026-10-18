#!/bin/bash
# docker-user-firewall.sh — rules for the DOCKER-USER iptables chain.
#
# WHY: Docker's published ports bypass UFW (Docker programs the nat
# PREROUTING + FORWARD/DOCKER chains directly; UFW only rules INPUT).
# The pdf-tts Caddy publishes 0.0.0.0:8443->443/tcp (host mode) purely
# as a LOOPBACK target for the nginx SNI router (nginx stream proxies
# 127.0.0.1:8443 -> caddy). The public TCP 443 endpoint is nginx
# itself. As published, 8443 was reachable from the whole internet,
# bypassing the documented loopback-only intent (deploy/stack.yml
# comment + setup-sni-router.sh).
#
# The conntrack match keys on the ORIGINAL destination port (before
# Docker's DNAT rewrites it to the container port), so the rule is
# independent of container IPs and survives redeploys. Traffic from
# the nginx stream proxy to 127.0.0.1:8443 never traverses FORWARD
# (docker-proxy terminates it locally), so the loopback path keeps
# working while DIRECT external 8443 access is dropped.

set -u

ensure_chain() {
  iptables -w -L DOCKER-USER -n >/dev/null 2>&1 || iptables -w -N DOCKER-USER
}

# Idempotent: delete all prior copies of the rule, then insert at the top.
sync_rule() {
  local pos="$1"; shift
  local rule=("$@")
  while iptables -w -D DOCKER-USER "${rule[@]}" 2>/dev/null; do :; done
  iptables -w -I DOCKER-USER "$pos" "${rule[@]}"
}

ensure_chain

# Drop externally-originated connections to original dst port 8443
# (published Caddy). Local/loopback access via docker-proxy unaffected.
sync_rule 1 -p tcp -m conntrack --ctorigdstport 8443 -j DROP

# Defense in depth: Swarm manager API must never be reachable from
# outside (UFW already denies 2377; this covers Docker's own paths).
sync_rule 2 -p tcp -m conntrack --ctorigdstport 2377 -j DROP

exit 0
