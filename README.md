# 🚀 晓林影视 xiaolinTV

基于 [hafrey1/LunaTV-config](https://github.com/hafrey1/LunaTV-config) 公开采集源配置的**影视聚合站 + 电视直播**，零构建、纯静态前端 + 单文件 Cloudflare Worker 后端，持久化存储基于 **Cloudflare D1 关系型数据库 (dianying) + KV (dianying_KV) 双轨容灾**，可一键部署到 **Cloudflare Workers** 或 **Cloudflare Pages**。

## ✨ 功能

| 功能 | 说明 |
|---|---|
| 🎬 影视聚合 | 首页分类推荐 (每类固定 14 个，不足自动补充；网格对齐无横向滚动)、分类筛选 (年份)、详情页、HLS 播放器、自动连播、观看进度记忆、收藏 |
| 🔍 聚合搜索 | 全部采集源并行搜索 (12 路并发)，**逐源渐进式渲染**，多源去重合并；结果卡片**新标签页打开**，返回不丢搜索 |
| 🧭 影视源导航 | 导航栏「影视源」列出全部可用源，每个源可**单独搜索**或浏览最新影片 |
| ⇄ 换源播放 | 同一部片自动寻找其他采集源 (新标签页打开)，单源失效也能看 |
| 📺 电视直播 | 内置 iptv-org / fanmingming 公开直播源，频道分组、收藏、记忆上次频道，后台可自定义直播源地址 |
| 🔗 相关推荐 | 播放页按片名关键词推荐最多 **28** 部相关影片 |
| 🎨 6 套配色 | 暗夜蓝 / 翡翠绿 / 落日橙 / 樱花粉 / 海洋青 / 鎏金紫，右上角调色板随时切换，后台可设默认主题 |
| ⚙️ 后台管理 | 密码登录 (HMAC 会话)；**后台可直接修改管理密码** (旧会话自动失效)；**影视源可视化管理** (添加/删除自定义源、停用内置源、自定义采集配置地址/JSON)；成人内容总开关仅后台可控 (前台不显示任何开关) |
| 👥 用户系统 | 强制登录观看 (可关闭)、前台注册/登录、个人中心 (观看记录+收藏夹，可自行删除=软删)、**管理端可查每个用户的搜索/观看记录·时间·登录IP**，并可彻底删除 (硬删)；基于 D1 SQL 数据库存储 |
| 🗄️ 双轨存储 | **Cloudflare D1 (`dianying`) 关系型数据库主存储** + **Cloudflare KV (`dianying_KV`) 同步双写容灾**，内置热迁移与自动建表机制 |
| 🚀 双端部署 | 同一份代码支持 Workers (Static Assets) 与 Pages (高级模式 `_worker.js`) |

## 📁 目录结构

```
├── _worker.js            # 后端(API代理/源配置/D1+KV双轨存储/管理员鉴权) — 唯一后端文件
├── schema.sql            # Cloudflare D1 数据库建表结构 (支持自动建表)
├── wrangler.toml         # Workers 部署配置 (配置 D1 dianying 与 KV dianying_KV)
├── package.json          # npm 脚本(wrangler)
├── 部署指南.md            # 详尽的部署图文说明与常见排错指南
├── scripts/build-pages.mjs # 打包 Pages 上传目录 dist/
└── public/               # 前端(纯原生 HTML/CSS/JS，无需构建)
    ├── index.html
    ├── favicon.svg
    ├── css/themes.css    # 6 套配色主题(CSS 变量)
    ├── css/app.css       # 主样式
    └── js/{api,player,app,tv}.js
```

## 🚀 极简部署指南

**👉 详细图文步骤、Dashboard 手动上传、常见问题，全部在 [部署指南.md](./部署指南.md)**

### 命令行极简 3 步部署:

```bash
# 1. 创建 D1 数据库与 KV 空间 (记录命令输出的 database_id 和 namespace id)
npx wrangler d1 create dianying
npx wrangler kv namespace create dianying_KV

# 2. 将得到的两个 ID 填入 wrangler.toml 对应的 database_id 和 id 处

# 3. 部署上线
npm run deploy
```

本地预览命令：
```bash
npm install && npm run dev     # 本地预览 http://127.0.0.1:8787
```

## ⚙️ 后台使用

导航栏不显示后台入口；请直接访问 `https://你的域名/#/xiaolin1991` (本地为 http://127.0.0.1:8787/#/xiaolin1991)：

- **默认管理入口**：`/#/xiaolin1991`（原 `/#/admin` 已默认隐蔽化防扫描，访问旧路径对外显示「页面不存在」；可在后台「安全中心」随时自定义其他路径）
- **初始密码**：`admin123` (登录后可直接在后台「修改管理密码」修改，无需进 Cloudflare)
- **存储状态**：后台顶栏显示 **🟢 D1+KV 双轨存储** 或 **🟢 D1 数据库**，修改后自动保存在 SQL 数据库中，全球边缘节点秒级同步
- **新用户特权赠送**：后台「用户管理」可自定义新会员注册自动赠送私密福利影片 0~3 个月，注册成功自动触发专属欢迎与使用指引站内信
- **多端 App 分发与强制更新**：后台「APP推广」支持独立配置 Android、TV 电视盒子以及苹果 iPhone 端下载/安装地址；支持开启「强制更新」，客户端将弹出不可跳过的阻断式弹窗并自动暂停播放
- **移动端底部导航与老设备兼容**：手机端内置底部 5 项快捷导航（首页、影视、私密福利/电视直播智能切换、站内消息带未读红点、个人中心），全面适配 iPhone XR (iOS 13.6) 等老旧设备的 SVG 居中与安全区避让
- **影视源管理**：后台可添加自定义采集源 (填苹果CMS `api.php/provide/vod` 接口地址)、删除、停用内置源，保存后立即生效
- **成人内容开关**：仅后台可见可控；关闭 = 服务端剔除所有成人源，前台不显示任何开关
- **直播源**：每行一个 m3u 地址，保存后约 30 分钟内刷新缓存

## ❓ 常见问题

- **首页没数据 / 搜索全失败**：个别采集站在部分地区失效属正常，站点已内置多源容错；可在 Worker 日志查看 `/api/proxy` 返回。
- **某集播放黑屏**：采集源链接失效，试试"换源"或换一集。
- **直播卡顿**：公开 IPTV 源可用性波动大，可在后台换成自建/更稳定的 m3u 地址。
- **想加自己的采集源**：直接进后台「影视源管理」→「＋ 添加影视源」，填名称和接口地址保存即可；也可编辑 `_worker.js` 顶部 `DEFAULT_CONFIG_URL` 或补充 `FALLBACK_SOURCES`。

## 📱 原生 App 构建 (GitHub Actions)

本仓库内置原生壳构建，均通过 GitHub Actions 手动触发，安卓 + iOS 打包完成后合并发布**单个 Release**（并自动清理历史旧版本）：

| 产物 | 构建 Job | 说明 |
|---|---|---|
| Android APK | `build-apk` (`android/`) | 原生 WebView 壳，全屏时经 JS 桥 `AndroidBridge.setOrientation('landscape')` 强制横屏 + 沉浸式，**系统锁屏也能横屏铺满** |
| iPhone/iPad 免签 IPA | `build-ipa` (`ios/`) | 原生 WKWebView 壳，macos runner 免签构建；TrollStore / AltStore / Sideloadly 安装 |
| iPad 专用免签 IPA | `build-ipa` | 同一构建产出仅 iPad 家族的专用包 |
| 统一发布 | `publish-release` | 汇总 APK + IPA 到单个 Release，自动删除旧 Release |

- 工作流文件：`.github/workflows/android.yml`（已整合安卓 + iOS + Docker + 统一发布）
- App 名称：晓林影视；图标统一由 CI 从 `public/icons/icon-512.png` 自动生成
- 站点地址：仓库 Settings → Variables → `START_URL`（构建时注入）
- 触发方式：Actions 页面 → Run workflow → 输入 `yes` 确认
- 后台自动同步：后台「APP推广」→「🛰️ 自动获取最新 APP」一键读取私有仓最新 Release，同步版本号 + 把安装包代理到站内 `/APP/`（访客无需 GitHub 权限），iOS/iPad 下载地址自动填写且可改自定义（需 Worker 机密 `GITHUB_TOKEN`）
- iOS 全屏修复：iPhone/iPad 走系统原生视频全屏（`webkitEnterFullscreen`），**锁屏状态下也能横屏铺满**，点「完成」即回到原竖屏页面
- PakePlus 方案可弃用：其 WebView 壳无法在全屏时强制横屏，原生壳从根本上解决

## ⚖️ 免责声明

本项目仅为个人学习用的影视信息聚合导航，不存储、不上传、不生产任何视频内容，全部数据来自互联网公开采集接口与公开 IPTV 列表。请遵守所在地区法律法规，勿用于商业用途。
