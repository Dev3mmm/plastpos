$ErrorActionPreference = 'Stop'
$dest = $PSScriptRoot
$dataDir = Join-Path $dest 'app\backend\data'
$shortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'PlastPOS.lnk'

Write-Host "PlastPOS - remove from this computer" -ForegroundColor Cyan
Write-Host "-------------------------------------"
Write-Host ""
Write-Host "1. Remove everything - the program AND all saved data (sales, stock, everyone's records). This cannot be undone."
Write-Host "2. Remove the program only - keep all saved data on this computer, in case you install PlastPOS again later."
Write-Host "3. Cancel - do not remove anything."
Write-Host ""
$choice = Read-Host "Type 1, 2 or 3"

# Close it first if it's running, so files aren't locked.
Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -like "$dest*"
} | Stop-Process -Force -ErrorAction SilentlyContinue

if ($choice -eq '1') {
    $sure = Read-Host "This deletes everything, including saved data. Type YES to confirm"
    if ($sure -ne 'YES') { Write-Host "Stopped. Nothing was removed."; exit }
    if (Test-Path $shortcutPath) { Remove-Item $shortcutPath -Force }
    Remove-Item $dest -Recurse -Force
    Write-Host "PlastPOS and all its data have been removed." -ForegroundColor Green
}
elseif ($choice -eq '2') {
    if (Test-Path $shortcutPath) { Remove-Item $shortcutPath -Force }
    Get-ChildItem $dest -Force | Where-Object { $_.FullName -ne $dataDir -and $_.Name -ne 'data' } | ForEach-Object {
        if ($_.FullName -eq (Join-Path $dest 'app')) {
            # keep app\backend\data, remove everything else inside app\
            Get-ChildItem $_.FullName -Force | Where-Object { $_.Name -ne 'backend' } | Remove-Item -Recurse -Force
            Get-ChildItem (Join-Path $_.FullName 'backend') -Force | Where-Object { $_.Name -ne 'data' } | Remove-Item -Recurse -Force
        } else {
            Remove-Item $_.FullName -Recurse -Force
        }
    }
    Write-Host "The program has been removed. Your saved data is still here:" -ForegroundColor Green
    Write-Host "  $dataDir"
    Write-Host "Install PlastPOS again any time and it will pick that data back up."
}
else {
    Write-Host "Stopped. Nothing was removed."
}
