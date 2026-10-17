/* 晓林影视 XIAOLIN-TV — HLS 播放器封装 (深度兼容机顶盒 WebView · 双引擎自动回退 · 消除默认白底播放图标) */
(function () {
  'use strict';

  var current = null;
  var TRANSPARENT_POSTER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

  // 关键修复：关闭 enableWorker (老旧机顶盒 WebView 在 Blob Worker 下会静默死锁导致视频一直卡在播放图标)
  var HLS_DEFAULT = {
    enableWorker: false,
    startFragPrefetch: true,
    maxBufferLength: 30,
    maxMaxBufferLength: 60,
    maxBufferSize: 60 * 1000 * 1000,
    maxAudioFramesDrift: 6,
    manifestLoadingTimeOut: 7500,
    fragLoadingTimeOut: 10000,
    manifestLoadingMaxRetry: 1,
    levelLoadingMaxRetry: 1,
    fragLoadingMaxRetry: 2,
    fragLoadingRetryDelay: 300
  };

  var HLS_OPTIMIZE = Object.assign({}, HLS_DEFAULT, {
    enableWorker: false,
    startFragPrefetch: true,
    testBandwidth: true,
    startLevel: -1,
    abrEwmaDefaultEstimate: 800000,
    maxBufferLength: 30,
    maxMaxBufferLength: 60,
    maxBufferSize: 60 * 1000 * 1000,
    maxStarvationDelay: 4,
    maxLoadingDelay: 3,
    nudgeMaxRetry: 3
  });

  function trySafePlay(videoEl, tipEl) {
    if (!videoEl) return;
    try {
      var p = videoEl.play();
      if (p && typeof p.catch === 'function') {
        p.catch(function () {
          // 若机顶盒/浏览器因未静音拦截自动起播，立即静音起播再尝试恢复音量
          try {
            videoEl.muted = true;
            var p2 = videoEl.play();
            if (p2 && typeof p2.then === 'function') {
              p2.then(function () {
                setTimeout(function () {
                  try { videoEl.muted = false; } catch (e2) {}
                }, 350);
              }).catch(function (err2) {
                try { videoEl.dispatchEvent(new CustomEvent('player-autoplay-blocked', { detail: err2 })); } catch (e3) {}
              });
            }
          } catch (e4) {}
        });
      }
    } catch (e) {}
  }

  function playNativeVideo(videoEl, url, tipEl, opts) {
    if (!videoEl) return;
    try {
      videoEl.src = url;
      videoEl.load();
    } catch (e) {}

    var hideLoading = function () {
      if (videoEl.readyState >= 2 || videoEl.currentTime > 0) {
        showTip(tipEl, false);
      }
    };
    videoEl.addEventListener('canplay', hideLoading, { once: true });
    videoEl.addEventListener('loadeddata', hideLoading, { once: true });
    videoEl.addEventListener('playing', function () { showTip(tipEl, false); });
    videoEl.addEventListener('timeupdate', function () {
      if (videoEl.currentTime > 0.05) showTip(tipEl, false);
    });

    trySafePlay(videoEl, tipEl);

    videoEl.onerror = function (e) {
      showTip(tipEl, true, '播放失败，正在尝试切换备用源…');
      if (opts && typeof opts.onError === 'function') opts.onError(e);
      try { videoEl.dispatchEvent(new CustomEvent('player-error', { detail: e })); } catch (err) {}
    };
  }

  function play(videoEl, url, tipEl, opts) {
    destroy();
    if (!videoEl || !url) return { destroy: destroy };

    url = String(url).trim();
    showTip(tipEl, true, '正在连接视频流…');
    var optimize = opts && opts.optimize !== undefined ? !!opts.optimize : true;

    var ua = navigator.userAgent || '';
    var isApkWebView = /XIAOLIN-TV-APP/i.test(ua) || Boolean(window.AndroidBridge);
    var isTvMode = document.body && document.body.classList.contains('tv');
    var isAndroid = /Android/i.test(ua);

    if (!isApkWebView && typeof location !== 'undefined' && location.protocol === 'https:' && /^http:\/\//i.test(url)) {
      url = url.replace(/^http:\/\//i, 'https://');
    }

    var isM3u8 = /\.m3u8(\?|$)/i.test(url) || /m3u8/i.test(url);

    try {
      // 设置 1x1 透明封面，彻底隐藏 Android WebView 的默认白底大播放按钮图标
      videoEl.setAttribute('poster', TRANSPARENT_POSTER);
      videoEl.poster = TRANSPARENT_POSTER;
      videoEl.preload = 'auto';
      videoEl.preservesPitch = true;
      if ('webkitPreservesPitch' in videoEl) videoEl.webkitPreservesPitch = true;
      if ('mozPreservesPitch' in videoEl) videoEl.mozPreservesPitch = true;
      videoEl.playbackRate = 1.0;
      videoEl.defaultPlaybackRate = 1.0;
      videoEl.playsInline = true;
      videoEl.setAttribute('playsinline', '');
      videoEl.setAttribute('webkit-playsinline', '');
      videoEl.setAttribute('x5-playsinline', '');
      videoEl.setAttribute('x5-video-player-type', 'h5');
    } catch (e) {}

    if (isM3u8) {
      // 在安卓机顶盒 APK 或不支持 MSE 的设备上，优先使用 Hls.js (无Worker模式) + 3.8秒硬件解码双保险回退
      if (window.Hls && window.Hls.isSupported()) {
        var hlsConfig = Object.assign({}, optimize ? HLS_OPTIMIZE : HLS_DEFAULT);
        var hls = new Hls(hlsConfig);
        var switchedToNative = false;

        var nativeFallbackTimer = setTimeout(function () {
          if (switchedToNative || !videoEl.isConnected) return;
          if (videoEl.readyState < 2 && (!videoEl.currentTime || videoEl.currentTime < 0.1)) {
            // 若 Hls.js 软解在机顶盒上 3.8 秒仍未解出首帧，立即切换为安卓原生硬件解码器直接播放 m3u8
            if (isAndroid || isApkWebView || isTvMode || videoEl.canPlayType('application/vnd.apple.mpegurl')) {
              switchedToNative = true;
              try { hls.destroy(); } catch (e) {}
              if (current && current.hls === hls) current.hls = null;
              playNativeVideo(videoEl, url, tipEl, opts);
            }
          }
        }, 3800);

        hls.loadSource(url);
        hls.attachMedia(videoEl);
        hls.on(Hls.Events.MANIFEST_PARSED, function () {
          if (switchedToNative) return;
          trySafePlay(videoEl, tipEl);
        });
        videoEl.addEventListener('playing', function () {
          clearTimeout(nativeFallbackTimer);
          showTip(tipEl, false);
        }, { once: true });

        var netRetries = 0;
        var MAX_NET_RETRIES = 1;
        hls.on(Hls.Events.ERROR, function (_, data) {
          if (switchedToNative || !data.fatal) return;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            if (netRetries < MAX_NET_RETRIES) {
              netRetries++;
              hls.startLoad();
              return;
            }
            // Hls.js 网络/跨域失败时，在安卓/TV端尝试原生硬件播放器直连（原生 video 标签不受 CORS 限制！）
            if (isAndroid || isApkWebView || isTvMode) {
              switchedToNative = true;
              clearTimeout(nativeFallbackTimer);
              try { hls.destroy(); } catch (e) {}
              if (current && current.hls === hls) current.hls = null;
              playNativeVideo(videoEl, url, tipEl, opts);
              return;
            }
            clearTimeout(nativeFallbackTimer);
            showTip(tipEl, true, '播放地址连接失败，正在尝试换源…');
            if (opts && typeof opts.onError === 'function') opts.onError(data);
            try { videoEl.dispatchEvent(new CustomEvent('player-error', { detail: data })); } catch (e) {}
            destroy();
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
          } else {
            if (isAndroid || isApkWebView || isTvMode) {
              switchedToNative = true;
              clearTimeout(nativeFallbackTimer);
              try { hls.destroy(); } catch (e) {}
              if (current && current.hls === hls) current.hls = null;
              playNativeVideo(videoEl, url, tipEl, opts);
              return;
            }
            clearTimeout(nativeFallbackTimer);
            showTip(tipEl, true, '该片源暂时无法播放');
            if (opts && typeof opts.onError === 'function') opts.onError(data);
            try { videoEl.dispatchEvent(new CustomEvent('player-error', { detail: data })); } catch (e) {}
            destroy();
          }
        });
        current = { hls: hls, timer: nativeFallbackTimer };
        return { destroy: destroy };
      }

      playNativeVideo(videoEl, url, tipEl, opts);
      return { destroy: destroy };
    }

    playNativeVideo(videoEl, url, tipEl, opts);
    return { destroy: destroy };
  }

  function showTip(tipEl, show, text) {
    if (!tipEl) return;
    tipEl.classList.toggle('hidden', !show);
    if (show && text) tipEl.textContent = text;
  }

  function destroy() {
    if (current) {
      if (current.timer) clearTimeout(current.timer);
      try { if (current.hls) current.hls.destroy(); } catch (e) {}
      current = null;
    }
    var v = document.getElementById('videoEl');
    if (v) {
      try { v.pause(); } catch (e) {}
      v.onerror = null;
      v.removeAttribute('src');
      try { v.load && v.load(); } catch (e2) {}
    }
  }

  window.Player = { play: play, destroy: destroy };
})();
