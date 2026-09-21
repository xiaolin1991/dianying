import UIKit
import WebKit

/// 晓林影视 iOS 壳: 全屏 WKWebView 装载线上站点
/// - 与安卓壳一致的专属 UA (XIAOLIN-TV-IOS), 站点可识别官方 App
/// - 网页 fake-fs 横屏全屏在锁屏下依然生效(纯 CSS 旋转, 不依赖系统方向)
/// - 原生视频全屏播放器可突破系统旋转锁定自动横屏(同优酷/腾讯视频)
class MainViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {

    private var webView: WKWebView!

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
        if AppDelegate.allowLandscape {
            return [.portrait, .landscapeLeft, .landscapeRight]
        }
        return .portrait
    }

    override var prefersHomeIndicatorAutoHidden: Bool { true }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black

        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = false           // 视频可走系统全屏播放器(可横屏)
        config.mediaTypesRequiringUserActionForPlayback = [] // 允许自动连播
        config.userContentController.add(self, name: "orientation")
        // 注入与安卓壳一致的 JS 桥: 网页全屏逻辑统一走 AndroidBridge 路径
        let bridgeJS = """
        window.AndroidBridge = {
          setOrientation: function(mode) {
            try { window.webkit.messageHandlers.orientation.postMessage(String(mode)); } catch (e) {}
          }
        };
        """
        config.userContentController.addUserScript(
            WKUserScript(source: bridgeJS, injectionTime: .atDocumentStart, forMainFrameOnly: false))

        webView = WKWebView(frame: view.bounds, configuration: config)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        if #available(iOS 15.0, *) {
            webView.underPageBackgroundColor = .black
        }
        // 专属 UA: 网站识别官方 App
        webView.customUserAgent = WKWebView().value(forKey: "userAgent") as? String
        let baseUA = webView.customUserAgent ?? ""
        webView.customUserAgent = baseUA + " XIAOLIN-TV-IOS/1.0"
        view.addSubview(webView)

        let start = (Bundle.main.object(forInfoDictionaryKey: "StartURL") as? String)
            ?? "https://your-worker.your-subdomain.workers.dev/"
        if let url = URL(string: start) {
            webView.load(URLRequest(url: url))
        }
    }

    // MARK: - JS 桥: 网页全屏时请求横屏
    // 网页调用: window.webkit.messageHandlers.orientation.postMessage('landscape' | 'portrait')
    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.name == "orientation", let mode = message.body as? String else { return }
        if mode.lowercased() == "landscape" {
            AppDelegate.allowLandscape = true
            setOrientation(.landscapeRight)
        } else {
            AppDelegate.allowLandscape = false
            setOrientation(.portrait)
        }
    }

    private func setOrientation(_ orientation: UIInterfaceOrientation) {
        if #available(iOS 16.0, *) {
            if let scene = view.window?.windowScene {
                let prefs = UIWindowScene.GeometryPreferences.iOS(interfaceOrientations:
                    orientation == .portrait ? .portrait : .landscapeRight)
                try? scene.requestGeometryUpdate(prefs)
            }
        } else {
            UIDevice.current.setValue(orientation.rawValue, forKey: "orientation")
        }
        UIViewController.attemptRotationToDeviceOrientation()
    }

    // MARK: - 外链处理: APK/市场链接交给系统
    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = navigationAction.request.url,
           navigationAction.navigationType == .linkActivated {
            let u = url.absoluteString.lowercased()
            if u.hasPrefix("mailto:") || u.hasPrefix("tel:") || u.hasPrefix("itms") || u.contains(".apk") {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
                return
            }
        }
        decisionHandler(.allow)
    }
}
