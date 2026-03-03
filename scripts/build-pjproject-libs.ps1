param(
  [string]$PjsipDir = $env:PJSIP_DIR,
  [string]$Configuration = "Release",
  [string]$Platform = "x64",
  [string]$PlatformToolset = "v143",
  [string]$WindowsTargetPlatformVersion = ""
)

$ErrorActionPreference = "Stop"

function Find-VsWhere {
  $paths = @(
    "C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe",
    "C:\Program Files\Microsoft Visual Studio\Installer\vswhere.exe"
  )
  foreach ($p in $paths) {
    if (Test-Path $p) { return $p }
  }
  return $null
}

function Find-MSBuild {
  $msbuild = Get-Command msbuild -ErrorAction SilentlyContinue
  if ($msbuild) { return $msbuild.Source }

  $vswhere = Find-VsWhere
  if ($vswhere) {
    $path = & $vswhere -latest -products * -requires Microsoft.Component.MSBuild -find "MSBuild\**\Bin\MSBuild.exe"
    if ($path -and (Test-Path $path)) { return $path }
  }

  return $null
}

if (-not $PjsipDir) {
  throw "PJSIP_DIR nao definido. Exemplo: `$env:PJSIP_DIR='C:\deps\pjproject-2.14.1'"
}

if (-not (Test-Path $PjsipDir)) {
  throw "PJSIP_DIR not found: $PjsipDir"
}

$msbuildExe = Find-MSBuild
if (-not $msbuildExe) {
  throw "MSBuild nao encontrado. Instale Visual Studio Build Tools (workload C++)."
}

$libProj = Join-Path $PjsipDir "pjsip-apps\build\libpjproject.vcxproj"
if (-not (Test-Path $libProj)) {
  throw "Projeto nao encontrado: $libProj"
}

Write-Host "==> MSBuild: $msbuildExe"
Write-Host "==> Building pjproject libs: $libProj"
Write-Host "==> Configuration=$Configuration Platform=$Platform Toolset=$PlatformToolset"

$args = @(
  $libProj,
  "/m",
  "/p:Configuration=$Configuration",
  "/p:Platform=$Platform",
  "/p:PlatformToolset=$PlatformToolset"
)

if ($WindowsTargetPlatformVersion) {
  $args += "/p:WindowsTargetPlatformVersion=$WindowsTargetPlatformVersion"
}

& $msbuildExe @args

$libs = Get-ChildItem -Path $PjsipDir -Recurse -Filter *.lib -ErrorAction SilentlyContinue |
  Where-Object { $_.BaseName -match '^(pjsua2|pjsua|pjsip|pjmedia|pjnath|pjlib)' }

if (-not $libs) {
  throw "Build executou, mas nenhuma lib core do PJSIP foi encontrada."
}

Write-Host "Build de libs concluido. Total libs detectadas: $($libs.Count)"
