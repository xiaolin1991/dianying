# 星河影视 NebulaTV 🌌

基于 [hafrey1/LunaTV-config](https://github.com/hafrey1/LunaTV-config) 公开采集源配置的**影视聚合站 + 电视直播**,零构建、纯静态前端 + 单文件 Cloudflare Worker 后端,可一键部署到 **Cloudflare Workers** 或 **Cloudflare Pages**。

## ✨ 功能

| 功能 | 说明 |
|---|---|
| 🎬 影视聚合 | 首页分类推荐(电影/剧集/综艺/动漫)、分类筛选(年份)、详情页、HLS 播放器、自动连播、观看进度记忆、收藏 |
| 🔍 聚合搜索 | 并行搜索全部采集源,多源去重合并,显示"N 个源" |
| ⇄ 换源播放 | 同一部片自动寻找其他采集源,单源失效也能看 |
| 📺 电视直播 | 内置 iptv-org / fanmingming 公开直播源,频道分组、收藏、记忆上次频道,后台可自定义直播源地址 |
| 🎨 6 套配色 | 暗夜蓝 / 翡翠绿 / 落日橙 / 樱花粉 / 海洋青 / 鎏金紫,右上角调色板随时切换,后台可设默认主题 |
| ⚙️ 后台管理 | 密码登录(HMAC 会话);**成人内容总开关**(关闭时服务器直接剔除 🔞 采集源,前端无法绕过);站点名称/公告/默认主题;直播源管理 |
| 🚀 双端部署 | 同一份代码支持 Workers(Static Assets)与 Pages(高级模式 `_worker.js`) |

## 📁 目录结构

```
├── _worker.js            # 后端(API代理/源配置/设置KV/管理员鉴权) — 唯一后端文件
├── wrangler.toml         # Workers 部署配置
├── package.json          # npm 脚本(wrangler)
├── scripts/build-pages.mjs # 打包 Pages 上传目录 dist/
└── public/               # 前端(纯原生 HTML/CSS/JS, 无需构建)
    ├── index.html
    ├── favicon.svg
    ├── css/themes.css    # 6 套配色主题(CSS 变量)
    ├── css/app.css       # 主样式
    └── js/{api,player,app}.js
```

## 🚀 双端部署(Workers / Pages)

**👉 详细图文步骤、Dashboard 手动上传、常见问题,全部在 [部署指南.md](./部署指南.md)**

快速命令:

```bash
npm install && npm run dev     # 本地预览 http://127.0.0.1:8787
npm run deploy                 # 部署到 Cloudflare Workers
npm run deploy:pages           # 或部署到 Cloudflare Pages(最简单)
```

## ⚙️ 后台使用

导航栏不显示后台入口;请直接访问 `https://你的域名/#/admin`(本地为 http://127.0.0.1:8787/#/admin):

- 初始密码 `admin123`(务必通过环境变量 `ADMIN_PASSWORD` 修改)
- **成人内容开关**:关闭 = 服务端剔除所有 🔞 源,接口层不可达;开启后普通访客也可在前台用"🔞"按钮自行隐藏
- 直播源:每行一个 m3u 地址,保存后约 30 分钟内刷新缓存
- 未绑定 KV 时设置保存在实例内存,重部署会恢复默认(页面顶部有黄标提示)

## ❓常见问题

- **首页没数据 / 搜索全失败**:个别采集站在部分地区失效属正常,站点已内置多源容错;可在 Worker 日志查看 `/api/proxy` 返回。
- **某集播放黑屏**:采集源链接失效,试试"换源"或换一集。
- **直播卡顿**:公开 IPTV 源可用性波动大,可在后台换成自建/更稳定的 m3u 地址。
- **想加自己的采集源**:编辑 `_worker.js` 顶部 `DEFAULT_CONFIG_URL` 指向同格式的 JSON 配置,或直接补充 `FALLBACK_SOURCES`。

## ⚖️ 免责声明

本项目仅为个人学习用的影视信息聚合导航,不存储、不上传、不生产任何视频内容,全部数据来自互联网公开采集接口与公开 IPTV 列表。请遵守所在地区法律法规,勿用于商业用途。
