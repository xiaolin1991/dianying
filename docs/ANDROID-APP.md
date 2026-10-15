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


### 📺 手机版 APK 与 TV 电视专用版 APK 双包独立构建说明
- **手机版 (`xiaolintv-phone-latest.apk`)**：编译参数 `-PisTvApk=false`，专为安卓手机/平板触控设计，保留完整手机底部导航、手势调光调音与竖屏浏览。
- **电视/盒子版 (`xiaolintv-tv-latest.apk`)**：编译参数 `-PisTvApk=true`，内置 `BuildConfig.IS_TV_APK = true` 与 `XIAOLIN-TV-OS/1` 专属标识，**开机强制锁定横屏**（即使国产电视盒伪造了触摸屏属性也 100% 启用腾讯TV极光大屏 UI），遥控器返回键优先收起选集浮层与软键盘。
- **电脑浏览器调试 TV 版**：直接点击网页顶栏右上角 **「📺 TV版」** 按钮，或在网址后加 **`?tv=1`** 开启预览；点击底部 **「📺 退出TV模式」** 或加 **`?tv=0`** 即可切回电脑/手机模式。

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

## 二、每次更新如何出包（安全确认机制）

为了保证 APK 产物质量，避免在网页端尚未验证或存在错误时发布故障包，工作流已优化为**「先验证网页，后确认构建」**机制：

1. **第一步：推送代码与网页验证**
   - 推送代码到 `main` 分支后，Cloudflare 或 VPS 会先行完成网页部署。
   - 打开网站，测试浏览、换源、播放、搜索等核心体验，确认新版本一切正常。

2. **第二步：确认执行 APK 构建（四种任选其一）**
   - **方式 A（后台一键触发 · 最便捷）**：进入「管理中心」→「App 版本更新」，在「📦 自动构建 APK 控制」卡片点击 **「🚀 确认网页正常，立即触发构建 APK」** 按钮。
   - **方式 B（GitHub Actions 页面手动点击）**：前往 GitHub 仓库的 **Actions → Build & Publish (APK + Docker)**，点击右上角 **Run workflow**，确认输入 `yes` 点击执行。
   - **方式 C（版本标签触发）**：确认网页版本无误后，在终端打 tag 并推送：`git tag v1.0.77 && git push origin v1.0.77`。
   - **方式 D（提交信息触发）**：若对本次提交十分自信，可在提交说明包含 `[build-apk]` 标签（例如 `git commit -m "feat: release verified [build-apk]"`）。

| 任务 | 产物 |
|------|------|
| **Build APK** | `public/APP`、GitHub Release、`publish/app` |
| **Build Docker** | `ghcr.io/<你的仓库>:latest` 与 `v1.0.<构建号>` |

流程细节：

1. 构建 Debug APK，版本号 `1.0.<构建编号>` / `versionCode=<构建编号>`。
2. 写入 `public/APP/`（`*-latest.apk` + 版本号包 + `manifest.json`）。
3. **更新说明**自动取「距上一版」的提交摘要（或手动触发时填写的更新日志），写入 manifest。
4. 推到备份分支 `publish/app`，并**同步回 `main` 的 `public/APP`**。
5. 若配置了 `SITE_URL` + `ADMIN_PASSWORD`：额外把版本写入后台 KV。
6. 若配置了 `CF_DEPLOY_HOOK`：额外触发 Cloudflare 重新部署（让线上静态资源带上最新 APK）。

**串联关系：**

```
你推 main → 网页自动部署 → 浏览测试确认无误 → 触发构建 APK
                                                  ↓
                               Actions 打包 → publish/app + main/public/APP + GHCR 镜像
                                                  ↓
                               Cloudflare 重新部署 / 网站自动同步
                                                  ↓
                               /APP/manifest.json + latest.apk
                                                  ↓
                               后台「自动识别」+ 用户下载
```

> Desktop 若提示远程有更新：先「拉取」再推（CI 回写 APK 到 main 时偶尔发生），或运行 `.\scripts\git-push.ps1`。

自托管 Node 还可开启定时从 `publish/app` 同步（`AUTO_SYNC_APP=1`，默认开）。后台也可点「立即从 publish/app 同步 APK」。

### publish/app 分支红叉 /「领先又落后 main」？

**不用合并。** `publish/app` 故意只装 APK。Cloudflare 红叉：把构建分支限制为仅 `main`。

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
