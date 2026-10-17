package com.xiaolintv.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.UiModeManager;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;
import android.view.KeyEvent;
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
import android.widget.Toast;

/**
 * 晓林影视 安卓壳客户端 (全面兼容手机端与各类国产智能电视/机顶盒 TV 端)
 * - 全屏 WebView 装载线上站点(地址来自 BuildConfig.START_URL)
 * - 针对机顶盒网络协议优化: 允许 HTTPS/HTTP 混合内容(MIXED_CONTENT_ALWAYS_ALLOW)、兼容老机顶盒 SSL 根证书、开启 Cookie 持久化
 * - 消除 Android WebView 默认白底黑色大播放图标 (重写 getDefaultVideoPoster 返回 1x1 透明像素)
 * - 原生防卡死返回键守护: 任意时刻连续按 3 次返回键(或长按返回键)直接在系统层强制退出 App；在首页按返回键直接退出，不再被 web.goBack() 死循环卡住
 */
public class MainActivity extends Activity {

    private WebView web;
    private View customView;                       // 视频全屏时的自定义视图
    private WebChromeClient.CustomViewCallback customCb;
    private boolean isTvDevice = false;

    // 连续按返回键防卡死计数器 (3次返回键强制退出App)
    private long lastBackKeyTs = 0;
    private int rapidBackCount = 0;
    private long lastExitToastTs = 0;

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

    private void forceCloseApp() {
        runOnUiThread(() -> {
            try {
                if (web != null) {
                    web.loadUrl("about:blank");
                    web.destroy();
                    web = null;
                }
            } catch (Exception ignored) {}
            try {
                finishAffinity();
            } catch (Exception e) {
                finish();
            }
            System.exit(0);
        });
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
        web.setBackgroundColor(Color.parseColor("#060a14"));
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);                          // localStorage: 收藏/进度/主题
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);          // 允许自动连播与直接起播
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
            public void exitApp() {
                forceCloseApp();
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
                if (handler != null) {
                    handler.proceed();
                }
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            // 彻底消除图一中 Android WebView 默认的白底黑色大播放按钮图标
            @Override
            public Bitmap getDefaultVideoPoster() {
                try {
                    return Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
                } catch (Exception e) {
                    return super.getDefaultVideoPoster();
                }
            }

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
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event != null && event.getKeyCode() == KeyEvent.KEYCODE_BACK) {
            // 长按遥控器返回键直接强制退出 App（防卡死兜底）
            if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() >= 2) {
                Toast.makeText(this, "正在退出晓林影视…", Toast.LENGTH_SHORT).show();
                forceCloseApp();
                return true;
            }
            if (event.getAction() == KeyEvent.ACTION_UP) {
                long now = System.currentTimeMillis();
                if (now - lastBackKeyTs < 1800) {
                    rapidBackCount++;
                } else {
                    rapidBackCount = 1;
                }
                lastBackKeyTs = now;

                // 任意页面/卡顿状态下连续按 3 次返回键，直接在系统层强制退出 App！
                if (rapidBackCount >= 3) {
                    Toast.makeText(this, "已退出晓林影视", Toast.LENGTH_SHORT).show();
                    forceCloseApp();
                    return true;
                }
            }
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    public void onBackPressed() {
        if (customView != null) {
            hideCustomView();
            return;
        }
        if (web != null) {
            web.evaluateJavascript(
                    "(function(){try{if(window.__xlTvBack)return window.__xlTvBack();if(window.__ntvExitFs&&window.__ntvExitFs())return 1;return 0;}catch(e){return 0;}})()",
                    value -> {
                        // 返回 2 或 1 表示网页端已消费该次返回键(如从播放页返回列表、从列表滚回顶部导航栏、关闭弹窗等)
                        if ("2".equals(value) || "\"2\"".equals(value) || "1".equals(value) || "\"1\"".equals(value)) {
                            return;
                        }
                        // 返回 3 表示网页端请求立即退出 App
                        if ("3".equals(value) || "\"3\"".equals(value)) {
                            forceCloseApp();
                            return;
                        }
                        // 返回 0 表示当前已在默认首页顶栏 (不再调用 web.goBack() 以免跳回已退出的播放页造成死循环！)
                        runOnUiThread(() -> {
                            long now = System.currentTimeMillis();
                            if (now - lastExitToastTs < 2400) {
                                forceCloseApp();
                            } else {
                                lastExitToastTs = now;
                                Toast.makeText(MainActivity.this, "再按一次返回键退出晓林影视（连按3次强制退出）", Toast.LENGTH_SHORT).show();
                            }
                        });
                    });
            return;
        }
        forceCloseApp();
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
