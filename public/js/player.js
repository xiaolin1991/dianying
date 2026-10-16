/* 晓林影视 XIAOLIN-TV — HLS 播放器封装 (兼容老旧机顶盒 WebView · 默认开启首片预取) */
(function () {
  'use strict';

  var current = null;

  var HLS_DEFAULT = {
    enableWorker: true,
    startFragPrefetch: true,
    maxBufferLength: 30,
    maxMaxBufferLength: 60,
    maxBufferSize: 60 * 1000 * 1000,
    maxAudioFramesDrift: 4,
    manifestLoadingTimeOut: 9500,
    fragLoadingTimeOut: 14000,
    manifestLoadingMaxRetry: 2,
    levelLoadingMaxRetry: 2,
    fragLoadingMaxRetry: 3,
    fragLoadingRetryDelay: 350
  };

  var HLS_OPTIMIZE = Object.assign({}, HLS_DEFAULT, {
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

  function play(videoEl, url, tipEl, opts) {
    destroy();
    showTip(tipEl, false);
    var optimize = opts && opts.optimize !== undefined ? !!opts.optimize : true;

    // 仅在非安卓壳(普通 HTTPS 浏览器)下将 http 视频流尝试升级或保持原样(安卓机顶盒壳已开启 MIXED_CONTENT_ALWAYS_ALLOW，直接播 http 流最稳)
    var isApkWebView = /XIAOLIN-TV-APP/i.test(navigator.userAgent || '');
    if (!isApkWebView && typeof location !== 'undefined' && location.protocol === 'https:' && /^http:\/\//i.test(url)) {
      url = url.replace(/^http:\/\//i, 'https://');
    }

    var isM3u8 = /\.m3u8(\?|$)/i.test(url);

    try {
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
      if (window.Hls && window.Hls.isSupported()) {
        var hlsConfig = Object.assign({}, optimize ? HLS_OPTIMIZE : HLS_DEFAULT);
        var hls = new Hls(hlsConfig);
        hls.loadSource(url);
        hls.attachMedia(videoEl);
        hls.on(Hls.Events.MANIFEST_PARSED, function () {
          showTip(tipEl, false);
          var p = videoEl.play();
          if (p && typeof p.catch === 'function') {
            p.catch(function (err) {
              showTip(tipEl, false);
              try { videoEl.dispatchEvent(new CustomEvent('player-autoplay-blocked', { detail: err })); } catch (e) {}
            });
          }
        });
        var netRetries = 0;
        var MAX_NET_RETRIES = 1;
        hls.on(Hls.Events.ERROR, function (_, data) {
          if (!data.fatal) return;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            if (netRetries < MAX_NET_RETRIES) {
              netRetries++;
              showTip(tipEl, true, '网络加载失败，正在重试…');
              hls.startLoad();
              return;
            }
            showTip(tipEl, true, '播放地址连接失败（上游CDN失效或证书过期）');
            if (opts && typeof opts.onError === 'function') opts.onError(data);
            try { videoEl.dispatchEvent(new CustomEvent('player-error', { detail: data })); } catch (e) {}
            destroy();
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            showTip(tipEl, true, '媒体解码错误，尝试恢复…');
            hls.recoverMediaError();
          } else {
            showTip(tipEl, true, '该影片暂时无法播放');
            if (opts && typeof opts.onError === 'function') opts.onError(data);
            try { videoEl.dispatchEvent(new CustomEvent('player-error', { detail: data })); } catch (e) {}
            destroy();
          }
        });
        current = { hls: hls };
        return { destroy: destroy };
      }

      if (videoEl.canPlayType('application/vnd.apple.mpegurl') || isApkWebView) {
        videoEl.src = url;
        var hideLoading = function () { showTip(tipEl, false); };
        videoEl.addEventListener('loadedmetadata', hideLoading, { once: true });
        videoEl.addEventListener('canplay', hideLoading, { once: true });
        videoEl.addEventListener('loadeddata', hideLoading, { once: true });
        videoEl.addEventListener('playing', hideLoading);
        videoEl.addEventListener('play', hideLoading);
        videoEl.addEventListener('timeupdate', function () {
          if (videoEl.currentTime > 0) hideLoading();
        });
        var p = videoEl.play();
        if (p && typeof p.catch === 'function') {
          p.catch(function (err) {
            hideLoading();
            try { videoEl.dispatchEvent(new CustomEvent('player-autoplay-blocked', { detail: err })); } catch (e) {}
          });
        }
        videoEl.onerror = function (e) {
          showTip(tipEl, true, '播放失败，源可能已失效');
          if (opts && typeof opts.onError === 'function') opts.onError(e);
          try { videoEl.dispatchEvent(new CustomEvent('player-error', { detail: e })); } catch (err) {}
        };
        return { destroy: destroy };
      }
      showTip(tipEl, true, '当前浏览器不支持 HLS 播放');
      return { destroy: destroy };
    }

    videoEl.src = url;
    var hideLoading2 = function () { showTip(tipEl, false); };
    videoEl.addEventListener('loadedmetadata', hideLoading2, { once: true });
    videoEl.addEventListener('canplay', hideLoading2, { once: true });
    videoEl.addEventListener('playing', hideLoading2);
    var p2 = videoEl.play();
    if (p2 && typeof p2.catch === 'function') {
      p2.catch(function (err) {
        hideLoading2();
        try { videoEl.dispatchEvent(new CustomEvent('player-autoplay-blocked', { detail: err })); } catch (e) {}
      });
    }
    videoEl.onerror = function (e) {
      showTip(tipEl, true, '播放失败，源可能已失效');
      if (opts && typeof opts.onError === 'function') opts.onError(e);
      try { videoEl.dispatchEvent(new CustomEvent('player-error', { detail: e })); } catch (err) {}
    };
    return { destroy: destroy };
  }

  function showTip(tipEl, show, text) {
    if (!tipEl) return;
    tipEl.classList.toggle('hidden', !show);
    if (show && text) tipEl.textContent = text;
  }

  function destroy() {
    if (current) {
      try { if (current.hls) current.hls.destroy(); } catch (e) {}
      current = null;
    }
    var v = document.getElementById('videoEl');
    if (v) { try { v.pause(); } catch (e) {} v.removeAttribute('src'); v.load && v.load(); }
  }

  window.Player = { play: play, destroy: destroy };
})();
