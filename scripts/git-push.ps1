# 安全推送 main：先 rebase 远程再 push（避免 Desktop「远程存在更新的提交」卡死）
# 用法（项目根目录 PowerShell）:  .\scripts\git-push.ps1
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
git fetch origin
git pull --rebase origin main
if ($LASTEXITCODE -ne 0) { throw 'pull --rebase failed; resolve conflicts then retry' }
git push origin HEAD
Write-Host 'OK: pushed to origin' -ForegroundColor Green
