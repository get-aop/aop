#requires -Version 5.1
<#
.SYNOPSIS
  Install the AOP CLI + runtime assets on native Windows.

.DESCRIPTION
  Mirrors install.sh: downloads the prebuilt aop-windows-x64.exe, runtime-assets.tar.gz,
  and checksums.sha256, verifies SHA-256, installs to %LOCALAPPDATA%\aop, extracts the
  runtime assets, and unblocks the executable (it is unsigned in v1, so Windows marks the
  download with a Mark-of-the-Web that SmartScreen/Defender would otherwise flag).

  WSL users: do NOT use this script. Run the Linux install command inside your distro
  instead — AOP runs the sidecar in-distro (Model B). See docs/install.

.PARAMETER Version
  Release version to install (e.g. 0.2.11). Defaults to the latest published version.
#>
param(
  [string]$Version
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$ReleasesBaseUrl = if ($env:AOP_RELEASES_URL) { $env:AOP_RELEASES_URL } else { "https://getaop.com" }
$GitHubRepo = "get-aop/aop-mono"
$BinaryName = "aop-windows-x64.exe"
$RuntimeAssetsName = "runtime-assets.tar.gz"
$InstallDir = Join-Path $env:LOCALAPPDATA "aop"

function Resolve-Version {
  if ($Version) { return ($Version -replace '^v', '') }
  try {
    $latest = (Invoke-WebRequest -Uri "$ReleasesBaseUrl/latest/version" -UseBasicParsing).Content.Trim()
  } catch {
    throw "Failed to fetch the latest version from $ReleasesBaseUrl/latest/version"
  }
  if (-not $latest) { throw "Latest version response was empty" }
  return ($latest -replace '^v', '')
}

function Get-Asset {
  param([string]$Name, [string]$Destination, [string]$ResolvedVersion)
  $primary = "$ReleasesBaseUrl/v$ResolvedVersion/$Name"
  $fallback = "https://github.com/$GitHubRepo/releases/download/v$ResolvedVersion/$Name"
  foreach ($url in @($primary, $fallback)) {
    try {
      Invoke-WebRequest -Uri $url -OutFile $Destination -UseBasicParsing
      return
    } catch {
      Write-Host "  (could not fetch $url, trying next source)"
    }
  }
  throw "Failed to download $Name for v$ResolvedVersion"
}

function Assert-Checksum {
  param([string]$Name, [string]$FilePath, [string]$ChecksumsPath)
  $line = Select-String -Path $ChecksumsPath -Pattern ("  " + [regex]::Escape($Name) + "$") | Select-Object -First 1
  if (-not $line) { throw "No checksum found for $Name in checksums.sha256" }
  $expected = ($line.Line -split '\s+')[0].ToLower()
  $actual = (Get-FileHash -Algorithm SHA256 -Path $FilePath).Hash.ToLower()
  if ($expected -ne $actual) {
    throw "Checksum mismatch for ${Name}: expected $expected, got $actual"
  }
}

function Add-ToUserPath {
  param([string]$Dir)
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $entries = @()
  if ($userPath) { $entries = $userPath -split ';' }
  if ($entries -notcontains $Dir) {
    $newPath = (@($Dir) + $entries | Where-Object { $_ }) -join ';'
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    Write-Host "Added $Dir to your user PATH (restart your terminal to pick it up)."
  }
}

$resolved = Resolve-Version
Write-Host "Installing AOP $resolved to $InstallDir"

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("aop-install-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
try {
  Get-Asset -Name "checksums.sha256" -Destination (Join-Path $tmp "checksums.sha256") -ResolvedVersion $resolved
  Get-Asset -Name $BinaryName -Destination (Join-Path $tmp $BinaryName) -ResolvedVersion $resolved
  Get-Asset -Name $RuntimeAssetsName -Destination (Join-Path $tmp $RuntimeAssetsName) -ResolvedVersion $resolved

  $checksumsPath = Join-Path $tmp "checksums.sha256"
  Assert-Checksum -Name $BinaryName -FilePath (Join-Path $tmp $BinaryName) -ChecksumsPath $checksumsPath
  Assert-Checksum -Name $RuntimeAssetsName -FilePath (Join-Path $tmp $RuntimeAssetsName) -ChecksumsPath $checksumsPath

  # Stop a running server so the binary isn't locked, then install.
  $existing = Join-Path $InstallDir "aop.exe"
  if (Test-Path $existing) { & $existing stop *> $null }

  New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
  Copy-Item -Path (Join-Path $tmp $BinaryName) -Destination $existing -Force
  Unblock-File -Path $existing

  foreach ($sub in @("dashboard", "templates", "methodology")) {
    $dir = Join-Path $InstallDir $sub
    if (Test-Path $dir) { Remove-Item -Recurse -Force $dir }
  }
  & tar.exe -xzf (Join-Path $tmp $RuntimeAssetsName) -C $InstallDir
  if (-not (Test-Path (Join-Path $InstallDir "dashboard\index.html"))) {
    throw "Runtime assets did not extract correctly (dashboard\index.html missing)"
  }

  Add-ToUserPath -Dir $InstallDir

  Write-Host ""
  Write-Host "AOP $resolved installed to $InstallDir\aop.exe"
  Write-Host "The AOP desktop app manages the local server; or run 'aop run' yourself."
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
