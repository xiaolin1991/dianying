# 晓林影视 XIAOLIN-TV — 宝塔面板部署教程（VPS 云端）

适用：已装好宝塔面板的 Linux 服务器（CentOS / Ubuntu / Debian 均可）。
两种方式任选其一：**方式 A · Node 项目**（简单直观）或 **方式 B · Docker**（升级最省心）。
部署完成后都用面板的「反向代理」绑定域名 + HTTPS。

---

## 准备工作（两种方式通用）

1. 登录宝塔面板 → **软件商店**：
   - 安装 **Nginx**（用于反向代理和证书）
   - 方式 A 另需安装 **Node.js 版本管理器**，并安装 **Node 20**（≥18 即可）
   - 方式 B 另需安装 **Docker**（软件商店搜 Docker）
2. **放行端口**：面板 → 安全 → 放行 `8788`（TCP）。
   *若只用反向代理对外，也可以不放行，保持仅本机访问更安全。*

### 上传代码（方式 A 需要；方式 B 不需要）

获取项目文件到服务器 `/www/wwwroot/xiaolintv`，任选：

- **Git 方式**（推荐）：面板终端执行
  ```bash
  mkdir -p /www/wwwroot && cd /www/wwwroot
  git clone https://github.com/<你的用户名>/<仓库名>.git xiaolintv
  ```
- **压缩包方式**：本地把仓库打包 zip（**不要包含** `node_modules`、`.git`、`.wrangler`、`data`），
  面板 → 文件 → 进入 `/www/wwwroot` → 上传 zip → 解压并改名为 `xiaolintv`。

> 本项目**零 npm 依赖**，不需要在面板里执行 npm install。

---

## 方式 A · Node 项目（宝塔图形化托管）

1. 面板 → **网站** → 顶部标签 **Node 项目** → **添加 Node 项目**
2. 按下表填写：

| 字段 | 填写 |
|---|---|
| 项目目录 | `/www/wwwroot/xiaolintv` |
| 启动选项 | `node server/node-server.mjs`（有的版本是"启动文件"选 `server/node-server.mjs`） |
| 项目名称 | xiaolintv |
| 端口 | `8788` |
| 运行用户 | `root`（或 www，但需保证目录可写，见下方权限） |
| Node 版本 | 20.x |
| 环境变量 | `ADMIN_PASSWORD=你的管理密码`（换行分隔可加 `PORT=8788`） |

3. 提交后点「启动」，状态变绿即成功。日志里应出现：
   ```
   晓林影视 XIAOLIN-TV 自托管服务已启动
   ```
4. **数据说明**：未设 `DATA_DIR` 时数据落在项目目录 `data/kv.json`，
   备份该文件 = 备份全站数据。建议在环境变量中固定：
   ```
   DATA_DIR=/www/xiaodata
   ```

### 权限小贴士

如果用 www 用户运行却报写入失败：

```bash
mkdir -p /www/xiaodata && chown -R www:www /www/xiaodata /www/wwwroot/xiaolintv
```

---

## 方式 B · Docker（镜像自动更新，推荐长期使用）

### B-1 面板图形化

1. 软件商店打开 **Docker** → 容器模板/镜像：
   - 名称填 `ghcr.io/<你的GitHub用户名>/<仓库名>:latest`
   - 若 GHCR 拉取慢/失败：给 Docker 配置镜像加速，或在本地电脑
     `docker pull` 后 `docker save -o xl.tar` 上传 tar，再在面板 `docker load -i xl.tar`
2. 创建容器：
   - 端口映射：`8788 → 8788`
   - 目录映射：`/www/xiaodata → /data`（数据持久化关键！）
   - 环境变量：`ADMIN_PASSWORD=你的密码`
   - 重启策略：`unless-stopped`

### B-2 终端一条命令（等效）

```bash
docker pull ghcr.io/<用户名>/<仓库名>:latest
docker run -d --name xiaolintv --restart unless-stopped \
  -p 8788:8788 \
  -e ADMIN_PASSWORD=你的密码 \
  -v /www/xiaodata:/data \
  ghcr.io/<用户名>/<仓库名>:latest
```

验证：`curl http://127.0.0.1:8788/api/health` 返回 `{"ok":true,...}`。

---

## 绑定域名 + HTTPS（反向代理）

1. 面板 → **网站** → **添加站点**：域名填 `tv.example.com`，纯静态，不要数据库不要 PHP
2. 进入该站点 → **反向代理** → 添加：
   - 目标 URL：`http://127.0.0.1:8788`
   - 发送域名：`$host`
3. 站点 → **SSL** → Let's Encrypt → 文件验证申请 → 开启「强制 HTTPS」
4. 完成：手机/APP 的 START_URL 使用 `https://tv.example.com/`

---

## 数据迁移（Cloudflare ↔ 宝塔互通）

1. Cloudflare 版后台 → 🗄️ 数据备份 → **⬇️ 导出备份(JSON)** 存好文件
2. 宝塔部署的新站后台（初始密码见环境变量）→ 🗄️ 数据备份 → 选择该 JSON →
   模式「合并」→ **⬆️ 恢复备份**
3. 全部设置/用户/历史/收藏/统计无缝到位

> 也可以跳过后台：直接把旧环境的 `kv.json` 上传到数据目录（如 `/www/xiaodata/kv.json`），重启服务生效。

---

## 升级更新

| 方式 | 操作 |
|---|---|
| Node 项目 | 上传覆盖 `_worker.js`、`public/`、`server/` → Node 项目列表点「重启」（数据在 data 目录不受影响） |
| Docker | `docker pull ...latest` → 删除旧容器 → 用同样参数重新 run（卷里数据保留）；或用面板「容器」→ 重建 |

## 常见问题

- **502 / 打不开**：先确认 `curl 127.0.0.1:8788/api/health` 正常；再检查反代目标端口是否 8788
- **微信内提示无法访问**：右上角 ⋯ 选「在浏览器打开」（正常现象）
- **恢复备份后源列表没立刻变化**：前台有缓存，后台随便保存一次设置即可刷新
- **忘记管理密码**：Node 方式改环境变量里的 ADMIN_PASSWORD 重启；Docker 方式重建容器时传入新值
