param(
  [string]$PjsipDir = $env:PJSIP_DIR,
  [switch]$Clean
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

function Find-CMake {
  $cmake = Get-Command cmake -ErrorAction SilentlyContinue
  if ($cmake) { return $cmake.Source }

  $vswhere = Find-VsWhere
  if ($vswhere) {
    $vsPath = & $vswhere -latest -products * -property installationPath
    if ($vsPath) {
      $candidate = Join-Path $vsPath "Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"
      if (Test-Path $candidate) { return $candidate }
    }
  }

  return $null
}

function Assert-Path([string]$PathValue, [string]$Label) {
  if (-not (Test-Path $PathValue)) {
    throw "$Label not found: $PathValue"
  }
}

if (-not $PjsipDir) {
  throw "PJSIP_DIR nao definido. Exemplo: `$env:PJSIP_DIR='C:\deps\pjsip'"
}

Assert-Path $PjsipDir "PJSIP_DIR"
Assert-Path (Join-Path $PjsipDir "pjlib\include") "PJSIP pjlib include dir"
Assert-Path (Join-Path $PjsipDir "pjsip\include") "PJSIP pjsip include dir"

$candidateLibs = Get-ChildItem -Path $PjsipDir -Recurse -Filter *.lib -ErrorAction SilentlyContinue |
  Where-Object { $_.BaseName -match '^(pjsua2|pjsua|pjsip|pjmedia|pjnath|pjlib)' } |
  Select-Object -First 1

if (-not $candidateLibs) {
  throw "Nenhuma biblioteca .lib do PJSIP encontrada em $PjsipDir. Primeiro compile o pjproject (libs estáticas)."
}

$cmakeExe = Find-CMake
if (-not $cmakeExe) {
  throw "CMake nao encontrado. Instale Visual Studio Build Tools com C++ e CMake."
}

$root = Split-Path -Parent $PSScriptRoot
$srcDir = Join-Path $root "native\sip-agent"
$buildDir = Join-Path $srcDir "build-pjsip"

if ($Clean -and (Test-Path $buildDir)) {
  Remove-Item -Recurse -Force $buildDir
}

Write-Host "==> CMake: $cmakeExe"
Write-Host "==> PJSIP_DIR: $PjsipDir"
Write-Host "==> Build dir: $buildDir"

& $cmakeExe -S $srcDir -B $buildDir -G "Visual Studio 17 2022" -A x64 -DSIP_AGENT_WITH_PJSIP=ON -DPJSIP_DIR="$PjsipDir"
& $cmakeExe --build $buildDir --config Release

$exe = Join-Path $buildDir "Release\sip-agent.exe"
if (-not (Test-Path $exe)) {
  throw "Build finalizado sem gerar sip-agent.exe em $exe"
}

Write-Host ""
Write-Host "Build concluido: $exe"
Write-Host "Copie para native\sip-agent\bin\sip-agent.exe para empacotamento."
