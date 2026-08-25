/* 晓林影视 XIAOLIN-TV — HLS 播放器封装 */
(function () {
  'use strict';

  let current = null; // { hls }

  /**
   * 播放 url 到 video 元素
   * @returns {{destroy: Function}}
   */
  function play(videoEl, url, tipEl) {
    destroy();
    showTip(tipEl, false);
    const isM3u8 = /\.m3u8(\?|$)/i.test(url);

    if (isM3u8) {
      if (window.Hls && window.Hls.isSupported()) {
        const hls = new Hls({
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          manifestLoadingTimeOut: 15000,
          fragLoadingTimeOut: 20000,
        });
        hls.loadSource(url);
        hls.attachMedia(videoEl);
        hls.on(Hls.Events.MANIFEST_PARSED, () => { showTip(tipEl, false); videoEl.play().catch(() => {}); });
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
