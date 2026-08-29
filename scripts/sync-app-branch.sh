#!/usr/bin/env bash
# 从独立分支 publish/app 同步 APK 到本仓库 public/APP（不碰你的 main 提交）
# 用法（在网站项目根目录）:
#   bash scripts/sync-app-branch.sh
# 宝塔可做成计划任务：每次 git pull 后执行一次
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
git fetch origin publish/app:refs/remotes/origin/publish/app
git checkout origin/publish/app -- public/APP
echo "[sync-app] public/APP 已从 origin/publish/app 更新"
ls -la public/APP | head -20
