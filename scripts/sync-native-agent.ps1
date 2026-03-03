$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$binDir = Join-Path $projectRoot "native\sip-agent\bin"
$target = Join-Path $binDir "sip-agent.exe"

$candidates = @(
  (Join-Path $projectRoot "native\sip-agent\build-pjsip\Release\sip-agent.exe"),
  (Join-Path $projectRoot "native\sip-agent\build\Release\sip-agent.exe")
)

New-Item -ItemType Directory -Path $binDir -Force | Out-Null

$source = $null
foreach ($candidate in $candidates) {
  if (Test-Path $candidate) {
    $source = $candidate
    break
  }
}

if (-not $source) {
  if (Test-Path $target) {
    Write-Host "No fresh build found, keeping existing bin sip-agent.exe"
    exit 0
  }
  throw "sip-agent.exe not found in build outputs or bin. Build native agent first."
}

try {
  Copy-Item -Path $source -Destination $target -Force
  Write-Host "Native agent synced to $target"
} catch {
  if (Test-Path $target) {
    Write-Warning "Could not copy from build output (likely locked). Using existing bin sip-agent.exe."
    exit 0
  }
  throw
}
