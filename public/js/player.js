/* 晓林影视 XIAOLIN-TV — HLS 播放器封装 */
(function () {
  'use strict';

  let current = null; // { hls }

  /** 现状: 稳健偏保守 */
  const HLS_DEFAULT = {
    maxBufferLength: 30,
    maxMaxBufferLength: 60,
    manifestLoadingTimeOut: 15000,
    fragLoadingTimeOut: 20000,
  };

  /** 优化: 更快起播(低码率先出画) + 分片预取 + Worker 解码 */
  const HLS_OPTIMIZE = {
    enableWorker: true,
    startFragPrefetch: true,
    testBandwidth: true,
    // -1=自动; 优化模式下先从较低档起播再升, 缩短黑屏等待
    startLevel: 0,
    abrEwmaDefaultEstimate: 300000,
    maxBufferLength: 18,
    maxMaxBufferLength: 48,
    maxBufferSize: 40 * 1000 * 1000,
    maxStarvationDelay: 2,
    maxLoadingDelay: 2,
    manifestLoadingTimeOut: 10000,
    fragLoadingTimeOut: 15000,
    fragLoadingMaxRetry: 4,
    fragLoadingRetryDelay: 400,
    manifestLoadingMaxRetry: 3,
    levelLoadingMaxRetry: 3,
    nudgeMaxRetry: 5,
  };

  /**
   * 播放 url 到 video 元素
   * @param {HTMLVideoElement} videoEl
   * @param {string} url
   * @param {HTMLElement|null} tipEl
   * @param {{ optimize?: boolean }} [opts]
   * @returns {{destroy: Function}}
   */
  function play(videoEl, url, tipEl, opts) {
    destroy();
    showTip(tipEl, false);
    const optimize = !!(opts && opts.optimize);

    // 协议自动升级：当前站点为 HTTPS 且视频源为 http:// 时，自动升级为 https 避免 iOS Safari 混合内容策略拦截
    if (typeof location !== 'undefined' && location.protocol === 'https:' && /^http:\/\//i.test(url)) {
      url = url.replace(/^http:\/\//i, 'https://');
    }

    const isM3u8 = /\.m3u8(\?|$)/i.test(url);

    try {
      videoEl.preload = optimize ? 'auto' : (videoEl.preload || 'metadata');
      // 增强移动端 / iOS 原生播放与画中画兼容属性
      videoEl.playsInline = true;
      videoEl.setAttribute('playsinline', '');
      videoEl.setAttribute('webkit-playsinline', '');
      videoEl.setAttribute('x5-playsinline', '');
      videoEl.setAttribute('x5-video-player-type', 'h5');
    } catch (e) { /* ignore */ }

    if (isM3u8) {
      if (window.Hls && window.Hls.isSupported()) {
        const hls = new Hls(optimize ? { ...HLS_OPTIMIZE } : { ...HLS_DEFAULT });
        hls.loadSource(url);
        hls.attachMedia(videoEl);
        hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
          showTip(tipEl, false);
          // 优化模式: 清单就绪后若有多档, 从低档起播, 随后交给 ABR 升档
          if (optimize && data && Array.isArray(data.levels) && data.levels.length > 1) {
            try { hls.startLevel = 0; hls.currentLevel = 0; hls.nextLevel = -1; hls.loadLevel = -1; } catch (e) {}
          }
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

      // iOS Safari 原生 HLS (AVPlayer)
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
            // iOS 自动播放受阻: 隐藏加载文字，通知前台唤醒中央播放大按钮
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

    // mp4 / 其他原生格式
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
