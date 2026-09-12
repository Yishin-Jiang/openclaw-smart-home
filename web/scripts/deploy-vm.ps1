param(
  [string]$Target = 'openclaw-vm',
  [string]$RemotePath = '/home/vboxuser/.openclaw/workspace/web'
)

$ErrorActionPreference = 'Stop'
$ProjectPath = Split-Path -Parent $PSScriptRoot

Push-Location $ProjectPath
try {
  npm run build
  ssh $Target 'install -d -m 700 /home/vboxuser/.config/openclaw-smart-home /home/vboxuser/.config/systemd/user'
  scp package.json package-lock.json README.md .env.example "${Target}:${RemotePath}/"
  scp -r dist public server src scripts deploy "${Target}:${RemotePath}/"
  scp deploy/systemd/openclaw-smart-home-web.service deploy/systemd/openclaw-smart-home-proxy.service "${Target}:/home/vboxuser/.config/systemd/user/"
  scp deploy/security.env "${Target}:/home/vboxuser/.config/openclaw-smart-home/security.env"
  ssh $Target 'chmod 600 /home/vboxuser/.config/openclaw-smart-home/security.env && systemctl --user daemon-reload && systemctl --user restart openclaw-smart-home-web openclaw-smart-home-proxy'
  ssh $Target "cd '$RemotePath' && npm run smoke"
} finally {
  Pop-Location
}
