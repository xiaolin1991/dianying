/* 晓林影视 XIAOLIN-TV — HLS 播放器封装 (默认开启首片预取与快速起播优化) */
(function () {
  'use strict';

  let current = null; // { hls }

  /**
   * 极速稳健默认配置:
   * 默认开启 startFragPrefetch 首片预取 + Worker 异步解码，缩短连接超时以便死源快速切源，
   * 同时保留 maxAudioFramesDrift=4 防止采集源切片时间戳抖动造成变音失真
   */
  const HLS_DEFAULT = {
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
    fragLoadingRetryDelay: 350,
  };

  const HLS_OPTIMIZE = {
    ...HLS_DEFAULT,
    startFragPrefetch: true,
    testBandwidth: true,
    startLevel: -1,
    abrEwmaDefaultEstimate: 800000,
    maxBufferLength: 30,
    maxMaxBufferLength: 60,
    maxBufferSize: 60 * 1000 * 1000,
    maxStarvationDelay: 4,
    maxLoadingDelay: 3,
    nudgeMaxRetry: 3,
  };

  function play(videoEl, url, tipEl, opts) {
    destroy();
    showTip(tipEl, false);
    const optimize = opts && opts.optimize !== undefined ? !!opts.optimize : true;

    // 协议自动升级：当前站点为 HTTPS 且视频源为 http:// 时，自动升级为 https 避免混合内容拦截
    if (typeof location !== 'undefined' && location.protocol === 'https:' && /^http:\/\//i.test(url)) {
      url = url.replace(/^http:\/\//i, 'https://');
    }

    const isM3u8 = /\.m3u8(\?|$)/i.test(url);

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
    } catch (e) { /* ignore */ }

    if (isM3u8) {
      if (window.Hls && window.Hls.isSupported()) {
        const hlsConfig = optimize ? { ...HLS_OPTIMIZE } : { ...HLS_DEFAULT };
        const hls = new Hls(hlsConfig);
        hls.loadSource(url);
        hls.attachMedia(videoEl);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          showTip(tipEl, false);
          const p = videoEl.play();
          if (p && typeof p.catch === 'function') {
            p.catch((err) => {
              showTip(tipEl, false);
              try { videoEl.dispatchEvent(new CustomEvent('player-autoplay-blocked', { detail: err })); } catch (e) {}
            });
          }
        });
        let netRetries = 0;
        const MAX_NET_RETRIES = 1;
        hls.on(Hls.Events.ERROR, (_, data) => {
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
        current = { hls };
        return { destroy };
      }

      if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
        videoEl.src = url;
        const hideLoading = () => showTip(tipEl, false);
        videoEl.addEventListener('loadedmetadata', hideLoading, { once: true });
        videoEl.addEventListener('canplay', hideLoading, { once: true });
        videoEl.addEventListener('loadeddata', hideLoading, { once: true });
        videoEl.addEventListener('playing', hideLoading);
        videoEl.addEventListener('play', hideLoading);
        videoEl.addEventListener('timeupdate', () => {
          if (videoEl.currentTime > 0) hideLoading();
        });
        const p = videoEl.play();
        if (p && typeof p.catch === 'function') {
          p.catch((err) => {
            hideLoading();
            try { videoEl.dispatchEvent(new CustomEvent('player-autoplay-blocked', { detail: err })); } catch (e) {}
          });
        }
        videoEl.onerror = (e) => {
          showTip(tipEl, true, '播放失败，源可能已失效');
          if (opts && typeof opts.onError === 'function') opts.onError(e);
          try { videoEl.dispatchEvent(new CustomEvent('player-error', { detail: e })); } catch (err) {}
        };
        return { destroy };
      }
      showTip(tipEl, true, '当前浏览器不支持 HLS 播放');
      return { destroy };
    }

    videoEl.src = url;
    const hideLoading = () => showTip(tipEl, false);
    videoEl.addEventListener('loadedmetadata', hideLoading, { once: true });
    videoEl.addEventListener('canplay', hideLoading, { once: true });
    videoEl.addEventListener('playing', hideLoading);
    const p = videoEl.play();
    if (p && typeof p.catch === 'function') {
      p.catch((err) => {
        hideLoading();
        try { videoEl.dispatchEvent(new CustomEvent('player-autoplay-blocked', { detail: err })); } catch (e) {}
      });
    }
    videoEl.onerror = (e) => {
      showTip(tipEl, true, '播放失败，源可能已失效');
      if (opts && typeof opts.onError === 'function') opts.onError(e);
      try { videoEl.dispatchEvent(new CustomEvent('player-error', { detail: e })); } catch (err) {}
    };
    return { destroy };
  }

  function showTip(tipEl, show, text) {
    if (!tipEl) return;
    tipEl.classList.toggle('hidden', !show);
    if (show && text) tipEl.textContent = text;
  }

  function destroy() {
    if (current) {
      try { if (current.hls) current.hls.destroy(); } catch (e) { /* ignore */ }
      current = null;
    }
    const v = document.getElementById('videoEl');
    if (v) { try { v.pause(); } catch (e) {} v.removeAttribute('src'); v.load && v.load(); }
  }

  window.Player = { play, destroy };
})();
