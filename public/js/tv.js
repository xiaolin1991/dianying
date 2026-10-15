/* ============================================================
 * 晓林影视 XIAOLIN-TV · 腾讯TV极光风格 (云视听极光) 终端大屏交互引擎
 * 适用范围: 智能电视 / 电视盒子 APK / 浏览器 ?tv=1 或顶栏「TV版」开关
 * 核心特性:
 *  1. 极简顶栏: 搜索 | 精选 | 电影 | 剧集 | 综艺 | 动漫 | 直播 + 右侧仅保留「👤 我的」与时钟
 *  2. 沉浸式大屏首页/分类页: 70% 巨幕背景随遥控器焦点卡片实时联动 + 6列超大海报
 *  3. 三栏同屏实时搜索: 左栏全键盘(A-Z)/T9九宫格 + 中栏猜你想搜/热榜 + 右栏同屏全站大海报(不跳页不丢焦点)
 *  4. 极简全屏播放器: 进片直达全屏，◀▶ 快进退 15秒，OK 暂停，▼/▲ 呼出底部选集与秒换源浮层
 *  5. 全局遥控器输入面板: 登录/注册/卡密激活全程大键位遥控器输入，告别手机软键盘
 * ============================================================ */
(function () {
  'use strict';

  /* ---------------- 1. TV 模式精准识别与开关 ---------------- */
  function checkTvMode() {
    try {
      var searchStr = (location.search || '') + '&' + ((location.hash || '').split('?')[1] || '');
      if (/(?:^|[?&])tv=0(?:&|$)/i.test(searchStr)) {
        try { localStorage.removeItem('ntv:tvMode'); sessionStorage.removeItem('ntv_tv_override'); } catch (e) {}
        return false;
      }
      if (/(?:^|[?&])tv=1(?:&|$)/i.test(searchStr)) {
        try { localStorage.setItem('ntv:tvMode', '1'); sessionStorage.setItem('ntv_tv_override', '1'); } catch (e) {}
        return true;
      }
      try {
        if (localStorage.getItem('ntv:tvMode') === '1' || sessionStorage.getItem('ntv_tv_override') === '1') return true;
      } catch (e) {}
      if (window.AndroidBridge && typeof window.AndroidBridge.isTv === 'function') {
        try { if (window.AndroidBridge.isTv()) return true; } catch (e) {}
      }
      var ua = navigator.userAgent || '';
      if (/XIAOLIN-TV-OS|LargeScreen|SmartTV|GoogleTV|Android\s*TV|Leanback|AFTB|AFTM|AFTT|AFTS|AFTN|MiBOX|MiTV|Tizen|Web0S|BRAVIA|Changhong|Hisense|Konka|Skyworth|TCL|VIDAA|Himedia|Dangbei|Projector/i.test(ua)) {
        return true;
      }
      var noTouch = !('ontouchstart' in window) && (navigator.maxTouchPoints || 0) === 0;
      return /Android/i.test(ua) && noTouch;
    } catch (e) {
      return false;
    }
  }

  if (!checkTvMode()) return;

  document.body.classList.add('tv');
  document.documentElement.classList.add('tv-root');

  var FOCUSED_CLS = 'tv-f';
  var heroDetailCache = new Map();
  var heroFetchTimer = null;
  var currentHeroHref = '';
  var osdHideTimer = null;
  var hintHideTimer = null;
  var hudHideTimer = null;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function stripTags(s) {
    return String(s || '').replace(/<[^>]*>/g, '').trim();
  }

  function getHooks() {
    return window.XLTV || {};
  }

  /* ---------------- 2. 空间焦点导航引擎 (D-Pad 几何寻路) ---------------- */
  function visible(el) {
    if (!el || el.disabled || (el.getAttribute && el.getAttribute('aria-hidden') === 'true')) return false;
    if (el.classList && el.classList.contains('hidden')) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 6 || r.height < 6) return false;
    var st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return false;
    if (el.offsetParent === null && st.position !== 'fixed' && st.position !== 'sticky') return false;
    return true;
  }

  function collectFocusable(scopeRoot) {
    var root = scopeRoot || document;
    // 若全局软键盘弹窗打开，焦点严格锁定在软键盘内
    var kbMask = document.getElementById('tvModalKbMask');
    if (!scopeRoot && kbMask && !kbMask.classList.contains('hidden')) {
      root = kbMask;
    } else if (!scopeRoot) {
      // 若 T9 子弹窗打开，焦点严格锁定在 T9 子弹窗内
      var t9Pop = document.getElementById('tvsT9Pop');
      if (t9Pop) root = t9Pop;
      else {
        // 若通用 modal 弹窗打开，焦点锁定在弹窗内
        var modal = document.querySelector('.modal-mask:not(.hidden)');
        if (modal) root = modal;
        else if (document.body.classList.contains('tv-playing')) {
          var osd = document.getElementById('tvPlayerOsd');
          if (osd && osd.classList.contains('open')) root = osd;
          else return [];
        }
      }
    }

    var list = root.querySelectorAll('a[href],button,input,select,[tabindex]:not([tabindex="-1"])');
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (!visible(el)) continue;
      if (el.id === 'vkbBox' || el.closest('#vkbBox')) continue;
      out.push(el);
    }
    return out;
  }

  function center(r) {
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function pickNext(cur, dir, scopeRoot) {
    var all = collectFocusable(scopeRoot);
    if (!all.length) return null;
    if (!cur || !visible(cur)) return all[0];

    var cr = cur.getBoundingClientRect();
    var c = center(cr);
    var best = null;
    var bestScore = Infinity;

    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el === cur || el.contains(cur) || cur.contains(el)) continue;
      var r = el.getBoundingClientRect();
      var m = center(r);
      var dx = m.x - c.x;
      var dy = m.y - c.y;
      var pri, sec;

      if (dir === 'left') {
        if (dx >= -4) continue;
        pri = -dx;
        sec = Math.abs(dy);
      } else if (dir === 'right') {
        if (dx <= 4) continue;
        pri = dx;
        sec = Math.abs(dy);
      } else if (dir === 'up') {
        if (dy >= -4) continue;
        pri = -dy;
        sec = Math.abs(dx);
      } else {
        if (dy <= 4) continue;
        pri = dy;
        sec = Math.abs(dx);
      }

      // 同容器内同行/同列优先加权
      var sameRowContainer = cur.parentElement && cur.parentElement === el.parentElement;
      if ((dir === 'left' || dir === 'right') && sec > Math.max(pri * 1.85, 160)) continue;
      if ((dir === 'up' || dir === 'down') && sec > Math.max(pri * 2.8, 360)) continue;

      var score = pri + sec * (sameRowContainer ? 1.6 : 2.35);
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }

    // 兜底放宽角度再找一次（例如从顶栏往下跳到巨幕按钮或第一张海报）
    if (!best && (dir === 'down' || dir === 'up')) {
      for (var j = 0; j < all.length; j++) {
        var el2 = all[j];
        if (el2 === cur) continue;
        var r2 = el2.getBoundingClientRect();
        var m2 = center(r2);
        var dy2 = m2.y - c.y;
        var dx2 = Math.abs(m2.x - c.x);
        if (dir === 'down' && dy2 <= 8) continue;
        if (dir === 'up' && dy2 >= -8) continue;
        var sc2 = Math.abs(dy2) * 1.5 + dx2 * 0.65;
        if (sc2 < bestScore) {
          bestScore = sc2;
          best = el2;
        }
      }
    }

    return best;
  }

  function setFocus(el, noScroll) {
    if (!el) return;
    try {
      var prevs = document.querySelectorAll('.' + FOCUSED_CLS);
      for (var i = 0; i < prevs.length; i++) prevs[i].classList.remove(FOCUSED_CLS);
    } catch (e) {}

    el.classList.add(FOCUSED_CLS);
    try {
      // 对只读 input 不直接調原生 focus 以免安卓弹系统软键盘
      if (el.tagName !== 'INPUT') el.focus({ preventScroll: true });
    } catch (e) {
      try { if (el.tagName !== 'INPUT') el.focus(); } catch (e2) {}
    }

    if (!noScroll) {
      try {
        var r = el.getBoundingClientRect();
        if (r.top < 100 || r.bottom > window.innerHeight - 90 || r.left < 30 || r.right > window.innerWidth - 30) {
          el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
        }
      } catch (e) {
        try { el.scrollIntoView(); } catch (e2) {}
      }
    }

    // 焦点落在海报卡片上时，实时联动顶部 70% 极光巨幕背景与简介
    if (el.classList && el.classList.contains('card')) {
      updateAuroraHeroFromCard(el);
    }
  }

  /* ---------------- 3. 顶栏改造: 极简频道胶囊 + 右侧「👤 我的」+ 时钟 ---------------- */
  function tuneTopbar() {
    var nav = document.getElementById('mainNav');
    if (nav) {
      var tvChannels = [
        ['#/search', '🔍 搜索'],
        ['#/home', '精选'],
        ['#/browse/电影', '电影'],
        ['#/browse/剧集', '剧集'],
        ['#/browse/综艺', '综艺'],
        ['#/browse/动漫', '动漫'],
        ['#/live', '直播']
      ];
      var curHash = '#/' + ((location.hash || '#/home').replace(/^#\/?/, '').split('?')[0] || 'home');
      var decodedHash = curHash;
      try { decodedHash = decodeURIComponent(curHash); } catch (e) {}

      // 仅当还未改造或路由激活态变化时更新
      if (nav.dataset.tvTuned !== '1') {
        nav.dataset.tvTuned = '1';
        nav.innerHTML = tvChannels.map(function (item) {
          return '<a href="' + item[0] + '" data-href="' + item[0] + '">' + item[1] + '</a>';
        }).join('');
      }
      var links = nav.querySelectorAll('a');
      for (var i = 0; i < links.length; i++) {
        var a = links[i];
        var dh = a.getAttribute('data-href') || '';
        var isAct = decodedHash === dh || (dh !== '#/home' && decodedHash.indexOf(dh) === 0);
        a.classList.toggle('active', isAct);
      }
    }

    // 右侧仅保留「👤 我的」与实时时钟
    var topRight = document.querySelector('.topbar-right');
    if (topRight) {
      var tvRight = document.getElementById('tvTopRight');
      if (!tvRight) {
        tvRight = document.createElement('div');
        tvRight.id = 'tvTopRight';
        tvRight.innerHTML =
          '<a id="tvMyEntry" href="#/user">👤 我的</a>' +
          '<span id="tvClock">20:30</span>';
        topRight.appendChild(tvRight);
      }
      var myEntry = document.getElementById('tvMyEntry');
      var hooks = getHooks();
      var st = hooks.getState ? hooks.getState() : null;
      var me = st && st.me ? st.me : null;
      if (myEntry) {
        myEntry.href = me ? '#/user' : '#/login';
        myEntry.textContent = me ? ('👤 ' + me) : '👤 我的';
        var h = location.hash || '';
        myEntry.classList.toggle('active', h.indexOf('#/user') === 0 || h.indexOf('#/login') === 0);
      }
      updateClock();
    }
  }

  function updateClock() {
    var el = document.getElementById('tvClock');
    if (!el) return;
    var d = new Date();
    var hh = String(d.getHours()).padStart(2, '0');
    var mm = String(d.getMinutes()).padStart(2, '0');
    el.textContent = hh + ':' + mm;
  }
  setInterval(updateClock, 15000);

  /* ---------------- 4. 底部遥控器操作提示条 + 退出TV预览开关 ---------------- */
  function ensureLegend() {
    if (document.getElementById('tvLegend')) return;
    var bar = document.createElement('div');
    bar.id = 'tvLegend';
    var isNativeTvApk = /XIAOLIN-TV-OS/i.test(navigator.userAgent || '') ||
      (window.AndroidBridge && typeof window.AndroidBridge.isTv === 'function' && window.AndroidBridge.isTv());
    bar.innerHTML =
      '<span><b>◀▶▲▼</b> 遥控移动</span>' +
      '<span><b>OK</b> 确认/播放</span>' +
      '<span><b>返回键</b> 上级/退出</span>' +
      (!isNativeTvApk ? '<button type="button" id="tvExitPreviewBtn" title="切回电脑/手机版界面">📺 退出TV模式</button>' : '');
    document.body.appendChild(bar);
    var exitBtn = document.getElementById('tvExitPreviewBtn');
    if (exitBtn) {
      exitBtn.addEventListener('click', function () {
        var hooks = getHooks();
        if (hooks && typeof hooks.setTvMode === 'function') {
          hooks.setTvMode(false);
        } else {
          try { localStorage.removeItem('ntv:tvMode'); sessionStorage.removeItem('ntv_tv_override'); } catch (e) {}
          var u = new URL(location.href);
          u.searchParams.delete('tv');
          location.href = u.pathname + u.search + (location.hash || '#/home');
        }
      });
    }
  }

  /* ---------------- 5. 首页与分类页: 70% 极光联动巨幕 (#tvAuroraHero) ---------------- */
  function isHomeOrBrowse() {
    var h = location.hash || '#/home';
    return h === '' || h === '#' || h === '#/' || h.indexOf('#/home') === 0 || h.indexOf('#/browse') === 0;
  }

  function ensureAuroraHero() {
    if (!isHomeOrBrowse()) return null;
    // 若在搜索页则不建巨幕
    var view = document.getElementById('view');
    if (!view || view.dataset.tvSearch === '1') return null;

    var container = view.querySelector('.container');
    if (!container) return null;

    var hero = document.getElementById('tvAuroraHero');
    if (!hero) {
      hero = document.createElement('div');
      hero.id = 'tvAuroraHero';
      hero.innerHTML =
        '<div class="tah-bg-blur" id="tahBgBlur"></div>' +
        '<div class="tah-bg-main" id="tahBgMain"></div>' +
        '<div class="tah-vignette"></div>' +
        '<div class="tah-content">' +
        '  <div class="tah-title" id="tahTitle">晓林影视 · 极光大屏影院</div>' +
        '  <div class="tah-tags" id="tahTags">' +
        '    <span class="tah-tag tah-4k">4K HDR</span>' +
        '    <span class="tah-tag">杜比视界</span>' +
        '    <span class="tah-tag">遥控器焦点联动预览</span>' +
        '  </div>' +
        '  <div class="tah-desc" id="tahDesc">使用遥控器方向键移动焦点至下方任意影片海报，大屏将实时预览影片背景与剧情简介，按 OK 键直接全屏起播。</div>' +
        '  <div class="tah-actions">' +
        '    <a class="tah-play-btn" id="tahPlayBtn" href="#/home">▶ 立即播放</a>' +
        '    <a class="tah-sub-btn" id="tahSearchBtn" href="#/search">🔍 首字母搜片</a>' +
        '  </div>' +
        '</div>';
      container.insertBefore(hero, container.firstChild);
    }

    // 若当前巨幕尚未填充实际影片，自动取第一张已加载的海报卡初始化
    var firstCard = view.querySelector('.card');
    if (firstCard && (!currentHeroHref || currentHeroHref === '#/home')) {
      updateAuroraHeroFromCard(firstCard);
    }
    return hero;
  }

  function parsePlayHref(href) {
    // 格式: #/play/<sourceKey>/<id>?ep=0&group=0
    var m = String(href || '').match(/^#\/play\/([^/?#]+)\/([^/?#]+)/);
    if (!m) return null;
    try {
      return { sourceKey: decodeURIComponent(m[1]), id: decodeURIComponent(m[2]) };
    } catch (e) {
      return { sourceKey: m[1], id: m[2] };
    }
  }

  function updateAuroraHeroFromCard(card) {
    if (!card) return;
    var hero = document.getElementById('tvAuroraHero') || ensureAuroraHero();
    if (!hero) return;

    var img = card.querySelector('img');
    var nameEl = card.querySelector('.card-name');
    var badgeEl = card.querySelector('.card-badge');
    var subEl = card.querySelector('.card-sub');
    var srcEl = card.querySelector('.card-src');

    var title = nameEl ? nameEl.textContent.trim() : '';
    var pic = img ? (img.getAttribute('src') || '') : '';
    var badge = badgeEl ? badgeEl.textContent.trim() : '';
    var sub = subEl ? subEl.textContent.trim() : '';
    var srcName = srcEl ? srcEl.textContent.trim() : '';
    var href = card.getAttribute('href') || '#/home';

    if (!title) return;
    currentHeroHref = href;

    var bgBlur = document.getElementById('tahBgBlur');
    var bgMain = document.getElementById('tahBgMain');
    var titleEl = document.getElementById('tahTitle');
    var tagsEl = document.getElementById('tahTags');
    var descEl = document.getElementById('tahDesc');
    var playBtn = document.getElementById('tahPlayBtn');

    if (titleEl) titleEl.textContent = title;
    if (playBtn) playBtn.setAttribute('href', href);
    if (pic) {
      var safePic = pic.replace(/"/g, '\\"');
      if (bgBlur) bgBlur.style.backgroundImage = 'url("' + safePic + '")';
      if (bgMain) bgMain.style.backgroundImage = 'url("' + safePic + '")';
    }

    var tagsHtml = '<span class="tah-tag tah-4k">4K HDR</span>';
    if (sub) {
      sub.split('·').forEach(function (part) {
        var t = part.trim();
        if (t) tagsHtml += '<span class="tah-tag">' + esc(t) + '</span>';
      });
    }
    if (badge && sub.indexOf(badge) === -1) {
      tagsHtml += '<span class="tah-tag">' + esc(badge) + '</span>';
    }
    if (srcName) {
      tagsHtml += '<span class="tah-tag">' + esc(srcName) + '</span>';
    }
    if (tagsEl) tagsEl.innerHTML = tagsHtml;

    var parsed = parsePlayHref(href);
    if (!parsed) return;
    var cacheKey = parsed.sourceKey + ':' + parsed.id;
    if (heroDetailCache.has(cacheKey)) {
      var cachedDesc = heroDetailCache.get(cacheKey);
      if (descEl && cachedDesc) descEl.textContent = cachedDesc;
      return;
    }

    if (descEl) {
      descEl.textContent = '《' + title + '》 · 按遥控器 OK 键立即全屏播放，支持自动连播与多线路秒换源。';
    }

    clearTimeout(heroFetchTimer);
    heroFetchTimer = setTimeout(function () {
      var hooks = getHooks();
      if (!hooks.findSourceByKey || !window.API || !window.API.detail) return;
      var srcObj = hooks.findSourceByKey(parsed.sourceKey);
      if (!srcObj) return;
      window.API.detail(srcObj, parsed.id, 8000).then(function (r) {
        var vod = r && r.list && r.list[0];
        if (!vod) return;
        var actor = stripTags(vod.vod_actor || '');
        var content = stripTags(vod.vod_content || '');
        var summary = '';
        if (actor) summary += '主演：' + actor.slice(0, 38) + (actor.length > 38 ? '… ' : ' · ');
        if (content) summary += content.slice(0, 110);
        if (summary) {
          heroDetailCache.set(cacheKey, summary);
          if (currentHeroHref === href && descEl) {
            descEl.textContent = summary;
          }
        }
      }).catch(function () {});
    }, 180);
  }

  /* ---------------- 6. 腾讯TV风格: 三栏同屏实时搜索页 (#/search) ---------------- */
  var searchState = {
    buf: '',
    kbMode: 'full', // 'full' | 't9'
    searchSeq: 0,
    debounceTimer: null
  };

  var T9_KEYS = [
    { num: '1', sub: '0 / 1', chars: ['1', '0'] },
    { num: '2', sub: 'ABC', chars: ['A', 'B', 'C', '2'] },
    { num: '3', sub: 'DEF', chars: ['D', 'E', 'F', '3'] },
    { num: '4', sub: 'GHI', chars: ['G', 'H', 'I', '4'] },
    { num: '5', sub: 'JKL', chars: ['J', 'K', 'L', '5'] },
    { num: '6', sub: 'MNO', chars: ['M', 'N', 'O', '6'] },
    { num: '7', sub: 'PQRS', chars: ['P', 'Q', 'R', 'S', '7'] },
    { num: '8', sub: 'TUV', chars: ['T', 'U', 'V', '8'] },
    { num: '9', sub: 'WXYZ', chars: ['W', 'X', 'Y', 'Z', '9'] }
  ];

  // 内置高频影视热词与首字母兜底词库（保证即使刚打开搜索页，首字母联想也秒出经典大片）
  var BUILTIN_HOT_TITLES = [
    { title: '庆余年 第二季', py: 'QYNDEJ' },
    { title: '流浪地球2', py: 'LLDQ2' },
    { title: '狂飙', py: 'KB' },
    { title: '三体', py: 'ST' },
    { title: '漫长的季节', py: 'MCDJJ' },
    { title: '封神第一部', py: 'FSDYB' },
    { title: '繁花', py: 'FH' },
    { title: '热辣滚烫', py: 'RLGT' },
    { title: '飞驰人生2', py: 'FCRS2' },
    { title: '第二十条', py: 'DEST' },
    { title: '周处除三害', py: 'ZCCSH' },
    { title: '唐朝诡事录', py: 'TCGSL' },
    { title: '凡人修仙传', py: 'FRXXZ' },
    { title: '完美世界', py: 'WMSJ' },
    { title: '斗破苍穹', py: 'DPCQ' },
    { title: '仙逆', py: 'XN' }
  ];

  function collectTitleCandidates(queryStr) {
    var hooks = getHooks();
    var q = String(queryStr || '').trim().toUpperCase();
    var seen = new Set();
    var results = [];

    function addCandidate(title, pic, remarks, sourceKey, id) {
      title = String(title || '').trim();
      if (!title || seen.has(title)) return;
      var py = (hooks.ti ? hooks.ti(title) : '') || '';
      if (q) {
        var matchPy = py.indexOf(q) === 0 || py.indexOf(q) >= 0;
        var matchTitle = title.toUpperCase().indexOf(q) >= 0;
        if (!matchPy && !matchTitle) return;
      }
      seen.add(title);
      results.push({
        title: title,
        py: py,
        pic: pic || '',
        remarks: remarks || '',
        sourceKey: sourceKey || '',
        id: id || ''
      });
    }

    // 1. 若无输入：优先展示最近搜索历史 + 本地已索引热播片 + 内置热搜词
    if (!q && hooks.store) {
      var hist = hooks.store.get('searchHist', []) || [];
      hist.forEach(function (h) { addCandidate(h, '', '历史搜索'); });
    }

    // 2. 遍历 TitleIdx 全站实时索引
    if (hooks.idx && typeof hooks.idx.forEach === 'function') {
      hooks.idx.forEach(function (it) {
        addCandidate(it.title, it.pic, it.remarks, it.sourceKey, it.id);
      });
    }

    // 3. 补充内置热门片单首字母联想
    BUILTIN_HOT_TITLES.forEach(function (b) {
      if (!q || b.py.indexOf(q) === 0 || b.title.indexOf(q) >= 0) {
        if (!seen.has(b.title)) {
          seen.add(b.title);
          results.push({ title: b.title, py: b.py, pic: '', remarks: '热搜' });
        }
      }
    });

    return results.slice(0, 10);
  }

  function mountTvSearch(initialQuery) {
    var view = document.getElementById('view');
    if (!view) return;

    if (initialQuery && typeof initialQuery === 'string' && initialQuery.trim()) {
      searchState.buf = initialQuery.trim().toUpperCase();
    }

    // 如果已经在三栏搜索页，只刷新数据和输入框，绝不重建 DOM 避免丢失键盘焦点
    if (view.dataset.tvSearch === '1' && document.getElementById('tvsAuroraWrap')) {
      renderSearchInputAndMid();
      triggerLiveSearch(searchState.buf, true);
      return;
    }

    view.dataset.tvSearch = '1';
    var fullChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890'.split('');

    view.innerHTML =
      '<div class="container page-wrap">' +
      '  <div class="tvs-aurora-wrap" id="tvsAuroraWrap">' +
      '    <!-- 左栏: 遥控器双模键盘 -->' +
      '    <div class="tvs-left-panel">' +
      '      <div class="tvs-input-box">' +
      '        <span class="tvs-input-ico">🔍</span>' +
      '        <div class="tvs-input-text is-placeholder" id="tvsInputDisplay">输入首字母(如QYN)或片名</div>' +
      '      </div>' +
      '      <div class="tvs-mode-tabs">' +
      '        <button type="button" class="tvs-mode-tab on" id="tvsTabFull" data-mode="full">全键盘 (A-Z)</button>' +
      '        <button type="button" class="tvs-mode-tab" id="tvsTabT9" data-mode="t9">T9 九宫格</button>' +
      '      </div>' +
      '      <div class="tvs-kb-full" id="tvsKbFull">' +
               fullChars.map(function (ch) {
                 return '<button type="button" class="tvs-char-btn" data-char="' + ch + '">' + ch + '</button>';
               }).join('') +
      '      </div>' +
      '      <div class="tvs-kb-t9 hidden" id="tvsKbT9">' +
               T9_KEYS.map(function (k, idx) {
                 return '<button type="button" class="tvs-t9-btn" data-t9="' + idx + '">' +
                        '<strong>' + k.num + '</strong><small>' + k.sub + '</small></button>';
               }).join('') +
      '      </div>' +
      '      <div class="tvs-fn-row">' +
      '        <button type="button" data-fn="DEL">⌫ 退格</button>' +
      '        <button type="button" data-fn="CLR">🗑 清空</button>' +
      '        <button type="button" class="tvs-fn-go" data-fn="GO">🔍 全网搜</button>' +
      '      </div>' +
      '    </div>' +
      '    <!-- 中栏: 猜你想搜 / 大家都在搜 -->' +
      '    <div class="tvs-mid-panel">' +
      '      <div class="tvs-col-title" id="tvsMidTitle">猜你想搜</div>' +
      '      <div class="tvs-col-sub" id="tvsMidSub">大家都在搜</div>' +
      '      <div class="tvs-sug-list" id="tvsSugList"></div>' +
      '    </div>' +
      '    <!-- 右栏: 同屏实时搜索结果大海报 -->' +
      '    <div class="tvs-right-panel">' +
      '      <div class="tvs-right-head">' +
      '        <div class="tvs-col-title" id="tvsRightTitle">搜索结果</div>' +
      '        <div class="tvs-right-stat" id="tvsRightStat">支持拼音首字母秒配与 12 源并发检索</div>' +
      '      </div>' +
      '      <div id="tvsResultGrid"></div>' +
      '    </div>' +
      '  </div>' +
      '</div>';

    bindTvSearchEvents();
    renderSearchInputAndMid();
    triggerLiveSearch(searchState.buf, true);

    setTimeout(function () {
      var firstKey = document.querySelector('#tvsKbFull button[data-char="A"]');
      if (firstKey) setFocus(firstKey, true);
    }, 60);
  }

  function switchSearchKbMode(mode) {
    searchState.kbMode = mode === 't9' ? 't9' : 'full';
    var tabFull = document.getElementById('tvsTabFull');
    var tabT9 = document.getElementById('tvsTabT9');
    var kbFull = document.getElementById('tvsKbFull');
    var kbT9 = document.getElementById('tvsKbT9');
    if (!kbFull || !kbT9) return;
    var isT9 = searchState.kbMode === 't9';
    tabFull.classList.toggle('on', !isT9);
    tabT9.classList.toggle('on', isT9);
    kbFull.classList.toggle('hidden', isT9);
    kbT9.classList.toggle('hidden', !isT9);
    closeT9SubPop();
  }

  function openT9SubPop(t9Idx, triggerBtn) {
    closeT9SubPop();
    var kbT9 = document.getElementById('tvsKbT9');
    var item = T9_KEYS[t9Idx];
    if (!kbT9 || !item) return;

    var pop = document.createElement('div');
    pop.id = 'tvsT9Pop';
    pop.className = 'tvs-t9-pop';
    pop.innerHTML =
      '<div class="tvs-t9-pop-title">方向键选择字符 · 按返回键关闭</div>' +
      '<div class="tvs-t9-pop-row">' +
      item.chars.map(function (c) {
        return '<button type="button" class="tvs-t9-sub" data-subchar="' + c + '">' + c + '</button>';
      }).join('') +
      '<button type="button" class="tvs-t9-sub" data-subclose="1" style="font-size:16px">返回</button>' +
      '</div>';
    kbT9.appendChild(pop);

    pop.addEventListener('click', function (e) {
      var subBtn = e.target.closest('button[data-subchar]');
      if (subBtn) {
        var ch = subBtn.getAttribute('data-subchar');
        closeT9SubPop();
        appendSearchChar(ch);
        if (triggerBtn) setFocus(triggerBtn, true);
        return;
      }
      if (e.target.closest('button[data-subclose]')) {
        closeT9SubPop();
        if (triggerBtn) setFocus(triggerBtn, true);
      }
    });

    var firstSub = pop.querySelector('.tvs-t9-sub');
    if (firstSub) setFocus(firstSub, true);
  }

  function closeT9SubPop() {
    var pop = document.getElementById('tvsT9Pop');
    if (pop) pop.remove();
  }

  function appendSearchChar(ch) {
    searchState.buf = (searchState.buf + ch).slice(0, 18);
    renderSearchInputAndMid();
    scheduleLiveSearch();
  }

  function bindTvSearchEvents() {
    var wrap = document.getElementById('tvsAuroraWrap');
    if (!wrap) return;

    wrap.addEventListener('click', function (e) {
      var modeBtn = e.target.closest('.tvs-mode-tab');
      if (modeBtn) {
        switchSearchKbMode(modeBtn.getAttribute('data-mode'));
        setFocus(modeBtn, true);
        return;
      }

      var charBtn = e.target.closest('.tvs-char-btn');
      if (charBtn) {
        appendSearchChar(charBtn.getAttribute('data-char'));
        setFocus(charBtn, true);
        return;
      }

      var t9Btn = e.target.closest('.tvs-t9-btn');
      if (t9Btn) {
        openT9SubPop(Number(t9Btn.getAttribute('data-t9')), t9Btn);
        return;
      }

      var fnBtn = e.target.closest('button[data-fn]');
      if (fnBtn) {
        var fn = fnBtn.getAttribute('data-fn');
        if (fn === 'DEL') {
          searchState.buf = searchState.buf.slice(0, -1);
          renderSearchInputAndMid();
          scheduleLiveSearch();
        } else if (fn === 'CLR') {
          searchState.buf = '';
          renderSearchInputAndMid();
          triggerLiveSearch('', true);
        } else if (fn === 'GO') {
          triggerLiveSearch(searchState.buf, true);
        }
        setFocus(fnBtn, true);
        return;
      }

      var sugBtn = e.target.closest('.tvs-sug-btn');
      if (sugBtn) {
        var word = sugBtn.getAttribute('data-word') || '';
        if (word) {
          var disp = document.getElementById('tvsInputDisplay');
          if (disp) {
            disp.textContent = word;
            disp.classList.remove('is-placeholder');
          }
          triggerLiveSearch(word, true);
          setFocus(sugBtn, true);
        }
      }
    });
  }

  function renderSearchInputAndMid() {
    var disp = document.getElementById('tvsInputDisplay');
    var midTitle = document.getElementById('tvsMidTitle');
    var midSub = document.getElementById('tvsMidSub');
    var sugList = document.getElementById('tvsSugList');
    if (!disp || !sugList) return;

    if (searchState.buf) {
      disp.textContent = searchState.buf.split('').join(' ');
      disp.classList.remove('is-placeholder');
      if (midTitle) midTitle.textContent = '猜你想搜';
      if (midSub) midSub.textContent = '首字母「' + searchState.buf + '」智能联想';
    } else {
      disp.textContent = '输入首字母(如QYN)或片名';
      disp.classList.add('is-placeholder');
      if (midTitle) midTitle.textContent = '猜你想搜';
      if (midSub) midSub.textContent = '大家都在搜';
    }

    var cands = collectTitleCandidates(searchState.buf);
    if (!cands.length && searchState.buf) {
      cands = [{ title: searchState.buf, py: '全网直接搜索该关键词', remarks: '直搜' }];
    }

    sugList.innerHTML = cands.map(function (c, idx) {
      var rankCls = idx === 0 ? 'r1' : idx === 1 ? 'r2' : idx === 2 ? 'r3' : '';
      return '<button type="button" class="tvs-sug-btn" data-word="' + esc(c.title) + '">' +
        '<span class="tvs-sug-rank ' + rankCls + '">' + (idx + 1) + '</span>' +
        '<div class="tvs-sug-info">' +
        '  <div class="tvs-sug-name">' + esc(c.title) + '</div>' +
        (c.py ? '  <div class="tvs-sug-py">' + esc(c.py) + '</div>' : '') +
        '</div>' +
        '</button>';
    }).join('');
  }

  function scheduleLiveSearch() {
    clearTimeout(searchState.debounceTimer);
    // 先0延迟渲染本地首字母匹配结果到右侧海报墙
    renderLocalPosterPreview(searchState.buf);
    searchState.debounceTimer = setTimeout(function () {
      triggerLiveSearch(searchState.buf, false);
    }, 420);
  }

  function renderLocalPosterPreview(rawQ) {
    var grid = document.getElementById('tvsResultGrid');
    var stat = document.getElementById('tvsRightStat');
    var rightTitle = document.getElementById('tvsRightTitle');
    var hooks = getHooks();
    if (!grid || !hooks.cardHtml) return;

    var q = String(rawQ || '').trim().toUpperCase();
    var localItems = [];
    if (hooks.idx && typeof hooks.idx.forEach === 'function') {
      hooks.idx.forEach(function (it) {
        if (!it.pic) return;
        if (!q) {
          if (localItems.length < 12) localItems.push(it);
          return;
        }
        var py = hooks.ti ? hooks.ti(it.title) : '';
        if (py.indexOf(q) === 0 || it.title.toUpperCase().indexOf(q) >= 0) {
          localItems.push(it);
        }
      });
    }

    if (!q) {
      if (rightTitle) rightTitle.textContent = '🔥 热门大片推荐';
      if (stat) stat.textContent = '在左侧按遥控器输入片名首字母（如 QYN）即可实时检索全站';
      if (localItems.length) {
        grid.innerHTML = localItems.slice(0, 12).map(hooks.cardHtml).join('');
      }
      return;
    }

    if (localItems.length) {
      if (rightTitle) rightTitle.textContent = '搜索结果';
      if (stat) stat.textContent = '已秒配 ' + localItems.length + ' 部本地片源 · 正在并发检索全网影视源…';
      grid.innerHTML = localItems.slice(0, 18).map(hooks.cardHtml).join('');
    }
  }

  async function triggerLiveSearch(rawQuery, immediate) {
    var grid = document.getElementById('tvsResultGrid');
    var stat = document.getElementById('tvsRightStat');
    var rightTitle = document.getElementById('tvsRightTitle');
    var hooks = getHooks();
    if (!grid || !hooks.visibleSources || !window.API) return;

    var q = String(rawQuery || '').trim();
    if (!q) {
      renderLocalPosterPreview('');
      return;
    }

    // 若用户输入的是纯字母缩写(如 QYN)，优先取中栏第1条匹配的中文片名做全网聚合搜索
    var effectiveQuery = q;
    if (/^[a-zA-Z]{2,10}$/.test(q)) {
      var cands = collectTitleCandidates(q);
      if (cands.length && cands[0].title && !/^[a-zA-Z]+$/.test(cands[0].title)) {
        effectiveQuery = cands[0].title;
      }
    }

    var seq = ++searchState.searchSeq;
    var sources = hooks.visibleSources();
    if (!sources || !sources.length) return;

    if (immediate) {
      if (hooks.pushSearchHist) hooks.pushSearchHist(effectiveQuery);
      if (hooks.logSearch) hooks.logSearch(effectiveQuery);
    }

    if (rightTitle) rightTitle.textContent = '搜索结果 · ' + effectiveQuery;
    if (stat) stat.textContent = '⏳ 正在并发检索 ' + sources.length + ' 个影视源…';

    var merged = new Map();
    // 先保留本地秒配项
    if (/^[a-zA-Z]{1,10}$/.test(q) && hooks.idx) {
      var up = q.toUpperCase();
      hooks.idx.forEach(function (it) {
        var py = hooks.ti ? hooks.ti(it.title) : '';
        if (py.indexOf(up) === 0 && it.pic) {
          var k0 = it.title + '|' + (it.year || '');
          merged.set(k0, Object.assign({}, it, { srcCount: 1, showSource: true }));
        }
      });
    }

    var done = 0;
    var idx = 0;
    var CONC = Math.min(10, sources.length);

    function renderMerged() {
      if (seq !== searchState.searchSeq) return;
      var curGrid = document.getElementById('tvsResultGrid');
      var curStat = document.getElementById('tvsRightStat');
      if (!curGrid) return;
      var arr = Array.from(merged.values()).sort(function (a, b) {
        return (b.srcCount || 1) - (a.srcCount || 1);
      });
      if (curStat) {
        curStat.textContent = (done >= sources.length ? '✅ 搜索完成 · ' : '⏳ 检索中 (' + done + '/' + sources.length + ') · ') +
          '为您找到 ' + arr.length + ' 部精彩内容';
      }
      if (arr.length) {
        curGrid.innerHTML = arr.slice(0, 36).map(hooks.cardHtml).join('');
      } else if (done >= sources.length) {
        curGrid.innerHTML = '<div class="empty" style="grid-column:1/-1;padding:48px 0"><div class="big">🙈</div><p>未找到「' + esc(effectiveQuery) + '」相关影片，请尝试其他首字母或关键词</p></div>';
      }
    }

    async function worker() {
      while (idx < sources.length) {
        if (seq !== searchState.searchSeq) return;
        var s = sources[idx++];
        try {
          var r = await window.API.search(s, effectiveQuery, 1, 12000);
          if (seq !== searchState.searchSeq) return;
          var list = (r && r.list) || [];
          for (var i = 0; i < list.length; i++) {
            var vod = list[i];
            var title = String(vod.vod_name || '').trim();
            if (!title) continue;
            var k = title.replace(/[\s·:：,，.!！?？]/g, '').toLowerCase() + '|' + (vod.vod_year || '');
            var hit = {
              sourceKey: s.key,
              sourceName: s.name,
              adult: s.adult,
              id: vod.vod_id,
              title: title,
              pic: vod.vod_pic,
              remarks: vod.vod_remarks,
              year: vod.vod_year,
              typeName: vod.type_name,
              srcCount: 1,
              showSource: true
            };
            if (merged.has(k)) {
              merged.get(k).srcCount++;
            } else {
              merged.set(k, hit);
            }
          }
        } catch (e) {}
        done++;
        renderMerged();
      }
    }

    var workers = [];
    for (var w = 0; w < CONC; w++) workers.push(worker());
    await Promise.allSettled(workers);
    renderMerged();
  }

  window.XLTV_MOUNT_SEARCH = async function (q) {
    mountTvSearch(q);
  };

  /* ---------------- 7. 极简全屏播放页与遥控器底部选集/换源浮层 (#tvPlayerOsd) ---------------- */
  function isPlayRoute() {
    return (location.hash || '').indexOf('#/play/') === 0;
  }

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function syncTvPlayerMode() {
    var playing = isPlayRoute();
    document.body.classList.toggle('tv-playing', playing);
    if (!playing) return;

    var wrap = document.getElementById('videoWrap');
    var video = document.getElementById('videoEl');
    if (!wrap || !video) return;

    // 禁用桌面/手机原生控制条，统一由 TV 极光浮层控制
    video.removeAttribute('controls');

    if (!document.getElementById('tvPlayHint')) {
      var hint = document.createElement('div');
      hint.id = 'tvPlayHint';
      hint.innerHTML =
        '<span><b>◀▶</b> 快进/快退</span>' +
        '<span><b>OK</b> 暂停/播放</span>' +
        '<span><b>▼</b> 选集/换源</span>' +
        '<span><b>返回</b> 退出</span>';
      wrap.appendChild(hint);
    }

    if (!document.getElementById('tvPlayCenterHud')) {
      var hud = document.createElement('div');
      hud.id = 'tvPlayCenterHud';
      wrap.appendChild(hud);
    }

    if (!document.getElementById('tvPlayerOsd')) {
      var osd = document.createElement('div');
      osd.id = 'tvPlayerOsd';
      osd.innerHTML =
        '<div class="tvo-head">' +
        '  <div class="tvo-title" id="tvoTitle">正在播放</div>' +
        '  <div class="tvo-sub" id="tvoSub">▲▼ 切换选集与线路 · OK 确认 · 返回键收起</div>' +
        '</div>' +
        '<div class="tvo-prog-row">' +
        '  <span class="tvo-time" id="tvoCurTime">00:00:00</span>' +
        '  <div class="tvo-bar-track"><div class="tvo-bar-fill" id="tvoBarFill"></div></div>' +
        '  <span class="tvo-time" id="tvoDurTime">/ 00:00:00</span>' +
        '</div>' +
        '<div class="tvo-rail" id="tvOsdEpRow"></div>' +
        '<div class="tvo-rail" id="tvOsdSrcRow"></div>';
      wrap.appendChild(osd);

      // 绑定时间进度刷新
      video.addEventListener('timeupdate', updateOsdProgress);
      video.addEventListener('loadedmetadata', updateOsdProgress);
      video.addEventListener('play', function () { scheduleHideHint(4200); });
    }

    refreshOsdContent();
    scheduleHideHint(5000);
  }

  function scheduleHideHint(ms) {
    var hint = document.getElementById('tvPlayHint');
    if (!hint) return;
    hint.classList.remove('hide');
    clearTimeout(hintHideTimer);
    hintHideTimer = setTimeout(function () {
      var osd = document.getElementById('tvPlayerOsd');
      if (!osd || !osd.classList.contains('open')) {
        hint.classList.add('hide');
      }
    }, ms || 4500);
  }

  function showCenterHud(text, ms) {
    var hud = document.getElementById('tvPlayCenterHud');
    if (!hud) return;
    hud.textContent = text;
    hud.classList.add('show');
    clearTimeout(hudHideTimer);
    hudHideTimer = setTimeout(function () {
      hud.classList.remove('show');
    }, ms || 1200);
  }

  function updateOsdProgress() {
    var video = document.getElementById('videoEl');
    var curEl = document.getElementById('tvoCurTime');
    var durEl = document.getElementById('tvoDurTime');
    var fillEl = document.getElementById('tvoBarFill');
    if (!video || !curEl || !durEl || !fillEl) return;
    var c = video.currentTime || 0;
    var d = video.duration || 0;
    curEl.textContent = fmtTime(c);
    durEl.textContent = '/ ' + fmtTime(d);
    var pct = d > 0 ? Math.min(100, Math.max(0, (c / d) * 100)) : 0;
    fillEl.style.width = pct.toFixed(2) + '%';
  }

  function refreshOsdContent() {
    var pbTitle = document.querySelector('.pb-title');
    var curEpEl = document.getElementById('curEpName');
    var tvoTitle = document.getElementById('tvoTitle');
    if (tvoTitle && pbTitle) {
      var epStr = curEpEl ? curEpEl.textContent.trim() : '';
      var rawTitle = pbTitle.childNodes[0] ? pbTitle.childNodes[0].textContent.trim() : pbTitle.textContent.trim();
      tvoTitle.textContent = '《' + rawTitle + '》 ' + epStr;
    }

    // 1. 同步选集大胶囊按钮 (#sideEps .ep-btn)
    var epRow = document.getElementById('tvOsdEpRow');
    var sideEps = document.querySelectorAll('#sideEps .ep-btn');
    if (epRow && sideEps.length) {
      var epHtml = '';
      // 若有翻页按钮 (#epsNavTop .chip)
      var navChips = document.querySelectorAll('#epsNavTop button.chip');
      if (navChips.length >= 2 && !navChips[0].disabled) {
        epHtml += '<button type="button" class="tvo-pill" data-epnav="0">‹ 上一页剧集</button>';
      }
      for (var i = 0; i < sideEps.length; i++) {
        var b = sideEps[i];
        var isCur = b.classList.contains('current');
        var label = b.textContent.trim();
        epHtml += '<button type="button" class="tvo-pill ' + (isCur ? 'current' : '') + '" data-epidx="' + i + '">' +
          '<span>' + esc(label) + '</span>' +
          (isCur ? '<small>[正在播放]</small>' : '') +
          '</button>';
      }
      if (navChips.length >= 2 && !navChips[1].disabled) {
        epHtml += '<button type="button" class="tvo-pill" data-epnav="1">下一页剧集 ›</button>';
      }
      epRow.innerHTML = epHtml;
      epRow.onclick = function (e) {
        var pill = e.target.closest('button.tvo-pill');
        if (!pill) return;
        if (pill.hasAttribute('data-epnav')) {
          var navIdx = Number(pill.getAttribute('data-epnav'));
          var nBtns = document.querySelectorAll('#epsNavTop button.chip');
          if (nBtns[navIdx]) {
            nBtns[navIdx].click();
            setTimeout(function () {
              refreshOsdContent();
              var firstNew = document.querySelector('#tvOsdEpRow .tvo-pill');
              if (firstNew) setFocus(firstNew, false);
            }, 80);
          }
          return;
        }
        var idx = Number(pill.getAttribute('data-epidx'));
        var origBtns = document.querySelectorAll('#sideEps .ep-btn');
        if (origBtns[idx]) {
          origBtns[idx].click();
          setTimeout(function () {
            refreshOsdContent();
            closePlayerOsd();
          }, 120);
        }
      };
    }

    // 2. 同步快速换源与快捷操作胶囊 (#srcSwitch a.src-item)
    var srcRow = document.getElementById('tvOsdSrcRow');
    if (srcRow) {
      var curBadge = document.querySelector('#srcBadge span');
      var curSrcName = curBadge ? curBadge.textContent.trim() : '当前源';
      var srcItems = document.querySelectorAll('#srcSwitch a.src-item');
      var favBtn = document.getElementById('playFav');
      var isFav = favBtn && favBtn.classList.contains('on');

      var srcHtml = '<button type="button" class="tvo-pill current" data-act="cursrc">' +
        '<span>线路1: ' + esc(curSrcName) + '</span><small>[当前线路]</small></button>';

      for (var s = 0; s < Math.min(8, srcItems.length); s++) {
        var a = srcItems[s];
        var sNameEl = a.querySelector('span');
        var spdEl = a.querySelector('i.spd');
        var sName = sNameEl ? sNameEl.textContent.trim() : ('备用源' + (s + 2));
        var spd = spdEl ? spdEl.textContent.trim() : '可用';
        srcHtml += '<button type="button" class="tvo-pill" data-swap="' + s + '">' +
          '<span>线路' + (s + 2) + ': ' + esc(sName) + '</span><small>' + esc(spd) + '</small></button>';
      }

      srcHtml +=
        '<button type="button" class="tvo-pill" data-act="fav"><span>' + (isFav ? '★ 已收藏' : '☆ 收藏影片') + '</span></button>' +
        '<button type="button" class="tvo-pill" data-act="exit"><span>🚪 退出播放</span></button>';

      srcRow.innerHTML = srcHtml;
      srcRow.onclick = function (e) {
        var pill = e.target.closest('button.tvo-pill');
        if (!pill) return;
        if (pill.hasAttribute('data-swap')) {
          var sIdx = Number(pill.getAttribute('data-swap'));
          var links = document.querySelectorAll('#srcSwitch a.src-item');
          if (links[sIdx]) {
            closePlayerOsd();
            location.replace(links[sIdx].getAttribute('href'));
          }
          return;
        }
        var act = pill.getAttribute('data-act');
        if (act === 'fav') {
          var fb = document.getElementById('playFav');
          if (fb) fb.click();
          refreshOsdContent();
          var newFavPill = srcRow.querySelector('button[data-act="fav"]');
          if (newFavPill) setFocus(newFavPill, true);
        } else if (act === 'exit') {
          closePlayerOsd();
          if (window.history.length > 1) window.history.back();
          else location.hash = '#/home';
        } else if (act === 'cursrc') {
          closePlayerOsd();
        }
      };
    }
  }

  function openPlayerOsd() {
    var osd = document.getElementById('tvPlayerOsd');
    if (!osd) return;
    refreshOsdContent();
    updateOsdProgress();
    osd.classList.add('open');
    scheduleHideHint(8000);
    bumpOsdTimer();
    var curEpPill = osd.querySelector('#tvOsdEpRow .tvo-pill.current') || osd.querySelector('.tvo-pill');
    if (curEpPill) setFocus(curEpPill, false);
  }

  function closePlayerOsd() {
    var osd = document.getElementById('tvPlayerOsd');
    if (osd) osd.classList.remove('open');
    clearTimeout(osdHideTimer);
    scheduleHideHint(2500);
  }

  function bumpOsdTimer() {
    clearTimeout(osdHideTimer);
    osdHideTimer = setTimeout(function () {
      closePlayerOsd();
    }, 8500);
  }

  /* ---------------- 8. 全局 TV 遥控器软键盘弹窗 (#tvModalKbMask) ---------------- */
  var modalKbState = {
    targetInput: null,
    upper: false
  };

  function ensureModalKb() {
    var mask = document.getElementById('tvModalKbMask');
    if (mask) return mask;
    mask = document.createElement('div');
    mask.id = 'tvModalKbMask';
    mask.className = 'hidden';
    document.body.appendChild(mask);
    return mask;
  }

  function openModalKb(inputEl) {
    if (!inputEl) return;
    modalKbState.targetInput = inputEl;
    inputEl.readOnly = true; // 防止弹出安卓系统残缺软键盘
    var mask = ensureModalKb();
    renderModalKb();
    mask.classList.remove('hidden');
    var firstKey = mask.querySelector('.tmk-key');
    if (firstKey) setFocus(firstKey, true);
  }

  function closeModalKb(focusNext) {
    var mask = document.getElementById('tvModalKbMask');
    var target = modalKbState.targetInput;
    if (mask) mask.classList.add('hidden');
    modalKbState.targetInput = null;
    if (target && focusNext) {
      var formHost = target.closest('.login-box, .modal-box') || document;
      var subBtn = formHost.querySelector('#authBtn, .btn-submit, .t-go, button.primary');
      if (subBtn && visible(subBtn)) setFocus(subBtn, true);
      else setFocus(target, true);
    }
  }

  function renderModalKb() {
    var mask = ensureModalKb();
    var t = modalKbState.targetInput;
    var val = t ? (t.value || '') : '';
    var placeholder = t ? (t.getAttribute('placeholder') || '请输入内容') : '请输入';
    var letters = (modalKbState.upper ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' : 'abcdefghijklmnopqrstuvwxyz').split('');
    var nums = '1234567890_@.-'.split('');
    var allKeys = letters.concat(nums);

    mask.innerHTML =
      '<div class="tmk-box">' +
      '  <div class="tmk-head">' +
      '    <div class="tmk-title">📺 遥控器输入 · ' + esc(placeholder) + '</div>' +
      '    <div style="font-size:14px;color:#8fa4c9">方向键选择 · OK 输入 · 返回键完成</div>' +
      '  </div>' +
      '  <div class="tmk-preview">' + (val ? esc(val) : '<span style="color:#657aa3;font-size:17px">' + esc(placeholder) + '</span>') + '</div>' +
      '  <div class="tmk-grid">' +
           allKeys.map(function (k) {
             return '<button type="button" class="tmk-key" data-k="' + esc(k) + '">' + esc(k) + '</button>';
           }).join('') +
      '    <button type="button" class="tmk-key fn" data-fn="CASE" style="grid-column:span 2">' + (modalKbState.upper ? '⇩ 小写' : '⇧ 大写') + '</button>' +
      '    <button type="button" class="tmk-key fn" data-fn="DEL" style="grid-column:span 2">⌫ 退格</button>' +
      '    <button type="button" class="tmk-key fn" data-fn="CLR" style="grid-column:span 2">🗑 清空</button>' +
      '    <button type="button" class="tmk-key ok" data-fn="DONE" style="grid-column:span 3">✅ 确认完成</button>' +
      '  </div>' +
      '</div>';

    mask.onclick = function (e) {
      if (e.target === mask) {
        closeModalKb(true);
        return;
      }
      var btn = e.target.closest('button.tmk-key');
      if (!btn || !modalKbState.targetInput) return;
      var k = btn.getAttribute('data-k');
      var fn = btn.getAttribute('data-fn');
      var inp = modalKbState.targetInput;

      if (k !== null) {
        inp.value = (inp.value || '') + k;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        var prev = mask.querySelector('.tmk-preview');
        if (prev) prev.textContent = inp.value;
        setFocus(btn, true);
      } else if (fn === 'DEL') {
        inp.value = (inp.value || '').slice(0, -1);
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        renderModalKb();
        var delBtn = mask.querySelector('button[data-fn="DEL"]');
        if (delBtn) setFocus(delBtn, true);
      } else if (fn === 'CLR') {
        inp.value = '';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        renderModalKb();
        var clrBtn = mask.querySelector('button[data-fn="CLR"]');
        if (clrBtn) setFocus(clrBtn, true);
      } else if (fn === 'CASE') {
        modalKbState.upper = !modalKbState.upper;
        renderModalKb();
        var caseBtn = mask.querySelector('button[data-fn="CASE"]');
        if (caseBtn) setFocus(caseBtn, true);
      } else if (fn === 'DONE') {
        closeModalKb(true);
      }
    };
  }

  // 全局拦截 TV 模式下对任何输入框的点击/确认
  document.addEventListener('click', function (e) {
    var inp = e.target.closest('input');
    if (!inp) return;
    var type = (inp.getAttribute('type') || 'text').toLowerCase();
    if (/^(text|password|search|tel|email|url)$/.test(type)) {
      e.preventDefault();
      e.stopPropagation();
      openModalKb(inp);
    }
  }, true);

  /* ---------------- 9. 电视直播页 (#/live) 遥控器适配 ---------------- */
  function enhanceLivePage() {
    if ((location.hash || '').indexOf('#/live') !== 0) return;
    var chs = document.querySelectorAll('#liveChs .live-ch');
    for (var i = 0; i < chs.length; i++) {
      var ch = chs[i];
      if (!ch.hasAttribute('tabindex')) {
        ch.setAttribute('tabindex', '0');
        ch.setAttribute('role', 'button');
      }
    }
  }

  /* ---------------- 10. 全局遥控器按键中枢 (方向键 / OK / 返回键) ---------------- */
  function handleBackAction() {
    // 1. 若全局输入软键盘打开，先关软键盘
    var kbMask = document.getElementById('tvModalKbMask');
    if (kbMask && !kbMask.classList.contains('hidden')) {
      closeModalKb(true);
      return true;
    }
    // 2. 若 T9 子键盘打开，先关 T9 子键盘
    var t9Pop = document.getElementById('tvsT9Pop');
    if (t9Pop) {
      closeT9SubPop();
      var firstT9 = document.querySelector('#tvsKbT9 .tvs-t9-btn');
      if (firstT9) setFocus(firstT9, true);
      return true;
    }
    // 3. 若播放页底部选集浮层打开，先收起选集浮层
    if (isPlayRoute()) {
      var osd = document.getElementById('tvPlayerOsd');
      if (osd && osd.classList.contains('open')) {
        closePlayerOsd();
        return true;
      }
    }
    // 4. 若页面有弹窗 (.modal-mask)，先关闭弹窗
    var mask = document.querySelector('.modal-mask:not(.hidden)');
    if (mask) {
      var closeBtn = mask.querySelector('.modal-close, .btn-cancel, button');
      if (closeBtn) closeBtn.click();
      else mask.remove();
      return true;
    }
    // 5. 非首页则回退上一页
    var h = location.hash || '#/home';
    if (h !== '#/home' && h !== '#/' && h !== '') {
      if (window.history.length > 1) window.history.back();
      else location.hash = '#/home';
      return true;
    }
    return false;
  }

  // 供安卓客户端 MainActivity.onBackPressed 优先调用
  window.__xlTvBack = function () {
    return handleBackAction() ? 1 : 0;
  };

  window.addEventListener('keydown', function (ev) {
    var k = ev.key;
    var code = ev.keyCode;

    // 返回键兼容: Escape / Backspace / Android Back (4) / LG WebOS (461) / Samsung Tizen (10009)
    var isBack = k === 'Escape' || k === 'Backspace' || k === 'GoBack' || k === 'BrowserBack' || code === 4 || code === 461 || code === 10009;
    if (isBack) {
      if (handleBackAction()) {
        ev.preventDefault();
        ev.stopPropagation();
      }
      return;
    }

    var dir = null;
    if (k === 'ArrowUp' || code === 19) dir = 'up';
    else if (k === 'ArrowDown' || code === 20) dir = 'down';
    else if (k === 'ArrowLeft' || code === 21) dir = 'left';
    else if (k === 'ArrowRight' || code === 22) dir = 'right';

    var isOk = k === 'Enter' || k === ' ' || code === 23 || code === 66;

    // 播放页专属遥控器控制逻辑
    if (isPlayRoute() && !document.querySelector('.modal-mask:not(.hidden)')) {
      var osd = document.getElementById('tvPlayerOsd');
      var video = document.getElementById('videoEl');
      var isOsdOpen = osd && osd.classList.contains('open');

      if (!isOsdOpen) {
        if (dir === 'left' || dir === 'right') {
          ev.preventDefault();
          ev.stopPropagation();
          if (video && video.duration) {
            var step = dir === 'right' ? 15 : -15;
            var targetTime = Math.min(video.duration - 0.5, Math.max(0, (video.currentTime || 0) + step));
            try { video.currentTime = targetTime; } catch (e) {}
            showCenterHud((step > 0 ? '⏩ 快进 15秒 · ' : '⏪ 快退 15秒 · ') + fmtTime(targetTime) + ' / ' + fmtTime(video.duration), 1400);
            scheduleHideHint(3500);
          }
          return;
        }
        if (dir === 'down' || dir === 'up' || k === 'ContextMenu' || code === 82) {
          ev.preventDefault();
          ev.stopPropagation();
          openPlayerOsd();
          return;
        }
        if (isOk) {
          ev.preventDefault();
          ev.stopPropagation();
          if (video) {
            if (video.paused) {
              video.play().catch(function () {});
              showCenterHud('▶ 继续播放', 900);
            } else {
              video.pause();
              showCenterHud('⏸ 已暂停 · 按 OK 键继续播放', 2500);
            }
            scheduleHideHint(4000);
          }
          return;
        }
      } else {
        // 播放页底部选集浮层打开中
        bumpOsdTimer();
        if (dir) {
          ev.preventDefault();
          ev.stopPropagation();
          var curOsdFocus = osd.querySelector('.' + FOCUSED_CLS) || osd.querySelector('.tvo-pill');
          var nextOsd = pickNext(curOsdFocus, dir, osd);
          if (nextOsd) setFocus(nextOsd, false);
          return;
        }
        if (isOk) {
          ev.preventDefault();
          ev.stopPropagation();
          var actPill = osd.querySelector('.' + FOCUSED_CLS);
          if (actPill) actPill.click();
          return;
        }
      }
    }

    // 常规页面: 方向键空间寻路
    if (dir) {
      ev.preventDefault();
      ev.stopPropagation();
      var cur = document.querySelector('.' + FOCUSED_CLS);
      if (!cur || !visible(cur)) {
        cur = document.activeElement && visible(document.activeElement) ? document.activeElement : null;
      }
      var next = pickNext(cur, dir);
      if (next) setFocus(next, false);
      return;
    }

    // OK 键触发当前焦点元素点击
    if (isOk) {
      var focused = document.querySelector('.' + FOCUSED_CLS);
      if (focused && visible(focused)) {
        ev.preventDefault();
        ev.stopPropagation();
        if (focused.tagName === 'INPUT') {
          openModalKb(focused);
        } else {
          focused.click();
        }
      }
    }
  }, true);

  /* ---------------- 11. 启动与页面生命周期同步 ---------------- */
  function syncTvScreen() {
    ensureLegend();
    tuneTopbar();
    syncTvPlayerMode();
    enhanceLivePage();

    var h = location.hash || '#/home';
    if (h === '#/search' || h.indexOf('#/search?') === 0) {
      var qm = h.match(/[?&]q=([^&]*)/);
      var qVal = qm ? decodeURIComponent(qm[1]) : '';
      mountTvSearch(qVal);
      return;
    } else {
      var view = document.getElementById('view');
      if (view && view.dataset.tvSearch === '1') view.dataset.tvSearch = '';
    }

    if (isHomeOrBrowse()) {
      ensureAuroraHero();
    }
  }

  function bootTv() {
    syncTvScreen();

    // 监听 DOM 变化: 异步卡片加载完成、直播频道加载完成或换源按钮到达时实时同步
    var mo = new MutationObserver(function () {
      if (isPlayRoute()) {
        syncTvPlayerMode();
      } else if (isHomeOrBrowse()) {
        ensureAuroraHero();
      } else if ((location.hash || '').indexOf('#/live') === 0) {
        enhanceLivePage();
      }
    });
    var viewEl = document.getElementById('view');
    if (viewEl) {
      mo.observe(viewEl, { childList: true, subtree: true });
    }

    window.addEventListener('hashchange', function () {
      setTimeout(function () {
        syncTvScreen();
        // 路由切换后确保焦点落在可视元素上
        var curF = document.querySelector('.' + FOCUSED_CLS);
        if (!curF || !visible(curF)) {
          var navAct = document.querySelector('#mainNav a.active') || document.querySelector('#mainNav a');
          if (navAct) setFocus(navAct, true);
        }
      }, 90);
    });

    window.addEventListener('xl:ready', function () {
      syncTvScreen();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootTv);
  } else {
    bootTv();
  }
})();
