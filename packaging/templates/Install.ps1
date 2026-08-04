$ErrorActionPreference = 'Stop'
$src = $PSScriptRoot
$dest = Join-Path $env:USERPROFILE 'PlastPOS'

Write-Host "PlastPOS - installing to this computer" -ForegroundColor Cyan
Write-Host "-------------------------------------"
Write-Host "No internet needed - everything runs from this flash drive's copy." -ForegroundColor DarkGray
Write-Host ""

if (-not (Test-Path $dest)) { New-Item -ItemType Directory -Path $dest -Force | Out-Null }

Write-Host "Copying app files to $dest ..."
# robocopy /E copies subfolders; it will NOT delete an existing data\ folder
# on the destination that isn't present in the source, so re-running this
# on a machine that already has real business data is safe.
robocopy (Join-Path $src 'node') (Join-Path $dest 'node') /E /NFL /NDL /NJH /NJS | Out-Null
robocopy (Join-Path $src 'app')  (Join-Path $dest 'app')  /E /NFL /NDL /NJH /NJS | Out-Null
Copy-Item (Join-Path $src 'Start-PlastPOS.bat') (Join-Path $dest 'Start-PlastPOS.bat') -Force

Write-Host "Adding a Desktop shortcut..."
$shortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'PlastPOS.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $dest 'Start-PlastPOS.bat'
$shortcut.WorkingDirectory = $dest
$shortcut.Description = 'Start PlastPOS'
$shortcut.Save()

Write-Host ""
Write-Host "Done. A 'PlastPOS' shortcut was added to your Desktop." -ForegroundColor Green
Write-Host "Starting PlastPOS now..."
Write-Host ""
Start-Process (Join-Path $dest 'Start-PlastPOS.bat') -WorkingDirectory $dest
