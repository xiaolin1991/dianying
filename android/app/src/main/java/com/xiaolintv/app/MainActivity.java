package com.xiaolintv.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.UiModeManager;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * 晓林影视 安卓壳客户端 (全面兼容手机端与各类国产智能电视/机顶盒 TV 端)
 * - 全屏 WebView 装载线上站点(地址来自 BuildConfig.START_URL)
 * - 针对机顶盒网络协议优化: 允许 HTTPS/HTTP 混合内容(MIXED_CONTENT_ALWAYS_ALLOW)、兼容老机顶盒 SSL 根证书、开启 Cookie 持久化
 * - TV 专版 APK (BuildConfig.IS_TV_APK) 或电视硬件自动锁定横屏并注入 XIAOLIN-TV-OS 标识
 * - 返回键 = 优先收起 TV 浮层/软键盘，再退全屏或网页后退(hash 路由)
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
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);          // 允许自动连播
        // 关键修复: 机顶盒与采集源大量海报/视频流为 http 协议，必须开启 MIXED_CONTENT_ALWAYS_ALLOW 避免被 HTTPS 页面拦截
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setSupportMultipleWindows(false);

        try {
            CookieManager cm = CookieManager.getInstance();
            cm.setAcceptCookie(true);
            cm.setAcceptThirdPartyCookies(web, true);
        } catch (Exception ignored) {}

        String uaSuffix = " XIAOLIN-TV-APP/"
                + BuildConfig.VERSION_NAME
                + "/"
                + BuildConfig.VERSION_CODE
                + (isTvDevice ? " XIAOLIN-TV-OS/1" : "");
        s.setUserAgentString(s.getUserAgentString() + uaSuffix);

        web.addJavascriptInterface(new Object() {
            @JavascriptInterface
            public boolean isTv() {
                return isTvDevice;
            }

            @JavascriptInterface
            public void setOrientation(String mode) {
                runOnUiThread(() -> {
                    try {
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

            @SuppressLint("WebViewClientOnReceivedSslError")
            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                // 关键修复: 机顶盒系统内置 CA 根证书往往较老，遇到 Cloudflare / Let's Encrypt 新证书会报错白屏，直接放行
                if (handler != null) {
                    handler.proceed();
                }
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
        if (customView != null) {
            hideCustomView();
            return;
        }
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
            try { CookieManager.getInstance().flush(); } catch (Exception ignored) {}
            web.loadUrl("about:blank");
            web.destroy();
        }
        super.onDestroy();
    }
}
