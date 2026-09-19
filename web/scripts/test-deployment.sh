#!/usr/bin/env bash
# Isolated Linux/Git Bash contract tests. No real systemd, npm, HA or devices.
set -euo pipefail
runner=$(cd "$(dirname "$0")" && pwd)/remote-deploy.sh
fixture=$(mktemp -d)
export OPENCLAW_DEPLOY_ROOT="$fixture/home"
mkdir -p "$fixture/bin" "$OPENCLAW_DEPLOY_ROOT"
export PATH="$fixture/bin:$PATH"
# These mocks are deliberately confined to this child process's PATH.
printf '#!/usr/bin/env bash\nexit 0\n' > "$fixture/bin/systemctl"
printf '#!/usr/bin/env bash\n[[ ${FAIL_INSTALL:-0} != 1 ]] || exit 1\nmkdir -p node_modules\nprintf new > node_modules/version\n' > "$fixture/bin/npm"
printf '#!/usr/bin/env bash\n[[ ${FAIL_HEALTH:-0} != 1 ]] || exit 1\n[[ ${FAIL_NEW:-0} != 1 ]] || ! grep -q new .openclaw/workspace/web/server/version\n' > "$fixture/bin/node"
printf '#!/usr/bin/env bash\nexit 0\n' > "$fixture/bin/sleep"
printf '#!/usr/bin/env bash\nif [[ -e $OPENCLAW_DEPLOY_ROOT/fail-copy && $* == *release/web/server* ]]; then mv "$OPENCLAW_DEPLOY_ROOT/fail-copy" "$OPENCLAW_DEPLOY_ROOT/copy-failed"; exit 1; fi\nexec /usr/bin/cp "$@"\n' > "$fixture/bin/cp"
if ! command -v flock >/dev/null; then
  printf '#!/usr/bin/env bash\nexit 0\n' > "$fixture/bin/flock"
  echo 'NOTE flock mocked on this platform; lock exclusion is not tested.'
fi
chmod +x "$fixture/bin/"*
cd "$OPENCLAW_DEPLOY_ROOT"
web=.openclaw/workspace/web
skill=.openclaw/workspace/skills/ha-camera-snapshot
mkdir -p "$web/"{dist,server,node_modules,scripts,data} "$skill/cache" .config/openclaw-smart-home .config/systemd/user/openclaw-gateway.service.d
for path in dist/version server/version node_modules/version package.json package-lock.json scripts/smoke-test.mjs; do printf old > "$web/$path"; done
for file in SKILL.md hls-url.mjs inspect-capabilities.mjs snapshot.sh status.sh stream-frame.mjs stream-info.mjs; do printf '# old\n' > "$skill/$file"; done
printf secret > .config/openclaw-smart-home/web.env
printf config > .config/systemd/user/openclaw-gateway.service.d/90-smart-home-camera.conf
printf user-data > "$web/data/preferences.json"
printf ffmpeg > "$skill/ffmpeg"
revision=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
prepare() {
  id="aaaaaaaaaaaa-2026091900000000$1"
  stage="$OPENCLAW_DEPLOY_ROOT/.local/share/openclaw-deploy/$id"
  mkdir -p "$stage/input/web" "$stage/input/skills"
  cp -a "$web/." "$stage/input/web/"
  cp -a "$skill" "$stage/input/skills/"
  printf new > "$stage/input/web/server/version"
  printf new > "$stage/input/web/dist/version"
  tar -cf "$stage/source.tar" -C "$stage/input" web skills
  tar -cf "$stage/dist.tar" -C "$stage/input" web/dist
}
preserved() {
  test "$(cat "$web/data/preferences.json")" = user-data-new
  test "$(cat .config/openclaw-smart-home/web.env)" = secret
  test "$(cat .config/systemd/user/openclaw-gateway.service.d/90-smart-home-camera.conf)" = config
  test "$(cat "$skill/ffmpeg")" = ffmpeg
}
prepare 1
bash "$runner" deploy "$id" "$revision"
test "$(cat "$web/server/version")" = new
printf user-data-new > "$web/data/preferences.json"
bash "$runner" rollback "$id"
test "$(cat "$web/server/version")" = old
preserved
if bash "$runner" rollback "$id"; then exit 1; fi
echo 'PASS update, explicit rollback, data/config preservation, duplicate rollback rejection'
prepare 2
if FAIL_NEW=1 bash "$runner" deploy "$id" "$revision"; then exit 1; fi
test "$(cat "$web/server/version")" = old
test "$(cat "$stage/status")" = rolled-back
preserved
echo 'PASS failed health check automatically rolls back'
prepare 3
if FAIL_INSTALL=1 bash "$runner" deploy "$id" "$revision"; then exit 1; fi
test ! -e "$stage/backup.tar"
test "$(cat "$web/server/version")" = old
echo 'PASS preparation failure leaves runtime unchanged'
prepare 4
touch "$OPENCLAW_DEPLOY_ROOT/fail-copy"
if bash "$runner" deploy "$id" "$revision"; then exit 1; fi
test "$(cat "$web/server/version")" = old
test "$(cat "$stage/status")" = rolled-back
preserved
echo 'PASS mid-switch copy failure restores complete previous version'
prepare 5
if FAIL_HEALTH=1 bash "$runner" deploy "$id" "$revision"; then exit 1; fi
test "$(cat "$stage/status")" = recovery-required
bash "$runner" rollback "$id"
test "$(cat "$web/server/version")" = old
preserved
echo 'PASS failed recovery is recorded and can be retried'
prepare 6
bash "$runner" deploy "$id" "$revision"
printf corrupt >> "$stage/backup.tar"
if bash "$runner" rollback "$id"; then exit 1; fi
test "$(cat "$web/server/version")" = new
preserved
echo 'PASS damaged backup rejected before runtime changes'
echo "Fixtures retained: $fixture"
