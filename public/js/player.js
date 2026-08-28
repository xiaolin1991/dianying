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
    const isM3u8 = /\.m3u8(\?|$)/i.test(url);

    try {
      videoEl.preload = optimize ? 'auto' : (videoEl.preload || 'metadata');
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
          videoEl.play().catch(() => {});
        });
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (!data.fatal) return;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            showTip(tipEl, true, '网络加载失败，正在重试…');
            hls.startLoad();
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            showTip(tipEl, true, '媒体解码错误，尝试恢复…');
            hls.recoverMediaError();
          } else {
            showTip(tipEl, true, '该频道/影片暂时无法播放，请换一个试试');
            destroy();
          }
        });
        current = { hls };
        return { destroy };
      }
      if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
        videoEl.src = url;
        videoEl.play().catch(() => {});
        return { destroy };
      }
      showTip(tipEl, true, '当前浏览器不支持 HLS 播放');
      return { destroy };
    }

    // mp4 / 其他原生格式
    videoEl.src = url;
    videoEl.play().catch(() => {});
    videoEl.onerror = () => showTip(tipEl, true, '播放失败，源可能已失效');
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
