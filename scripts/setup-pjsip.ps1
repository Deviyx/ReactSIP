param(
  [string]$Version = "2.14.1",
  [string]$DestinationRoot = "C:\deps"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $DestinationRoot)) {
  New-Item -ItemType Directory -Path $DestinationRoot -Force | Out-Null
}

$zipUrl = "https://github.com/pjsip/pjproject/archive/refs/tags/$Version.zip"
$zipPath = Join-Path $DestinationRoot "pjproject-$Version.zip"
$extractDir = Join-Path $DestinationRoot "pjproject-$Version"

Write-Host "==> Downloading $zipUrl"
curl.exe -L $zipUrl -o $zipPath

if (Test-Path $extractDir) {
  Write-Host "==> Removing existing folder $extractDir"
  Remove-Item -Recurse -Force $extractDir
}

Write-Host "==> Extracting to $DestinationRoot"
tar.exe -xf $zipPath -C $DestinationRoot

$configSample = Join-Path $extractDir "pjlib\include\pj\config_site_sample.h"
$configTarget = Join-Path $extractDir "pjlib\include\pj\config_site.h"

if ((Test-Path $configSample) -and (-not (Test-Path $configTarget))) {
  Copy-Item $configSample $configTarget
  Write-Host "==> Created config_site.h from sample"
}

$envHint = "`$env:PJSIP_DIR=`"$extractDir`""

Write-Host ""
Write-Host "PJSIP source prepared at: $extractDir"
Write-Host "Next:"
Write-Host "1) $envHint"
Write-Host "2) npm run native:build:pjsip"
