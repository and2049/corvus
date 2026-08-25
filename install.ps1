#Requires -Version 5.0
[CmdletBinding()]
param(
    [Alias("v")]
        [string]$Version,
    [switch]$NoModifyPath,
    [switch]$Help
)

$ErrorActionPreference = "Stop"
$App = "corvus"
$Repo = "and2049/corvus"

if ($Help) {
    Write-Host @"
Corvus Installer

Usage: install.ps1 [options]

Options:
    -Version <version>   Install a specific version (e.g., 0.1.0)
    -NoModifyPath        Don't add corvus to user PATH
    -Help                Display this help message

Examples:
    irm https://github.com/$Repo/releases/latest/download/install.ps1 | iex
    & ([scriptblock]::Create((irm https://github.com/$Repo/releases/latest/download/install.ps1))) -Version 0.1.0
"@
    exit 0
}

function Write-Info  { param([string]$msg) Write-Host $msg -ForegroundColor Gray }
function Write-Err   { param([string]$msg) Write-Host $msg -ForegroundColor Red }
function Write-Warn  { param([string]$msg) Write-Host $msg -ForegroundColor Yellow }

# --- Target ---
# Only windows-x64 is published; Windows on ARM runs x64 binaries via emulation.
$target = "windows-x64"
$archiveExt = ".zip"
$filename = "$App-$target$archiveExt"

# --- Determine version and URL ---

if ($Version) {
    $Version = $Version -replace '^v', ''
    $url = "https://github.com/$Repo/releases/download/v$Version/$filename"
    $specificVersion = $Version
    $tagUrl = "https://github.com/$Repo/releases/tag/v$Version"
    try {
        Invoke-WebRequest -Uri $tagUrl -Method Head -UseBasicParsing -ErrorAction Stop | Out-Null
    } catch {
        Write-Err "Release v$Version not found"
        Write-Info "Available releases: https://github.com/$Repo/releases"
        exit 1
    }
} else {
    $url = "https://github.com/$Repo/releases/latest/download/$filename"
    try {
        $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -ErrorAction Stop
        $specificVersion = $release.tag_name -replace '^v', ''
    } catch {
        Write-Err "Failed to fetch version information"
        exit 1
    }
}

# --- Check existing version ---

$existingCommand = Get-Command $App -ErrorAction SilentlyContinue
if ($existingCommand) {
    try {
        $versionOutput = & $App --version 2>$null
        if ($versionOutput) {
            $installedVersion = (($versionOutput -split '\s+')[1]).TrimStart('v')
            if ($installedVersion -eq $specificVersion) {
                Write-Info "Version $specificVersion already installed"
                exit 0
            } else {
                Write-Info "Installed version: $installedVersion"
            }
        }
    } catch {}
}

# --- Install ---

$installDir = Join-Path $env:USERPROFILE ".$App\bin"
if (-not (Test-Path $installDir)) {
    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
}

Write-Info "Installing $App version: $specificVersion"

$tmpDir = Join-Path $env:TEMP "${App}_install_$PID"
if (-not (Test-Path $tmpDir)) {
    New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null
}

$archivePath = Join-Path $tmpDir $filename

try {
    Invoke-WebRequest -Uri $url -OutFile $archivePath -UseBasicParsing -ErrorAction Stop
} catch {
    Write-Err "Failed to download $filename"
    exit 1
}

Expand-Archive -Path $archivePath -DestinationPath $tmpDir -Force

# The archive contains the binary; it may be named "corvus" or "corvus.exe".
$extractedBinary = Join-Path $tmpDir "$App.exe"
if (-not (Test-Path $extractedBinary)) {
    $extractedBinary = Join-Path $tmpDir "$App"
}
if (-not (Test-Path $extractedBinary)) {
    Write-Err "Could not find $App or $App.exe in extracted archive"
    exit 1
}

$destBinary = Join-Path $installDir "$App.exe"

# Windows does not allow overwriting a running executable. If a previous
# corvus.exe is locked (e.g. running `corvus upgrade`), rename it aside and
# drop the new binary into place. A detached cleanup process deletes the
# leftover once the running corvus exits.
$oldBinary = "$destBinary.old"
if (Test-Path $oldBinary) {
    try { Remove-Item -Path $oldBinary -Force -ErrorAction Stop }
    catch { Write-Warn "Could not remove stale $oldBinary; it will be left in place." }
}
if (Test-Path $destBinary) {
    try { Move-Item -Path $destBinary -Destination $oldBinary -Force -ErrorAction Stop }
    catch {
        Write-Err "Failed to relocate existing $destBinary for replacement: $($_.Exception.Message)"
        Remove-Item -Path $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
        exit 1
    }
}

Move-Item -Path $extractedBinary -Destination $destBinary -Force
Remove-Item -Path $tmpDir -Recurse -Force

if (Test-Path $oldBinary) {
    $cleanupScript = @"
`$ErrorActionPreference = 'SilentlyContinue'
for (`$i = 0; `$i -lt 60; `$i++) {
    try {
        `$fs = [System.IO.File]::Open('$oldBinary', 'Open', 'ReadWrite', 'None')
        `$fs.Close()
        Remove-Item -LiteralPath '$oldBinary' -Force
        break
    } catch {
        Start-Sleep -Seconds 1
    }
}
"@
    $encoded = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($cleanupScript))
    try {
        Start-Process -FilePath "powershell.exe" `
            -ArgumentList "-NoProfile","-EncodedCommand",$encoded `
            -WindowStyle Hidden -PassThru | Out-Null
    } catch {
        Write-Warn "Could not schedule cleanup of $oldBinary; it will be removed on a future install."
    }
}

# --- Add to PATH ---

if (-not $NoModifyPath) {
    $userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
    if ($userPath -notlike "*$installDir*") {
        $newPath = if ($userPath) { "$installDir;$userPath" } else { $installDir }
        [Environment]::SetEnvironmentVariable("PATH", $newPath, "User")
        Write-Info "Added corvus to PATH (User environment variable)"
        Write-Info "Restart your terminal for the change to take effect"
    } else {
        Write-Info "corvus is already in your PATH"
    }
}

if ($env:GITHUB_ACTIONS -eq "true" -and $env:GITHUB_PATH) {
    Add-Content -Path $env:GITHUB_PATH -Value $installDir
}

Write-Host ""
Write-Info "corvus installed successfully!"
Write-Info "Run 'corvus' to launch. More info: https://github.com/$Repo"
Write-Host ""
