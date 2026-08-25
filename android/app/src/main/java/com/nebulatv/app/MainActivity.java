package com.XIAOLIN-TV.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * 晓林影视 安卓壳客户端
 * - 全屏 WebView 装载线上站点(地址来自 BuildConfig.START_URL)
 * - 返回键 = 网页后退(hash 路由), 退出全屏优先
 * - target=_blank 链接留在 App 内打开
 * - 支持视频元素级全屏(播放页 ⛶ 按钮)
 */
public class MainActivity extends Activity {

    private WebView web;
    private View customView;                       // 视频全屏时的自定义视图
    private WebChromeClient.CustomViewCallback customCb;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);

        web = new WebView(this);
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

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return false; // 全部站内加载
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (customView != null) { callback.onCustomViewHidden(); return; }
                customView = view;
                customCb = callback;
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

        web.loadUrl(BuildConfig.START_URL);
    }

    private void hideCustomView() {
        if (customView == null) return;
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
        if (customView != null) {           // 视频全屏中: 先退全屏
            hideCustomView();
            return;
        }
        if (web.canGoBack()) {              // 网页内后退(SPA hash 路由)
            web.goBack();
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
