param(
  [switch]$SkipCleanBuild,
  [switch]$Offline
)

$ErrorActionPreference = 'Stop'
$RepositoryRoot = Split-Path -Parent $PSScriptRoot

function Assert-LastExitCode([string]$Message) {
  if ($LASTEXITCODE -ne 0) { throw $Message }
}

function Find-GitBash {
  $candidates = @(
    'C:\Program Files\Git\bin\bash.exe',
    'C:\Program Files (x86)\Git\bin\bash.exe'
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
  }
  $command = Get-Command bash -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  throw 'Git Bash is required to validate Linux shell scripts.'
}

function Test-HighConfidenceSecrets {
  $allowedExtensions = @(
    '.md', '.json', '.mjs', '.js', '.ts', '.tsx', '.css', '.html', '.sh',
    '.ps1', '.yml', '.yaml', '.toml', '.conf', '.example', '.txt', '.service'
  )
  $specialNames = @('Dockerfile', 'Caddyfile', '.gitignore', '.gitattributes')
  $patterns = [ordered]@{
    private_key = '-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'
    openai_or_anthropic_key = '(?:sk-(?:proj-)?[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,})'
    github_token = '(?:gh[pousr]_[A-Za-z0-9]{20,})'
    jwt = 'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'
    literal_bearer = 'Bearer[ \t]+[A-Za-z0-9._-]{20,}'
    credentialed_url = '(?:https?|rtsp)://[^\s/:]+:[^\s/@]+@'
  }
  $hits = @()

  $candidateFiles = @(git ls-files -co --exclude-standard)
  Assert-LastExitCode 'Could not enumerate Git-visible files.'
  foreach ($path in $candidateFiles) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
    $item = Get-Item -LiteralPath $path
    if ($item.Length -gt 5MB) { continue }
    $extension = [IO.Path]::GetExtension($path).ToLowerInvariant()
    $name = [IO.Path]::GetFileName($path)
    if (($allowedExtensions -notcontains $extension) -and ($specialNames -notcontains $name)) { continue }
    try { $content = [IO.File]::ReadAllText($item.FullName) } catch { continue }
    foreach ($entry in $patterns.GetEnumerator()) {
      if ([regex]::IsMatch($content, $entry.Value)) {
        $hits += "$($entry.Key): $path"
      }
    }
  }

  if ($hits.Count) {
    $hits | Sort-Object -Unique | ForEach-Object { Write-Error $_ }
    throw 'High-confidence secret scan failed.'
  }
  Write-Output 'PASS high-confidence secret scan'
}

function Test-IgnoreBoundaries {
  $mustBeIgnored = @(
    '.tmp-g350-test.jpg',
    '.tmp-ffmpeg-20260912',
    'tmp',
    'web-stage3.tgz',
    'web/data',
    'web/deploy/security.env',
    'web/dist',
    'web/node_modules'
  )
  foreach ($path in $mustBeIgnored) {
    if (-not (Test-Path -LiteralPath $path)) { continue }
    git check-ignore --quiet -- $path
    if ($LASTEXITCODE -ne 0) { throw "Expected ignored path is Git-visible: $path" }
  }

  $mustBeVisible = @(
    'skills/ha-camera-snapshot/SKILL.md',
    'skills/ha-camera-snapshot/status.sh',
    'web/deploy/security.env.example'
  )
  foreach ($path in $mustBeVisible) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required source file is missing: $path" }
    git check-ignore --quiet -- $path
    if ($LASTEXITCODE -eq 0) { throw "Required source file is unexpectedly ignored: $path" }
  }
  Write-Output 'PASS Git ignore boundaries'
}

function Test-Syntax {
  $parseErrors = $null
  $parseTokens = $null
  $powerShellFiles = @(
    'scripts/verify-repository.ps1',
    'web/scripts/deploy-vm.ps1'
  )
  foreach ($path in $powerShellFiles) {
    [System.Management.Automation.Language.Parser]::ParseFile(
      (Resolve-Path $path), [ref]$parseTokens, [ref]$parseErrors
    ) | Out-Null
    if ($parseErrors.Count) { throw "PowerShell syntax check failed: $path" }
  }

  $gitBash = Find-GitBash
  foreach ($path in @('skills/ha-camera-snapshot/status.sh', 'skills/ha-camera-snapshot/snapshot.sh')) {
    & $gitBash -n $path
    Assert-LastExitCode "Bash syntax check failed: $path"
  }

  Get-ChildItem -LiteralPath 'skills/ha-camera-snapshot' -Filter '*.mjs' -File | ForEach-Object {
    node --check $_.FullName
    Assert-LastExitCode "Node syntax check failed: $($_.FullName)"
  }
  Write-Output 'PASS script syntax checks'
}

function Test-CleanCandidateBuild {
  $temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  $testPath = Join-Path $temporaryRoot ('openclaw-repro-' + [guid]::NewGuid().ToString('N'))
  $resolvedTestPath = [IO.Path]::GetFullPath($testPath)
  if (-not $resolvedTestPath.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase) -or
      [IO.Path]::GetFileName($resolvedTestPath) -notlike 'openclaw-repro-*') {
    throw 'Unsafe temporary build path.'
  }

  New-Item -ItemType Directory -Path $resolvedTestPath | Out-Null
  try {
    $candidateFiles = @(git ls-files -co --exclude-standard -- 'web/**')
    Assert-LastExitCode 'Could not enumerate Git-visible web files.'
    foreach ($relativePath in $candidateFiles) {
      if (-not (Test-Path -LiteralPath $relativePath -PathType Leaf)) { continue }
      $webRelativePath = $relativePath.Substring(4)
      $destination = Join-Path $resolvedTestPath $webRelativePath
      $destinationDirectory = Split-Path -Parent $destination
      if (-not (Test-Path -LiteralPath $destinationDirectory)) {
        New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
      }
      Copy-Item -LiteralPath $relativePath -Destination $destination
    }

    Push-Location $resolvedTestPath
    try {
      $installArguments = @('ci')
      if ($Offline) { $installArguments += '--offline' }
      npm @installArguments
      Assert-LastExitCode 'Clean dependency installation failed.'
      npm test
      Assert-LastExitCode 'Clean candidate regression tests failed.'
      npm run build
      Assert-LastExitCode 'Clean candidate production build failed.'
    } finally {
      Pop-Location
    }
    Write-Output "PASS clean candidate build ($($candidateFiles.Count) Git-visible web files)"
  } finally {
    if (Test-Path -LiteralPath $resolvedTestPath) {
      $finalCheck = [IO.Path]::GetFullPath($resolvedTestPath)
      if ($finalCheck.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase) -and
          [IO.Path]::GetFileName($finalCheck) -like 'openclaw-repro-*') {
        Remove-Item -LiteralPath $finalCheck -Recurse -Force
      } else {
        throw 'Refusing unsafe temporary build cleanup.'
      }
    }
  }
}

Push-Location $RepositoryRoot
try {
  git diff --check
  Assert-LastExitCode 'Git whitespace check failed.'
  Write-Output 'PASS Git whitespace check'
  Test-HighConfidenceSecrets
  Test-IgnoreBoundaries
  Test-Syntax
  if (-not $SkipCleanBuild) { Test-CleanCandidateBuild }
  Write-Output "PASS repository verification; staged files: $(@(git diff --cached --name-only).Count)"
} finally {
  Pop-Location
}
