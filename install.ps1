$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "PlastPOS installer" -ForegroundColor Cyan
Write-Host "-------------------"

# 1. Check Node.js is installed and new enough (built-in SQLite needs 22.5+)
$nodeOk = $false
try {
    $verString = (& node --version) -replace 'v', ''
    $ver = [version]$verString
    if ($ver -ge [version]"22.5.0") { $nodeOk = $true }
} catch { }

if (-not $nodeOk) {
    Write-Host ""
    Write-Host "Node.js 22.5 or newer is required and was not found." -ForegroundColor Yellow
    Write-Host "Opening the download page - install it, then run this installer again."
    Start-Process "https://nodejs.org/en/download"
    exit 1
}
Write-Host "Node.js OK: $(node --version)" -ForegroundColor Green

# 2. Install backend dependencies
Write-Host ""
Write-Host "Installing dependencies..."
Push-Location (Join-Path $root "backend")
npm install
Pop-Location

# 3. Create a Desktop shortcut to start-plastpos.bat
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "PlastPOS.lnk"
$targetPath = Join-Path $root "start-plastpos.bat"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $targetPath
$shortcut.WorkingDirectory = $root
$shortcut.Description = "Start PlastPOS"
$shortcut.Save()

Write-Host ""
Write-Host "Done. A 'PlastPOS' shortcut was added to your Desktop." -ForegroundColor Green
Write-Host "Double-click it any time to start the server and open the app."
Write-Host ""

# 4. Show the LAN IP so phones on the same WiFi know what to type
Write-Host "This computer's network addresses (for phones on the same WiFi):"
Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
    ForEach-Object { Write-Host "  http://$($_.IPAddress):4000" -ForegroundColor Cyan }
