#!/usr/bin/env bash
# Social sign-in (Google / Facebook) credentials for datxevui.com.
#
# Run ON THE SERVER, in the deploy directory, by a person:
#   cd /opt/vexevn && bash oauth-env.sh
#
# For each provider it asks for the client id (Enter keeps the value shown)
# and the client secret (typed hidden, never echoed or stored in shell
# history; Enter keeps the current one). A provider is switched on only
# when both are set. .env is backed up first and stays 0600. Takes effect
# on the next deploy (deploy.sh re-reads .env), or now with --apply.
#
# Register this callback with each provider:
#   https://datxevui.com/api/auth/oauth/<google|facebook>/callback
set -euo pipefail

cd "$(cd "$(dirname "$0")" && pwd)"
ENV_FILE=.env
[ -f "$ENV_FILE" ] || { echo "FATAL: $ENV_FILE not found in $(pwd) — run deploy.sh once first"; exit 1; }

APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

# Public identifiers — not secrets (they appear in every sign-in URL).
DEFAULT_GOOGLE_ID="881396106675-vplh0v4q8o870g4h69la69otaq7s3o8d.apps.googleusercontent.com"
DEFAULT_FACEBOOK_ID="4408154769422718"
BASE_URL="https://datxevui.com"

current() { grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- || true; }

# Ids, secrets and URLs only ever use these characters; anything else is a
# paste mistake, and refusing it keeps `. ./.env` (deploy.sh) safe.
valid() { [[ $1 =~ ^[A-Za-z0-9._~:/-]*$ ]]; }

set_env() {
  local key=$1 value=$2 tmp
  valid "$value" || { echo "FATAL: $key has unexpected characters — check what was pasted"; exit 1; }
  tmp=$(mktemp "${ENV_FILE}.XXXXXX")
  grep -vE "^${key}=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$ENV_FILE"
}

umask 077
backup="${ENV_FILE}.bak-$(date +%Y%m%d-%H%M%S)"
cp -p "$ENV_FILE" "$backup"
echo "Backed up $ENV_FILE → $backup"

set_env OAUTH_REDIRECT_BASE_URL "$(current OAUTH_REDIRECT_BASE_URL | grep . || echo "$BASE_URL")"
set_env OAUTH_FRONTEND_URL "$(current OAUTH_FRONTEND_URL | grep . || echo "$BASE_URL")"

configure() {
  local name=$1 prefix=$2 default_id=$3 id secret
  local cur_id cur_secret
  cur_id=$(current "${prefix}_CLIENT_ID")
  cur_secret=$(current "${prefix}_CLIENT_SECRET")
  echo
  echo "── $name ──"
  read -r -p "Client id [${cur_id:-$default_id}]: " id
  id=${id:-${cur_id:-$default_id}}
  if [ -n "$cur_secret" ]; then
    read -r -s -p "Client secret (Enter keeps the current one): " secret; echo
  else
    read -r -s -p "Client secret (Enter to leave $name off): " secret; echo
  fi
  secret=${secret:-$cur_secret}
  set_env "${prefix}_CLIENT_ID" "$id"
  set_env "${prefix}_CLIENT_SECRET" "$secret"
  if [ -n "$id" ] && [ -n "$secret" ]; then
    set_env "${prefix}_ENABLED" true
    echo "$name: on"
  else
    set_env "${prefix}_ENABLED" false
    echo "$name: off (no secret)"
  fi
}

configure Google OAUTH_GOOGLE "$DEFAULT_GOOGLE_ID"
configure Facebook OAUTH_FACEBOOK "$DEFAULT_FACEBOOK_ID"

echo
if [ "$APPLY" = 1 ]; then
  image=$(docker service inspect datxevui_backend --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}')
  echo "Redeploying the running image ($image) with the new settings…"
  IMAGE="$image" bash deploy.sh
else
  echo "Saved. They take effect on the next deploy, or now with: bash oauth-env.sh --apply"
fi
echo "Check: curl -s $BASE_URL/api/auth/oauth/providers"
