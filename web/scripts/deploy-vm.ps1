param(
  [string]$Target = 'openclaw-vm',
  [switch]$ValidateOnly,
  [string]$Rollback
)
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
function Run([string]$Command, [string[]]$Arguments) {
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Command failed (exit $LASTEXITCODE)." }
}
if ($Target -notmatch '^[A-Za-z0-9][A-Za-z0-9_.@-]*$') { throw 'Invalid SSH target.' }
if ($Rollback -and $Rollback -notmatch '^[a-f0-9]{12}-[0-9]{17}$') { throw 'Invalid deployment ID.' }
if ($Rollback -and $ValidateOnly) { throw 'Choose rollback or validation, not both.' }
if ($Rollback) {
  Run ssh @($Target, "bash .local/share/openclaw-deploy/$Rollback/remote-deploy.sh rollback $Rollback")
  return
}
Push-Location $Repo
try {
  $revision = (& git rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve Git revision.' }
  $dirty = & git status --porcelain --untracked-files=all -- web skills/ha-camera-snapshot
  if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect deployment inputs.' }
  if ($dirty -and -not $ValidateOnly) { throw 'Commit deployment inputs first. This script never commits or pushes.' }
  if ($ValidateOnly) {
    Push-Location web
    try { Run npm @('test'); Run npm @('run', 'build') } finally { Pop-Location }
    Write-Output 'PASS local tests/build only; no SSH, clean-install or rollback rehearsal performed.'
    return
  }
  $id = $revision.Substring(0,12) + '-' + (Get-Date -Format 'yyyyMMddHHmmssfff')
  $stage = Join-Path ([System.IO.Path]::GetTempPath()) "openclaw-deploy-$id"
  New-Item -ItemType Directory -Path $stage | Out-Null
  Run git @('archive', '--format=tar', "--output=$stage/source.tar", $revision, 'web', 'skills/ha-camera-snapshot')
  Run tar @('-xf', "$stage/source.tar", '-C', $stage)
  Push-Location "$stage/web"
  try {
    Run npm @('ci', '--no-audit', '--no-fund')
    Run npm @('test')
    Run npm @('run', 'build')
  } finally { Pop-Location }
  Run tar @('-cf', "$stage/dist.tar", '-C', $stage, 'web/dist')
  $remote = ".local/share/openclaw-deploy/$id"
  Run ssh @($Target, "umask 077; mkdir -p .local/share/openclaw-deploy && mkdir '$remote'")
  Run scp @("$stage/source.tar", "$stage/dist.tar", "$stage/web/scripts/remote-deploy.sh", "${Target}:$remote/")
  Write-Output "Deployment ID: $id (local staging retained at $stage)"
  Run ssh @($Target, "bash '$remote/remote-deploy.sh' deploy '$id' '$revision'")
} finally { Pop-Location }
