#!/usr/bin/env bash
# Managed code only. Never archive/restore runtime data or credentials.
set -euo pipefail
umask 077
mode=${1:-}; id=${2:-}; revision=${3:-}
[[ $mode == deploy || $mode == rollback ]] || exit 2
[[ $id =~ ^[a-f0-9]{12}-[0-9]{17}$ ]] || exit 2
base=${OPENCLAW_DEPLOY_ROOT:-$HOME}
[[ $base == /* && $base != / ]] || exit 2
cd "$base"
root="$base/.local/share/openclaw-deploy"
stage="$root/$id"
test -d "$stage"
mkdir -p "$root"
exec 9>"$root/lock"
flock -n 9 || { echo 'Another deployment is running.'; exit 1; }
web=.openclaw/workspace/web
skill=.openclaw/workspace/skills/ha-camera-snapshot
managed=("$web/dist" "$web/server" "$web/node_modules" "$web/package.json" "$web/package-lock.json" "$web/scripts/smoke-test.mjs")
skillfiles=(SKILL.md hls-url.mjs inspect-capabilities.mjs snapshot.sh status.sh stream-frame.mjs stream-info.mjs)
for file in "${skillfiles[@]}"; do managed+=("$skill/$file"); done
services=(openclaw-smart-home-web openclaw-gateway)
services_active() {
  local service
  for service in "${services[@]}" openclaw-smart-home-proxy; do
    systemctl --user is-active --quiet "$service" || return 1
  done
}
health() {
  local attempt
  for attempt in 1 2 3 4 5; do
    if services_active &&
      node "$web/scripts/smoke-test.mjs"; then return 0; fi
    sleep 2
  done
  return 1
}
restore() {
  test "$(cat "$root/current")" = "$id" || { echo 'Only the latest deployment may be rolled back.'; return 1; }
  (cd "$stage" && sha256sum --status -c backup.sha256) || return 1
  tar -tf "$stage/backup.tar" >/dev/null || return 1
  local rescue path
  rescue=$(mktemp -d "$stage/replaced-XXXXXX") || return 1
  printf 'rolling-back\n' > "$stage/status"
  systemctl --user stop "${services[@]}" || return 1
  for path in "${managed[@]}"; do
    if [[ -e $path ]]; then
      mkdir -p "$rescue/$(dirname "$path")" || return 1
      mv "$path" "$rescue/$path" || return 1
    fi
  done
  tar -xpf "$stage/backup.tar" -C "$base" || return 1
  systemctl --user start "${services[@]}" || return 1
  health || return 1
  printf 'rolled-back\n' > "$stage/status"
  cp "$stage/previous" "$root/current"
  echo "PASS rollback $id; runtime data/configuration untouched."
}
if [[ $mode == rollback ]]; then
  if restore; then exit 0; fi
  if [[ $(cat "$stage/status" 2>/dev/null) == rolling-back ]]; then
    printf 'recovery-required\n' > "$stage/status"
  fi
  exit 1
fi
[[ $revision =~ ^[a-f0-9]{40}$ && ${revision:0:12} == ${id:0:12} ]] || exit 2
test ! -e "$stage/backup.tar"
if [[ -s $root/current ]]; then
  prior=$(cat "$root/current")
  test "$(cat "$root/$prior/status")" = deployed
fi
for path in "${managed[@]}"; do test -e "$path"; test ! -L "$path"; done
# Bootstrap settings are deliberately not overwritten.
test -s .config/openclaw-smart-home/web.env
test -s .config/systemd/user/openclaw-gateway.service.d/90-smart-home-camera.conf
services_active
mkdir "$stage/release"
tar -xf "$stage/source.tar" -C "$stage/release"
tar -xf "$stage/dist.tar" -C "$stage/release"
(cd "$stage/release/web" && npm ci --omit=dev --no-audit --no-fund && npm test)
for file in snapshot.sh status.sh; do bash -n "$stage/release/skills/ha-camera-snapshot/$file"; done
for path in "${managed[@]}"; do
  relative=${path#.openclaw/workspace/}
  test -e "$stage/release/$relative"
done
tar -cf "$stage/backup.tar" "${managed[@]}"
(cd "$stage" && sha256sum backup.tar > backup.sha256)
if [[ -f $root/current ]]; then cp "$root/current" "$stage/previous"; else : > "$stage/previous"; fi
printf '%s\n' "$revision" > "$stage/revision"
printf '%s\n' "$id" > "$root/current"
printf 'switching\n' > "$stage/status"
failed() {
  trap - ERR
  echo 'Deployment failed; attempting rollback.' >&2
  if ! restore; then
    printf 'recovery-required\n' > "$stage/status"
    echo "Recovery failed. Backup retained in $stage; inspect services before retry." >&2
  fi
  exit 1
}
trap failed ERR
systemctl --user stop "${services[@]}"
mkdir "$stage/retired"
for path in "${managed[@]}"; do
  mkdir -p "$stage/retired/$(dirname "$path")"
  mv "$path" "$stage/retired/$path"
  relative=${path#.openclaw/workspace/}
  cp -a "$stage/release/$relative" "$path"
done
chmod 700 "$skill/snapshot.sh" "$skill/status.sh"
systemctl --user start "${services[@]}"
health
printf 'deployed\n' > "$stage/status"
trap - ERR
echo "PASS deployed $id; rollback: deploy-vm.ps1 -Rollback $id"
