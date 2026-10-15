package com.xiaolintv.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.UiModeManager;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * 晓林影视 安卓壳客户端 (兼容手机端与智能电视/盒子 TV 端)
 * - 全屏 WebView 装载线上站点(地址来自 BuildConfig.START_URL)
 * - TV 专版 APK (BuildConfig.IS_TV_APK) 或电视硬件自动锁定横屏并注入 XIAOLIN-TV-OS 标识
 * - 返回键 = 优先收起 TV 浮层/软键盘，再退全屏或网页后退(hash 路由)
 * - target=_blank 链接留在 App 内打开
 * - 支持视频元素级全屏(播放页 ⛶ 按钮)
 */
public class MainActivity extends Activity {

    private WebView web;
    private View customView;                       // 视频全屏时的自定义视图
    private WebChromeClient.CustomViewCallback customCb;
    private boolean isTvDevice = false;

    private boolean detectTvEnvironment() {
        if (BuildConfig.IS_TV_APK) return true;
        try {
            UiModeManager uiModeManager = (UiModeManager) getSystemService(UI_MODE_SERVICE);
            if (uiModeManager != null && uiModeManager.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION) {
                return true;
            }
            PackageManager pm = getPackageManager();
            if (pm != null) {
                if (pm.hasSystemFeature(PackageManager.FEATURE_LEANBACK)
                        || pm.hasSystemFeature("android.hardware.type.television")
                        || !pm.hasSystemFeature(PackageManager.FEATURE_TOUCHSCREEN)) {
                    return true;
                }
            }
        } catch (Exception ignored) {}
        return false;
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);

        isTvDevice = detectTvEnvironment();
        if (isTvDevice) {
            try {
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
            } catch (Exception ignored) {}
        }

        web = new WebView(this);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);                          // localStorage: 收藏/进度/主题
        s.setMediaPlaybackRequiresUserGesture(false);          // 允许自动连播
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        // 卡片是 target=_blank: 关闭多窗口后, 新窗口导航会落到当前 WebView, 不弹出外部浏览器
        s.setSupportMultipleWindows(false);
        // 专属 UA: 网站识别官方 App, 并读取版本做更新检查
        // 格式: XIAOLIN-TV-APP/<versionName>/<versionCode> (TV版额外附加 XIAOLIN-TV-OS/1)
        String uaSuffix = " XIAOLIN-TV-APP/"
                + BuildConfig.VERSION_NAME
                + "/"
                + BuildConfig.VERSION_CODE
                + (isTvDevice ? " XIAOLIN-TV-OS/1" : "");
        s.setUserAgentString(s.getUserAgentString() + uaSuffix);

        // 注册 JS 桥梁: 供网页播放器在全屏时通知 App 强制横屏/恢复竖屏 + 查询 TV 硬件态
        web.addJavascriptInterface(new Object() {
            @JavascriptInterface
            public boolean isTv() {
                return isTvDevice;
            }

            @JavascriptInterface
            public void setOrientation(String mode) {
                runOnUiThread(() -> {
                    try {
                        // TV 模式下始终保持横屏，忽略网页端的竖屏恢复请求
                        if (isTvDevice) {
                            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
                            return;
                        }
                        if ("landscape".equalsIgnoreCase(mode)) {
                            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);
                            try {
                                getWindow().getDecorView().setSystemUiVisibility(
                                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                                    | View.SYSTEM_UI_FLAG_FULLSCREEN
                                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                                    | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                                );
                            } catch (Exception ignored) {}
                        } else if ("portrait".equalsIgnoreCase(mode)) {
                            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
                            try {
                                getWindow().getDecorView().setSystemUiVisibility(
                                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                                    | View.SYSTEM_UI_FLAG_VISIBLE
                                );
                            } catch (Exception ignored) {}
                        } else {
                            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
                            try {
                                getWindow().getDecorView().setSystemUiVisibility(
                                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                                    | View.SYSTEM_UI_FLAG_VISIBLE
                                );
                            } catch (Exception ignored) {}
                        }
                    } catch (Exception ignored) {}
                });
            }
        }, "AndroidBridge");

        web.setWebViewClient(new WebViewClient() {
            private boolean openExternal(String url) {
                if (url == null) return false;
                String u = url.toLowerCase();
                // APK / 应用市场链接 → 系统下载或安装器(应用内更新)
                if (u.contains(".apk") || u.startsWith("market:") || u.startsWith("intent:")) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                        return true;
                    } catch (Exception e) {
                        return false;
                    }
                }
                return false;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (openExternal(url)) return true;
                return false;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (request != null && request.getUrl() != null) {
                    if (openExternal(request.getUrl().toString())) return true;
                }
                return false;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (customView != null) { callback.onCustomViewHidden(); return; }
                customView = view;
                customCb = callback;
                try {
                    setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);
                } catch (Exception ignored) {}
                web.setVisibility(View.GONE);
                ViewGroup decor = (ViewGroup) getWindow().getDecorView();
                decor.addView(customView, new ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            }

            @Override
            public void onHideCustomView() {
                hideCustomView();
            }
        });

        String startUrl = BuildConfig.START_URL;
        if (isTvDevice && startUrl != null && !startUrl.contains("tv=")) {
            startUrl = startUrl + (startUrl.contains("?") ? "&tv=1" : "?tv=1");
        }
        web.loadUrl(startUrl);
    }

    private void hideCustomView() {
        if (customView == null) return;
        try {
            setRequestedOrientation(isTvDevice
                    ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                    : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        } catch (Exception ignored) {}
        ViewGroup decor = (ViewGroup) getWindow().getDecorView();
        decor.removeView(customView);
        customView = null;
        if (customCb != null) {
            customCb.onCustomViewHidden();
            customCb = null;
        }
        web.setVisibility(View.VISIBLE);
    }

    @Override
    public void onBackPressed() {
        if (customView != null) {           // 系统视频全屏中: 先退全屏
            hideCustomView();
            return;
        }
        // 优先通知网页层处理返回键(TV 选集浮层收起 / 软键盘关闭 / 网页假全屏退出)
        if (web != null) {
            web.evaluateJavascript(
                    "(function(){try{if(window.__xlTvBack&&window.__xlTvBack())return 2;if(window.__ntvExitFs&&window.__ntvExitFs())return 1;return 0;}catch(e){return 0;}})()",
                    value -> {
                        if ("2".equals(value) || "\"2\"".equals(value)) {
                            return;
                        }
                        if ("1".equals(value) || "\"1\"".equals(value)) {
                            runOnUiThread(() -> {
                                try {
                                    if (!isTvDevice) {
                                        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
                                        getWindow().getDecorView().setSystemUiVisibility(
                                            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                                            | View.SYSTEM_UI_FLAG_VISIBLE
                                        );
                                    }
                                } catch (Exception ignored) {}
                            });
                            return;
                        }
                        runOnUiThread(() -> {
                            if (web.canGoBack()) web.goBack();
                            else MainActivity.super.onBackPressed();
                        });
                    });
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.loadUrl("about:blank");
            web.destroy();
        }
        super.onDestroy();
    }
}
