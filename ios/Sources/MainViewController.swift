import UIKit
import WebKit
import MediaPlayer

/// 晓林影视 iOS 壳: 全屏 WKWebView 装载线上站点
/// - 与安卓壳一致的专属 UA (XIAOLIN-TV-IOS), 站点可识别官方 App
/// - 网页全屏走 CSS 假全屏 + 容器旋转90°(B站/西瓜同款): 系统"竖排方向锁定"下
///   程序性强制旋转与原生全屏均无法横屏(iOS 硬限制), CSS 旋转是唯一可靠方案;
///   未锁定旋转时本类仍会程序性强制真横屏, 体验更佳
/// - 网页全屏时经 statusbar 桥隐藏系统状态栏(沉浸式, 优酷/腾讯视频同款), 退出全屏恢复
/// - 网页自定义控制条(进度/倍速)与手势(快进/音量/亮度)在 iOS 全屏下全部可用
/// - 音量/亮度经 JS 桥真正调节系统值(网页 video.volume 在 iOS 上无效)
class MainViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {

    private var webView: WKWebView!
    /// 首次调节亮度时记录的系统亮度, 退出全屏时恢复(网页发 brightness: "reset")
    private var originalBrightness: CGFloat = -1
    /// 离屏 MPVolumeView: 用于程序性调节系统音量
    private var volumeView: MPVolumeView?

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
        if AppDelegate.allowLandscape {
            return [.portrait, .landscapeLeft, .landscapeRight]
        }
        return .portrait
    }

    override var prefersHomeIndicatorAutoHidden: Bool { true }

    /// 网页全屏时隐藏系统状态栏(沉浸式), 退出全屏恢复
    private var statusBarHidden = false
    override var prefersStatusBarHidden: Bool { statusBarHidden }
    override var preferredStatusBarUpdateAnimation: UIStatusBarAnimation { .fade }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black

        let config = WKWebViewConfiguration()
        // 必须为 true: 否则 iPhone 上视频一律被系统原生全屏接管, 网页自定义控制条/手势/退出键全部失效(点不动、退不出)
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = [] // 允许自动连播
        config.userContentController.add(self, name: "orientation")
        config.userContentController.add(self, name: "volume")
        config.userContentController.add(self, name: "brightness")
        config.userContentController.add(self, name: "statusbar")
        // 注入与安卓壳一致的 JS 桥: 网页全屏/音量/亮度逻辑统一走 AndroidBridge 路径
        let bridgeJS = """
        window.AndroidBridge = {
          setOrientation: function(mode) {
            try { window.webkit.messageHandlers.orientation.postMessage(String(mode)); } catch (e) {}
          },
          setVolume: function(v) {
            try { window.webkit.messageHandlers.volume.postMessage(Number(v)); } catch (e) {}
          },
          setBrightness: function(v) {
            try { window.webkit.messageHandlers.brightness.postMessage(String(v)); } catch (e) {}
          },
          resetBrightness: function() {
            try { window.webkit.messageHandlers.brightness.postMessage('reset'); } catch (e) {}
          },
          setStatusBar: function(hidden) {
            try { window.webkit.messageHandlers.statusbar.postMessage(hidden ? 'hide' : 'show'); } catch (e) {}
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

    // MARK: - JS 桥: 网页全屏时请求横屏 / 调节系统音量 / 调节系统亮度
    // 网页调用: window.webkit.messageHandlers.{orientation|volume|brightness}.postMessage(...)
    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        switch message.name {
        case "orientation":
            guard let mode = message.body as? String else { return }
            if mode.lowercased() == "landscape" {
                AppDelegate.allowLandscape = true
                setOrientation(.landscapeRight)
            } else {
                AppDelegate.allowLandscape = false
                setOrientation(.portrait)
            }
        case "volume":
            // 网页 video.volume 在 iOS 上无效, 这里程序性调系统音量
            var v: Double = -1
            if let n = message.body as? NSNumber { v = n.doubleValue }
            else if let s = message.body as? String { v = Double(s) ?? -1 }
            guard v >= 0 else { return }
            setSystemVolume(Float(min(1, max(0, v))))
        case "brightness":
            if let s = message.body as? String, s == "reset" {
                restoreBrightness()
                return
            }
            var v: Double = -1
            if let n = message.body as? NSNumber { v = n.doubleValue }
            else if let s = message.body as? String { v = Double(s) ?? -1 }
            guard v >= 0 else { return }
            if originalBrightness < 0 { originalBrightness = UIScreen.main.brightness }
            UIScreen.main.brightness = CGFloat(min(1, max(0.02, v)))
        case "statusbar":
            // 网页全屏时隐藏系统状态栏(沉浸式), 退出全屏恢复显示
            guard let mode = message.body as? String else { return }
            let hide = (mode == "hide")
            guard hide != statusBarHidden else { return }
            statusBarHidden = hide
            UIView.animate(withDuration: 0.25) {
                self.setNeedsStatusBarAppearanceUpdate()
            }

        default:
            break
        }
    }

    /// 程序性设置系统音量(离屏 MPVolumeView 的 UISlider)
    private func setSystemVolume(_ v: Float) {
        if volumeView == nil {
            let vv = MPVolumeView(frame: CGRect(x: -2000, y: -2000, width: 100, height: 50))
            vv.showsVolumeSlider = true
            view.addSubview(vv)
            volumeView = vv
        }
        guard let slider = volumeView?.subviews.compactMap({ $0 as? UISlider }).first else { return }
        // 刚加入视图层级时需要一拍才生效
        DispatchQueue.main.async { slider.value = v }
    }

    /// 恢复进入全屏前的系统亮度
    private func restoreBrightness() {
        guard originalBrightness >= 0 else { return }
        UIScreen.main.brightness = originalBrightness
        originalBrightness = -1
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
