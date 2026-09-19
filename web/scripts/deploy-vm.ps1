param(
  [string]$Target = 'openclaw-vm',
  [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'
$ProjectPath = Split-Path -Parent $PSScriptRoot
$RemotePath = '.openclaw/workspace/web'
$RequiredCommands = if ($ValidateOnly) { @('npm') } else { @('npm', 'ssh', 'scp') }
$RequiredFiles = @(
  'package.json',
  'package-lock.json',
  '.env.example',
  'deploy/security.env',
  'deploy/systemd/openclaw-smart-home-web.service',
  'deploy/systemd/openclaw-smart-home-proxy.service'
)

if ($Target -notmatch '^[A-Za-z0-9_.@-]+$') {
  throw 'Target contains unsupported characters.'
}

Push-Location $ProjectPath
try {
  foreach ($command in $RequiredCommands) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
      throw "Required command is unavailable: $command"
    }
  }

  foreach ($file in $RequiredFiles) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
      throw "Required deployment input is missing: $file"
    }
  }

  if ($ValidateOnly) {
    npm test
    if ($LASTEXITCODE -ne 0) { throw 'Local regression tests failed.' }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Local production build failed.' }
    Write-Output 'PASS local deployment inputs and production build'
    return
  }

  npm ci
  if ($LASTEXITCODE -ne 0) { throw 'Clean dependency installation failed.' }
  npm test
  if ($LASTEXITCODE -ne 0) { throw 'Regression tests failed.' }
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'Production build after clean install failed.' }

  ssh $Target 'test -f "$HOME/.config/openclaw-smart-home/web.env" && test -f "$HOME/.config/openclaw-smart-home/proxy.env" && test -f "$HOME/.config/openclaw-smart-home/Caddyfile"'
  if ($LASTEXITCODE -ne 0) {
    throw 'VM bootstrap configuration is incomplete; see deploy/README.md.'
  }

  ssh $Target "install -d -m 700 '$RemotePath' '$RemotePath/scripts' \"`$HOME/.config/openclaw-smart-home\" \"`$HOME/.config/systemd/user\""
  if ($LASTEXITCODE -ne 0) { throw 'Could not prepare VM configuration directories.' }
  scp package.json package-lock.json README.md .env.example "${Target}:${RemotePath}/"
  if ($LASTEXITCODE -ne 0) { throw 'Could not upload package metadata.' }
  scp -r dist server "${Target}:${RemotePath}/"
  if ($LASTEXITCODE -ne 0) { throw 'Could not upload runtime files.' }
  scp scripts/smoke-test.mjs "${Target}:${RemotePath}/scripts/"
  if ($LASTEXITCODE -ne 0) { throw 'Could not upload the read-only smoke test.' }
  ssh $Target "cd '$RemotePath' && npm ci --omit=dev"
  if ($LASTEXITCODE -ne 0) { throw 'VM production dependency installation failed.' }
  scp deploy/systemd/openclaw-smart-home-web.service deploy/systemd/openclaw-smart-home-proxy.service "${Target}:.config/systemd/user/"
  if ($LASTEXITCODE -ne 0) { throw 'Could not upload systemd service files.' }
  scp deploy/security.env "${Target}:.config/openclaw-smart-home/security.env"
  if ($LASTEXITCODE -ne 0) { throw 'Could not upload the VM security environment file.' }
  ssh $Target 'chmod 600 "$HOME/.config/openclaw-smart-home/security.env" && systemctl --user daemon-reload && systemctl --user restart openclaw-smart-home-web openclaw-smart-home-proxy'
  if ($LASTEXITCODE -ne 0) { throw 'VM service restart failed.' }
  ssh $Target "cd '$RemotePath' && npm run smoke"
  if ($LASTEXITCODE -ne 0) { throw 'Read-only VM smoke test failed.' }
} finally {
  Pop-Location
}
