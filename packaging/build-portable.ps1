$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'dist\PlastPOS-USB'
$nodeVersion = 'v24.14.0'
$nodeZipName = "node-$nodeVersion-win-x64.zip"
$nodeZipUrl = "https://nodejs.org/dist/$nodeVersion/$nodeZipName"
$cacheDir = Join-Path $root 'packaging\.cache'

Write-Host "Building portable PlastPOS package..." -ForegroundColor Cyan

# 1. Fresh output folder
if (Test-Path $outDir) { Remove-Item $outDir -Recurse -Force }
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

# 2. Get a portable Node.js runtime (downloads once, then reuses the cached zip)
if (-not (Test-Path $cacheDir)) { New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null }
$zipPath = Join-Path $cacheDir $nodeZipName
if (-not (Test-Path $zipPath)) {
    Write-Host "Downloading Node.js $nodeVersion (portable, win-x64)..."
    Invoke-WebRequest -Uri $nodeZipUrl -OutFile $zipPath
} else {
    Write-Host "Using cached Node.js runtime from $zipPath"
}
Write-Host "Extracting Node.js runtime..."
$extractTemp = Join-Path $cacheDir 'extract'
if (Test-Path $extractTemp) { Remove-Item $extractTemp -Recurse -Force }
Expand-Archive -Path $zipPath -DestinationPath $extractTemp -Force
$extractedFolder = Get-ChildItem $extractTemp | Select-Object -First 1
Move-Item $extractedFolder.FullName (Join-Path $outDir 'node')
Remove-Item $extractTemp -Recurse -Force

# 3. Copy the app (backend incl. already-installed node_modules, minus local data; frontend)
Write-Host "Copying app files..."
$appDir = Join-Path $outDir 'app'
New-Item -ItemType Directory -Path $appDir -Force | Out-Null
robocopy (Join-Path $root 'backend') (Join-Path $appDir 'backend') /E /XD data /NFL /NDL /NJH /NJS | Out-Null
robocopy (Join-Path $root 'frontend') (Join-Path $appDir 'frontend') /E /NFL /NDL /NJH /NJS | Out-Null

# 4. Launcher + installer scripts + instructions
Copy-Item (Join-Path $PSScriptRoot 'templates\Start-PlastPOS.bat') (Join-Path $outDir 'Start-PlastPOS.bat')
Copy-Item (Join-Path $PSScriptRoot 'templates\Install-To-This-PC.bat') (Join-Path $outDir 'Install-To-This-PC.bat')
Copy-Item (Join-Path $PSScriptRoot 'templates\Install.ps1') (Join-Path $outDir 'Install.ps1')
Copy-Item (Join-Path $PSScriptRoot 'templates\README-INSTALL.txt') (Join-Path $outDir 'README-INSTALL.txt')

$sizeMB = [math]::Round((Get-ChildItem $outDir -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB, 1)
Write-Host ""
Write-Host "Done. Portable package built at:" -ForegroundColor Green
Write-Host "  $outDir" -ForegroundColor Cyan
Write-Host "  Size: $sizeMB MB"
Write-Host ""
Write-Host "Copy that whole 'PlastPOS-USB' folder onto a flash drive." -ForegroundColor Yellow
