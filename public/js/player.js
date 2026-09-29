/* 晓林影视 XIAOLIN-TV — HLS 播放器封装 */
(function () {
  'use strict';

  let current = null; // { hls }

  /**
   * 基础稳健配置:
   * 针对国内影视采集源切片不规则、插播广告小分片、时间戳(PTS)抖动与 44.1kHz AAC 音频重采样优化
   */
  const HLS_DEFAULT = {
    enableWorker: true,
    maxBufferLength: 30,
    maxMaxBufferLength: 60,
    maxBufferSize: 60 * 1000 * 1000,
    // 关键音频参数: 采集站与切片广告经常存在微小 PTS 抖动(>1 帧)，默认 1 会导致频繁丢音频帧/重同步导致变音变调或杂音失真
    maxAudioFramesDrift: 4,
    manifestLoadingTimeOut: 15000,
    fragLoadingTimeOut: 20000,
    manifestLoadingMaxRetry: 3,
    levelLoadingMaxRetry: 3,
    fragLoadingMaxRetry: 4,
    fragLoadingRetryDelay: 500,
  };

  /**
   * 起播优化配置:
   * 开启分片预取 + Worker 解码 + 合理缓冲，同时确保音频时间戳平滑不失真
   */
  const HLS_OPTIMIZE = {
    ...HLS_DEFAULT,
    startFragPrefetch: true,
    testBandwidth: true,
    startLevel: -1, // 自动档位，避免强设第0档与后续音轨不兼容导致声调切换异常
    abrEwmaDefaultEstimate: 500000,
    maxBufferLength: 30,
    maxMaxBufferLength: 60,
    maxBufferSize: 60 * 1000 * 1000,
    maxStarvationDelay: 4, // 保持标准 4 秒，防止过早触发伪饥饿与微调(nudge)打乱音频时钟
    maxLoadingDelay: 4,
    nudgeMaxRetry: 3,
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
      // 保持原始音调，杜绝因速率或时钟微调导致的变调变音/娃娃音/失真
      videoEl.preservesPitch = true;
      if ('webkitPreservesPitch' in videoEl) videoEl.webkitPreservesPitch = true;
      if ('mozPreservesPitch' in videoEl) videoEl.mozPreservesPitch = true;
      videoEl.playbackRate = 1.0;
      videoEl.defaultPlaybackRate = 1.0;
      // 增强移动端 / iOS 原生播放与画中画兼容属性
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
