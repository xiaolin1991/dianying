# 从独立分支 publish/app 同步 APK 到本仓库 public/APP
# 用法（项目根目录 PowerShell）:
#   .\scripts\sync-app-branch.ps1
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

Write-Host 'Fetching origin/publish/app ...'
git fetch origin publish/app:refs/remotes/origin/publish/app
if ($LASTEXITCODE -ne 0) {
  throw 'fetch failed: 分支 publish/app 还不存在时，等 Actions 成功打完一次包后再试'
}

git checkout origin/publish/app -- public/APP
if ($LASTEXITCODE -ne 0) { throw 'checkout public/APP failed' }

Write-Host 'OK: public/APP 已从 publish/app 更新' -ForegroundColor Green
Get-ChildItem public\APP | Format-Table Name, Length, LastWriteTime
