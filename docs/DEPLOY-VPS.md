# 晓林影视 XIAOLIN-TV — VPS / Docker 自托管部署指南

> 🎛️ **使用宝塔面板？请直接看专属教程：[docs/DEPLOY-BT.md](./DEPLOY-BT.md)**（Node 项目 / Docker / 反代+HTTPS 全图形化操作）

本系统支持三种运行方式，数据可在它们之间**无缝互迁**：

| 运行方式 | 适合 | 数据存储 |
|---|---|---|
| Cloudflare Workers | 免运维、全球加速 | 云端 KV |
| **Docker（推荐）** | 有 VPS/NAS/群晖 | 宿主机挂载卷 `kv.json` |
| 裸机 Node | 无 Docker 的服务器 | 数据目录 `kv.json` |

> 自托管与 Cloudflare 版是**同一套业务代码**，功能完全一致；
> KV 以 JSON 文件落地，备份/搬家 = 复制一个文件 或 后台导出导入 JSON。

---

## 一、Docker 部署（推荐，3 条命令）

镜像由 GitHub 自动构建发布到 GHCR：

```bash
# 1. 拉取镜像(每次 push 仓库自动更新 latest)
docker pull ghcr.io/<你的GitHub用户名>/<仓库名>:latest

# 2. 运行(数据持久化到宿主机 /opt/xiaolintv)
docker run -d \
  --name xiaolintv \
  --restart unless-stopped \
  -p 8788:8788 \
  -e ADMIN_PASSWORD=你的管理密码 \
  -v /opt/xiaolintv:/data \
  ghcr.io/<你的GitHub用户名>/<仓库名>:latest

# 3. 验证
curl http://127.0.0.1:8788/api/health
```

浏览器打开 `http://服务器IP:8788` 即可使用；后台 `#/admin` 初始密码为
`ADMIN_PASSWORD` 环境变量（未设置时 admin123，请务必修改）。

### 常用运维

```bash
# 更新版本(数据在卷里, 不丢失)
docker pull ghcr.io/<用户名>/<仓库>:latest && docker rm -f xiaolintv && 重新执行上面 run

# 直接备份数据(等价于后台导出)
cp /opt/xiaolintv/kv.json kv-backup-$(date +%F).json

# 查看日志
docker logs -f xiaolintv
```

### HTTPS（强烈建议）

视频站建议套一层反向代理签证书，以 Caddy 为例（自动 HTTPS）：

```
tv.example.com {
    reverse_proxy 127.0.0.1:8788
}
```

或 Nginx：`proxy_pass http://127.0.0.1:8788;` 并加 ssl 证书配置。

---

## 二、裸机 Node 部署（无 Docker 时）

要求 Node.js ≥ 20（无需 npm install，零依赖）：

```bash
git clone https://github.com/<你>/<仓库名>.git xiaolintv
cd xiaolintv
ADMIN_PASSWORD=你的密码 PORT=8788 node server/node-server.mjs
```

### systemd 开机自启

`/etc/systemd/system/xiaolintv.service`：

```ini
[Unit]
Description=XiaoLin TV
After=network.target

[Service]
WorkingDirectory=/root/xiaolintv
ExecStart=/usr/bin/node server/node-server.mjs
Environment=PORT=8788
Environment=ADMIN_PASSWORD=你的密码
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload && systemctl enable --now xiaolintv
```

---

## 三、数据迁移：Cloudflare ↔ VPS/Docker

两边的后台都内置「🗄️ 数据备份 / 迁移」，JSON 双向互通。

### CF → VPS/Docker（搬去自己服务器）

1. Cloudflare 版后台 → 🗄️ 数据备份 → **⬇️ 导出备份(JSON)**
2. 按 above 方式部署好自托管版并打开后台
3. 后台 → 🗄️ 数据备份 → 选择该文件 → 模式选「合并」→ **⬆️ 恢复备份**
4. 完成：设置/用户/历史/收藏/统计 全部到位

### VPS/Docker → CF（搬回或双跑）

自托管后台导出 → Cloudflare 版后台恢复，步骤同上。
（注意：Workers KV 单值上限约 25MB，正常业务远达不到）

### 文件级直拷（仅 Docker↔裸机之间）

直接复制 `data/kv.json`（容器内 `/data/kv.json`）到新机器同位置，重启服务即可。

---

## 四、环境变量一览

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | 8788 | 监听端口 |
| `DATA_DIR` | `./data`（容器内 `/data`） | kv.json 数据目录 |
| `ADMIN_PASSWORD` | admin123 | 初始管理密码 |
| `ADULT_ENABLED` | false | 成人内容全局初始开关 |

## 五、常见问题

- **恢复备份后源列表没变？** 前台有 2h 缓存，后台「保存设置」会即时刷新；或等待缓存过期。
- **想改端口？** `-p 其他端口:8788` 或 `PORT=` 环境变量。
- **升级会丢数据吗？** 不会。业务代码与数据分离（`/data` 卷），任意升级/回滚都保留。
