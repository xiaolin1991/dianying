/* ============================================================
 * XIAOLIN-TV · TV 大屏独立交互层 (仅安卓无触摸设备自动启用)
 *  - 空间焦点导航: 方向键在可视元素间按几何方位找最近目标
 *  - TV 搜索页: 字母网格虚拟键盘(无需系统输入法) + 首字母本地秒配
 *  - 首页 Banner 大卡 / 底部遥控器按键提示条
 * 依赖: body.tv 由本文件挂载; window.XLTV 由 app.js 在 TV 模式下注入
 * ========================================================== */
(function () {
  'use strict';
  var ua = navigator.userAgent || '';
  var isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  // 与 app.js isTvDevice 同口径: 安卓 WebView 且无触摸屏(电视盒子/智能电视)
  if (!/Android/i.test(ua) || isTouch) return;

  document.body.classList.add('tv');
  document.documentElement.classList.add('tv-root');

  /* ---------------- 空间焦点导航引擎 ---------------- */
  var FOCUSED_CLS = 'tv-f';
  function visible(el) {
    if (!el || el.disabled || el.getAttribute && el.getAttribute('aria-hidden') === 'true') return false;
    var r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
    return true;
  }
  function collect() {
    var list = document.querySelectorAll('a[href],button,input,select,[tabindex]:not([tabindex="-1"])');
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (visible(el)) {
        var t = el.tagName;
        if (t === 'INPUT' && !/search|text|number/.test(el.type || 'text')) continue;
        out.push(el);
      }
    }
    return out;
  }
  function center(r) { return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
  /** dir: 'up'|'down'|'left'|'right' → 返回该方向上最近的可见元素 */
  function pick(cur, dir) {
    var cr = cur.getBoundingClientRect(), c = center(cr);
    var best = null, bestScore = Infinity;
    var all = collect();
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el === cur || el.contains(cur)) continue;
      var r = el.getBoundingClientRect(), m = center(r);
      var dx = m.x - c.x, dy = m.y - c.y;
      var pri, sec;
      if (dir === 'left') { if (dx >= -6) continue; pri = -dx; sec = Math.abs(dy); }
      else if (dir === 'right') { if (dx <= 6) continue; pri = dx; sec = Math.abs(dy); }
      else if (dir === 'up') { if (dy >= -6) continue; pri = -dy; sec = Math.abs(dx); }
      else { if (dy <= 6) continue; pri = dy; sec = Math.abs(dx); }
      // 排除明显错位的目标(横向找时纵向偏差过大等)
      if (sec > Math.max(pri * 2.2, 140)) continue;
      var score = pri + sec * 2.5;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    return best;
  }
  function setFocus(el) {
    if (!el) return;
    try {
      var prev = document.querySelector('.' + FOCUSED_CLS);
      if (prev) prev.classList.remove(FOCUSED_CLS);
    } catch (e) {}
    el.classList.add(FOCUSED_CLS);
    try { el.focus({ preventScroll: true }); }
    catch (e) { try { el.focus(); } catch (e2) {} }
    try {
      var r = el.getBoundingClientRect();
      if (r.top < 90 || r.bottom > innerHeight - 130 || r.left < 20 || r.right > innerWidth - 20) {
        el.scrollIntoView({ block: 'center', inline: 'center' });
      }
    } catch (e) { try { el.scrollIntoView(); } catch (e2) {} }
  }
  window.addEventListener('keydown', function (ev) {
    var k = ev.key;
    var dir = null;
    if (k === 'ArrowUp') dir = 'up';
    else if (k === 'ArrowDown') dir = 'down';
    else if (k === 'ArrowLeft') dir = 'left';
    else if (k === 'ArrowRight') dir = 'right';
    if (dir) {
      var cur = document.activeElement && visible(document.activeElement)
        ? document.activeElement
        : document.querySelector('.' + FOCUSED_CLS);
      var next = cur ? pick(cur, dir) : collect()[0];
      if (next) { ev.preventDefault(); ev.stopPropagation(); setFocus(next); }
      return;
    }
    /* 返回键: 兼容各盒子(Escape/Backspace/LG 461/三星 10009) */
    var back = k === 'Escape' || k === 'Backspace' || ev.keyCode === 461 || ev.keyCode === 10009;
    if (back) {
      // 输入类元素内退格不劫持
      var ae = document.activeElement;
      if (ae && ae.tagName === 'INPUT' && k === 'Backspace') return;
      var mask = document.querySelector('.modal-mask:last-of-type');
      if (mask) {
        ev.preventDefault();
        var x = mask.querySelector('.modal-box button') || mask.querySelector('button');
        if (x) x.click(); else mask.remove();
        return;
      }
      if (location.hash && location.hash !== '#/home' && location.hash !== '#/') {
        ev.preventDefault();
        history.back();
      }
    }
  }, true);

  /* ---------------- 底部按键提示条 ---------------- */
  function ensureLegend() {
    if (document.getElementById('tvLegend')) return;
    var bar = document.createElement('div');
    bar.id = 'tvLegend';
    bar.innerHTML = '<span><b>◀▶▲▼</b> 移动</span><span><b>OK</b> 确认</span><span><b>返回</b> 上级/退出</span>';
    document.body.appendChild(bar);
  }

  /* ---------------- 顶栏: 注入搜索入口 & 精简桌面件 ---------------- */
  function tuneTopbar() {
    var nav = document.getElementById('mainNav');
    if (!nav) return;
    if (!nav.querySelector('#tvSearchChip')) {
      var a = document.createElement('a');
      a.id = 'tvSearchChip';
      a.href = '#/search';
      a.innerHTML = '🔍 搜索';
      nav.appendChild(a);
    }
    ['searchInput', 'voiceBtn', 'searchMBtn', 'themeBtn'].forEach(function (id) {
      var el = document.getElementById(id);
      var box = el && el.closest('.searchbox');
      if (box) box.style.display = 'none';
      else if (el && id !== 'searchInput') el.style.display = 'none';
    });
    var ub = document.getElementById('userBox');
    if (ub) ub.style.display = 'none';
    var bt = document.getElementById('backTop');
    if (bt) bt.style.display = 'none';
  }

  /* ---------------- 首页 Banner 大卡 ---------------- */
  function buildBanner() {
    if (document.getElementById('tvBanner')) return true;
    var firstGrid = document.querySelector('#view .grid');
    var card = firstGrid && firstGrid.querySelector('.card');
    var view = document.getElementById('view');
    if (!card || !view) return false;
    var img = card.querySelector('img');
    var nameEl = card.querySelector('.card-name');
    var title = nameEl ? nameEl.textContent.trim() : '';
    if (!img || !img.src || !title) return false;
    var href = card.getAttribute('href') || '#/home';
    var b = document.createElement('div');
    b.id = 'tvBanner';
    b.innerHTML =
      '<a class="tb-poster" href="' + href.replace(/"/g, '&quot;') + '">' +
      '<img src="' + img.src.replace(/"/g, '&quot;') + '" alt="">' +
      '</a>' +
      '<div class="tb-meta"><div class="tb-title">' + title.replace(/</g, '&lt;') + '</div>' +
      '<a class="tb-play btn" href="' + href.replace(/"/g, '&quot;') + '">▶ 立即播放</a></div>';
    view.insertBefore(b, view.firstChild.nextSibling ? view.querySelector('.row, .grid').parentNode : view.firstChild);
    return true;
  }

  /* ---------------- TV 搜索页(字母网格键盘) ---------------- */
  var kbBuf = '';
  function localMatches(s) {
    var hooks = window.XLTV;
    if (!hooks || !hooks.idx || !s) return [];
    s = s.toUpperCase();
    var seen = {}, out = [];
    hooks.idx.forEach(function (it) {
      if (out.length >= 12) return;
      var ini = hooks.ti(it.title);
      if ((ini === s || ini.indexOf(s) === 0) && !seen[it.title]) {
        seen[it.title] = 1;
        out.push(it);
      }
    });
    return out;
  }
  function mountTvSearch() {
    var view = document.getElementById('view');
    if (!view || view.dataset.tvSearch === '1') return;
    view.dataset.tvSearch = '1';
    var letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    var html =
      '<div class="container page-wrap tv-search-wrap">' +
      '<div class="page-head"><div class="page-title">🔍 搜索影片</div></div>' +
      '<div class="tvs-layout">' +
      '<div class="tvs-left">' +
      '<div class="tvs-input" id="tvsBuf">&nbsp;</div>' +
      '<div class="tvs-local" id="tvsLocal"></div>' +
      '</div>' +
      '<div class="tvs-kb" id="tvsKb">' +
      letters.map(function (L) { return '<button type="button" data-k="' + L + '">' + L + '</button>'; }).join('') +
      '<button type="button" data-k="DEL" style="grid-column:span 2">⌫ 删除</button>' +
      '<button type="button" data-k="CLR" style="grid-column:span 2">清空</button>' +
      '<button type="button" data-k="GO" class="tvs-go" style="grid-column:span 3">🌐 搜索全站</button>' +
      '<button type="button" data-k="SP" style="grid-column:span 1">空格</button>' +
      '</div></div></div>';
    view.innerHTML = html;
    var bufEl = document.getElementById('tvsBuf');
    var locEl = document.getElementById('tvsLocal');
    function renderBuf() { bufEl.textContent = kbBuf || '请用右侧字母键输入片名首字母…'; }
    function renderLocal() {
      var hits = localMatches(kbBuf);
      locEl.innerHTML = hits.length
        ? '<div class="tvs-local-h">本地匹配（OK 直达）</div>' +
          hits.map(function (it) {
            return '<a class="tvs-hit" href="#/play/' + encodeURIComponent(it.sourceKey) + '/' + encodeURIComponent(it.id) + '?ep=0&group=0">' +
              '<img src="' + (it.pic || '').replace(/"/g, '&quot;') + '" onerror="this.style.visibility=\'hidden\'">' +
              '<span>' + it.title.replace(/</g, '&lt;') + '</span></a>';
          }).join('')
        : '';
    }
    document.getElementById('tvsKb').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-k]');
      if (!b) return;
      var kk = b.getAttribute('data-k');
      if (kk === 'DEL') kbBuf = kbBuf.slice(0, -1);
      else if (kk === 'CLR') kbBuf = '';
      else if (kk === 'SP') kbBuf += ' ';
      else if (kk === 'GO') {
        var q = kbBuf.trim();
        if (q) location.hash = '#/search?q=' + encodeURIComponent(q);
        return;
      } else kbBuf += kk;
      if (kbBuf.length > 16) kbBuf = kbBuf.slice(0, 16);
      renderBuf(); renderLocal();
      setFocus(b); // 保持焦点不丢
    });
    renderBuf(); renderLocal();
    var firstBtn = document.querySelector('#tvsKb button');
    if (firstBtn) setFocus(firstBtn);
  }
  function maybeSearchPage() {
    var h = location.hash || '';
    if (h === '#/search' || h.indexOf('#/search?') === 0) {
      var qm = h.match(/[?&]q=/);
      if (!qm) { kbBuf = ''; mountTvSearch(); return true; }
    }
    var v = document.getElementById('view');
    if (v && v.dataset.tvSearch === '1' && h.indexOf('#/search') !== 0) v.dataset.tvSearch = '';
    return false;
  }

  /* ---------------- 启动 & 路由挂钩 ---------------- */
  function bootTv() {
    ensureLegend();
    tuneTopbar();
    maybeSearchPage();
    // 首页内容异步渲染 → 轮询一次建 Banner(最多10s)
    var tries = 0;
    var t = setInterval(function () {
      tries++;
      if (buildBanner() || tries > 40) clearInterval(t);
    }, 250);
    window.addEventListener('hashchange', function () {
      setTimeout(function () { tuneTopbar(); maybeSearchPage(); buildBanner(); }, 120);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootTv);
  else bootTv();
})();
