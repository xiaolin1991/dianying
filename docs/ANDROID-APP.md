# 安卓 APP 自动打包说明

本项目自带一个轻量 Android 壳工程（`android/`），本质是全屏 WebView 装载你的线上站点，
配合 GitHub Actions（`.github/workflows/android.yml`）实现**每次 push 到 main 自动打出 APK**，
并发布到站点目录 **`public/APP/`**，国内用户走你自己的域名直链下载（无需蓝奏云 / 无需翻墙下 GitHub）。

壳客户端已内置：
- 返回键 = 网页后退（适配 hash 路由 SPA），视频全屏中先退全屏
- 卡片 `target="_blank"` 链接留在 App 内打开（不弹外部浏览器）
- 播放页「⛶ 全屏」按钮可用（元素级视频全屏）
- 允许自动播放、localStorage 持久化（收藏/进度/主题）
- UA 携带 `XIAOLIN-TV-APP/<versionName>/<versionCode>`，配合后台做应用内更新

## 一、首次配置（只需做一次）

1. 代码推到 GitHub 仓库。
2. 让 APK 知道你的网站地址：
   - 仓库 → Settings → Secrets and variables → Actions → **Variables**
   - New repository variable：名称 `START_URL`，值填线上地址（如 `https://tv.example.com/`，末尾带 `/`）
3. （推荐）自动同步 App **版本号**：
   - 同一页 → **Secrets** → 新建：
     - `SITE_URL`：站点根地址，如 `https://tv.example.com`（无尾斜杠也可）
     - `ADMIN_PASSWORD`：与线上后台管理密码一致
   - 后台「APP推广」默认 **固定最新包**（`/APP/xiaolintv-phone-latest.apk`），CI 只覆盖文件并更新 versionCode，**不必再改下载链接**。
   - 若要用蓝奏云等外链：后台切到「自定义」再填地址。TV 包未上线时保持「关闭」。
4. 不配 Secrets 时：APK 仍会写入仓库 `public/APP/`；手机下载在固定模式下部署后即可用。

## 二、每次更新如何出包

只要 push 到 `main`（或 Actions 页手动 Run workflow）：

1. 构建 Debug APK，版本号 `1.0.<构建编号>` / `versionCode=<构建编号>`。
2. 脚本 [`scripts/publish-apk.mjs`](../scripts/publish-apk.mjs) 写入工作区 `public/APP/`（latest + 版本号包 + manifest）。
3. Actions 把 `public/APP` **强制推送到分支 `publish/app`**（**不改 main**，避免和你本地推送冲突）。
4. 服务器执行 `bash scripts/sync-app-branch.sh` 同步 APK 到线上 `public/APP`。
5. 若已配置 `SITE_URL` + `ADMIN_PASSWORD`：自动更新后台版本号字段（下载链接由「固定最新包」决定）。
6. GitHub Releases / Artifacts 仍会上传，仅作备份。

## 版本更新如何自动弹窗

1. CI 打包后写入 `public/APP/manifest.json`（含 `versionCode` / `versionName` / `changelog`）。
2. 站点 `/api/settings` **默认自动读取**该文件作为最新版本（后台「App 版本更新」保持「自动识别」即可）。
3. 官方 App 对比本地 versionCode，更低则弹「立即更新」，下载走固定 `/APP/xiaolintv-phone-latest.apk`。
4. 可选：配置 `SITE_URL` + `ADMIN_PASSWORD` 时，CI 还会把版本写入后台 KV（双保险）；不配也能靠 manifest 生效。
5. 仅当需要临时关掉自动、手填版本时，后台切到「手动填写」。

## 三、本地手动发布（可选）

本机已打出 APK 时：

```bash
# 可选：同步后台
# set SITE_URL=https://你的域名
# set ADMIN_PASSWORD=你的后台密码

node scripts/publish-apk.mjs --apk android/app/build/outputs/apk/debug/app-debug.apk --code 62 --name 1.0.62
```

本地构建示例：

```bash
gradle -p android assembleDebug -PstartUrl=https://你的域名/ -PverCode=62 -PverName=1.0.62
# 产物在 android/app/build/outputs/apk/debug/app-debug.apk
```

## 四、常见调整

| 想改什么 | 改哪里 |
|---|---|
| App 名称 | `android/app/src/main/AndroidManifest.xml` 的 `android:label` |
| 版本号 | CI 用 `github.run_number`；本地用 `-PverCode` / `-PverName` |
| 应用图标 | 覆盖 `app/src/main/res/mipmap-*/ic_launcher.png` |
| 正式签名包 | 在工作流中追加签名步骤（需 keystore），当前为 debug 签名可直接安装 |
| 下载直链 | 固定 `/APP/*-latest.apk`；CI 发布会覆盖文件内容 |

> 图标已内置一套蓝紫渐变播放键占位图（`res/mipmap-*`），想换自己的 logo 直接用同名 PNG 覆盖即可。

## 五、其他可选方案（未采用，供参考）

- **PWA 加桌面**：manifest + Service Worker，无需 APK。
- **TWA/Bubblewrap**：需域名 `assetlinks.json`。
- **Capacitor/Flutter**：重量级，适合要大量原生模块时。

当前 WebView 壳对聚合站最省事：前端照常迭代，APK 只是容器；换启动地址或壳功能时才需要重新打包。
