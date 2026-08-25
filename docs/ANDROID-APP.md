# 安卓 APP 自动打包说明

本项目自带一个轻量 Android 壳工程（`android/`），本质是全屏 WebView 装载你的线上站点，
配合 GitHub Actions（`.github/workflows/android.yml`）实现**每次 push 到 main 自动打出 APK**。

壳客户端已内置：
- 返回键 = 网页后退（适配 hash 路由 SPA），视频全屏中先退全屏
- 卡片 `target="_blank"` 链接留在 App 内打开（不弹外部浏览器）
- 播放页「⛶ 全屏」按钮可用（元素级视频全屏）
- 允许自动播放、localStorage 持久化（收藏/进度/主题）

## 一、首次配置（只需做一次）

1. 代码推到 GitHub 仓库。
2. 让 APK 知道你的网站地址（二选一）：
   - **推荐**：仓库页 → Settings → Secrets and variables → Actions → **Variables** 标签 →
     New repository variable：名称 `START_URL`，值填你的线上地址
     （如 `https://XIAOLIN-TV.xxx.workers.dev/`，末尾带 `/`）
   - 或直接改 `android/app/build.gradle` 里 `findProperty('startUrl') ?: '...'` 的默认值。
3. 不配置时 APK 会使用默认占位地址，打开后无法访问——记得配置。

## 二、每次更新如何出包

只要 push 到 `main` 分支（或手动在 Actions 页点 Run workflow）：

1. GitHub 会自动跑 `Android APK` 工作流（JDK17 + Android SDK + Gradle 8.7 构建）。
2. 跑完进入该次运行页面底部 **Artifacts** → 下载 `XIAOLIN-TV-debug-apk`。
3. 解压得到 `app-debug.apk`，传到手机安装即可（首次需允许"未知来源"安装）。

## 三、本地验证构建（可选）

本机装了 JDK 17 与 Android SDK 时：

```bash
gradle -p android assembleDebug -PstartUrl=https://你的域名/
# 产物在 android/app/build/outputs/apk/debug/app-debug.apk
```

## 四、常见调整

| 想改什么 | 改哪里 |
|---|---|
| App 名称 | `android/app/src/main/AndroidManifest.xml` 的 `android:label` |
| 版本号 | `android/app/build.gradle` 的 `versionName` / `versionCode` |
| 应用图标 | 覆盖 `app/src/main/res/mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher.png`（尺寸 48/72/96/144/192，或只放一张 512px 到 xxxhdpi），PNG 格式 |
| 正式签名包 | 在工作流中追加签名步骤（需 keystore），当前输出为 debug 签名可直接安装 |

> 图标已内置一套蓝紫渐变播放键占位图（`res/mipmap-*`），想换自己的 logo 直接用同名 PNG 覆盖即可，无需改任何配置。

## 五、其他可选方案（未采用，供参考）

- **PWA 加桌面**：给网页加 manifest + Service Worker，用户浏览器"添加到主屏幕"，无需 APK，但无独立图标推送等原生能力。
- **TWA/Bubblewrap**：Google 官方轻量封装，体积更小，但要求域名托管 `assetlinks.json` 做校验。
- **Capacitor/Flutter**：重量级方案，适合需要原生模块的场景。

当前 WebView 壳方案对"聚合站"最省事：前端照常迭代，APK 只是容器，无需随站点改动重新发版
（只有换启动地址或壳功能时才需要重新打包）。
