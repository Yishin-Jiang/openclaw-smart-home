#!/usr/bin/env bash
set -euo pipefail

readonly DEFAULT_SECRET_FILE="${HOME:?HOME is required}/.config/openclaw/ha_token"
readonly DEFAULT_HA_BASE_URL="http://homeassistant.local:8123"
readonly DEFAULT_CAMERA_ENTITY="camera.aqara_g350"
readonly DEFAULT_OUTPUT_FILE="/tmp/g350.jpg"

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
secret_file="${HA_TOKEN_FILE:-$DEFAULT_SECRET_FILE}"
ha_base_url="${HA_BASE_URL:-$DEFAULT_HA_BASE_URL}"
camera_entity="${HA_CAMERA_ENTITY:-$DEFAULT_CAMERA_ENTITY}"
output_file="${1:-$DEFAULT_OUTPUT_FILE}"
cleanup_ttl_seconds="${HA_SNAPSHOT_TTL_SECONDS:-0}"

if [[ ! -r "$secret_file" ]]; then
  printf 'Error: token file is not readable: %s\n' "$secret_file" >&2
  exit 1
fi

output_dir="$(dirname -- "$output_file")"
if [[ ! -d "$output_dir" ]]; then
  printf 'Error: output directory does not exist: %s\n' "$output_dir" >&2
  exit 1
fi

if [[ ! "$cleanup_ttl_seconds" =~ ^[0-9]+$ ]]; then
  printf 'Error: HA_SNAPSHOT_TTL_SECONDS must be a non-negative integer\n' >&2
  exit 1
fi

token="$(tr -d '\r\n' < "$secret_file")"
if [[ -z "$token" ]]; then
  printf 'Error: token file is empty\n' >&2
  exit 1
fi

temporary_file="$(mktemp "$output_dir/.g350-snapshot.XXXXXX")"
cleanup() {
  rm -f -- "$temporary_file"
}
trap cleanup EXIT

http_status="$({
  curl \
    --silent \
    --show-error \
    --location \
    --connect-timeout 5 \
    --max-time 30 \
    --output "$temporary_file" \
    --write-out '%{http_code}' \
    --header "Authorization: Bearer $token" \
    "$ha_base_url/api/camera_proxy/$camera_entity"
} || true)"

if [[ "$http_status" == "500" ]]; then
  printf 'Home Assistant still-image endpoint returned HTTP 500; trying one frame from its authenticated stream.\n' >&2
  : > "$temporary_file"
  ffmpeg_bin="${FFMPEG_BIN:-$script_dir/ffmpeg}"
  hls_url="$(HOME_ASSISTANT_URL="$ha_base_url" HOME_ASSISTANT_TOKEN_FILE="$secret_file" HOME_ASSISTANT_CAMERA_ENTITY="$camera_entity" node "$script_dir/hls-url.mjs" 2>/dev/null || true)"
  if [[ -x "$ffmpeg_bin" && -n "$hls_url" ]]; then
    if ! timeout 35 "$ffmpeg_bin" -loglevel error -nostdin -headers "Authorization: Bearer $token\r\n" -i "$hls_url" -frames:v 1 -f image2 -y "$temporary_file" >/dev/null 2>&1; then
      printf 'Error: Home Assistant HLS stream did not yield a frame\n' >&2
      exit 1
    fi
  else
    printf 'Error: Home Assistant HLS fallback is unavailable (ffmpeg or stream URL missing)\n' >&2
    exit 1
  fi
elif [[ "$http_status" != "200" ]]; then
  printf 'Error: Home Assistant snapshot request returned HTTP %s\n' "${http_status:-request-failed}" >&2
  exit 1
fi

mime_type="$(file --brief --mime-type "$temporary_file")"
if [[ "$mime_type" != "image/jpeg" ]]; then
  printf 'Error: expected image/jpeg, received %s\n' "$mime_type" >&2
  exit 1
fi

chmod 600 "$temporary_file"
mv -f -- "$temporary_file" "$output_file"
trap - EXIT

if (( cleanup_ttl_seconds > 0 )); then
  snapshot_inode="$(stat -c '%i' "$output_file")"
  nohup sh -c '
    sleep "$1"
    current_inode="$(stat -c "%i" -- "$2" 2>/dev/null)" || exit 0
    if [ "$current_inode" = "$3" ]; then
      rm -f -- "$2"
    fi
  ' snapshot-cleanup "$cleanup_ttl_seconds" "$output_file" "$snapshot_inode" \
    >/dev/null 2>&1 &
fi

printf 'Snapshot saved: %s\n' "$output_file"
file --brief "$output_file"
