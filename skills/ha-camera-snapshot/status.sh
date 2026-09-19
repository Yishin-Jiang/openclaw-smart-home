#!/usr/bin/env bash
set -euo pipefail

# Metadata-only Home Assistant entity check. This script never retrieves a
# camera image and never prints the access token.
ha_base_url="${HA_BASE_URL:-http://homeassistant.local:8123}"
camera_entity="${HA_CAMERA_ENTITY:-camera.aqara_g350}"
token_file="${HA_TOKEN_FILE:-${HOME:?HOME is required}/.config/openclaw/ha_token}"

if [[ ! "$camera_entity" =~ ^[a-z0-9_]+\.[a-z0-9_]+$ ]]; then
  printf '{"reachable":false,"error":"invalid_entity_id"}\n'
  exit 2
fi

if [[ ! -r "$token_file" ]]; then
  printf '{"reachable":false,"entity_id":"%s","error":"token_file_unreadable"}\n' "$camera_entity"
  exit 2
fi

ha_token="$(tr -d '\r\n' < "$token_file")"
if [[ -z "$ha_token" ]]; then
  printf '{"reachable":false,"entity_id":"%s","error":"token_file_empty"}\n' "$camera_entity"
  exit 2
fi

response_file="$(mktemp)"
trap 'rm -f -- "$response_file"' EXIT

http_status="$({ curl --silent --show-error \
  --connect-timeout 5 \
  --max-time 10 \
  --output "$response_file" \
  --write-out '%{http_code}' \
  --header "Authorization: Bearer ${ha_token}" \
  --header 'Content-Type: application/json' \
  "${ha_base_url%/}/api/states/${camera_entity}"; } || true)"

if [[ "$http_status" != "200" ]]; then
  node -e '
    const entityId = process.argv[1];
    const rawStatus = process.argv[2];
    const httpStatus = /^\d{3}$/.test(rawStatus) ? Number(rawStatus) : null;
    console.log(JSON.stringify({
      reachable: false,
      entity_id: entityId,
      http_status: httpStatus,
      error: "home_assistant_query_failed"
    }));
  ' "$camera_entity" "$http_status"
  exit 1
fi

node - "$camera_entity" "$response_file" <<'NODE'
const fs = require('node:fs');

const entityId = process.argv[2];
const responseFile = process.argv[3];

try {
  const state = JSON.parse(fs.readFileSync(responseFile, 'utf8'));
  console.log(JSON.stringify({
    reachable: true,
    entity_id: entityId,
    state: typeof state.state === 'string' ? state.state : 'unknown',
    last_updated: state.last_updated ?? null,
    connectivity_basis: 'home_assistant_metadata_only',
    physical_connectivity_confirmed: false
  }));
} catch {
  console.log(JSON.stringify({
    reachable: false,
    entity_id: entityId,
    error: 'invalid_home_assistant_response'
  }));
  process.exitCode = 1;
}
NODE
