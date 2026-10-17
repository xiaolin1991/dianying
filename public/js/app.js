/* ============================================================
   晓林影视 XIAOLIN-TV — 前端应用(原生 JS, 无构建)
   视图: 首页 / 分类 / 搜索 / 详情 / 播放 / 电视直播 / 后台
   ============================================================ */
(function () {
  'use strict';

  /* --------------------- 老电视盒子 WebView 兼容垫片 ---------------------
     部分盒子的 Android System WebView 较旧, 缺 Promise.allSettled 等新 API,
     会导致「登录加载失败: promise.allSettled is not a function」 */
  if (typeof Promise !== 'undefined' && !Promise.allSettled) {
    Object.defineProperty(Promise, 'allSettled', {
      value: function (list) {
        return Promise.all([...list].map((p) =>
          Promise.resolve(p).then(
            (v) => ({ status: 'fulfilled', value: v }),
            (e) => ({ status: 'rejected', reason: e })
          )
        ));
      },
      writable: true, configurable: true,
    });
  }
  if (typeof Object.fromEntries !== 'function') {
    Object.defineProperty(Object, 'fromEntries', {
      value: function (entries) {
        const o = {};
        for (const [k, v] of entries) o[k] = v;
        return o;
      }, writable: true, configurable: true,
    });
  }

  /* ------------------------------ 工具 ------------------------------ */
  const $ = (s, p = document) => p.querySelector(s);
  const $$ = (s, p = document) => [...p.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const stripTags = (s) => String(s || '').replace(/<[^>]*>/g, '').trim();

  /* ---------- 电视/盒子识别(WebView 无触摸屏) + 标题首字母索引 ---------- */
  function isTvDevice() {
    try {
      // 彻底清理旧版遗留的持久化 TV 标记，确保电脑端输入正常域名 100% 显示电脑界面
      try { localStorage.removeItem('ntv:tvMode'); sessionStorage.removeItem('ntv_tv_override'); } catch (e) {}
      const pathStr = (location.pathname || '/').replace(/^\/+|\/+$/g, '');
      const hashStr = location.hash || '';
      const searchStr = (location.search || '') + '&' + (hashStr.split('?')[1] || '');
      // 管理员后台与手机扫码遥控页永远强制使用电脑/手机原生 UI，绝不混入 TV 样式
      if (pathStr === 'xiaolin1991' || pathStr === 'admin' || /^#\/(xiaolin1991|admin|tv-remote)/i.test(hashStr) || /(?:^|[?&])tv_sid=/i.test(searchStr)) {
        return false;
      }
      if (/(?:^|[?&])tv=0(?:&|$)/i.test(searchStr)) {
        return false;
      }
      // 仅当网址当前明确带有 ?tv=1 参数时，才在电脑上预览 TV 模式
      if (/(?:^|[?&])tv=1(?:&|$)/i.test(searchStr)) {
        return true;
      }
      if (window.AndroidBridge && typeof window.AndroidBridge.isTv === 'function') {
        try { if (window.AndroidBridge.isTv()) return true; } catch (e) {}
      }
      const ua = navigator.userAgent || '';
      if (/XIAOLIN-TV-OS|LargeScreen|SmartTV|GoogleTV|Android\s*TV|Leanback|AFTB|AFTM|AFTT|AFTS|AFTN|MiBOX|MiTV|Tizen|Web0S|BRAVIA|Changhong|Hisense|Konka|Skyworth|TCL|VIDAA|Himedia|Dangbei|Projector/i.test(ua)) {
        return true;
      }
      const noTouch = !('ontouchstart' in window) && (navigator.maxTouchPoints || 0) === 0;
      return /Android/i.test(ua) && noTouch;
    } catch (e) { return false; }
  }
  // 拼音首字母(近似): 用 ICU 中文拼音排序在 23 个声母边界字中二分定位。
  // 老设备无拼音 Collator 时结果可能不准, 仅影响「首字母快搜」命中率, 不影响其他功能。
  const PY_LETTERS = 'ABCDEFGHJKLMNPQRSTWXYZ';
  const PY_BOUNDS = ['阿', '八', '嚓', '咑', '妸', '发', '噶', '哈', '丌', '咔', '垃', '呣', '拿', '噢', '啪', '七', '呥', '仨', '牠', '挖', '希', '压', '匝'];
  let pyCmp = null;
  try {
    if (typeof Intl !== 'undefined' && Intl.Collator) pyCmp = new Intl.Collator(['zh-Hans-CN', 'zh'], { sensitivity: 'base' });
  } catch (e) { pyCmp = null; }
  function pyInitial(ch) {
    if (!ch) return '';
    if (/[a-zA-Z0-9]/.test(ch)) return ch.toUpperCase();
    if (typeof window.__xlPyInitials === 'function') {
      const r = window.__xlPyInitials(ch);
      if (r) return r.slice(0, 1);
    }
    if (!pyCmp) return '';
    const cmp = (a, b) => pyCmp.compare(a, b);
    let lo = 0, hi = PY_BOUNDS.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cmp(PY_BOUNDS[mid], ch) <= 0) { ans = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return ans >= 0 ? PY_LETTERS[ans] : '';
  }
  function titleInitials(name) {
    if (typeof window.__xlPyInitials === 'function') {
      const full = window.__xlPyInitials(String(name || ''));
      if (full) return full.slice(0, 12);
    }
    let out = '';
    for (const ch of String(name || '')) {
      const c = pyInitial(ch);
      if (c) out += c;
      if (out.length >= 12) break;
    }
    return out;
  }
  // 全站标题索引(cardHtml 渲染时自动登记), 供「首字母搜索」本地快查
  const TitleIdx = new Map();
  function indexTitle(item) {
    try {
      if (!item || !item.title || TitleIdx.has(item.title)) return;
      if (TitleIdx.size > 800) return;
      TitleIdx.set(item.title, {
        title: item.title, pic: item.pic || '', remarks: item.remarks || '',
        sourceKey: item.sourceKey || '', id: item.id || '',
      });
    } catch (e) { /* ignore */ }
  }

  function fmtDateTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function fmtWatchSec(sec) {
    sec = Math.floor(sec || 0);
    if (sec <= 0) return '瞬时';
    if (sec < 60) return sec + ' 秒';
    const m = Math.floor(sec / 60);
    const remSec = sec % 60;
    if (m < 60) return m + ' 分' + (remSec > 0 ? (' ' + remSec + ' 秒') : '');
    return Math.floor(m / 60) + ' 小时 ' + (m % 60) + ' 分';
  }

  function toast(msg, type = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = msg;
    $('#toastWrap').appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .4s'; }, 2600);
    setTimeout(() => el.remove(), 3100);
  }

  /* ---------- TV 虚拟键盘: 盒子 WebView 弹不出系统输入法时的兜底 ----------
     全部为真实 <button>, 遥控器方向键可直接移动焦点 + OK 键输入 */
  const VKB = {
    el: null, target: null, shift: false, sym: false,
    ensure() {
      if (this.el) return this.el;
      const box = document.createElement('div');
      box.className = 'vkb hidden';
      box.id = 'vkbBox';
      box.addEventListener('click', (e) => e.stopPropagation());
      document.body.appendChild(box);
      this.el = box;
      document.addEventListener('click', (e) => {
        if (!box.classList.contains('hidden') && !e.target.closest('.vkb') && e.target !== this.target) {
          if (!/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) this.hide();
        }
      });
      return box;
    },
    render() {
      const rows = this.sym
        ? ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '@', '#']
        : (this.shift ? 'QWERTYUIOPASDFGHJKLZXCVBNM' : 'qwertyuiopasdfghjklzxcvbnm').split('');
      const extra = this.sym ? ['.', '_', '-', '+'] : ['清空'];
      const keys = [
        ...rows.map((c) => ({ t: c, k: c })),
        { t: '⇧', k: '__shift' }, { t: '123/abc', k: '__sym' },
        { t: '⌫ 删除', k: '__del' }, ...extra.map((c) => ({ t: c, k: c === '清空' ? '__clear' : c })),
        { t: '完成', k: '__done' },
      ];
      this.el.innerHTML = `<div class="vkb-title">${esc(this.target ? (this.target.placeholder || '输入') : '输入')} <small>遥控器方向键选择 · OK 输入</small></div>
        <div class="vkb-keys">${keys.map((x) => `<button type="button" class="vkb-key${String(x.k).startsWith('__') ? ' fn' : ''}" data-k="${esc(x.k)}">${esc(x.t)}</button>`).join('')}</div>`;
      $$('.vkb-key', this.el).forEach((b) => b.addEventListener('click', () => this.press(b.dataset.k)));
    },
    press(k) {
      const t = this.target;
      if (!t) return this.hide();
      if (k === '__shift') { this.shift = !this.shift; return this.render(); }
      if (k === '__sym') { this.sym = !this.sym; return this.render(); }
      if (k === '__del') { t.value = t.value.slice(0, -1); }
      else if (k === '__clear') { t.value = ''; }
      else if (k === '__done') { return this.hide(); }
      else { t.value += (this.shift && !this.sym) ? k.toUpperCase() : k; }
      t.dispatchEvent(new Event('input', { bubbles: true }));
    },
    attach(input) {
      if (!input || input.dataset.vkbBound) return;
      input.dataset.vkbBound = '1';
      input.readOnly = true; // 阻止唤起(弹不出的)系统输入法, 编辑全部走虚拟键盘
      input.addEventListener('click', () => this.open(input));
      input.addEventListener('focus', () => this.open(input));
    },
    open(input) {
      this.ensure();
      this.target = input;
      this.render();
      this.el.classList.remove('hidden');
      const first = $('.vkb-key', this.el);
      first && first.focus();
    },
    hide() { if (this.el) { this.el.classList.add('hidden'); this.target = null; } },
  };

  /* ---------- 语音搜索: Web Speech API(Chromium 内核可用时) ---------- */
  function startVoice(cb) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return toast('当前设备不支持语音识别（电视盒子可安装 Google 语音服务后重试）', 'err');
    try {
      const r = new SR();
      r.lang = 'zh-CN';
      r.interimResults = false;
      r.maxAlternatives = 1;
      toast('🎙 请说出影片名…');
      let got = false;
      r.onresult = (e) => {
        got = true;
        const t = String((e.results && e.results[0] && e.results[0][0] && e.results[0][0].transcript) || '').trim();
        if (t) cb(t); else toast('没听清，请再试一次', 'err');
      };
      r.onerror = (e) => {
        if (got) return;
        toast(e.error === 'not-allowed' ? '麦克风权限被拒绝' : e.error === 'no-speech' ? '没有听到声音' : '语音识别失败：' + e.error, 'err');
      };
      r.start();
    } catch (e) { toast('语音识别启动失败', 'err'); }
  }

  const store = {
    get(k, d) { try { const v = localStorage.getItem('ntv:' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('ntv:' + k, JSON.stringify(v)); } catch (e) {} },
  };

  /* ---------- 路由守卫: 页面切换后旧异步任务不得再写 DOM(修复 innerHTML null 报错) ---------- */
  let routeSeq = 0;
  function makeAlive() { const seq = ++routeSeq; return () => seq === routeSeq; }
  /** 安全写入 innerHTML: 元素不存在时静默跳过 */
  function setHtml(target, html) {
    const el = typeof target === 'string' ? $(target) : target;
    if (el) el.innerHTML = html;
    return el;
  }

  /* ------------------------------ 状态 ------------------------------ */
  const State = {
    settings: null,   // 公开设置 { siteName, defaultTheme, announcement, requireLogin, allowRegister }
    config: null,     // { adultEnabled, total, count, sources }
    liveCache: null,
    me: null,         // 当前登录用户名(null=未登录)
    meCreated: 0,
    adultAllowed: false,
    adultExpireAt: 0,
    unreadMsgCount: 0,
  };

  const FEATURED_ORDER = ['dbzy.tv', 'mtzy.me', 'iqiyizyapi.com', 'ruyizy.cn', 'tyyszy.com', 'bfzy.tv', 'wolongzyw.com'];
  const CAT_REGEX = {
    '电影': /(电影|片)$|电影/,
    '剧集': /(剧|连续剧)/,
    '综艺': /(综艺|真人秀|晚会)/,
    '动漫': /(动漫|动画|漫画)/,
  };
  const YEARS = ['全部', '2026', '2025', '2024', '2023', '2022', '2021', '2020'];

  // 网站常规页面严格仅展示正常源(成人源隔离至会员中心)
  function visibleSources() {
    if (!State.config) return [];
    return State.config.sources || [];
  }
  // 全局源查找(兼容常规源 + 会员中心私密福利源)
  function findSourceByKey(key) {
    if (!State.config) return null;
    const s = (State.config.sources || []).find((x) => x.key === key);
    if (s) return s;
    return (State.config.adultSources || []).find((x) => x.key === key) || null;
  }
  const cleanSrcName = (s) => s ? (String(s.name || s.key).replace(/🔞/g, '').trim() || s.key) : '';

  /* ---- 登录态 ---- */
  function loginRequired() {
    return Boolean(State.settings && State.settings.requireLogin !== false && !State.me);
  }
  function updateUserBox() {
    const box = $('#userBox');
    if (!box) return;
    box.innerHTML = State.me
      ? `<a class="user-chip" href="#/user" title="${esc(State.me)} · 个人中心"><span class="u-ava">${esc(State.me.slice(0, 1).toUpperCase())}</span><span class="u-name">${esc(State.me)}</span></a>`
      : `<a class="btn ghost small login-short" href="#/login">登录</a>`;
  }
  /* ---- 访问与停留时长统计埋点 ---- */
  let _currentTrack = {
    path: '',
    title: '',
    startTime: 0,
    sentDuration: 0,
  };

  function sendVisitBeacon(path, title, duration) {
    if (!path) return;
    try {
      const payload = JSON.stringify({
        path: String(path),
        title: String(title || ''),
        duration: Math.max(0, Math.floor(Number(duration) || 0)),
        u: State.me || '',
      });
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/stats/visit', new Blob([payload], { type: 'application/json' }));
      } else {
        fetch('/api/stats/visit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true,
        }).catch(() => {});
      }
    } catch (e) {}
  }

  function flushCurrentTrackDuration() {
    if (!_currentTrack.path || !_currentTrack.startTime) return;
    const now = Date.now();
    const totalSec = Math.floor((now - _currentTrack.startTime) / 1000);
    const delta = totalSec - (_currentTrack.sentDuration || 0);
    if (delta >= 3) {
      sendVisitBeacon(_currentTrack.path, _currentTrack.title, delta);
      _currentTrack.sentDuration = totalSec;
    }
  }

  function trackVisit(path, title) {
    // 离开前一页面时，上报已停留/观看的时长
    flushCurrentTrackDuration();

    const now = Date.now();
    const curPath = path || (location.hash || '#/');
    const curTitle = title || document.title || '';
    _currentTrack = {
      path: curPath,
      title: curTitle,
      startTime: now,
      sentDuration: 0,
    };
    sendVisitBeacon(curPath, curTitle, 0);
  }

  function updateTrackTitle(newTitle) {
    if (!newTitle) return;
    _currentTrack.title = String(newTitle).trim();
  }

  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushCurrentTrackDuration();
  });
  window.addEventListener('beforeunload', () => {
    flushCurrentTrackDuration();
  });
  setInterval(() => {
    flushCurrentTrackDuration();
  }, 45000);

  function logSearch(q) {
    if (!q) return;
    if (State.me) API.userLogSearch(q); // 用户维度记录
    updateTrackTitle('🔍 搜索：' + q);
    try { // 全站统计(含未登录)
      const payload = JSON.stringify({ q, title: '🔍 搜索：' + q, u: State.me || '' });
      if (navigator.sendBeacon) navigator.sendBeacon('/api/stats/search', new Blob([payload], { type: 'application/json' }));
      else fetch('/api/stats/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(() => {});
    } catch (e) {}
  }
  function pushSearchHist(q) {
    q = String(q || '').trim();
    if (!q) return;
    const h = store.get('searchHist', []).filter((x) => x !== q);
    h.unshift(q);
    store.set('searchHist', h.slice(0, 12));
  }
  /* ---- 收藏云同步: 登录后本地与服务器合并, 收藏变更即时上传 ---- */
  function pushFavsToServer() {
    if (!State.me) return;
    API.userSaveFavs(store.get('favs', []));
  }
  async function pullFavsMerge() {
    if (!State.me) return;
    try {
      const r = await API.userFavs();
      const remote = Array.isArray(r.favs) ? r.favs : [];
      const local = store.get('favs', []);
      const seen = new Set(local.map((f) => f.key + '|' + f.id));
      let changed = false;
      for (const f of remote) {
        const k = (f.key || '') + '|' + (f.id || '');
        if (!f.key || !f.id || seen.has(k)) continue;
        local.push({ key: f.key, id: String(f.id), title: f.title || '', pic: f.pic || '', remarks: f.remarks || '' });
        seen.add(k);
        changed = true;
      }
      if (changed) store.set('favs', local.slice(0, 200));
      // 双向收敛: 把合并结果推回服务器, 多设备最终一致
      API.userSaveFavs(store.get('favs', []));
    } catch (e) { /* 未登录/无KV 静默 */ }
  }
  function featuredSources(max = 6) {
    const vis = visibleSources();
    const picked = [];
    const used = new Set();
    // 优先使用后台设置的首页源顺序
    const order = (State.settings && Array.isArray(State.settings.homeSources) && State.settings.homeSources.length)
      ? State.settings.homeSources
      : FEATURED_ORDER;
    for (const key of order) {
      const s = vis.find((x) => x.key === key);
      if (s && !used.has(s.key)) { picked.push(s); used.add(s.key); }
      if (picked.length >= max) break;
    }
    for (const s of vis) {
      if (picked.length >= max) break;
      if (!used.has(s.key)) picked.push(s);
    }
    return picked.slice(0, max);
  }

  /* ------------------------------ 苹果CMS 解析 ------------------------------ */
  /** 解析 vod_play_from / vod_play_url → [{name, eps:[{name,url}]}] */
  function parsePlayGroups(vod) {
    const froms = String(vod.vod_play_from || '').split('$$$');
    const urls = String(vod.vod_play_url || '').split('$$$');
    const groups = [];
    froms.forEach((fname, i) => {
      const raw = (urls[i] || '').split('#').filter(Boolean);
      const eps = raw.map((seg) => {
        const idx = seg.indexOf('$');
        return idx >= 0 ? { name: seg.slice(0, idx), url: seg.slice(idx + 1) } : { name: seg, url: seg };
      }).filter((e) => /^https?:\/\//i.test(e.url));
      if (eps.length) groups.push({ name: fname || '默认', eps });
    });
    return groups;
  }

  /* ------------------------------ 卡片渲染 ------------------------------ */
  function isMobileDevice() {
    if (isTvDevice()) return false;
    const ua = navigator.userAgent || '';
    if (/Windows NT|Macintosh|Linux x86_64|CrOS/i.test(ua) && !/Android|iPhone|iPod|Mobile/i.test(ua)) return false;
    if (/iPhone|iPod|Android.+Mobile|Mobile.+Android|xiaolin/i.test(ua)) return true;
    if (/Android/i.test(ua) && Math.min(screen.width, screen.height) <= 820) return true;
    return window.matchMedia('(max-width: 820px) and (hover: none) and (pointer: coarse)').matches;
  }

  /** 桌面浏览器新标签打开; 手机/App 同页打开(便于返回后恢复滚动位置) */
  function preferNewTab() {
    try {
      if (isTvDevice()) return false;
      if (typeof inApp === 'function' && inApp()) return false;
      if (isMobileDevice()) return false;
      return true;
    } catch (e) { return true; }
  }
  /** 卡片为真实链接; 列表页离开前会缓存 DOM+滚动, 返回时回到原位置 */
  function cardHtml(item) {
    indexTitle(item); // 登记到全站标题索引(供首字母快搜)
    // 海报卡片直接进播放器页面(跳过详情中间页); 详情仍可从播放页「← 详情」进入
    const href = `#/play/${esc(item.sourceKey)}/${encodeURIComponent(item.id)}?ep=0&group=0`;
    const blank = preferNewTab() ? ' target="_blank" rel="noopener"' : '';
    return `
      <a class="card" href="${href}"${blank}>
        <div class="card-poster">
          <img loading="lazy" referrerpolicy="no-referrer" src="${esc(item.pic)}" alt=""
               onerror="this.style.visibility='hidden'">
          <span class="card-badge">${esc(item.remarks || item.year || '')}</span>
          <span class="card-play-ico"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>
        </div>
        <div class="card-name" title="${esc(item.title)}">${esc(item.title)}</div>
        <div class="card-sub">${esc(item.year || '')}${item.typeName ? ' · ' + esc(item.typeName) : ''}</div>
        ${item.showSource ? `<div class="card-src">${esc(item.sourceName)}${item.srcCount > 1 ? ' 等' + item.srcCount + '源' : ''}</div>` : ''}
      </a>`;
  }
  function bindCards() { /* 卡片已是原生链接, 无需再绑定点击 */ }
  function skeletons(n, cls = 'skl-card') {
    let h = '';
    for (let i = 0; i < n; i++) h += `<div class="${cls}"><div class="skl skl-poster"></div><div class="skl skl-line"></div><div class="skl skl-line" style="width:60%"></div></div>`;
    return h;
  }

  /* ------------------------------ 主题 ------------------------------ */
  const THEME_META = [
    { id: 'midnight', name: '暗夜黑', dot: '#5b8cff', bg: '#070b14' },
    { id: 'emerald', name: '翡翠绿', dot: '#34d399', bg: '#06110d' },
    { id: 'sunset', name: '落日橙', dot: '#ff8a3d', bg: '#150e08' },
    { id: 'sakura', name: '樱花粉', dot: '#ff6b9d', bg: '#fdf4f7' },
    { id: 'ocean', name: '薄荷蓝', dot: '#0ea5b7', bg: '#f1f9fc' },
    { id: 'royal', name: '墨金紫', dot: '#a78bfa', bg: '#100c1c' },
    // 节日主题
    { id: 'christmas', name: '圣诞夜', dot: '#e0393e', bg: '#071410' },
    { id: 'spring', name: '新春红', dot: '#ffb347', bg: '#1c0808' },
    { id: 'lantern', name: '元宵灯彩', dot: '#ff7ab6', bg: '#170b20' },
    { id: 'halloween', name: '万圣夜', dot: '#ff8a3d', bg: '#140b1d' },
    { id: 'valentine', name: '情人节', dot: '#ff5d73', bg: '#fdf0f2' },
    { id: 'midautumn', name: '中秋月', dot: '#f5c66d', bg: '#0a1224' },
  ];
  function applyTheme(id) {
    if (!THEME_META.some((t) => t.id === id)) id = 'midnight';
    document.documentElement.setAttribute('data-theme', id);
    store.set('theme', id);
    const meta = THEME_META.find((t) => t.id === id);
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor && meta) themeColor.setAttribute('content', meta.bg);
    $$('#themePop .theme-item').forEach((el) => el.classList.toggle('active', el.dataset.tid === id));
  }
  function buildThemePop() {
    const pop = $('#themePop');
    if (!pop) return;
    pop.classList.add('hidden');
    pop.innerHTML = THEME_META.map((t) => `
      <div class="theme-item ${store.get('theme') === t.id ? 'active' : ''}" data-tid="${t.id}">
        <span class="theme-dot" style="background:${t.bg}; box-shadow: inset 0 0 0 10px ${t.dot}"></span>
        <span>${t.name}</span>
      </div>`).join('');
    $$('.theme-item', pop).forEach((el) => el.addEventListener('click', () => {
      applyTheme(el.dataset.tid);
      pop.classList.add('hidden');
      toast('已切换主题：' + THEME_META.find((x) => x.id === el.dataset.tid).name, 'ok');
    }));
  }

  /* ---------------- 网站版式(流光旗舰版UI / 经典版UI) & 护眼日夜模式永久记忆 ---------------- */
  function getEffectiveColorMode(serverDefault) {
    const userSaved = store.get('userColorMode', null);
    if (userSaved === 'light' || userSaved === 'dark') return userSaved;
    if (serverDefault === 'dark') return 'dark';
    return 'light'; // 默认开启护眼白天模式
  }
  function applyUiLayout(layout) {
    if (isTvDevice()) {
      document.body.classList.remove('ui-modern');
      return;
    }
    const norm = layout === 'classic' ? 'classic' : 'modern';
    const on = norm === 'modern';
    document.body.classList.toggle('ui-modern', on);
    store.set('uiLayout', norm);
  }
  function applyModernTheme(mt, isUserAction = false) {
    const m = mt === 'dark' ? 'dark' : 'light';
    document.body.setAttribute('data-mtheme', m);
    store.set('uiModernTheme', m);
    if (isUserAction) {
      store.set('userColorMode', m);
    }
    const ico = $('#colorModeIco');
    const txt = $('#colorModeTxt');
    if (ico) ico.textContent = m === 'light' ? '☀️' : '🌙';
    if (txt) txt.textContent = m === 'light' ? '护眼日间' : '沉浸夜间';
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor && !isTvDevice()) {
      themeColor.setAttribute('content', m === 'light' ? '#f3f6fb' : '#090d16');
    }
  }
  function applyUiMode(layout, serverTheme) {
    applyUiLayout(layout);
    applyModernTheme(getEffectiveColorMode(serverTheme), false);
  }

  /* ------------------------------ 全站页面与滚动记忆(搜索/影视源/分类/首页/会员中心) ------------------------------ */
  const LIST_PAGE_CACHE = new Map(); // routeKey -> { html, scrollY, state, rebind, ts }
  let activeListPage = null; // { key, getState, rebind }
  let lastKnownScrollY = 0;

  // 全局持续记录最新滚动位置(避免移动端在点击或 hashchange 触发瞬间 scrollTop 被归零)
  window.addEventListener('scroll', () => {
    const y = window.scrollY || document.documentElement.scrollTop || 0;
    if (y > 0) lastKnownScrollY = y;
  }, { passive: true });

  // 在任意可能导致跳转的卡片/链接点击捕获阶段, 立刻固化当前页面 DOM 与精确滚动高度
  document.addEventListener('click', (e) => {
    const target = e.target.closest('a, button, .card, .adult-vod-card');
    if (!target) return;
    const curY = window.scrollY || document.documentElement.scrollTop || lastKnownScrollY || 0;
    if (curY > 0) lastKnownScrollY = curY;
    const { parts, query } = parseHash();
    const rKey = listRouteKey(parts, query);
    if (rKey && isListRoute(parts)) {
      saveListPageCache(rKey, curY);
    }
  }, true);

  function listRouteKey(parts, query) {
    const p = (parts && parts[0]) || 'home';
    const dec = (s) => { try { return decodeURIComponent(s || ''); } catch (e) { return s || ''; } };
    if (p === 'search') return 'search|' + dec(query.q || '');
    if (p === 'sources' || p === 'source') {
      return 'sources|' + dec(parts[1] || '') + '|' + dec(query.q || '') + '|' + dec(query.cat || '');
    }
    if (p === 'browse') return 'browse|' + dec(parts[1] || '电影') + '|' + (query.year || '全部');
    if (p === 'home') return 'home';
    if (p === 'user') return 'user';
    if (p === 'adult') return 'adult';
    return '';
  }

  function isListRoute(parts) {
    const p = (parts && parts[0]) || 'home';
    if (p === 'search' && isTvDevice()) return false;
    return p === 'search' || p === 'sources' || p === 'source' || p === 'browse' || p === 'home' || p === 'user' || p === 'adult';
  }

  function saveListPageCache(key, optScrollY) {
    if (!key) return;
    const view = $('#view');
    if (!view || !view.innerHTML.trim()) return;
    const curY = (optScrollY != null && optScrollY > 0) ? optScrollY : (window.scrollY || document.documentElement.scrollTop || lastKnownScrollY || 0);
    const hasActive = activeListPage && activeListPage.key === key;
    const state = (hasActive && typeof activeListPage.getState === 'function') ? activeListPage.getState() : null;
    const rebind = hasActive ? activeListPage.rebind : null;
    LIST_PAGE_CACHE.set(key, {
      html: view.innerHTML,
      scrollY: curY,
      state,
      getState: hasActive ? activeListPage.getState : null,
      rebind,
      ts: Date.now(),
    });
    sessionStorage.setItem('ntv_scroll_' + key, String(curY));
    if (LIST_PAGE_CACHE.size > 12) {
      let oldest = '', ot = Infinity;
      LIST_PAGE_CACHE.forEach((v, k) => { if (v.ts < ot) { ot = v.ts; oldest = k; } });
      if (oldest) LIST_PAGE_CACHE.delete(oldest);
    }
  }

  function smoothScrollRestore(targetY) {
    if (targetY == null || targetY <= 0) return;
    const doScroll = () => {
      window.scrollTo({ top: targetY, behavior: 'instant' });
    };
    doScroll();
    requestAnimationFrame(doScroll);
    setTimeout(doScroll, 40);
    setTimeout(doScroll, 120);
    setTimeout(doScroll, 280);
    setTimeout(doScroll, 550);
  }

  function restoreListPageCache(key, alive) {
    const cached = LIST_PAGE_CACHE.get(key);
    if (!cached || Date.now() - cached.ts > 30 * 60 * 1000) return false;
    const view = $('#view');
    if (!view) return false;
    view.innerHTML = cached.html;
    if (typeof cached.rebind === 'function') {
      try { cached.rebind(alive, cached.state); } catch (e) { console.warn('[list-cache] rebind failed', e); }
    }
    activeListPage = { key, getState: cached.getState, rebind: cached.rebind };
    const y = cached.scrollY || Number(sessionStorage.getItem('ntv_scroll_' + key) || 0);
    smoothScrollRestore(y);
    return true;
  }

  /* ------------------------------ 导航 ------------------------------ */
  try { store.remove('appDownloaded'); } catch (e) {}
  const NAVS = [
    ['#/home', '首页'], ['#/browse/电影', '电影'], ['#/browse/剧集', '剧集'],
    ['#/browse/综艺', '综艺'], ['#/browse/动漫', '动漫'], ['#/sources', '影视源'], ['#/live', '电视直播'],
    ['#/download', '下载APP'],
  ];
  function buildNav() {
    // 只要是在浏览器中浏览，一律显示「下载APP」导航；只有真正运行在已安装的官方 App 客户端内 (inApp)，才隐藏「下载APP」
    const items = inApp() ? NAVS.filter(([href]) => href !== '#/download') : NAVS;
    $('#mainNav').innerHTML = items.map(([href, label]) =>
      `<a href="${href}" data-href="${href}">${label}</a>`).join('');
  }
  function markNav(hash) {
    $$('#mainNav a').forEach((a) => a.classList.toggle('active', hash.startsWith(a.dataset.href)));
    renderBottomNav();
  }

  /* ---------------------- 手机端底部现代化导航栏 ---------------------- */
  function renderBottomNav() {
    const bar = $('#bottomTabBar');
    if (!bar) return;
    const { parts, query } = parseHash();
    const p0 = parts[0] || 'home';
    const isHome = p0 === 'home';
    const isFilm = ['browse', 'sources', 'source', 'search', 'detail', 'play'].includes(p0);
    // 手机端私密福利入口条件:
    // 1. 全局福利开关开启 (State.settings.adultEnabled)
    // 2. 手机底部导航开关开启 (State.settings.adultBottomNav)
    // 3. 并且满足以下之一:
    //    a) 已登录正式会员且账号已解锁 (State.me && State.me !== '管理员' && State.config && State.config.adultUnlocked)
    //    b) 后台开启了「允许未登录访客可见」或配置了游客试看时长 > 0
    const adultTrialMin = Number(State.config && State.config.adultTrialMinutes !== undefined ? State.config.adultTrialMinutes : (State.settings && State.settings.adultTrialMinutes !== undefined ? State.settings.adultTrialMinutes : 10));
    const isMemberUnlocked = Boolean(
      State.me &&
      State.me !== '管理员' &&
      State.config &&
      State.config.adultUnlocked
    );
    const allowGuest = Boolean(State.settings && State.settings.adultGuestVisible) || adultTrialMin > 0;
    const hasAdult = Boolean(
      State.settings &&
      State.settings.adultEnabled &&
      State.settings.adultBottomNav &&
      (isMemberUnlocked || allowGuest)
    );
    const isAdult = p0 === 'adult';
    const isLive = p0 === 'live';
    const isMsg = p0 === 'messages';
    const isUser = p0 === 'user';
    const unread = Math.max(0, Number(State.unreadMsgCount || 0));

    bar.innerHTML = `
      <a class="tab-item ${isHome ? 'active' : ''}" href="#/home" data-tab="home" title="首页">
        <svg viewBox="0 0 24 24"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>
        <span>首页</span>
      </a>
      <a class="tab-item ${isFilm ? 'active' : ''}" href="#/browse/电影" data-tab="film" title="影视">
        <svg viewBox="0 0 24 24"><path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/></svg>
        <span>影视</span>
      </a>
      ${hasAdult ? `
      <a class="tab-item ${isAdult ? 'active' : ''}" href="#/adult" data-tab="adult" title="私密福利">
        <svg viewBox="0 0 24 24" style="fill:var(--acc)"><path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .55-.45 1-1 1H6c-.55 0-1-.45-1-1v-1h14v1z"/></svg>
        <span style="color:var(--acc);font-weight:700">私密福利</span>
      </a>` : `
      <a class="tab-item ${isLive ? 'active' : ''}" href="#/live" data-tab="live" title="电视直播">
        <svg viewBox="0 0 24 24"><path d="M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 1.99-.9 1.99-2L23 5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z"/></svg>
        <span>电视直播</span>
      </a>`}
      <a class="tab-item ${isMsg ? 'active' : ''}" href="#/messages" data-tab="messages" title="站内消息">
        <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/></svg>
        <span>消息</span>
        ${unread > 0 ? `<span class="tab-badge">${unread > 99 ? '99+' : unread}</span>` : ''}
      </a>
      <a class="tab-item ${isUser ? 'active' : ''}" href="#/user" data-tab="user" title="个人中心">
        <svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
        <span>我的</span>
      </a>
    `;
  }

  /* ------------------------------ 路由 ------------------------------ */
  function parseHash() {
    let rawHash = location.hash.replace(/^#/, '');
    const pathSeg = (location.pathname || '/').replace(/^\/+|\/+$/g, '');
    let h = rawHash;
    if (!h || h === '/') {
      if (pathSeg && pathSeg !== 'index.html') {
        h = '/' + pathSeg + (location.search || '');
      } else {
        h = '/home';
      }
    }
    const qi = h.indexOf('?');
    const query = {};
    if (qi >= 0) {
      new URLSearchParams(h.slice(qi + 1)).forEach((v, k) => { query[k] = v; });
      h = h.slice(0, qi);
    }
    const parts = h.split('/').filter(Boolean);
    return { parts, query };
  }

  async function route() {
    const { parts, query } = parseHash();
    const view = $('#view');
    const customAdm = store.get('adminPathLive', 'xiaolin1991') || 'xiaolin1991';
    const isAdmRoute = parts[0] === 'xiaolin1991' || parts[0] === 'admin' || parts[0] === customAdm;
    if (isAdmRoute) {
      // 进入后台强制移除一切 TV 模式样式，保持纯正电脑管理端界面
      document.body.classList.remove('tv', 'tv-playing', 'tv-fs-mode');
      document.documentElement.classList.remove('tv-root');
      // 将 /#/xiaolin1991 自动美化为无 # 的 /xiaolin1991
      if (location.hash && location.hash.indexOf('#/' + parts[0]) === 0) {
        try { history.replaceState(null, '', '/' + parts[0]); } catch (e) {}
      }
    } else {
      const curPath = (location.pathname || '/').replace(/^\/+|\/+$/g, '');
      if (curPath && curPath !== 'index.html' && location.hash) {
        try { history.replaceState(null, '', '/' + location.hash); } catch (e) {}
      }
    }
    const routeKey = listRouteKey(parts, query);
    const prev = route._prev || null;
    if (prev && prev.key && isListRoute(prev.parts)) saveListPageCache(prev.key);

    Player.destroy();
    document.documentElement.classList.remove('player-fs');
    document.body.style.overflow = '';
    // 路由切换兜底: 恢复系统状态栏显示(若销毁时仍处于全屏)
    try {
      if (window.AndroidBridge && typeof window.AndroidBridge.setStatusBar === 'function') {
        window.AndroidBridge.setStatusBar(false);
      }
    } catch (e) {}

    try { screen.orientation && screen.orientation.unlock && screen.orientation.unlock(); } catch (e) {}
    try {
      if (window.AndroidBridge && typeof window.AndroidBridge.setOrientation === 'function') {
        window.AndroidBridge.setOrientation(isTvDevice() ? 'landscape' : 'portrait');
      }
    } catch (e) {}
    markNav('#/' + (parts[0] || 'home'));

    const alive = makeAlive();
    const dec = (s) => { try { return decodeURIComponent(s || ''); } catch (e) { return s || ''; } };

    // 手机扫码电视同步搜索页: 支持 ?tv_sid=xxx 或 #/tv-remote?sid=xxx 直接进入
    const urlTvSid = (new URLSearchParams(location.search || '')).get('tv_sid') || '';
    if (parts[0] === 'tv-remote' || (urlTvSid && (!parts[0] || parts[0] === 'home'))) {
      markNav('');
      activeListPage = null;
      route._prev = { parts: ['tv-remote'], query, key: '' };
      return viewTvRemote(query.sid || urlTvSid, alive);
    }

    // 强制登录: 未登录只允许登录页与后台
    if (loginRequired() && !['login', 'admin', 'xiaolin1991', 'tv-remote'].includes(parts[0])) {
      markNav('');
      if (location.hash && location.hash !== '#/login') store.set('afterLogin', location.hash);
      activeListPage = null;
      route._prev = { parts, query, key: routeKey };
      return viewLogin(alive, true);
    }

    let routeTitle = '首页';
    if (parts[0] === 'browse') routeTitle = '分类浏览: ' + (dec(parts[1]) || '电影');
    else if (parts[0] === 'search') routeTitle = '搜索: ' + (query.q ? dec(query.q) : '');
    else if (parts[0] === 'detail') routeTitle = '影视详情';
    else if (parts[0] === 'play') routeTitle = '视频播放';
    else if (parts[0] === 'sources' || parts[0] === 'source') routeTitle = '影视源大全';
    else if (parts[0] === 'login') routeTitle = '用户登录/注册';
    else if (parts[0] === 'user') routeTitle = '会员中心';
    else if (parts[0] === 'adult') routeTitle = '🔞 私密福利专区';
    else if (parts[0] === 'messages') routeTitle = '站内公告';
    else if (parts[0] === 'live') routeTitle = '📺 电视直播';
    else if (parts[0] === 'download' || parts[0] === 'dl-android-guide' || parts[0] === 'dl-ios-guide') routeTitle = '客户端下载';
    else if (parts[0] === 'xiaolin1991' || parts[0] === 'admin') routeTitle = '后台管理系统';

    // 返回搜索/影视源/分类页: 恢复离开前的列表与滚动位置(不重新加载)
    if (routeKey && isListRoute(parts) && restoreListPageCache(routeKey, alive)) {
      route._prev = { parts, query, key: routeKey };
      if (State.config) trackVisit('#/' + parts.join('/'), routeTitle);
      if (document.body.classList.contains('tv')) {
        setTimeout(() => {
          const el = $('#mainNav a.active') || $('#mainNav a');
          const ae = document.activeElement;
          const inField = ae && ae.tagName && /^(INPUT|TEXTAREA)$/.test(ae.tagName);
          if (el && !inField) { try { el.focus(); } catch (e) {} }
        }, 80);
      }
      return;
    }

    activeListPage = null;
    window.scrollTo({ top: 0 });
    // TV: 路由完成后把焦点放到当前导航项, 遥控器开机即用, 无需先"盲按"
    if (document.body.classList.contains('tv')) {
      setTimeout(() => {
        const el = $('#mainNav a.active') || $('#mainNav a');
        const ae = document.activeElement;
        const inField = ae && ae.tagName && /^(INPUT|TEXTAREA)$/.test(ae.tagName);
        if (el && !inField) { try { el.focus(); } catch (e) {} }
      }, 80);
    }
    // 播放页: <video autoplay> 获得焦点时部分浏览器会把页面滚到播放器位置(表现为自动下滑约20%)
    if (parts[0] === 'play') {
      let n = 0;
      const g = setInterval(() => { window.scrollTo(0, 0); if (++n >= 15) clearInterval(g); }, 100);
    }
    route._prev = { parts, query, key: routeKey };
    if (State.config) trackVisit('#/' + parts.join('/'), routeTitle); // 页面访问统计
    maybeAppUpdate(); // 每次路由切换时检查是否有新版本或强制更新
    try {
      if (parts[0] === 'browse') await viewBrowse(dec(parts[1]) || '电影', query, alive);
      else if (parts[0] === 'search') {
        if (isTvDevice() && typeof window.XLTV_MOUNT_SEARCH === 'function') {
          await window.XLTV_MOUNT_SEARCH(query.q ? dec(query.q) : '', alive);
        } else {
          await viewSearch(query.q ? dec(query.q) : '', alive);
        }
      }
      else if (parts[0] === 'detail') await viewDetail(parts[1], dec(parts[2]), alive);
      else if (parts[0] === 'play') await viewPlay(parts[1], dec(parts[2]), query, alive);
      else if (parts[0] === 'sources') await viewSources(dec(parts[1]) || '', query, alive);
      else if (parts[0] === 'source') await viewSources(dec(parts[1]), query, alive); // 兼容旧链接
      else if (parts[0] === 'login') await viewLogin(alive, false);
      else if (parts[0] === 'user') await viewUser(alive);
      else if (parts[0] === 'adult') await viewAdult(alive);
      else if (parts[0] === 'messages') await viewMessages(alive);
      else if (parts[0] === 'live') await viewLive(query);
      else if (parts[0] === 'download' || parts[0] === 'dl-android-guide' || parts[0] === 'dl-ios-guide') {
        const scrollTarget = parts[0] !== 'download' ? parts[0] : null;
        await viewDownload(alive, scrollTarget);
      }
      else if (parts[0] === 'xiaolin1991') await viewAdmin(query, parts[0]);
      else if (parts[0] === 'admin') {
        let ok = false;
        try { ok = (await API.checkAdminPath('admin')).ok; } catch (e) { /* 默认非 admin */ }
        if (ok) await viewAdmin(query, parts[0]);
        else await viewHome(alive);
      }
      else if (!parts[1] && /^[a-z0-9][a-z0-9-_]{1,39}$/.test(parts[0] || '')) {
        // 未知路径: 探测是否为自定义后台入口(是→进后台, 否→回首页)
        let ok = false;
        try { ok = (await API.checkAdminPath(parts[0])).ok; } catch (e) { /* 网络/离线 */ }
        if (ok) await viewAdmin(query, parts[0]);
        else await viewHome(alive);
      }
      else await viewHome(alive);
    } catch (err) {
      if (!alive()) return;
      view.innerHTML = `<div class="container empty"><div class="big">😵</div>
        <p>加载失败：${esc(err.message)}</p>
        <p style="margin-top:14px"><a class="btn ghost" href="#/home">返回首页</a></p></div>`;
    }
  }

  /* ============================================================
     视图：首页(支持流光旗舰版双栏巨幕+TOP10热榜 & 经典版 · 首波极速秒出)
     ============================================================ */
  const HOME_ROW_COUNT = 14;
  let heroTimer = null;

  function top10CardHtml(item, rank) {
    indexTitle(item);
    const href = `#/play/${esc(item.sourceKey)}/${encodeURIComponent(item.id)}?ep=0&group=0`;
    const blank = preferNewTab() ? ' target="_blank" rel="noopener"' : '';
    const rCls = rank === 1 ? 'r1' : rank === 2 ? 'r2' : rank === 3 ? 'r3' : '';
    return `
      <a class="card fs-top10-card" href="${href}"${blank} data-src="${esc(item.sourceKey)}" data-vid="${esc(item.id)}">
        <div class="card-poster">
          <img loading="lazy" referrerpolicy="no-referrer" src="${esc(item.pic)}" alt=""
               onerror="this.style.visibility='hidden'">
          <span class="card-badge">${esc(item.remarks || item.year || '热播')}</span>
          <span class="card-play-ico"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>
        </div>
        <span class="fs-rank-badge ${rCls}">${rank}</span>
        <div class="card-name" title="${esc(item.title)}">${esc(item.title)}</div>
        <div class="card-sub">${esc(item.year || '')}${item.typeName ? ' · ' + esc(item.typeName) : ''}</div>
      </a>`;
  }

  async function viewHome(alive) {
    clearInterval(heroTimer);
    if (!alive()) return;
    const v = $('#view');
    v.innerHTML = `
      <div class="container page-wrap">
        <div class="hero fs-hero-stage">
          <div class="fs-hero-main">
            <div class="hero-bg" id="heroBg"></div>
            <div class="hero-content" id="heroContent"></div>
            <div class="hero-dots" id="heroDots"></div>
          </div>
          <div class="fs-hero-rail" id="heroSideRail"></div>
        </div>
        <div class="fs-quick-bar" id="fsQuickBar">
          <a class="fs-qpill primary" href="#/home">🔥 今日热播</a>
          <a class="fs-qpill" href="#/browse/%E7%94%B5%E5%BD%B1">🎬 院线大片</a>
          <a class="fs-qpill" href="#/browse/%E5%89%A7%E9%9B%86">📺 王牌剧集</a>
          <a class="fs-qpill" href="#/browse/%E7%BB%BC%E8%89%BA">🎪 王牌综艺</a>
          <a class="fs-qpill" href="#/browse/%E5%8A%A8%E6%BC%AB">🌸 热门动漫</a>
          <a class="fs-qpill" href="#/sources">🧭 影视源</a>
          <a class="fs-qpill" href="#/live">📡 电视直播</a>
        </div>
        <section class="row" id="fsTop10Row">
          <div class="row-head">
            <div class="row-title">🔥 TOP 10 热播风云榜</div>
            <a class="row-more" href="#/browse/%E7%94%B5%E5%BD%B1">查看完整榜单 ›</a>
          </div>
          <div class="fs-top10-grid" id="fsTop10Grid">${skeletons(6)}</div>
        </section>
        <div id="rows"></div>
      </div>`;

    const cats = [['电影', '热门电影'], ['剧集', '热播剧集'], ['综艺', '综艺精选'], ['动漫', '动漫天地']];
    const rowsEl = $('#rows');
    for (const [cat, label] of cats) {
      const sec = document.createElement('section');
      sec.className = 'row';
      sec.innerHTML = `
        <div class="row-head"><div class="row-title">${label}</div>
          <a class="row-more" href="#/browse/${encodeURIComponent(cat)}">更多 ›</a></div>
        <div class="grid row-grid">${skeletons(HOME_ROW_COUNT)}</div>`;
      rowsEl.appendChild(sec);
    }

    const pool = { 电影: [], 剧集: [], 综艺: [], 动漫: [], general: [] };
    const seen = new Set();
    let heroMounted = false;
    let top10Mounted = false;

    const renderPoolToDom = (finalPass) => {
      if (!alive()) return;
      const grids = $$('#rows .row .grid.row-grid');
      const allAvailable = pool.电影.concat(pool.剧集, pool.综艺, pool.动漫, pool.general).filter((it) => it && it.pic);

      // 只要有任意 5 部带图影片到达，立即渲染双栏 Hero 与 TOP 10 热播榜(不等凑满14部)
      if (!heroMounted && (allAvailable.length >= 5 || (finalPass && allAvailable.length > 0))) {
        const heroPicks = (pool.电影.length >= 3 ? pool.电影.concat(pool.剧集) : allAvailable).filter((it) => it && it.pic).slice(0, 5);
        if (heroPicks.length) {
          setupHero(heroPicks, alive);
          heroMounted = true;
        }
      }

      if (!top10Mounted && (allAvailable.length >= 6 || (finalPass && allAvailable.length > 0))) {
        const topPicks = [];
        const topSeen = new Set();
        const mix = pool.剧集.slice(0, 3).concat(pool.电影.slice(0, 4), allAvailable);
        for (const it of mix) {
          if (topPicks.length >= 6) break;
          const tk = it.title + '|' + it.year;
          if (!it.pic || topSeen.has(tk)) continue;
          topSeen.add(tk);
          topPicks.push(it);
        }
        if (topPicks.length) {
          setHtml('#fsTop10Grid', topPicks.map((it, idx) => top10CardHtml(it, idx + 1)).join(''));
          if (topPicks.length >= 6 || finalPass) top10Mounted = true;
        }
      }

      cats.forEach(([cat], i) => {
        const list = pool[cat];
        if (list.length >= 6 || (finalPass && list.length)) {
          const usedKeys = new Set(list.map((it) => it.title + '|' + it.year));
          const extras = [];
          if (list.length < HOME_ROW_COUNT && finalPass) {
            const donors = pool.general.concat(...cats.map(([c]) => pool[c]));
            for (const it of donors) {
              if (list.length + extras.length >= HOME_ROW_COUNT) break;
              const kk = it.title + '|' + it.year;
              if (usedKeys.has(kk)) continue;
              usedKeys.add(kk);
              extras.push(it);
            }
          }
          const full = list.concat(extras).slice(0, HOME_ROW_COUNT);
          setHtml(grids[i], full.map(cardHtml).join(''));
        } else if (finalPass && !list.length && allAvailable.length) {
          setHtml(grids[i], allAvailable.slice(0, HOME_ROW_COUNT).map(cardHtml).join(''));
        } else if (finalPass && !list.length) {
          setHtml(grids[i], '<div class="empty" style="grid-column:1/-1;padding:26px;font-size:13px">该分类暂时没有数据</div>');
        }
      });
    };

    // 0ms 快照秒开: 若本地有最近缓存的首页池，立即渲染上屏，后台静默更新
    try {
      const cachedPool = store.get('home_pool_snapshot', null);
      if (cachedPool && cachedPool.ts && Date.now() - cachedPool.ts < 30 * 60 * 1000 && cachedPool.pool) {
        ['电影', '剧集', '综艺', '动漫', 'general'].forEach((k) => {
          if (Array.isArray(cachedPool.pool[k])) {
            pool[k] = cachedPool.pool[k].slice();
            pool[k].forEach((it) => seen.add(it.title + '|' + (it.year || '')));
          }
        });
        renderPoolToDom(true);
      }
    } catch (e) {}

    const consume = (job) => {
      if (!job || !job.r || !Array.isArray(job.r.list)) return;
      for (const vod of job.r.list) {
        const title = String(vod.vod_name || '').trim();
        if (!title) continue;
        const k = title + '|' + (vod.vod_year || '');
        if (seen.has(k)) continue;
        seen.add(k);
        const item = {
          sourceKey: job.s.key, sourceName: job.s.name, id: vod.vod_id, title,
          pic: vod.vod_pic, remarks: vod.vod_remarks, year: vod.vod_year, typeName: String(vod.type_name || ''),
        };
        let matched = false;
        for (const [cat, re] of Object.entries(CAT_REGEX)) {
          if (re.test(item.typeName)) { pool[cat].push(item); matched = true; break; }
        }
        if (!matched) pool.general.push(item);
      }
    };

    const sources = featuredSources(6);
    // 第一波优先并发各源第 1 页(仅6个请求，不堵塞浏览器同源连接池，首个源返回即刻上屏)
    const wave1 = sources.map((s) => API.list(s, 1).then((r) => ({ s, r })).catch(() => null));
    for (const p of wave1) {
      p.then((j) => {
        if (!j) return;
        consume(j);
        renderPoolToDom(false);
      });
    }
    await Promise.allSettled(wave1);
    renderPoolToDom(false);

    // 第二波后台补充第 2、3 页丰富度
    const wave2 = [];
    for (const s of sources) {
      for (let pg = 2; pg <= 3; pg++) {
        wave2.push(API.list(s, pg).then((r) => ({ s, r })).catch(() => null));
      }
    }
    let w2Count = 0;
    for (const p of wave2) {
      p.then((j) => {
        if (!j) return;
        consume(j);
        if (++w2Count % 3 === 0) renderPoolToDom(false);
      });
    }
    await Promise.allSettled(wave2);
    renderPoolToDom(true);
    try {
      store.set('home_pool_snapshot', {
        ts: Date.now(),
        pool: {
          电影: pool.电影.slice(0, 16),
          剧集: pool.剧集.slice(0, 16),
          综艺: pool.综艺.slice(0, 16),
          动漫: pool.动漫.slice(0, 16),
          general: pool.general.slice(0, 16),
        },
      });
    } catch (e) {}
    loadHero(alive);
    activeListPage = {
      key: 'home',
      getState: () => ({}),
      rebind: (alive2) => {
        if (!alive2()) return;
        if (heroItems && heroItems.length) setupHero(heroItems, alive2);
      },
    };
  }

  /* ---- Hero (支持旗舰版右侧5片联动导视轨 + 经典版圆点) ---- */
  let heroItems = [], heroIdx = 0;
  function setupHero(items, alive) {
    if (!items.length || !alive()) return;
    heroItems = items; heroIdx = 0;
    const dots = $('#heroDots');
    if (dots) {
      dots.innerHTML = items.map((_, i) => `<i class="${i === 0 ? 'on' : ''}"></i>`).join('');
      $$('#heroDots i').forEach((d, i) => d.addEventListener('click', () => showHero(i)));
    }
    const rail = $('#heroSideRail');
    if (rail) {
      rail.innerHTML = items.slice(0, 5).map((it, i) => `
        <div class="fs-rail-item ${i === 0 ? 'active' : ''}" data-hidx="${i}">
          <div class="fs-rail-thumb">
            <img loading="lazy" referrerpolicy="no-referrer" src="${esc(it.pic)}" alt="" onerror="this.style.visibility='hidden'">
          </div>
          <div class="fs-rail-info">
            <div class="fs-rail-title">${esc(it.title)}</div>
            <div class="fs-rail-sub">${esc(it.remarks || it.year || '高清热播')}${it.typeName ? ' · ' + esc(it.typeName) : ''}</div>
          </div>
        </div>`).join('');
      $$('#heroSideRail .fs-rail-item').forEach((el) => {
        const idx = Number(el.dataset.hidx);
        el.addEventListener('mouseenter', () => {
          showHero(idx);
          clearInterval(heroTimer);
        });
        el.addEventListener('click', () => {
          const target = heroItems[idx];
          if (target) location.hash = `#/play/${target.sourceKey}/${encodeURIComponent(target.id)}?ep=0&group=0`;
        });
      });
    }
    showHero(0);
    clearInterval(heroTimer);
    heroTimer = setInterval(() => {
      if (document.getElementById('heroBg')) showHero((heroIdx + 1) % heroItems.length);
      else clearInterval(heroTimer);
    }, 6000);
  }
  function showHero(i) {
    heroIdx = i;
    const it = heroItems[i];
    if (!it) return;
    const bg = $('#heroBg'), ct = $('#heroContent');
    if (!bg || !ct) return;
    bg.classList.remove('show');
    const img = new Image();
    img.onload = () => {
      if (!bg.isConnected) return;
      bg.style.backgroundImage = `url("${it.pic}")`; bg.classList.add('show');
    };
    img.onerror = () => {};
    img.referrerPolicy = 'no-referrer';
    img.src = it.pic;
    const favList = store.get('favs', []);
    const isFav = favList.some((f) => f.key === it.sourceKey && String(f.id) === String(it.id));
    ct.innerHTML = `
      <div class="hero-meta">
        <span class="tag">4K HDR</span>
        <span class="tag plain">${esc(it.typeName || '精选影视')}</span>
        ${it.year ? `<span class="tag plain">${esc(it.year)}</span>` : ''}
        ${it.remarks ? `<span class="tag plain">${esc(it.remarks)}</span>` : ''}
      </div>
      <div class="hero-title">《${esc(it.title)}》</div>
      <p class="hero-desc">${esc(stripTags(it.desc || '高清正片聚合秒播，支持多线路无缝切换与跨端播放进度记忆。'))}</p>
      <div class="hero-actions-row">
        <button class="btn primary" id="heroPlay">▶ 立即播放</button>
        <button class="btn ghost" id="heroFavBtn">${isFav ? '★ 已追剧' : '+ 追剧收藏'}</button>
      </div>`;
    const playBtn = $('#heroPlay');
    playBtn && playBtn.addEventListener('click', () => {
      location.hash = `#/play/${it.sourceKey}/${encodeURIComponent(it.id)}?ep=0&group=0`;
    });
    const favBtn = $('#heroFavBtn');
    favBtn && favBtn.addEventListener('click', () => {
      const list = store.get('favs', []);
      const fIdx = list.findIndex((f) => f.key === it.sourceKey && String(f.id) === String(it.id));
      if (fIdx >= 0) {
        list.splice(fIdx, 1);
        favBtn.textContent = '+ 追剧收藏';
        toast('已取消追剧收藏');
      } else {
        list.unshift({ key: it.sourceKey, id: String(it.id), title: it.title, pic: it.pic, remarks: it.remarks || '' });
        favBtn.textContent = '★ 已追剧';
        toast('已加入追剧收藏', 'ok');
      }
      store.set('favs', list.slice(0, 200));
      pushFavsToServer();
    });
    $$('#heroDots i').forEach((d, di) => d.classList.toggle('on', di === i));
    $$('#heroSideRail .fs-rail-item').forEach((el, ri) => el.classList.toggle('active', ri === i));
  }
  async function loadHero(alive) {
    // 轮询等待 Hero 就绪后, 拉取详情补充简介(尽力而为)
    const wait = setInterval(async () => {
      if (!alive() || !document.getElementById('heroBg')) { clearInterval(wait); return; }
      if (heroItems.length) {
        clearInterval(wait);
        try {
          const it = heroItems[heroIdx];
          const src = findSourceByKey(it.sourceKey);
          const r = await API.detail(src, it.id);
          const vod = r.list && r.list[0];
          if (vod && document.getElementById('heroContent') && alive()) {
            it.desc = stripTags(vod.vod_content || '').slice(0, 120);
            showHero(heroIdx);
          }
        } catch (e) { /* ignore */ }
      }
    }, 400);
    setTimeout(() => clearInterval(wait), 10000);
  }

  /* ============================================================
     视图：分类浏览
     ============================================================ */
  const browseCursors = new Map(); // cat -> { pool, idx, pageBy:Map, seen:Set, year }
  async function viewBrowse(cat, query, alive) {
    if (!CAT_REGEX[cat]) cat = '电影';
    const v = $('#view');
    v.innerHTML = `
      <div class="container page-wrap">
        <div class="page-head"><div class="page-title">${esc(cat)}</div></div>
        <div class="chips" id="yearChips">${YEARS.map((y) => `<button class="chip ${(query.year || '全部') === y ? 'on' : ''}" data-y="${y}">${y === '全部' ? '全部年份' : y}</button>`).join('')}</div>
        <div class="src-status" id="browseStat">⏳ 正在并行加载多个源…</div>
        <div class="grid" id="browseGrid">${skeletons(18)}</div>
        <div class="scroll-sentinel" id="browseSentinel"></div>
      </div>`;

    const cur = { pool: featuredSources(6), pageBy: new Map(), seen: new Set(), year: query.year || '全部' };
    browseCursors.set(cat, cur);
    const life = { ok: alive }; // 返回本页时 rebind 会换上新的 alive, 才能继续下滑加载

    $$('#yearChips .chip').forEach((c) => c.addEventListener('click', () => {
      location.hash = `#/browse/${encodeURIComponent(cat)}?year=${encodeURIComponent(c.dataset.y)}`;
    }));

    const statEl = $('#browseStat');
    const setStat = (t) => { if (life.ok() && statEl) statEl.textContent = t; };

    /** 并发执行一批任务(每源一页), 单个返回立即上屏 */
    async function runWave(tasks) {
      let added = 0, done = 0;
      let idx = 0;
      const CONC = 5;
      const worker = async () => {
        while (idx < tasks.length) {
          if (!life.ok()) return added;
          const { s, pg } = tasks[idx++];
          try {
            const r = await API.list(s, pg);
            const grid = $('#browseGrid');
            if (!grid || !life.ok()) return added;
            const frag = [];
            for (const vod of (r.list || [])) {
              const tn = String(vod.type_name || '');
              if (!CAT_REGEX[cat].test(tn)) continue;
              if (cur.year !== '全部' && String(vod.vod_year || '') !== cur.year) continue;
              const k = s.key + ':' + vod.vod_id;
              if (cur.seen.has(k)) continue;
              cur.seen.add(k);
              frag.push(cardHtml({
                sourceKey: s.key, sourceName: s.name, id: vod.vod_id, title: vod.vod_name,
                pic: vod.vod_pic, remarks: vod.vod_remarks, year: vod.vod_year, typeName: tn, showSource: true,
              }));
              added++;
            }
            if (frag.length) {
              // 首批结果到达时移除骨架屏, 之后直接追加
              if ($('.skl-card', grid)) grid.innerHTML = '';
              grid.insertAdjacentHTML('beforeend', frag.join(''));
            }
          } catch (e) { /* 该源失败, 忽略 */ }
          done++;
          setStat(`⏳ 已显示 ${added} 部 · 源批次 ${done}/${tasks.length}`);
          if (added >= 24) { idx = tasks.length; } // 达标后其余任务跳过
        }
        return added;
      };
      await Promise.allSettled(Array.from({ length: Math.min(CONC, tasks.length) }, worker));
      return added;
    }

    function nextTasks(pagesPerSource) {
      const tasks = [];
      for (let n = 1; n <= pagesPerSource; n++) {
        for (const s of cur.pool) {
          const pg = (cur.pageBy.get(s.key) || 0) + 1;
          cur.pageBy.set(s.key, pg);
          tasks.push({ s, pg });
        }
      }
      return tasks;
    }

    // 首波 + 无限滚动(滚到底自动加载下一批, 瀑布流式)
    let waving = false, exhausted = false, emptyStreak = 0;
    const countCards = () => $$('#browseGrid .card').length;
    async function loadNext() {
      if (waving || exhausted || !life.ok()) return;
      waving = true;
      setStat('⏳ 正在加载更多…');
      const added = await runWave(nextTasks(2));
      if (!life.ok()) return;
      waving = false;
      if (added <= 0) {
        emptyStreak++;
        if (emptyStreak >= 2) { exhausted = true; setStat(countCards() ? '✅ 已经到底了' : ''); }
      } else {
        emptyStreak = 0;
        setStat(`✅ 已显示 ${countCards()} 部 · 继续下滑加载更多`);
        const sen = $('#browseSentinel');
        if (sen && !exhausted) {
          const r = sen.getBoundingClientRect();
          if (r.top < window.innerHeight + 400) loadNext(); // 仍贴底则继续
        }
      }
    }
    const okFirst = await runWave(nextTasks(2)) > 0; // 首波: 每源前2页并发
    if (!life.ok()) return;
    waving = false;
    if (okFirst) setStat(`✅ 已显示 ${countCards()} 部`);
    else {
      setStat('');
      setHtml('#browseGrid', '<div class="empty" style="grid-column:1/-1"><div class="big">🎬</div>暂无内容，试试其他筛选</div>');
    }
    const sentinel = $('#browseSentinel');
    if (sentinel && 'IntersectionObserver' in window) {
      const io = new IntersectionObserver((es) => {
        es.forEach((en) => { if (en.isIntersecting && !exhausted) loadNext(); });
      }, { rootMargin: '600px' });
      io.observe(sentinel);
    }
    const onBrowseScroll = () => {
      if (waving || exhausted || !life.ok()) return;
      const sen = $('#browseSentinel');
      if (!sen) return;
      const r = sen.getBoundingClientRect();
      if (r.top < window.innerHeight + 650) loadNext();
    };
    window.addEventListener('scroll', onBrowseScroll, { passive: true });

    const browseKey = listRouteKey(['browse', cat], query);
    activeListPage = {
      key: browseKey,
      getState: () => ({ cat, year: cur.year, exhausted }),
      rebind: (alive2) => {
        life.ok = alive2;
        waving = false;
        if (!life.ok()) return;
        $$('#yearChips .chip').forEach((c) => c.addEventListener('click', () => {
          location.hash = `#/browse/${encodeURIComponent(cat)}?year=${encodeURIComponent(c.dataset.y)}`;
        }));
        const sen = $('#browseSentinel');
        if (sen && 'IntersectionObserver' in window) {
          const io2 = new IntersectionObserver((es) => {
            es.forEach((en) => { if (en.isIntersecting && !exhausted) loadNext(); });
          }, { rootMargin: '600px' });
          io2.observe(sen);
        }
        window.addEventListener('scroll', onBrowseScroll, { passive: true });
        // 贴底时立即补一批, 避免返回后需手动再滑才触发
        const r = sen && sen.getBoundingClientRect();
        if (r && r.top < window.innerHeight + 650 && !exhausted) loadNext();
      },
    };
  }

  /* ============================================================
     视图：聚合搜索(逐源渐进式渲染, 搜到即显示)
     ============================================================ */
  async function viewSearch(q, alive) {
    const v = $('#view');
    $('#searchInput').value = q;
    if (!q) {
      v.innerHTML = `<div class="container page-wrap empty"><div class="big">🔍</div><p>输入关键词开始搜索</p></div>`;
      return;
    }
    v.innerHTML = `
      <div class="container page-wrap">
        <div class="page-head"><div class="page-title">搜索：${esc(q)}</div><div id="srcStat" style="color:var(--dim);font-size:13px"></div></div>
        <div class="search-progress"><i id="progBar"></i></div>
        <div id="srLocal"></div>
        <div class="grid" id="srGrid"></div>
        <div class="scroll-sentinel hidden" id="srSentinel"><span class="spin"></span></div>
        <div class="empty hidden" id="srEmpty"><div class="big">🙈</div><p>没有找到相关内容</p></div>
      </div>`;
    // 🔤 纯字母关键词 → 本地 + 云端拼音首字母智能模糊快搜 (如 JM 匹配 九门、老九门)
    let pyExpandedKeywords = [q];
    if (/^[a-zA-Z]{1,10}$/.test(q)) {
      try {
        store.get('favs', []).forEach((f) => indexTitle({ title: f.title, pic: f.pic, remarks: f.remarks, sourceKey: f.key, id: f.id }));
      } catch (e) { /* ignore */ }
      const want = q.toUpperCase();
      const hits = [...TitleIdx.values()]
        .filter((it) => {
          const ini = titleInitials(it.title);
          return ini === want || ini.startsWith(want) || (want.length >= 2 && ini.indexOf(want) !== -1);
        })
        .slice(0, 24);
      const localBox = $('#srLocal');
      if (localBox && hits.length) {
        localBox.innerHTML = `
          <div style="margin:2px 0 14px">
            <div style="font-size:15px;font-weight:700;margin-bottom:10px">🔤 首字母「${esc(want)}」本地匹配 <small style="color:var(--dim);font-weight:400;font-size:12px">· 支持首字母模糊检索</small></div>
            <div class="grid">${hits.map(cardHtml).join('')}</div>
          </div>`;
      }
      // 同步拉取云端拼音首字母联想词 (如 JM -> 九门 / 老九门)，自动转换为中文片名并发搜索采集源
      try {
        const pyRes = await API.pySuggest(want);
        if (pyRes && Array.isArray(pyRes.list) && pyRes.list.length) {
          const cnWords = pyRes.list.map((x) => x && x.title).filter(Boolean);
          if (cnWords.length) {
            pyExpandedKeywords = cnWords.slice(0, 2);
            if (!pyExpandedKeywords.includes(q)) pyExpandedKeywords.push(q);
            if (localBox) {
              const chipsHtml = pyRes.list.slice(0, 10).map((item) =>
                `<a class="chip ${pyExpandedKeywords.includes(item.title) ? 'on' : ''}" href="#/search?q=${encodeURIComponent(item.title)}" style="text-decoration:none">${esc(item.title)} <small style="opacity:.7">${esc(item.py || '')}</small></a>`
              ).join('');
              localBox.insertAdjacentHTML('afterbegin', `
                <div style="margin:0 0 14px;padding:12px 14px;background:var(--card);border:1px solid var(--border);border-radius:12px">
                  <div style="font-size:13.5px;font-weight:700;margin-bottom:8px">✨ 拼音首字母「${esc(want)}」智能联想（已自动为您检索：${esc(pyExpandedKeywords.slice(0, 2).join('、'))}）：</div>
                  <div class="chips" style="flex-wrap:wrap;gap:8px">${chipsHtml}</div>
                </div>`);
            }
          }
        }
      } catch (e) {}
    }
    if (!alive()) return;
    logSearch(q); // 搜索记录上报(登录用户)

    const sources = visibleSources();
    const merged = new Map(); // normTitle|year -> item
    const doneKeys = new Set(); // 已完成搜索的源 key(返回后可准确续搜)
    let renderTimer = null, reveal = 48, idx = 0, resuming = false;
    const life = { ok: alive }; // 返回搜索页时换新 alive, 才能继续展示/补搜
    const doneCount = () => doneKeys.size;

    const applyProgress = () => {
      const finished = doneCount() >= sources.length;
      const bar = $('#progBar'), stat = $('#srcStat'), prog = $('.search-progress', v);
      if (bar) {
        bar.style.width = Math.round((doneCount() / Math.max(sources.length, 1)) * 100) + '%';
        bar.classList.toggle('done', finished);
      }
      if (stat) {
        stat.innerHTML = finished
          ? `<span class="search-done">✅ 搜索完成</span> · ${sources.length} 个源 · 共 ${merged.size} 条结果`
          : `<span class="spin"></span> 正在搜索 <b>${doneCount()}</b>/${sources.length} 个源 · 已找到 ${merged.size} 条…`;
      }
      if (prog && finished) prog.remove();
    };
    const renderGrid = () => {
      if (!life.ok()) return;
      const grid = $('#srGrid');
      if (!grid) return;
      grid.innerHTML = [...merged.values()]
        .sort((a, b) => b.srcCount - a.srcCount)
        .slice(0, reveal).map(cardHtml).join('');
      const sen = $('#srSentinel');
      if (sen) sen.classList.toggle('hidden', merged.size <= reveal);
    };
    // 滚动分批展示更多结果
    function bindRevealIO() {
      const srSen = $('#srSentinel');
      if (!srSen) return;
      if ('IntersectionObserver' in window) {
        const io = new IntersectionObserver((es) => {
          es.forEach((en) => {
            if (en.isIntersecting && reveal < merged.size) { reveal += 48; renderGrid(); }
          });
        }, { rootMargin: '600px' });
        io.observe(srSen);
      }
      const onSearchScroll = () => {
        if (!life.ok() || reveal >= merged.size) return;
        const sen = $('#srSentinel');
        if (!sen) return;
        const r = sen.getBoundingClientRect();
        if (r.top <= window.innerHeight + 650) {
          reveal += 48;
          renderGrid();
        }
      };
      window.addEventListener('scroll', onSearchScroll, { passive: true });
    }
    bindRevealIO();
    // 节流渲染: 任一源返回后 120ms 内合并刷新, 结果逐步出现
    const scheduleRender = () => {
      if (renderTimer) return;
      renderTimer = setTimeout(() => { renderTimer = null; renderGrid(); }, 120);
    };

    const handle = (s, r) => {
      for (const vod of (r.list || [])) {
        const title = String(vod.vod_name || '').trim();
        if (!title) continue;
        const key = title.replace(/[\s·:：,，.!！?？]/g, '').toLowerCase() + '|' + (vod.vod_year || '');
        const hit = {
          sourceKey: s.key, sourceName: s.name, adult: s.adult, id: vod.vod_id, title,
          pic: vod.vod_pic, remarks: vod.vod_remarks, year: vod.vod_year, typeName: vod.type_name,
        };
        const ex = merged.get(key);
        if (ex) { ex.srcCount++; ex.sources.push(hit); }
        else merged.set(key, Object.assign({}, hit, { srcCount: 1, sources: [hit], showSource: true }));
      }
      scheduleRender();
    };

    // 固定并发池: 始终保持 12 个源在搜, 单个完成立即计数/渲染
    const CONCURRENCY = Math.min(12, sources.length);
    const worker = async () => {
      while (idx < sources.length) {
        if (!life.ok()) return;
        const i = idx++;
        const s = sources[i];
        if (!s || doneKeys.has(s.key)) continue;
        try {
          for (let ki = 0; ki < pyExpandedKeywords.length; ki++) {
            if (!life.ok()) break;
            try { handle(s, await API.search(s, pyExpandedKeywords[ki])); } catch (e2) {}
          }
        } catch (e) { /* 该源失败 */ }
        doneKeys.add(s.key);
        applyProgress();
      }
    };
    async function runSearchPool() {
      if (resuming || doneCount() >= sources.length) return;
      resuming = true;
      idx = 0; // 从头扫, 已完成的源靠 doneKeys 跳过
      await Promise.allSettled(Array.from({ length: CONCURRENCY }, worker));
      resuming = false;
      if (!life.ok()) return;
      if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
      applyProgress();
      renderGrid();
      if (!merged.size) setHtml('#srEmpty', '<div class="big">🙈</div><p>没有找到相关内容</p>');
      const emptyEl = $('#srEmpty');
      if (emptyEl && !merged.size) emptyEl.classList.remove('hidden');
    }
    const searchKey = listRouteKey(['search'], { q });
    activeListPage = {
      key: searchKey,
      getState: () => ({
        q, reveal,
        doneKeys: [...doneKeys],
        merged: [...merged.values()],
        finished: doneCount() >= sources.length,
      }),
      rebind: (alive2, state) => {
        life.ok = alive2;
        if (!life.ok()) return;
        const inp = $('#searchInput');
        if (inp && (state.q || q)) inp.value = state.q || q;
        reveal = state.reveal || reveal || 48;
        if (Array.isArray(state.merged) && state.merged.length) {
          merged.clear();
          for (const item of state.merged) {
            const tkey = String(item.title || '').replace(/[\s·:：,，.!！?？]/g, '').toLowerCase() + '|' + (item.year || '');
            merged.set(tkey, item);
          }
        }
        doneKeys.clear();
        for (const k of (state.doneKeys || [])) doneKeys.add(k);
        applyProgress();
        renderGrid();
        bindRevealIO();
        // 未搜完: 继续并发搜剩余源; 已搜完: 下滑继续揭示更多结果
        if (doneCount() < sources.length) runSearchPool();
        else {
          const sen = $('#srSentinel');
          const r = sen && sen.getBoundingClientRect();
          if (r && r.top < window.innerHeight + 650 && reveal < merged.size) { reveal += 48; renderGrid(); }
        }
      },
    };

    await runSearchPool();
    if (!life.ok()) return;
  }

  /* ============================================================
     私密福利：卡密解锁弹窗 & 高清图片预览弹窗
     ============================================================ */
  function openUnlockModal(onSuccess) {
    const prev = $('.unlock-modal-mask');
    if (prev) prev.remove();
    const box = document.createElement('div');
    box.className = 'modal-mask unlock-modal-mask';
    const payDesc = (State.settings && State.settings.adultPayDesc) ||
      '私密福利影片为会员专属特权内容。如需开通，可联系管理员获取激活卡密，或输入卡密立即解锁。';
    const payQr = (State.settings && State.settings.adultPayQr) || '';

    box.innerHTML = `
      <div class="modal-box unlock-modal-box" style="max-width:440px">
        <h3 style="margin:0 0 10px;display:flex;align-items:center;gap:8px">👑 解锁私密福利VIP特权</h3>
        <p style="color:var(--dim);font-size:13px;line-height:1.6;margin:0 0 14px">${esc(payDesc)}</p>
        ${payQr ? `
          <div class="unlock-qr-wrap" style="text-align:center;margin-bottom:14px;background:var(--bg2);padding:12px;border-radius:8px">
            <img src="${esc(payQr)}" alt="赞助二维码" style="max-width:180px;max-height:180px;border-radius:8px;border:1px solid var(--card-br)">
            <div style="color:var(--dim);font-size:12px;margin-top:6px">扫码赞助 / 联系客服获取卡密</div>
          </div>` : ''}
        <div style="margin-bottom:16px">
          <label style="display:block;font-size:13px;color:var(--dim);margin-bottom:6px">激活码 / 卡密</label>
          <input type="text" class="input unlock-code-input" placeholder="请输入激活卡密 (如: VIP888)" style="width:100%;box-sizing:border-box;text-transform:uppercase" />
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button class="btn ghost btn-cancel" type="button">取消</button>
          <button class="btn primary btn-submit" type="button">立即激活解锁</button>
        </div>
      </div>`;

    const close = () => box.remove();
    box.addEventListener('click', (e) => { if (e.target === box) close(); });
    const closeBtn = document.createElement('button');
    closeBtn.className = 'modal-close'; closeBtn.textContent = '×';
    const mbox = box.querySelector('.unlock-modal-box');
    if (mbox) mbox.appendChild(closeBtn);
    closeBtn.addEventListener('click', close);
    box.querySelector('.btn-cancel').addEventListener('click', close);

    const input = box.querySelector('.unlock-code-input');
    const submitBtn = box.querySelector('.btn-submit');
    const doSubmit = async () => {
      const code = String(input.value || '').trim();
      if (!code) return toast('请输入激活卡密', 'err');
      submitBtn.disabled = true;
      submitBtn.textContent = '正在激活…';
      try {
        const res = await API.userUnlockAdult(code);
        toast(res.message || '🎉 私密福利已成功解锁！', 'ok');
        if (State.config) State.config.adultUnlocked = true;
        close();
        if (typeof onSuccess === 'function') onSuccess();
        else route();
      } catch (err) {
        toast(err.message || '激活失败，卡密无效', 'err');
        submitBtn.disabled = false;
        submitBtn.textContent = '立即激活解锁';
      }
    };
    submitBtn.addEventListener('click', doSubmit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSubmit(); });
    document.body.appendChild(box);
    setTimeout(() => input.focus(), 80);
  }

  function openPicPreviewModal(vod, src) {
    const prev = $('.pic-preview-mask');
    if (prev) prev.remove();
    const box = document.createElement('div');
    box.className = 'modal-mask pic-preview-mask';
    const pic = vod.vod_pic || '';
    const name = vod.vod_name || '未知影片';
    const type = vod.type_name || '';
    const year = vod.vod_year || '';
    const desc = stripTags(vod.vod_content || '暂无简介');

    box.innerHTML = `
      <div class="modal-box pic-preview-modal-box" style="max-width:640px;width:90%">
        <div class="pic-preview-head" style="margin-bottom:14px">
          <h3 style="margin:0;display:flex;align-items:center;gap:6px">📷 私密福利 · 图片预览模式</h3>
        </div>
        <div class="pic-preview-body" style="display:flex;gap:18px;flex-wrap:wrap">
          <div class="pic-preview-poster-wrap" style="flex:0 0 200px;text-align:center">
            <img class="pic-preview-poster" src="${esc(pic)}" referrerpolicy="no-referrer" alt="${esc(name)}" style="width:100%;max-height:280px;object-fit:cover;border-radius:10px;border:1px solid var(--card-br)" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🎬</text></svg>'">
            ${pic ? `<div style="margin-top:8px"><a class="btn ghost small" href="${esc(pic)}" target="_blank" rel="noopener" style="width:100%">🔍 查看高清大图</a></div>` : ''}
          </div>
          <div class="pic-preview-info" style="flex:1;min-width:220px">
            <h2 style="font-size:18px;margin:0 0 8px">${esc(name)}</h2>
            <div class="meta-row" style="margin-bottom:12px;gap:6px;flex-wrap:wrap">
              ${type ? `<span class="tag">${esc(type)}</span>` : ''}
              ${year ? `<span class="tag plain">${esc(year)}</span>` : ''}
              <span class="tag plain">来源：${esc(cleanSrcName(src))}</span>
            </div>
            <div class="pic-lock-alert" style="display:flex;gap:10px;padding:10px 12px;background:rgba(225,29,72,.1);border:1px solid rgba(225,29,72,.3);border-radius:8px;margin-bottom:12px">
              <div style="font-size:20px;line-height:1">🔒</div>
              <div style="font-size:12.5px;line-height:1.5">
                <b style="color:var(--danger)">未付费解锁 · 播放受限</b>
                <div style="color:var(--dim)">本影片为私密福利会员影片，当前仅可预览图片与简介，无法播放视频。</div>
              </div>
            </div>
            <button class="btn primary" id="modalBtnUnlock" type="button" style="width:100%;margin-bottom:14px;background:linear-gradient(135deg,#e11d48,#be123c)">👑 立即解锁播放权限</button>
            <div class="pic-preview-desc" style="max-height:140px;overflow-y:auto;font-size:12.5px;color:var(--dim);line-height:1.6;border-top:1px solid var(--card-br);padding-top:8px">
              <b style="color:var(--txt);display:block;margin-bottom:2px">剧情简介</b>
              ${esc(desc)}
            </div>
          </div>
        </div>
      </div>`;

    const close = () => box.remove();
    box.addEventListener('click', (e) => { if (e.target === box) close(); });
    const closeBtn = document.createElement('button');
    closeBtn.className = 'modal-close'; closeBtn.textContent = '×';
    const mbox = box.querySelector('.pic-preview-modal-box');
    if (mbox) mbox.appendChild(closeBtn);
    closeBtn.addEventListener('click', close);

    const unlockBtn = box.querySelector('#modalBtnUnlock');
    if (unlockBtn) {
      unlockBtn.addEventListener('click', () => {
        close();
        openUnlockModal(() => route());
      });
    }

    document.body.appendChild(box);
  }

  /* ============================================================
     视图：详情
     ============================================================ */
  async function viewDetail(key, id, alive) {
    const v = $('#view');
    const src = findSourceByKey(key);
    if (!src) { v.innerHTML = '<div class="container empty">数据源不存在或已被后台关闭</div>'; return; }

    // 私密福利访问权限拦截
    const adultTrialMin = Number(State.config && State.config.adultTrialMinutes !== undefined ? State.config.adultTrialMinutes : (State.settings && State.settings.adultTrialMinutes !== undefined ? State.settings.adultTrialMinutes : 10));
    if (src.adult) {
      if (!State.me && adultTrialMin <= 0) {
        v.innerHTML = `<div class="container page-wrap"><div class="empty" style="padding:48px 20px"><div class="big">🔒</div><h3>私密福利影片仅限登录会员访问</h3><p style="color:var(--dim);margin:8px 0 16px">游客试看仅限正常影视内容，请先登录或注册账号。</p><a class="btn primary" href="#/login">立即登录</a></div></div>`;
        return;
      }
    }
    const isAdultLocked = Boolean(src.adult && (!State.config || !State.config.adultUnlocked) && adultTrialMin <= 0);

    v.innerHTML = `<div class="container page-wrap"><div class="grid"></div><div class="empty"><div class="big">📡</div>正在加载详情…</div></div>`;

    let r;
    try { r = await API.detail(src, id); }
    catch (e) { throw new Error('该源暂时无法访问（' + e.message + '），可点「换源」找其他播放源'); }
    if (!alive()) return;
    const vod = r.list && r.list[0];
    if (!vod) throw new Error('影片不存在或接口失效');
    updateTrackTitle('详情：《' + vod.vod_name + '》');

    const groups = parsePlayGroups(vod);
    const desc = stripTags(vod.vod_content || '暂无简介');
    const hist = store.get('hist:' + key + ':' + vod.vod_id, {});
    const watched = store.get('watched:' + key + ':' + vod.vod_id, []);
    const favList = store.get('favs', []);
    const isFav = favList.some((f) => f.key === key && f.id === String(vod.vod_id));

    v.innerHTML = `
      <div class="container page-wrap">
        <div class="detail-hero">
          <div class="detail-back" referrerpolicy="no-referrer" style="background-image:url('${esc(vod.vod_pic)}')"></div>
          <div class="detail-body">
            <div class="detail-poster"><img referrerpolicy="no-referrer" src="${esc(vod.vod_pic)}" alt="" onerror="this.style.visibility='hidden'"></div>
            <div class="detail-info">
              <h1 class="detail-title">${esc(vod.vod_name)}</h1>
              <div class="meta-row">
                ${vod.type_name ? `<span class="tag">${esc(vod.type_name)}</span>` : ''}
                ${vod.vod_year ? `<span class="tag plain">${esc(vod.vod_year)}</span>` : ''}
                ${vod.vod_area ? `<span class="tag plain">${esc(vod.vod_area)}</span>` : ''}
                ${vod.vod_lang ? `<span class="tag plain">${esc(vod.vod_lang)}</span>` : ''}
                ${vod.vod_remarks ? `<span class="tag plain">${esc(vod.vod_remarks)}</span>` : ''}
                <span class="tag plain">来源：${esc(cleanSrcName(src))}</span>
                ${src.adult ? '<span class="tag" style="background:var(--danger);color:#fff">🔞 私密福利</span>' : ''}
              </div>
              <div class="meta-row" style="font-size:13px;color:var(--dim)">
                ${vod.vod_director ? `<span>导演：${esc(stripTags(vod.vod_director))}</span>` : ''}
                ${vod.vod_actor ? `<span>主演：${esc(stripTags(vod.vod_actor).slice(0, 60))}</span>` : ''}
              </div>
              <div class="detail-actions">
                <button class="btn primary" id="btnPlay" style="${isAdultLocked ? 'background:linear-gradient(135deg,#e11d48,#be123c)' : ''}">
                  ${isAdultLocked ? '🔒 需解锁播放（点击解锁）' : '▶ 立即播放'}
                </button>
                ${isAdultLocked ? `<a class="btn ghost" href="${esc(vod.vod_pic)}" target="_blank" rel="noopener">🔍 预览海报大图</a>` : ''}
                <button class="btn ghost" id="btnFav">${isFav ? '★ 已收藏' : '☆ 收藏'}</button>
                ${!src.adult ? '<button class="btn ghost" id="btnSrc">⇄ 换源</button>' : ''}
              </div>
              ${isAdultLocked ? `
                <div class="preview-lock-banner" style="margin:12px 0 4px;padding:10px 14px;background:rgba(225,29,72,.12);border:1px solid rgba(225,29,72,.3);border-radius:8px;font-size:13px;line-height:1.5">
                  🔒 <b style="color:var(--danger)">私密福利未解锁</b>：当前账号仅支持浏览封面海报与剧照简介，无法播放正片视频流。
                  <a href="javascript:void(0)" id="detailUnlockLink" style="color:var(--acc);font-weight:700;margin-left:8px;text-decoration:underline">👑 立即输入卡密解锁</a>
                </div>` : ''}
              <p class="detail-desc" id="descP">${esc(desc)}</p>
              ${desc.length > 90 ? '<button class="desc-toggle" id="descToggle">展开全部 ▾</button>' : ''}
            </div>
          </div>
        </div>

        <section class="ep-section">
          <div class="row-head"><div class="row-title">播放列表</div><div style="color:var(--dim);font-size:12.5px" id="grpInfo"></div></div>
          <div class="ep-tabs" id="epTabs">${groups.map((g, gi) => `<button class="chip ${gi === 0 ? 'on' : ''}" data-gi="${gi}">${esc(g.name)} (${g.eps.length})</button>`).join('')}</div>
          <div class="ep-list" id="epList"></div>
        </section>
      </div>`;

    let gi = hist.group != null && groups[hist.group] ? Number(hist.group) : 0;
    function renderEps() {
      const g = groups[gi]; if (!g) return;
      $('#grpInfo').textContent = `${g.eps.length} 集 · 播放组 ${g.name}`;
      $('#epList').innerHTML = g.eps.map((e, ei) => {
        const w = watched.includes(ei);
        const curEp = hist.ep === ei;
        return `<button class="ep-btn ${w ? 'watched' : ''} ${curEp ? 'current' : ''}" data-ei="${ei}" title="${esc(e.name)}">${esc(e.name)}</button>`;
      }).join('');
      $$('#epList .ep-btn').forEach((b) => b.addEventListener('click', () => {
        if (isAdultLocked) {
          toast('私密福利未解锁，仅限图片预览', 'err');
          openUnlockModal(() => route());
          return;
        }
        location.hash = `#/play/${key}/${encodeURIComponent(id)}?ep=${b.dataset.ei}&group=${gi}`;
      }));
      $$('#epTabs .chip').forEach((c) => c.classList.toggle('on', Number(c.dataset.gi) === gi));
    }
    $$('#epTabs .chip').forEach((c) => c.addEventListener('click', () => { gi = Number(c.dataset.gi); renderEps(); }));
    renderEps();

    $('#btnPlay').addEventListener('click', () => {
      if (isAdultLocked) {
        openUnlockModal(() => route());
        return;
      }
      location.hash = `#/play/${key}/${encodeURIComponent(id)}?ep=${hist.ep != null ? hist.ep : 0}&group=${gi}`;
    });
    $('#detailUnlockLink') && $('#detailUnlockLink').addEventListener('click', () => openUnlockModal(() => route()));
    $('#btnFav').addEventListener('click', () => {
      const list = store.get('favs', []);
      const idx = list.findIndex((f) => f.key === key && f.id === String(vod.vod_id));
      if (idx >= 0) { list.splice(idx, 1); toast('已取消收藏'); }
      else {
        list.unshift({ key, id: String(vod.vod_id), title: vod.vod_name, pic: vod.vod_pic, remarks: vod.vod_remarks });
        toast('已加入收藏', 'ok');
      }
      store.set('favs', list.slice(0, 200));
      pushFavsToServer();
      $('#btnFav').textContent = idx >= 0 ? '☆ 收藏' : '★ 已收藏';
    });
    $('#descToggle') && ($('#descToggle').addEventListener('click', (e) => {
      const p = $('#descP');
      p.classList.toggle('open');
      e.target.textContent = p.classList.contains('open') ? '收起 ▴' : '展开全部 ▾';
    }));

    // 换源：并行搜同名片, 新标签页打开
    $('#btnSrc').addEventListener('click', async () => {
      toast('正在寻找其他播放源…');
      const others = visibleSources().filter((s) => s.key !== key).slice(0, 16);
      const found = [];
      await Promise.allSettled(others.map(async (s) => {
        try {
          const r2 = await API.search(s, vod.vod_name);
          for (const v2 of (r2.list || [])) {
            if (String(v2.vod_name).replace(/\s/g, '') === String(vod.vod_name).replace(/\s/g, '')) {
              found.push({ key: s.key, name: s.name, id: v2.vod_id, remarks: v2.vod_remarks });
            }
          }
        } catch (e) {}
      }));
      if (!alive()) return;
      if (!found.length) { toast('没有找到其他播放源'); return; }
      const box = document.createElement('div');
      box.className = 'modal-mask';
      box.innerHTML = `<div class="modal-box"><h3 style="margin-bottom:14px">切换播放源（找到 ${found.length} 个 · 新标签页打开）</h3>
        <div style="display:grid;gap:8px">${found.map((f) =>
        `<a class="src-item" target="_blank" rel="noopener" href="#/detail/${esc(f.key)}/${encodeURIComponent(f.id)}"><span>${esc(f.name)}</span><small style="color:var(--dim)">${esc(f.remarks || '')}</small></a>`).join('')}
        </div></div>`;
      box.addEventListener('click', (e) => {
        if (e.target === box) { box.remove(); return; }
      });
      const closeBtn = document.createElement('button');
      closeBtn.className = 'modal-close'; closeBtn.textContent = '×';
      const mbox993 = box.querySelector('.modal-box');
      if (mbox993) mbox993.appendChild(closeBtn);
      closeBtn.addEventListener('click', () => box.remove());
      document.body.appendChild(box);
    });
  }

  /* ============================================================
     视图：播放页
     ============================================================ */
  async function viewPlay(key, id, query, alive) {
    const v = $('#view');
    const src = findSourceByKey(key);
    if (!src) { v.innerHTML = '<div class="container empty">数据源不存在</div>'; return; }

    // 私密福利访问权限拦截与试看判定
    const isAdultVideo = Boolean(src && src.adult);
    const adultTrialMin = Number(State.config && State.config.adultTrialMinutes !== undefined ? State.config.adultTrialMinutes : (State.settings && State.settings.adultTrialMinutes !== undefined ? State.settings.adultTrialMinutes : 10));
    let isAdultUnlocked = Boolean(State.config && State.config.adultUnlocked);
    let isAdultTrial = Boolean(isAdultVideo && !isAdultUnlocked && adultTrialMin > 0);
    const maxAdultTrialSec = adultTrialMin * 60;

    if (isAdultVideo) {
      if (!State.me && !isAdultTrial) {
        v.innerHTML = `<div class="container page-wrap"><div class="empty" style="padding:48px 20px"><div class="big">🔒</div><h3>私密福利影片仅限登录会员访问</h3><p style="color:var(--dim);margin:8px 0 16px">游客试看功能未开启，请先登录或注册账号以获取播放特权。</p><a class="btn primary" href="#/login">立即登录</a></div></div>`;
        return;
      }
      if (State.me && !isAdultUnlocked && !isAdultTrial) {
        v.innerHTML = `
          <div class="container page-wrap">
            <div class="empty" style="padding:48px 20px">
              <div class="big">🔒</div>
              <h2 style="margin:12px 0 8px">私密福利影片 · 未解锁播放</h2>
              <p style="color:var(--dim);max-width:480px;margin:0 auto 20px">该影片属于私密福利会员特权内容，未付费解锁仅支持图片预览，无法播放视频流。</p>
              <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
                <button class="btn primary" id="playUnlockBtn" style="background:linear-gradient(135deg,#e11d48,#be123c)">👑 输入卡密立即解锁</button>
                <a class="btn ghost" href="#/user">返回会员中心</a>
              </div>
            </div>
          </div>`;
        $('#playUnlockBtn').addEventListener('click', () => openUnlockModal(() => route()));
        return;
      }
    }

    v.innerHTML = `<div class="container page-wrap"><div class="video-wrap"><video id="videoEl" controls playsinline></video>
      <div class="video-tip" id="videoTip">正在加载视频…</div></div>
      <div class="empty" style="padding:20px 0">正在获取剧集信息…</div></div>`;

    let r;
    try {
      r = await API.detail(src, id);
    } catch (e) {
      if (!alive()) return;
      v.innerHTML = `<div class="container page-wrap"><div class="empty"><div class="big">⚠️</div>
        <p><b>${esc(src.name)}</b> 加载失败：${esc(e.message)}</p>
        <p style="color:var(--dim);font-size:12.5px">该源可能已失效或网络超时，换个方式试试：</p>
        <div style="display:flex;gap:10px;justify-content:center;margin-top:14px;flex-wrap:wrap">
          <button class="btn primary small" onclick="location.reload()">🔄 重试本源</button>
          <a class="btn ghost small" href="#/sources">🔎 去影视源页换源找片</a>
          <a class="btn ghost small" href="#/home">回首页</a></div></div></div>`;
      return;
    }
    const vod = r.list && r.list[0];
    if (!vod || !String(vod.vod_name || '').trim()) {
      if (!alive()) return;
      v.innerHTML = `<div class="container page-wrap"><div class="empty"><div class="big">🙈</div>
        <p>该源未返回此影片数据，可能已下架</p>
        <a class="btn ghost small" style="margin-top:12px" href="#/home">回首页找别的片</a></div></div>`;
      return;
    }
    const groups = parsePlayGroups(vod);
    if (!groups.length) {
      if (!alive()) return;
      v.innerHTML = `<div class="container page-wrap"><div class="empty"><div class="big">😴</div>
        <p>该源暂无可播放的剧集</p>
        <a class="btn ghost small" style="margin-top:12px" href="#/detail/${key}/${encodeURIComponent(id)}">查看详情页</a></div></div>`;
      return;
    }

    let gi = Number(query.group || 0);
    if (!groups[gi]) gi = 0;
    let ei = Math.min(Number(query.ep || 0), groups[gi].eps.length - 1);
    const epName = (groups[gi] && groups[gi].eps && groups[gi].eps[ei]) ? groups[gi].eps[ei].name : '';
    updateTrackTitle('播放：《' + vod.vod_name + '》' + (epName ? ' ' + epName : ''));

    const progKey = `prog:${key}:${vod.vod_id}`;
    const allProg = store.get(progKey, {});

    const isFav = store.get('favs', []).some((f) => f.key === key && f.id === String(vod.vod_id));
    const cleanVodText = (str) => String(str || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&ldquo;|&rdquo;|&quot;/gi, '"')
      .replace(/&lsquo;|&rsquo;|&#39;/gi, "'")
      .replace(/&hellip;/gi, '…')
      .replace(/&mdash;/gi, '—')
      .replace(/&amp;/gi, '&')
      .replace(/\s+/g, ' ')
      .trim();
    const vodCleanDesc = cleanVodText(vod.vod_content || vod.vod_blurb || '');
    const vodCleanActor = cleanVodText(vod.vod_actor || '');
    const vodCleanArea = cleanVodText(vod.vod_area || '');
    const vodCleanYear = cleanVodText(vod.vod_year || '');
    const vodCleanType = cleanVodText(vod.type_name || '');
    const vodCleanRemarks = cleanVodText(vod.vod_remarks || '');

    v.innerHTML = `
      <div id="vodMetaData" class="hidden"
        data-title="${esc(vod.vod_name)}"
        data-year="${esc(vodCleanYear)}"
        data-area="${esc(vodCleanArea)}"
        data-type="${esc(vodCleanType)}"
        data-remarks="${esc(vodCleanRemarks)}"
        data-actor="${esc(vodCleanActor)}"
        data-desc="${esc(vodCleanDesc)}"
        data-pic="${esc(vod.vod_pic || '')}"
        data-total-eps="${groups[gi].eps.length}"></div>
      <div class="container page-wrap play-head">
        <button type="button" class="play-back-btn" id="playBackBtn" title="返回" aria-label="返回">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <div class="pb-title">${esc(vod.vod_name)}<span id="curEpName">${esc(groups[gi].eps[ei].name)}</span></div>
      </div>
      <div class="container page-wrap">
        <div class="play-top-row">
          <div class="play-col">
            <div class="play-stage">
              <div class="video-wrap" id="videoWrap"><video id="videoEl" playsinline webkit-playsinline autoplay></video>
                <div class="fs-top-bar" id="fsTopBar">
                  <button type="button" class="fs-back-btn" id="fsBackBtn" title="退出全屏" aria-label="退出全屏">
                    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 19l-7-7 7-7"/></svg>
                  </button>
                  <div class="fs-vod-title" id="fsVodTitle">${esc(vod.vod_name)} <small id="fsEpName">${esc(groups[gi].eps[ei].name)}</small></div>
                </div>
                <button class="pp-btn" id="ppBtn" type="button" title="播放" aria-label="播放">▶</button>
                <div class="m-ctrl" id="mCtrl">
                  <div class="m-ctrl-row">
                    <span class="m-time" id="mTimeCur">0:00</span>
                    <input class="m-seek" id="mSeek" type="range" min="0" max="1000" value="0" step="1" aria-label="进度" />
                    <span class="m-time" id="mTimeDur">0:00</span>
                    <button type="button" class="m-icon-btn" id="mFsToggle" title="全屏" aria-label="全屏"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/></svg></button>
                  </div>
                </div>
                <img class="player-wm" id="playerWm" alt="" draggable="false" />
                <div class="video-tip hidden" id="videoTip"></div>
                <div class="gest-hud" id="gestHud"></div>
              </div>
            </div>
            <div class="play-actions">
              <div class="src-badge" id="srcBadge" title="当前播放源">${srcIconHtml(src)}<span>${esc(cleanSrcName(src))}</span></div>
              <button class="chip ${store.get('autoNext', true) ? 'on' : ''}" id="autoNext">连播: ${store.get('autoNext', true) ? '开' : '关'}</button>
              <button class="chip play-fs-btn" id="playFsBtn" type="button" title="全屏"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/></svg><span>全屏</span></button>
              <button class="chip play-fav ${isFav ? 'on' : ''}" id="playFav">${isFav ? '★ 已收藏' : '☆ 收藏'}</button>
            </div>
          </div>
          <aside class="rel-rail" id="relRail">
            <div class="rail-head">📺 同类推荐 <small>同关键词 · 换源也能看</small></div>
            <div class="rail-list" id="relRailList">${skeletons(4)}</div>
          </aside>
        </div>
      </div>
      <div class="container page-wrap play-below">
        <div class="side-card swap-card">
          <h4>⚡ 快速换源</h4>
          <div class="swap-stat" id="swapStat"><span class="spin"></span> 正在探测其他播放源…</div>
          <button class="btn primary swap-open" id="openSwapBtn" disabled>🔍 探测中…</button>
          <div class="src-switch swap-flow" id="srcSwitch"></div>
          <button class="swap-miss-toggle hidden" id="swapMissToggle" type="button"></button>
          <div class="src-switch swap-flow hidden" id="swapMiss"></div>
        </div>
        <div class="side-card eps-card" style="margin-top:14px">
          <h4>📺 选集 · 共 ${groups.reduce((n, g) => n + g.eps.length, 0)} 集<button class="chip" id="epsFold">收起 ▴</button></h4>
          <div id="epsBody">
            <div class="eps-nav" id="epsNavTop"></div>
            <div class="eps-flow" id="sideEps"></div>
            <div class="eps-nav" id="epsNavBot"></div>
          </div>
        </div>
        <section class="row" id="relSec" style="margin-top:30px"></section>
      </div>`;

    const video = $('#videoEl');
    const tip = $('#videoTip');
    const wrap = $('#videoWrap');
    const ppBtn = $('#ppBtn');
    const mCtrl = $('#mCtrl');
    const mSeek = $('#mSeek');
    const mFsToggle = $('#mFsToggle');
    const playerWm = $('#playerWm');
    const mTimeCur = $('#mTimeCur');
    const mTimeDur = $('#mTimeDur');
    const fsTopBar = $('#fsTopBar');
    const fsBackBtn = $('#fsBackBtn');
    const fsEpName = $('#fsEpName');
    let autoFsByOrient = false;
    let fakeFsHistPushed = false;
    // 仅真手机/平板/APK WebView 走假全屏与横屏自动全屏; 带触摸的笔记本不算手机
    const isMobilePlayer = (() => {
      if (isTvDevice()) return false;
      const ua = navigator.userAgent || '';
      if (/Windows NT|Macintosh|Linux x86_64|CrOS/i.test(ua) && !/Android|iPhone|iPod|iPad|HarmonyOS|HUAWEI|Mobile/i.test(ua)) return false;
      if (/iPhone|iPod|iPad|Android|HarmonyOS|HUAWEI|xiaolin/i.test(ua)) return true;
      if (/Android|HarmonyOS|HUAWEI/i.test(ua) && Math.min(screen.width, screen.height) <= 920) return true;
      return window.matchMedia('(max-width: 920px) and (hover: none) and (pointer: coarse)').matches;
    })();
    if (!isMobilePlayer) {
      // 电脑: 完整原生控件(含原生全屏/音量/画中画); 双击与下方「全屏」走容器真全屏
      video.setAttribute('controls', '');
      video.removeAttribute('controlsList');
      try { video.disablePictureInPicture = false; } catch (e) {}
    } else {
      video.removeAttribute('controls');
      video.removeAttribute('controlsList');
      if (wrap) wrap.classList.add('is-mobile-player');
    }
    // 采集源 m3u8 常内嵌 DEFAULT=YES 的赌博广告"字幕轨": iOS 原生 HLS(AVPlayer) 会自动显示并盖住画面(桌面 hls.js 不会)
    // 本站无字幕功能, 一律禁用内嵌文本轨
    const killAdTextTracks = () => {
      try {
        const tts = video.textTracks;
        if (!tts) return;
        for (let i = 0; i < tts.length; i++) {
          if (tts[i].mode !== 'disabled') tts[i].mode = 'disabled';
        }
      } catch (e) {}
    };
    video.addEventListener('loadedmetadata', killAdTextTracks);
    video.addEventListener('play', killAdTextTracks);
    try {
      if (video.textTracks && video.textTracks.addEventListener) {
        video.textTracks.addEventListener('addtrack', () => setTimeout(killAdTextTracks, 0));
      }
    } catch (e) {}
    const getSavedVol = () => Math.min(1, Math.max(0, Number(store.get('vidVol', 1)) || 1));
    // iOS 全屏统一走 CSS 假全屏 + fs-rotated 旋转(B站/西瓜同款):
    // 旋转锁定下原生强制横屏/原生全屏均无法横屏(iOS 硬限制), CSS 旋转是唯一可靠方案
    const isIosDevice = /iP(hone|ad|od)/i.test(navigator.userAgent || '')
      || (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1);
    let iosNativeFs = false; // 当前是否处于 iOS 原生视频全屏
    /** 假全屏 / 容器全屏 / 视频原生全屏 均视为播放器全屏 */
    const isPlayerFs = () => {
      if (!wrap) return false;
      if (wrap.classList.contains('fake-fs')) return true;
      if (iosNativeFs) return true;
      const fs = document.fullscreenElement || document.webkitFullscreenElement;
      if (fs === wrap || fs === video) return true;
      try { if (video && video.webkitDisplayingFullscreen) return true; } catch (e) {}
      return false;
    };
    // 依据影片实际宽高比判定: 竖屏短剧(h>w)走竖屏全屏, 电影/剧集横屏全屏
    const isPortraitVideo = () => {
      try {
        const w = video.videoWidth || 0, h = video.videoHeight || 0;
        if (w > 0 && h > 0) return h > w;
      } catch (e) {}
      return false; // 元数据未就绪时按横屏处理
    };
    let prevOrientPortrait = true; // 进入全屏前的页面方向(退出全屏时原样恢复)
    let curBrightness = 1.0;
    // iOS App 壳注入的原生桥(音量/亮度): 网页 video.volume 在 iOS 上无效, 需走原生
    const nativeVol = () => (window.AndroidBridge && typeof window.AndroidBridge.setVolume === 'function') ? window.AndroidBridge : null;
    const nativeBright = () => (window.AndroidBridge && typeof window.AndroidBridge.setBrightness === 'function') ? window.AndroidBridge : null;
    const setBrightness = (b) => {
      curBrightness = Math.min(1.8, Math.max(0.2, Number(b) || 1.0));
      const nb = nativeBright();
      if (nb) {
        // 原生调节系统屏幕亮度(0~1); 超过1的部分再用 CSS 滤镜补偿提亮
        try { nb.setBrightness(Math.min(1, Math.max(0.05, curBrightness))); } catch (e) {}
        if (video) video.style.filter = curBrightness > 1.02 ? `brightness(${curBrightness.toFixed(2)})` : '';
        return;
      }
      if (video) {
        video.style.filter = Math.abs(curBrightness - 1.0) < 0.02 ? '' : `brightness(${curBrightness.toFixed(2)})`;
      }
    };
    const resetBrightness = () => {
      curBrightness = 1.0;
      if (video) video.style.filter = '';
      const nb = nativeBright();
      // 原生模式: 恢复用户进入全屏前的系统亮度, 而不是粗暴重置为最亮
      if (nb && typeof nb.resetBrightness === 'function') { try { nb.resetBrightness(); } catch (e) {} }
    };
    const applyPlayerPrefs = () => {
      const vol = getSavedVol();
      try { video.volume = vol; if (vol > 0) video.muted = false; } catch (e) {}
      const nv = nativeVol();
      if (nv) { try { nv.setVolume(vol); } catch (e) {} }
    };
    const fmtClock = (sec) => {
      sec = Math.max(0, Math.floor(sec || 0));
      const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s2 = sec % 60;
      return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s2).padStart(2, '0');
    };
    let mCtrlHideT = null;
    let mSeeking = false;
    const bumpMCtrl = (dur = 3800) => {
      if (!mCtrl) return;
      mCtrl.classList.add('show');
      if (fsTopBar) fsTopBar.classList.add('show');
      clearTimeout(mCtrlHideT);
      if (video.paused || mSeeking) return;
      mCtrlHideT = setTimeout(() => {
        if (!video.paused && !mSeeking) {
          mCtrl.classList.remove('show');
          if (fsTopBar) fsTopBar.classList.remove('show');
        }
      }, dur);
    };
    const hideMCtrlNow = () => {
      clearTimeout(mCtrlHideT);
      if (mCtrl) mCtrl.classList.remove('show');
      if (fsTopBar) fsTopBar.classList.remove('show');
    };
    const syncMSeek = () => {
      if (!mSeek || !video.duration) return;
      if (mSeeking) return;
      mSeek.value = String(Math.round((video.currentTime / video.duration) * 1000));
      if (mTimeCur) mTimeCur.textContent = fmtClock(video.currentTime);
      if (mTimeDur) mTimeDur.textContent = fmtClock(video.duration);
    };
    const syncPpBtn = () => {
      if (ppBtn) {
        ppBtn.textContent = '▶';
        ppBtn.classList.toggle('paused', video.paused);
      }
      if (mFsToggle) mFsToggle.classList.toggle('on', isPlayerFs());
      bumpMCtrl(3800);
    };
    if (fsBackBtn) {
      fsBackBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        togglePlayerFs();
      });
    }
    const playBackBtn = $('#playBackBtn');
    if (playBackBtn) {
      playBackBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (window.history.length > 1) {
          window.history.back();
        } else {
          location.hash = '#/search';
        }
      });
    }
    let adultBarrierEl = null;
    const resumeAdultPlayback = () => {
      if (adultBarrierEl) adultBarrierEl.classList.add('hidden');
      isAdultUnlocked = true;
      isAdultTrial = false;
      video.play().catch(() => {});
    };

    const showAdultTrialNotice = () => {
      video.pause();
      if (!wrap) return;
      if (!adultBarrierEl) {
        adultBarrierEl = document.createElement('div');
        adultBarrierEl.className = 'adult-trial-player-barrier';
        adultBarrierEl.innerHTML = `
          <div class="atp-inner">
            <div style="font-size:38px;margin-bottom:8px">🔞</div>
            <div style="font-size:17px;font-weight:700;margin-bottom:6px;color:#fff">私密福利 · 免费试看已结束</div>
            <div style="font-size:13px;color:rgba(255,255,255,.8);margin-bottom:16px;line-height:1.5">
              您已免费试看 ${adultTrialMin} 分钟。<br>注册账号即可获赠 VIP 会员特权，畅享完整无删减高清影片！
            </div>
            <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
              <button class="btn primary small" id="atpGoBtn" style="background:linear-gradient(135deg,#e11d48,#be123c);font-weight:700;padding:8px 18px">
                🎁 立即免费注册 / 登录
              </button>
              <button class="btn ghost small" id="atpCardBtn" style="color:#fff;border-color:rgba(255,255,255,.3);padding:8px 14px">
                🔑 输入卡密
              </button>
            </div>
          </div>`;
        wrap.appendChild(adultBarrierEl);
        $('#atpGoBtn', adultBarrierEl).addEventListener('click', () => {
          showAdultTrialModal(adultTrialMin, resumeAdultPlayback);
        });
        $('#atpCardBtn', adultBarrierEl).addEventListener('click', () => {
          openUnlockModal(resumeAdultPlayback);
        });
      }
      adultBarrierEl.classList.remove('hidden');
      showAdultTrialModal(adultTrialMin, resumeAdultPlayback);
    };

    const checkAdultLimit = () => {
      if (!isAdultTrial || isAdultUnlocked) return false;
      if (video.currentTime >= maxAdultTrialSec) {
        video.currentTime = maxAdultTrialSec;
        video.pause();
        showAdultTrialNotice();
        return true;
      }
      return false;
    };

    if (isAdultTrial) {
      toast(`⏱️ 游客免费试看中（限时 ${adultTrialMin} 分钟，注册即送 VIP 特权）`, 'warn');
    }

    const togglePlay = () => {
      if (video.paused) {
        if (checkAdultLimit()) return;
        const p = video.play();
        if (p && typeof p.catch === 'function') {
          p.catch((err) => {
            console.warn('Playback play() catch:', err);
          });
        }
      } else {
        video.pause();
      }
      syncPpBtn();
    };
    applyPlayerPrefs();
    syncPpBtn();
    ['loadedmetadata', 'canplay', 'playing', 'pause', 'play', 'timeupdate', 'durationchange'].forEach((ev) => {
      video.addEventListener(ev, () => {
        if (ev === 'timeupdate' || ev === 'durationchange') {
          checkAdultLimit();
          syncMSeek();
          return;
        }
        applyPlayerPrefs();
        syncPpBtn();
        syncMSeek();
      });
    });
    video.addEventListener('volumechange', () => {
      try { if (!video.muted && video.volume >= 0) store.set('vidVol', Number(video.volume.toFixed(2))); } catch (e) {}
    });
    if (ppBtn) {
      ppBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (tip && !tip.querySelector('.failover-box')) {
          tip.classList.add('hidden');
          tip.innerHTML = '';
        }
        togglePlay();
        bumpMCtrl();
      });
    }
    if (tip) {
      tip.addEventListener('click', (e) => {
        if (e.target.closest('.failover-box, button, a')) return;
        tip.classList.add('hidden');
        tip.innerHTML = '';
        togglePlay();
        bumpMCtrl();
      });
    }
    if (mSeek) {
      mSeek.addEventListener('pointerdown', () => { mSeeking = true; bumpMCtrl(); });
      mSeek.addEventListener('input', () => {
        if (!video.duration) return;
        const t = (Number(mSeek.value) / 1000) * video.duration;
        if (mTimeCur) mTimeCur.textContent = fmtClock(t);
        bumpMCtrl();
      });
      const endSeek = () => {
        if (!video.duration) { mSeeking = false; return; }
        let target = (Number(mSeek.value) / 1000) * video.duration;
        if (isAdultTrial && !isAdultUnlocked && target >= maxAdultTrialSec) {
          target = maxAdultTrialSec;
          try { video.currentTime = maxAdultTrialSec; } catch (e) {}
          video.pause();
          showAdultTrialNotice();
          mSeeking = false;
          bumpMCtrl();
          return;
        }
        try { video.currentTime = target; } catch (e) {}
        mSeeking = false;
        bumpMCtrl();
      };
      mSeek.addEventListener('change', endSeek);
      mSeek.addEventListener('pointerup', endSeek);
      mSeek.addEventListener('pointercancel', () => { mSeeking = false; bumpMCtrl(); });
    }

    // ---- 播放器 PNG 水印: 始终挂在 #videoWrap 内(真全屏/假全屏都能看见) ----
    let refreshPlayerWm = () => {};
    {
      let wmHideT = null;
      const wmCfg = () => {
        const st = State.settings || {};
        const dur = Math.min(60, Math.max(1, Number(st.wmDuration == null ? 2 : st.wmDuration) || 2));
        return {
          on: !!st.wmEnabled && !!(st.wmUrl || '').trim(),
          mode: st.wmMode === 'center' ? 'center' : 'corner',
          url: String(st.wmUrl || '').trim(),
          opacity: Math.min(1, Math.max(0.15, Number(st.wmOpacity == null ? 0.55 : st.wmOpacity) || 0.55)),
          durationMs: dur * 1000,
        };
      };
      const hideWm = () => { if (playerWm) playerWm.classList.remove('show'); };
      const ensureWmInWrap = () => {
        if (!playerWm || !wrap) return;
        playerWm.classList.remove('wm-body-fs');
        if (playerWm.parentElement !== wrap) wrap.appendChild(playerWm);
      };
      const flashCenterWm = () => {
        const c = wmCfg();
        if (!playerWm || !c.on || c.mode !== 'center') return;
        ensureWmInWrap();
        playerWm.style.setProperty('--wm-op', String(c.opacity));
        playerWm.classList.add('show');
        clearTimeout(wmHideT);
        wmHideT = setTimeout(hideWm, c.durationMs);
      };
      const syncCornerWm = () => {
        const c = wmCfg();
        if (!playerWm || !c.on || c.mode !== 'corner') { hideWm(); return; }
        ensureWmInWrap();
        playerWm.style.setProperty('--wm-op', String(c.opacity));
        if (!video.paused) playerWm.classList.add('show');
        else hideWm();
      };
      const applyWm = () => {
        if (!playerWm) return;
        const c = wmCfg();
        playerWm.classList.toggle('mode-center', c.mode === 'center');
        playerWm.classList.toggle('mode-corner', c.mode === 'corner');
        playerWm.style.setProperty('--wm-op', String(c.opacity));
        playerWm.style.opacity = '';
        if (!c.on) {
          playerWm.removeAttribute('src');
          playerWm.classList.add('off');
          hideWm();
          ensureWmInWrap();
          return;
        }
        playerWm.classList.remove('off');
        if (playerWm.getAttribute('src') !== c.url) playerWm.src = c.url;
        ensureWmInWrap();
        if (c.mode === 'corner') syncCornerWm();
        else if (!video.paused) flashCenterWm();
        else hideWm();
      };
      refreshPlayerWm = () => { applyWm(); };
      applyWm();
      video.addEventListener('playing', () => {
        const c = wmCfg();
        if (!c.on) return;
        if (c.mode === 'center') flashCenterWm();
        else syncCornerWm();
      });
      video.addEventListener('play', () => {
        const c = wmCfg();
        if (c.on && c.mode === 'center') flashCenterWm();
        if (c.on && c.mode === 'corner') syncCornerWm();
      });
      video.addEventListener('pause', () => {
        const c = wmCfg();
        if (c.mode === 'corner') hideWm();
      });
    }

    // 右侧「同类推荐」栏高度 = 播放器实际渲染高度(含窗口缩放自适应; ≤1080px 横排模式自动解除)
    const syncRailH = () => {
      const rail = $('#relRail'), vw = $('#videoWrap');
      if (!rail) { window.removeEventListener('resize', onRailResize); return; }
      if (!vw) return;
      if (window.innerWidth <= 1080) { rail.style.height = ''; return; }
      rail.style.height = vw.offsetHeight + 'px';
    };
    const onRailResize = () => {
      if (!alive() || !document.getElementById('relRail')) { window.removeEventListener('resize', onRailResize); return; }
      syncRailH();
    };
    syncRailH();
    window.addEventListener('resize', onRailResize);

    // ---- 选集: 翻页(60集/页) + 折叠, 长剧不再无限拉长页面 ----
    const EPP = 60;
    let epsPg = Math.floor(ei / EPP);
    function renderEpsNav() {
      const pages = Math.ceil(groups[gi].eps.length / EPP);
      const html = pages <= 1 ? '' : `
        <button class="chip" data-d="-1" ${epsPg <= 0 ? 'disabled' : ''}>‹ 前 ${EPP} 集</button>
        <span style="color:var(--dim);font-size:12px">第 ${epsPg + 1} / ${pages} 页</span>
        <button class="chip" data-d="1" ${epsPg >= pages - 1 ? 'disabled' : ''}>后 ${EPP} 集 ›</button>`;
      $('#epsNavTop').innerHTML = html;
      $('#epsNavBot').innerHTML = html;
      $$('#epsBody .eps-nav .chip').forEach((b) => b.addEventListener('click', () => {
        if (b.disabled) return;
        epsPg += Number(b.dataset.d);
        renderSideEps();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }));
    }
    function renderSideEps() {
      const g = groups[gi];
      const wa = store.get('watched:' + key + ':' + vod.vod_id, []);
      const seg = g.eps.slice(epsPg * EPP, (epsPg + 1) * EPP);
      $('#sideEps').innerHTML = seg.map((e, j) => {
        const i = epsPg * EPP + j;
        return `<button class="ep-btn ${i === ei ? 'current' : ''} ${wa.includes(i) ? 'watched' : ''}"
          data-i="${i}" title="${esc(e.name)}">${esc(e.name)}</button>`;
      }).join('');
      $$('#sideEps .ep-btn').forEach((b) => b.addEventListener('click', () => gotoEp(Number(b.dataset.i))));
      renderEpsNav();
      const curBtn = $('#sideEps .ep-btn.current');
      curBtn && curBtn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    $('#epsFold').addEventListener('click', (e) => {
      const body = $('#epsBody');
      body.classList.toggle('hidden');
      e.target.textContent = body.classList.contains('hidden') ? '展开选集 ▾' : '收起 ▴';
    });

    let saveTimer = null; // 进度保存定时器(换集/离开页面时必须停掉, 否则污染旧集进度)
    let readyCheckTimer = null;
    let failoverCheckTimer = null;
    function stopSaveTimer() {
      if (saveTimer) { clearInterval(saveTimer); saveTimer = null; }
      if (readyCheckTimer) { clearTimeout(readyCheckTimer); readyCheckTimer = null; }
      if (failoverCheckTimer) { clearTimeout(failoverCheckTimer); failoverCheckTimer = null; }
    }

    const swapHits = [];
    let swapPending = 0;
    let autoFailoverTimer = null;
    let hasPlaybackFailed = false;

    /** 用户取消自动换源后的静态面板（保证随时可返回/重试，绝不卡死） */
    function renderFailoverCancelled() {
      if (!alive() || !tip) return;
      clearTimeout(autoFailoverTimer);
      tip.classList.remove('hidden');
      tip.innerHTML = `
        <div class="failover-box" style="padding:16px 20px;background:rgba(0,0,0,0.85);border-radius:12px;border:1px solid rgba(255,255,255,0.15);max-width:380px;margin:0 auto">
          <div style="font-size:15px;font-weight:600;margin-bottom:6px">⏸️ 已停止自动换源</div>
          <div style="font-size:13px;color:var(--dim);margin-bottom:14px">当前线路播放失败。你可以重试，或返回继续浏览其他影片</div>
          <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
            <button class="btn primary small" id="foResumeBtn">🔄 重试播放</button>
            <button class="btn ghost small" id="foBackBtn">← 返回上一页</button>
            <a class="btn ghost small" href="#/home">🏠 回首页</a>
          </div>
        </div>`;
      const bR = $('#foResumeBtn');
      if (bR) bR.onclick = () => {
        sessionStorage.removeItem('ntv_failover_cancel');
        hasPlaybackFailed = false;
        playCurrent(true);
      };
      const bB = $('#foBackBtn');
      if (bB) bB.onclick = () => {
        sessionStorage.removeItem('ntv_failover_cancel');
        try { history.back(); } catch (e) { location.hash = '#/home'; }
      };
    }

    function handlePlaybackFailure(trigger) {
      if (!alive()) return;
      // 用户已手动取消自动换源：停止一切自动切换，仅保留可返回的静态面板
      if (sessionStorage.getItem('ntv_failover_cancel') === '1') { renderFailoverCancelled(); return; }
      if (trigger !== 'swap_hit_arrived' && trigger !== 'all_swap_finished') {
        if (hasPlaybackFailed) return;
        hasPlaybackFailed = true;
        // 1. 如果当前影片包含其他播放组（例如 线路2、线路3），优先尝试切线路
        if (groups.length > 1 && gi + 1 < groups.length) {
          toast(`当前线路播放失败，正在自动尝试线路 ${gi + 2}…`, 'info');
          gotoEp(ei, gi + 1);
          return;
        }
      } else {
        if (!hasPlaybackFailed) return; // 播放正常则不响应探测更新
      }

      const swapCount = Number(sessionStorage.getItem('ntv_swap_count') || 0);

      const renderFailoverUI = (targetHit) => {
        if (!alive() || !tip) return;
        tip.classList.remove('hidden');
        if (targetHit && swapCount < 3) {
          tip.innerHTML = `
            <div class="failover-box" style="padding:16px 20px;background:rgba(0,0,0,0.85);border-radius:12px;border:1px solid rgba(255,255,255,0.15);max-width:380px;margin:0 auto">
              <div style="font-size:15px;font-weight:600;margin-bottom:6px">⚠️ 播放失败（上游CDN失效或断连）</div>
              <div style="font-size:13px;color:var(--dim);margin-bottom:14px">已为您找到可用源【<b>${esc(targetHit.s.name)}</b>】，正在自动无缝切换…</div>
              <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
                <button class="btn primary small" id="doSwapNowBtn">⚡ 立即切源</button>
                <button class="btn ghost small" id="doRetryBtn">🔄 重试</button>
                <button class="btn ghost small" id="foCancelBtn">✕ 取消自动换源</button>
              </div>
            </div>`;
          const doSwap = () => {
            clearTimeout(autoFailoverTimer);
            sessionStorage.setItem('ntv_swap_count', String(swapCount + 1));
            toast(`已自动切换到可用源：${targetHit.s.name}`, 'ok');
            location.replace(`#/play/${esc(targetHit.s.key)}/${encodeURIComponent(targetHit.id)}?ep=${ei}&group=0`);
          };
          const b1 = $('#doSwapNowBtn');
          if (b1) b1.onclick = doSwap;
          const b2 = $('#doRetryBtn');
          if (b2) b2.onclick = () => { hasPlaybackFailed = false; playCurrent(true); };
          const bC = $('#foCancelBtn');
          if (bC) bC.onclick = () => {
            sessionStorage.setItem('ntv_failover_cancel', '1');
            renderFailoverCancelled();
          };
          clearTimeout(autoFailoverTimer);
          autoFailoverTimer = setTimeout(doSwap, isTvDevice() ? 300 : 1000);
        } else if (swapPending > 0) {
          tip.innerHTML = `
            <div class="failover-box" style="padding:16px 20px;background:rgba(0,0,0,0.85);border-radius:12px;border:1px solid rgba(255,255,255,0.15);max-width:380px;margin:0 auto">
              <div style="font-size:15px;font-weight:600;margin-bottom:6px">⚠️ 播放连接异常（上游CDN失效）</div>
              <div style="font-size:13px;color:var(--dim);margin-bottom:14px"><span class="spin"></span> 正在自动探测其他可用源，探测到将立即无缝切换…</div>
              <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
                <button class="btn ghost small" id="doRetryBtn">🔄 重试当前源</button>
                <button class="btn ghost small" id="foCancelBtn2">✕ 停止自动探测</button>
                <a class="btn ghost small" href="#/home">回首页</a>
              </div>
            </div>`;
          const b2 = $('#doRetryBtn');
          if (b2) b2.onclick = () => { hasPlaybackFailed = false; playCurrent(true); };
          const bC2 = $('#foCancelBtn2');
          if (bC2) bC2.onclick = () => {
            sessionStorage.setItem('ntv_failover_cancel', '1');
            renderFailoverCancelled();
          };
        } else {
          tip.innerHTML = `
            <div class="failover-box" style="padding:16px 20px;background:rgba(0,0,0,0.85);border-radius:12px;border:1px solid rgba(255,255,255,0.15);max-width:380px;margin:0 auto">
              <div style="font-size:15px;font-weight:600;margin-bottom:6px">⚠️ 播放失败，且暂无其他可用源</div>
              <div style="font-size:13px;color:var(--dim);margin-bottom:14px">可能是上游源下架或CDN证书异常，可尝试刷新或换部影片</div>
              <div style="display:flex;gap:10px;justify-content:center">
                <button class="btn primary small" id="doRetryBtn">🔄 重试</button>
                <a class="btn ghost small" href="#/home">回首页找片</a>
              </div>
            </div>`;
          const b2 = $('#doRetryBtn');
          if (b2) b2.onclick = () => { hasPlaybackFailed = false; playCurrent(true); };
        }
      };

      if (swapHits.length > 0) {
        renderFailoverUI(swapHits[0]);
      } else {
        renderFailoverUI(null);
      }
    }

    function playCurrent(resume) {
      if (checkMobileWebLimit(video)) return;
      if (inApp()) maybeAppUpdate();
      const ep = groups[gi].eps[ei];
      hasPlaybackFailed = false;
      clearTimeout(autoFailoverTimer);
      clearTimeout(readyCheckTimer);
      clearTimeout(failoverCheckTimer);

      tip.classList.remove('hidden');
      tip.textContent = '正在加载…';
      const clear = () => {
        clearTimeout(readyCheckTimer);
        clearTimeout(failoverCheckTimer);
        sessionStorage.removeItem('ntv_swap_count');
        sessionStorage.removeItem('ntv_failover_cancel');
        hasPlaybackFailed = false;
        tip.classList.add('hidden');
        tip.innerHTML = '';
        syncPpBtn();
      };
      const clearEvents = ['playing', 'play', 'canplay', 'loadeddata', 'loadedmetadata', 'timeupdate', 'player-autoplay-blocked'];
      clearEvents.forEach((ev) => video.addEventListener(ev, clear, { once: true }));
      video.addEventListener('error', (e) => handlePlaybackFailure(e), { once: true });
      video.addEventListener('player-error', (e) => handlePlaybackFailure(e.detail), { once: true });

      Player.play(video, ep.url, tip, {
        optimize: !!(State.settings && State.settings.playerOptimize),
        onError: (err) => handlePlaybackFailure(err),
      });
      applyPlayerPrefs();

      // 即时检查：如果流元数据已就绪或正在播放，直接解除加载遮罩
      if (video.readyState >= 1 || (video.duration && video.duration > 0) || !video.paused) {
        clear();
      }

      // iOS 移动端加载检测兜底: 若 3.5 秒内视频元数据或首帧就绪，清除遮罩，显示播放按钮
      readyCheckTimer = setTimeout(() => {
        if (!alive() || !video.isConnected || hasPlaybackFailed) return;
        if (video.readyState >= 1 || (video.duration && video.duration > 0) || !video.paused) {
          clear();
        }
      }, 3500);

      // 超时兜底(6.5秒): 若 6.5 秒内仍未加载出视频帧(readyState < 2 且进度为 0)，立即触发自动换源，杜绝电视/网页端卡死黑屏
      failoverCheckTimer = setTimeout(() => {
        if (!alive() || !video.isConnected || hasPlaybackFailed) return;
        if (video.readyState < 2 && (!video.currentTime || video.currentTime < 0.2) && !tip.querySelector('.failover-box')) {
          handlePlaybackFailure('timeout_no_stream');
        }
      }, 6500);

      if (resume && allProg[gi + ':' + ei] && allProg[gi + ':' + ei].t > 20) {
        const onceSeek = () => { try { video.currentTime = allProg[gi + ':' + ei].t; } catch (e) {} };
        video.addEventListener('loadedmetadata', onceSeek, { once: true });
      }
      // 进度保存 + 观看心跳(每30秒向服务器累计观看时长)
      stopSaveTimer();
      let beat = 0;
      saveTimer = setInterval(() => {
        if (!alive() || !video.isConnected) return stopSaveTimer(); // 已切页: 自动停止
        if (!video.paused && checkMobileWebLimit(video, 5)) return stopSaveTimer();
        if (video.currentTime > 5) {
          allProg[gi + ':' + ei] = { t: Math.floor(video.currentTime), d: Math.floor(video.duration || 0) };
          store.set(progKey, allProg);
          beat++;
          if (beat % 6 === 0 && State.me && alive()) {
            API.userProgress({
              srcKey: key, vidId: String(vod.vod_id), title: vod.vod_name,
              srcName: src.name, pic: vod.vod_pic,
              ep: groups[gi].eps[ei] ? groups[gi].eps[ei].name : '',
              t: Math.floor(video.currentTime), deltaSec: 30,
            });
          }
        }
      }, 5000);
      // 记录看过
      const wa = store.get('watched:' + key + ':' + vod.vod_id, []);
      if (!wa.includes(ei)) { wa.push(ei); store.set('watched:' + key + ':' + vod.vod_id, wa); }
      // 自动连播
      video.onended = () => {
        if (store.get('autoNext', true) && ei < groups[gi].eps.length - 1) {
          toast('本集结束，自动播放下一集', 'ok');
          gotoEp(ei + 1);
        }
      };
    }

    function gotoEp(nextEi, nextGi) {
      sessionStorage.removeItem('ntv_failover_cancel'); // 手动切集/切线后重新允许自动换源
      if (nextGi != null) gi = nextGi;
      ei = nextEi;
      epsPg = Math.floor(ei / EPP);
      history.replaceState(null, '', `#/play/${key}/${encodeURIComponent(id)}?ep=${ei}&group=${gi}`);
      renderSideEps();
      playCurrent(true);
      const t = $('#curEpName');
      if (t) t.textContent = groups[gi].eps[ei].name;
      if (fsEpName && groups[gi] && groups[gi].eps[ei]) {
        fsEpName.textContent = groups[gi].eps[ei].name;
      }
      updateTrackTitle('播放：《' + vod.vod_name + '》 ' + (groups[gi] && groups[gi].eps && groups[gi].eps[ei] ? groups[gi].eps[ei].name : ''));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    $('#autoNext').addEventListener('click', (e) => {
      const nv = !store.get('autoNext', true);
      store.set('autoNext', nv);
      e.target.textContent = '连播: ' + (nv ? '开' : '关');
      e.target.classList.toggle('on', nv);
    });

    // ⛶ 全屏: 电脑 = 浏览器真全屏(容器); 手机 = 假全屏(兼容 iOS)
    const exitNativeFs = async () => {
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      resetBrightness();
      // iOS 原生视频全屏不产生 fullscreenElement, 必须在提前 return 之前兜底退出
      try { if (video.webkitDisplayingFullscreen && video.webkitExitFullscreen) video.webkitExitFullscreen(); } catch (e) {}
      if (!fsEl) return;
      try {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) await exit.call(document);
      } catch (e) {}
    };
    const enterNativeFs = () => {
      const wrapEl = $('#videoWrap');
      if (!wrapEl) return Promise.resolve();
      if (wrapEl.classList.contains('fake-fs')) exitFakeFs();
      let p = null;
      try {
        // 必须在用户手势栈内同步发起, 不可先 await 其它 Promise
        if (wrapEl.requestFullscreen) p = wrapEl.requestFullscreen();
        else if (wrapEl.webkitRequestFullscreen) { wrapEl.webkitRequestFullscreen(); p = Promise.resolve(); }
        else { toast('当前浏览器不支持全屏', 'err'); return Promise.resolve(); }
      } catch (e) {
        toast('当前浏览器无法进入全屏', 'err');
        return Promise.resolve();
      }
      return Promise.resolve(p).then(() => {
        requestAnimationFrame(() => refreshPlayerWm());
      }).catch(() => toast('当前浏览器无法进入全屏', 'err'));
    };
    const togglePlayerFs = async () => {
      autoFsByOrient = false;
      if (isMobilePlayer) {
        if (wrap.classList.contains('fake-fs') || isPlayerFs()) {
          await exitNativeFs();
          exitFakeFs();
        } else {
          await exitNativeFs();
          enterFakeFs();
        }
      } else {
        const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
        if (fsEl) await exitNativeFs();
        else if (wrap.classList.contains('fake-fs')) { exitFakeFs(); enterNativeFs(); }
        else enterNativeFs();
      }
      syncPpBtn();
      bumpMCtrl();
    };
    // 全屏切换: 统一由控制条 ⛶ 按钮(mFsToggle)触发
    // 控制栏全屏按钮 (移动端与电脑端通用)
    if (mFsToggle) {
      mFsToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        if (e.currentTarget && e.currentTarget.blur) e.currentTarget.blur();
        togglePlayerFs();
      });
    }
    // 操作行(收藏那行)常驻「全屏」按钮: iOS 上控制条需先点视频唤出, 此按钮保证一键直达全屏
    const playFsBtn = $('#playFsBtn');
    if (playFsBtn) {
      playFsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.currentTarget && e.currentTarget.blur) e.currentTarget.blur();
        togglePlayerFs();
      });
    }
    // 桌面单击画面暂停/播放(避开原生控件条); 双击另走真全屏
    if (wrap && !isMobilePlayer) {
      let deskClickT = null;
      wrap.addEventListener('click', (e) => {
        if (e.target.closest('.m-ctrl, button, a, input, select')) return;
        const rect = wrap.getBoundingClientRect();
        if (e.clientY > rect.bottom - 52) return;
        e.preventDefault();
        e.stopPropagation();
        clearTimeout(deskClickT);
        deskClickT = setTimeout(() => {
          if (!alive() || !video.isConnected) return;
          togglePlay();
        }, 220);
      }, true);
      wrap.addEventListener('dblclick', () => { clearTimeout(deskClickT); }, true);
    }

    let userExitedFs = false;
    const syncRotatedFs = () => {
      if (!alive() || !video.isConnected) {
        window.removeEventListener('resize', syncRotatedFs);
        return;
      }
      const wrapEl = $('#videoWrap');
      if (!wrapEl || !wrapEl.classList.contains('fake-fs')) return;
      const inApk = !!(window.AndroidBridge && typeof window.AndroidBridge.setOrientation === 'function');
      // Android App 壳: 原生 setRequestedOrientation 不受系统旋转锁定影响, 总能真横屏, 无需 CSS 旋转;
      // iOS(App壳/Safari/WebClip): 竖排方向锁定下原生强制横屏无效, 必须用 CSS 旋转90°铺满(B站/西瓜同款)
      if (inApk && !isIosDevice) {
        wrapEl.classList.remove('fs-rotated');
        wrapEl.style.width = '';
        wrapEl.style.height = '';
        return;
      }
      if (isPortraitVideo()) {
        // 竖屏短剧: 任何窗口方向下都不旋转, 竖屏铺满
        wrapEl.classList.remove('fs-rotated');
        wrapEl.style.width = '';
        wrapEl.style.height = '';
        return;
      }
      const isPortrait = window.innerWidth < window.innerHeight;
      if (isPortrait) {
        wrapEl.classList.add('fs-rotated');
        wrapEl.style.width = window.innerHeight + 'px';
        wrapEl.style.height = window.innerWidth + 'px';
      } else {
        wrapEl.classList.remove('fs-rotated');
        wrapEl.style.width = '';
        wrapEl.style.height = '';
      }
    };
    window.addEventListener('resize', syncRotatedFs);
    window.addEventListener('orientationchange', () => setTimeout(syncRotatedFs, 150));

    // 影片元数据晚到时(width/height 就绪或流内切换分辨率)重新校准全屏横竖方向
    const onVideoAspectReady = () => {
      if (!alive() || !video.isConnected) return;
      const wrapEl = $('#videoWrap');
      if (!wrapEl || !wrapEl.classList.contains('fake-fs')) return;
      const inApk = !!(window.AndroidBridge && typeof window.AndroidBridge.setOrientation === 'function');
      if (inApk) {
        try { window.AndroidBridge.setOrientation(isPortraitVideo() ? 'portrait' : 'landscape'); } catch (e) {}
      } else {
        try { screen.orientation && screen.orientation.lock && screen.orientation.lock(isPortraitVideo() ? 'portrait' : 'landscape'); } catch (e) {}
      }
      syncRotatedFs();
    };
    video.addEventListener('loadedmetadata', onVideoAspectReady);
    video.addEventListener('resize', onVideoAspectReady);

    function enterFakeFs() {
      const wrapEl = $('#videoWrap');
      if (!wrapEl || wrapEl.classList.contains('fake-fs')) return;
      const inApk = !!(window.AndroidBridge && typeof window.AndroidBridge.setOrientation === 'function');
      // iOS 全平台(App壳/Safari/WebClip)统一走 CSS 假全屏(B站/西瓜播放器同款方案):
      // 开发者实测结论 —— 系统开启"竖排方向锁定"后, 原生程序性强制旋转(setValue orientation)
      // 与原生全屏(webkitEnterFullscreen)都无法横屏, 这是 iOS 的硬限制, 与是否安装 App 无关;
      // 唯一可靠方案是 CSS 假全屏 + 容器旋转90°(fs-rotated), 自定义控制条/进度/音量/亮度手势全部保留。
      // (未锁定旋转时 App 壳仍会同时请求原生强制横屏, 真横屏成功后 syncRotatedFs 会自动摘掉旋转变换)
      // 记录进入前的页面方向, 退出全屏时原样恢复(原来竖屏回竖屏, 横屏回横屏)
      prevOrientPortrait = window.innerHeight >= window.innerWidth;
      wrapEl.classList.add('fake-fs');
      document.body.style.overflow = 'hidden';
      document.documentElement.classList.add('player-fs');
      // 沉浸式: 全屏时隐藏系统状态栏(优酷/腾讯视频同款); 仅 iOS 壳有此桥, 其他环境自动跳过
      try {
        if (window.AndroidBridge && typeof window.AndroidBridge.setStatusBar === 'function') {
          window.AndroidBridge.setStatusBar(true);
        }
      } catch (e) {}

      const wantPortrait = isPortraitVideo(); // 竖屏短剧→竖屏全屏; 电影/剧集→横屏全屏
      if (inApk) {
        try { window.AndroidBridge.setOrientation(wantPortrait ? 'portrait' : 'landscape'); } catch (e) {}
        // iOS 壳关键: 锁定旋转时原生强制横屏无效, 必须立即套 CSS 旋转铺满;
        // 若未锁定, 原生真横屏成功后 resize 会触发 syncRotatedFs 自动摘掉旋转变换(闪烁可忽略)
        syncRotatedFs();
      } else {
        // 手机浏览器: 先尝试系统级全屏 API (自动隐藏地址栏/状态栏)
        const tryNativeFs = () => {
          try {
            if (video && video.requestFullscreen) {
              return video.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
            } else if (video && video.webkitRequestFullscreen) {
              video.webkitRequestFullscreen();
            } else if (wrapEl.requestFullscreen) {
              return wrapEl.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
            } else if (wrapEl.webkitRequestFullscreen) {
              wrapEl.webkitRequestFullscreen();
            }
          } catch (e) {}
          return Promise.resolve();
        };
        // 同时保留 CSS rotate 方案作为 fallback（系统全屏 API 不可用时保证体验）
        try { screen.orientation && screen.orientation.lock && screen.orientation.lock(wantPortrait ? 'portrait' : 'landscape'); } catch (e) {}
        syncRotatedFs();
        // iOS 不支持元素级全屏 API, 且原生视频全屏在旋转锁定下只能竖屏+吞掉自定义控制条, 直接走 CSS 旋转铺满
        if (!isIosDevice) tryNativeFs();
      }

      // 仅在纯移动端浏览器中压入一层历史(APK由原生 onBackPressed 拦截, 不压入以防历史污染导致返回死循环)
      if (!inApk && isMobilePlayer && !fakeFsHistPushed) {
        try { history.pushState({ ntvFakeFs: 1 }, ''); fakeFsHistPushed = true; } catch (e) {}
      }
      bumpMCtrl(4000);
      syncPpBtn();
      requestAnimationFrame(() => refreshPlayerWm());
    }

    function exitFakeFs(fromPopstate) {
      const wrapEl = $('#videoWrap');
      if (!wrapEl) return;
      userExitedFs = true;
      const wasFs = wrapEl.classList.contains('fake-fs');
      wrapEl.classList.remove('fake-fs', 'fs-rotated');
      wrapEl.style.width = '';
      wrapEl.style.height = '';
      document.body.style.overflow = '';
      document.documentElement.classList.remove('player-fs');
      // 退出全屏: 恢复系统状态栏显示
      try {
        if (window.AndroidBridge && typeof window.AndroidBridge.setStatusBar === 'function') {
          window.AndroidBridge.setStatusBar(false);
        }
      } catch (e) {}

      const inApk = !!(window.AndroidBridge && typeof window.AndroidBridge.setOrientation === 'function');
      if (inApk) {
        // 恢复到进入全屏之前的方向(之前竖屏就回竖屏, 之前横屏就回横屏)
        try { window.AndroidBridge.setOrientation(prevOrientPortrait ? 'portrait' : 'landscape'); } catch (e) {}
      } else {
        try { screen.orientation && screen.orientation.unlock && screen.orientation.unlock(); } catch (e) {}
        // 若进入时触发了浏览器真全屏, 退出时同步退出
        const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
        if (fsEl) {
          try { if (document.exitFullscreen) document.exitFullscreen().catch(() => {}); else if (document.webkitExitFullscreen) document.webkitExitFullscreen(); } catch (e) {}
        }
      }
      // iOS 原生视频全屏兜底退出(确保回到竖屏页面)
      if (iosNativeFs) {
        iosNativeFs = false;
        try { if (video && video.webkitExitFullscreen) video.webkitExitFullscreen(); } catch (e) {}
      }



      resetBrightness();

      if (!inApk && wasFs && fakeFsHistPushed && !fromPopstate) {
        fakeFsHistPushed = false;
        try { history.back(); } catch (e) {}
      } else {
        fakeFsHistPushed = false;
      }
      bumpMCtrl(2000);
      syncPpBtn();
      requestAnimationFrame(() => refreshPlayerWm());
    }
    // App / 浏览器返回键: 全屏中优先退出全屏
    const onFakeFsPop = () => {
      if (!alive() || !video.isConnected) {
        window.removeEventListener('popstate', onFakeFsPop);
        window.__ntvExitFs = null;
        return;
      }
      if (wrap && (wrap.classList.contains('fake-fs') || isPlayerFs())) {
        autoFsByOrient = false;
        exitNativeFs();
        exitFakeFs(true);
      }
    };
    window.addEventListener('popstate', onFakeFsPop);
    window.__ntvExitFs = () => {
      if (!wrap || (!wrap.classList.contains('fake-fs') && !isPlayerFs())) return false;
      autoFsByOrient = false;
      exitNativeFs();
      exitFakeFs(true);
      return true;
    };
    // Esc: 假全屏时退出(真全屏由浏览器自己处理 Esc)
    const onFsEsc = (e) => {
      if (!alive() || !video.isConnected) {
        document.removeEventListener('keydown', onFsEsc);
        return;
      }
      if (e.key !== 'Escape') return;
      if (wrap && wrap.classList.contains('fake-fs')) {
        autoFsByOrient = false;
        exitFakeFs();
        syncPpBtn();
      }
    };
    document.addEventListener('keydown', onFsEsc);
    const onFsChange = async () => {
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      if (fsEl === video || fsEl === wrap) {
        syncPpBtn();
        refreshPlayerWm();
        return;
      }
      if (!fsEl) {
        const wrapEl = $('#videoWrap');
        if (wrapEl && wrapEl.classList.contains('fake-fs')) {
          // 浏览器原生全屏被退出(如按返回键), 同步清除 fake-fs/fs-rotated 旋转态
          // fromPopstate=true 防止再次 history.back() 误退出播放页
          autoFsByOrient = false;
          exitFakeFs(true);
        } else {
          resetBrightness();
          if (wrapEl) {
            document.body.style.overflow = '';
            document.documentElement.classList.remove('player-fs');
          }
        }
      }
      syncPpBtn();
      refreshPlayerWm();
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    video.addEventListener('webkitbeginfullscreen', () => {
      // iOS 原生全屏已接管: 只记录状态(自定义控制条/手势在原生全屏层之下不适用, 退出点系统"完成")
      iosNativeFs = true;
      syncPpBtn();
      refreshPlayerWm();
    });
    video.addEventListener('webkitendfullscreen', () => {
      const wasIosFs = iosNativeFs;
      iosNativeFs = false;
      if (wasIosFs && wrap && wrap.classList.contains('fake-fs')) {
        // iOS 系统全屏结束(用户点了"完成"): 同步清理全屏状态, 确保回到竖屏页面
        exitFakeFs();
      }
      syncPpBtn();
      refreshPlayerWm();
    });

    // 仅纯手机浏览器横屏自动全屏; APK 内部或电脑端绝不触发自动转屏
    const orientMq = window.matchMedia('(orientation: landscape)');
    const onOrientFs = () => {
      if (!alive() || !video.isConnected || !isMobilePlayer) return;
      if (window.AndroidBridge) return; // APK 壳内全屏完全由用户点击控制，避免传感器冲突
      if (orientMq.matches) {
        // 竖屏短剧: 转横屏不自动进入全屏(竖屏全屏本就铺满, 无需跟着传感器切)
        if (!isPlayerFs() && !userExitedFs && !isPortraitVideo()) {
          autoFsByOrient = true;
          enterFakeFs();
        }
      } else {
        userExitedFs = false;
        // iOS 修复: 全屏中物理转回竖屏时无条件退出全屏, 解决"返回不了竖屏页面"
        // 竖屏短剧例外: 竖屏全屏本身就是竖屏, 物理转向不应踢出全屏
        if ((autoFsByOrient || isIosDevice) && wrap.classList.contains('fake-fs') && !isPortraitVideo()) {
          autoFsByOrient = false;
          exitFakeFs();
        }
      }
      syncPpBtn();
    };
    if (isMobilePlayer && !window.AndroidBridge) {
      if (orientMq.addEventListener) orientMq.addEventListener('change', onOrientFs);
      else if (orientMq.addListener) orientMq.addListener(onOrientFs);
      window.addEventListener('orientationchange', () => setTimeout(onOrientFs, 150));
    }

    // 收藏(与详情页同一份本地收藏夹)
    $('#playFav').addEventListener('click', () => {
      const list = store.get('favs', []);
      const idx = list.findIndex((f) => f.key === key && f.id === String(vod.vod_id));
      if (idx >= 0) { list.splice(idx, 1); toast('已取消收藏'); }
      else {
        list.unshift({ key, id: String(vod.vod_id), title: vod.vod_name, pic: vod.vod_pic, remarks: vod.vod_remarks });
        toast('已加入收藏', 'ok');
      }
      store.set('favs', list.slice(0, 200));
      pushFavsToServer();
      const btn = $('#playFav');
      btn.textContent = idx >= 0 ? '☆ 收藏' : '★ 已收藏';
      btn.classList.toggle('on', idx < 0);
    });

    // ---- 播放器手势引擎: 屏幕任意位置左右滑动快进/快退, 纵向滑动调节音量, 桌面端方向键与滚轮快捷控制 ----
    {
      const hud = $('#gestHud');
      let hudTimer = null;

      const showTextHud = (t, dur = 900) => {
        if (!hud) return;
        hud.textContent = t;
        hud.style.left = '50%';
        hud.style.top = '22%';
        hud.style.transform = 'translate(-50%, -50%)';
        hud.classList.remove('bar');
        hud.classList.add('show');
        clearTimeout(hudTimer);
        hudTimer = setTimeout(() => { if (hud) hud.classList.remove('show'); }, dur);
      };

      const showBarHud = (icon, label, pct) => {
        if (!hud) return;
        const p = Math.max(0, Math.min(100, Math.round(pct)));
        hud.innerHTML = `<div class="gh-ico">${icon}</div><div class="gh-bar"><i style="height:${p}%"></i></div><div class="gh-val">${label} ${p}%</div>`;
        hud.style.left = '50%';
        hud.style.top = '50%';
        hud.style.transform = 'translate(-50%, -50%)';
        hud.classList.add('bar', 'show');
        clearTimeout(hudTimer);
      };

      const hideBarHudSoon = (delay = 800) => {
        clearTimeout(hudTimer);
        hudTimer = setTimeout(() => { if (hud) hud.classList.remove('show'); }, delay);
      };

      // ---- 触屏手势引擎: 屏幕左右滑动快进/快退, 左半区上下滑调节亮度, 右半区上下滑调节音量, 全屏无死角支持 ----
      if (wrap) {
        let touchStartX = 0, touchStartY = 0;
        let touchStartTime = 0, touchStartVol = 1, touchStartBright = 1;
        let touchMode = ''; // '' | 'seek' | 'vol' | 'bright'
        let seekTarget = -1;
        let lastTapAt = 0, singleTapTimer = null, tapHadCtrl = false;

        wrap.addEventListener('touchstart', (e) => {
          if (e.target.closest('.fs-top-bar, .m-ctrl, .failover-box, a, button, input, select')) return;
          if (!e.touches || e.touches.length !== 1) return;
          const t = e.touches[0];
          touchStartX = t.clientX;
          touchStartY = t.clientY;
          touchStartTime = video.currentTime || 0;
          touchStartVol = getSavedVol();
          touchStartBright = curBrightness;
          touchMode = '';
          seekTarget = -1;
          // 只记录按下瞬间控制条是否已显示, 不在这里显示(否则轻触会被误判为"点掉已显示的控制条"导致闪现)
          tapHadCtrl = !!(mCtrl && mCtrl.classList.contains('show'));
        }, { passive: true });

        wrap.addEventListener('touchmove', (e) => {
          if (e.target.closest('.fs-top-bar, .m-ctrl, .failover-box, a, button, input, select')) return;
          if (!e.touches || e.touches.length !== 1) return;
          const t = e.touches[0];
          const isRotated = wrap.classList.contains('fs-rotated');

          // 计算相对于用户可视方向的位移
          let dx = 0, dyUp = 0;
          if (isRotated) {
            // 手机竖屏锁屏强制旋转 90 度时：
            // 横向位移(快进/快退)对应手机屏幕纵向移动 (从上往下为快进 +)
            dx = t.clientY - touchStartY;
            // 纵向位移(音量/亮度增加)对应手机屏幕横向从左往右移动 (+)
            dyUp = t.clientX - touchStartX;
          } else {
            dx = t.clientX - touchStartX;
            dyUp = touchStartY - t.clientY;
          }

          if (!touchMode) {
            if (Math.hypot(dx, dyUp) < 8) return; // 初始位移防抖
            // 横向滑动为主 -> 进入快进/快退
            if (Math.abs(dx) >= Math.abs(dyUp)) {
              touchMode = 'seek';
            } else {
              // 纵向滑动为主 -> 判断左半屏(亮度)还是右半屏(音量)
              let isLeft = false;
              if (isRotated) {
                // 旋转模式下，手机上半屏幕对应画面左半区
                isLeft = touchStartY < (window.innerHeight / 2);
              } else {
                const rect = wrap.getBoundingClientRect();
                isLeft = (touchStartX - rect.left) < (rect.width / 2);
              }
              touchMode = isLeft ? 'bright' : 'vol';
            }
          }

          if (touchMode === 'seek') {
            e.preventDefault();
            bumpMCtrl();
            const w = isRotated ? (window.innerHeight || 320) : (wrap.clientWidth || 320);
            const span = video.duration ? Math.min(300, Math.max(90, video.duration * 0.12)) : 90;
            const delta = Math.round((dx / w) * span);
            seekTarget = Math.min((video.duration || 0) > 0 ? video.duration - 0.5 : 0, Math.max(0, touchStartTime + delta));
            const diff = Math.round(seekTarget - touchStartTime);
            const sign = diff >= 0 ? '+' : '';
            const ico = diff >= 0 ? '⏩ 快进' : '⏪ 快退';
            const curStr = fmtClock(seekTarget);
            const durStr = fmtClock(video.duration || 0);
            showTextHud(`${ico} ${curStr} / ${durStr} (${sign}${diff}s)`, 1500);

            if (mSeek && video.duration) {
              mSeek.value = String(Math.round((seekTarget / video.duration) * 1000));
            }
            if (mTimeCur) mTimeCur.textContent = curStr;
          } else if (touchMode === 'vol') {
            e.preventDefault();
            bumpMCtrl();
            const h = isRotated ? (window.innerWidth || 240) : Math.max(140, (wrap.clientHeight || 240) * 0.7);
            const nv = Math.min(1, Math.max(0, touchStartVol + dyUp / h));
            try { video.volume = nv; video.muted = nv <= 0; } catch (err) {}
            const nvb = nativeVol();
            if (nvb) { try { nvb.setVolume(nv); } catch (err) {} }
            store.set('vidVol', Number(nv.toFixed(2)));
            showBarHud(nv <= 0 ? '🔇' : '🔊', '音量', nv * 100);
          } else if (touchMode === 'bright') {
            e.preventDefault();
            bumpMCtrl();
            const h = isRotated ? (window.innerWidth || 240) : Math.max(140, (wrap.clientHeight || 240) * 0.7);
            const nb = Math.min(1.8, Math.max(0.2, touchStartBright + (dyUp / h) * 1.2));
            setBrightness(nb);
            const pct = Math.round(((nb - 0.2) / 1.6) * 100);
            showBarHud('☀️', '亮度', Math.max(5, Math.min(100, pct)));
          }
        }, { passive: false });

        wrap.addEventListener('touchend', (e) => {
          if (e.target.closest('.fs-top-bar, .m-ctrl, .failover-box, a, button, input, select')) return;
          if (touchMode === 'seek') {
            if (seekTarget >= 0 && video.duration) {
              if (isAdultTrial && !isAdultUnlocked && seekTarget >= maxAdultTrialSec) {
                seekTarget = maxAdultTrialSec;
                try { video.currentTime = maxAdultTrialSec; } catch (err) {}
                video.pause();
                showAdultTrialNotice();
              } else {
                try { video.currentTime = seekTarget; } catch (err) {}
                showTextHud(`⏱ 已跳到 ${fmtClock(video.currentTime)}`, 800);
              }
            }
            touchMode = '';
            seekTarget = -1;
            bumpMCtrl();
            return;
          }
          if (touchMode === 'vol' || touchMode === 'bright') {
            hideBarHudSoon();
            touchMode = '';
            bumpMCtrl();
            return;
          }

          // 未滑动的轻触 -> 处理单击控制条与双击播放/暂停
          const now = Date.now();
          const dt = now - lastTapAt;
          if (dt < 280) {
            clearTimeout(singleTapTimer);
            lastTapAt = 0;
            togglePlay();
            showTextHud(video.paused ? '⏸ 已暂停' : '▶ 播放中', 700);
          } else {
            lastTapAt = now;
            singleTapTimer = setTimeout(() => {
              // 点一下: 控制条+顶部退出栏显示约2.6秒; 显示中再点一下: 立即收回纯净全屏
              if (tapHadCtrl && mCtrl && mCtrl.classList.contains('show')) {
                hideMCtrlNow();
              } else {
                bumpMCtrl(2600);
              }
            }, 280);
          }
        });

        wrap.addEventListener('touchcancel', () => {
          if (touchMode === 'vol' || touchMode === 'bright') hideBarHudSoon();
          touchMode = '';
          seekTarget = -1;
          bumpMCtrl();
        });
      }

      // ---- 电脑端优化: 键盘左右方向键快进/快退 + 空格播放/暂停 + 双击全屏 (使用捕获阶段防浏览器原生事件抢占/反转) ----
      const onPlayerKeyDown = (e) => {
        if (!alive() || !video.isConnected) {
          window.removeEventListener('keydown', onPlayerKeyDown, true);
          return;
        }
        if (document.body.classList.contains('tv')) return;
        const target = e.target;
        if (target && target.tagName && /^(INPUT|TEXTAREA|SELECT)$/i.test(target.tagName)) return;

        if (e.key === ' ' || e.code === 'Space') {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          togglePlay();
          showTextHud(video.paused ? '⏸ 已暂停' : '▶ 播放中', 700);
          return;
        }

        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          if (!video.duration) return;
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          const step = e.key === 'ArrowRight' ? 10 : -10;
          const targetTime = Math.min(video.duration - 0.5, Math.max(0, (video.currentTime || 0) + step));
          try { video.currentTime = targetTime; } catch (err) {}
          const ico = step > 0 ? '⏩ 快进 10s' : '⏪ 快退 10s';
          showTextHud(`${ico} (${fmtClock(video.currentTime)} / ${fmtClock(video.duration)})`, 800);
          syncMSeek();
          bumpMCtrl();
          return;
        }

        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          const step = e.key === 'ArrowUp' ? 0.08 : -0.08;
          let nv = Math.min(1, Math.max(0, getSavedVol() + step));
          nv = Number(nv.toFixed(2));
          try { video.volume = nv; video.muted = nv <= 0; } catch (err) {}
          store.set('vidVol', nv);
          showBarHud(nv <= 0 ? '🔇' : '🔊', '音量', nv * 100);
          hideBarHudSoon(900);
          return;
        }

        if (e.key === 'f' || e.key === 'F') {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          togglePlayerFs();
          return;
        }
      };
      window.addEventListener('keydown', onPlayerKeyDown, true);
      video.addEventListener('keydown', (e) => {
        if (document.body.classList.contains('tv')) return;
        if (e.key === ' ' || e.code === 'Space' || (e.key && e.key.startsWith('Arrow'))) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
        }
      }, true);

      // 桌面双击全屏
      if (wrap && !isMobilePlayer) {
        wrap.addEventListener('dblclick', (e) => {
          if (e.target.closest('.m-ctrl, button, a, input, select')) return;
          e.preventDefault();
          e.stopPropagation();
          togglePlayerFs();
        }, true);
      }
    }

    // ⚡ 快速换源: 并发探测全部其他源
    // 桌面端: 可用源以药丸排列(一行5个)直接点击; 手机端: 按钮打开弹窗选择(一行3个)
    // 无此片/超时的源: 桌面不显示, 手机弹窗内灰显列出
    (function startSwapSearch() {
      const others = visibleSources().filter((s) => s.key !== key);
      const statEl = $('#swapStat');
      const openBtn = $('#openSwapBtn');
      const swapOk = $('#srcSwitch');
      const swapMiss = $('#swapMiss');
      const missToggle = $('#swapMissToggle');
      const hits = [];   // {s, ms, spdCls, id}
      const misses = []; // {s, ms, spdCls, why}
      let pending = others.length;
      swapPending = pending;
      const norm = (s2) => String(s2 || '').replace(/\s/g, '');
      // 桌面端失效源收缩区(与可用源同款 5 列排列); 手机端由 CSS 隐藏
      const updMissToggle = () => {
        if (!missToggle) return;
        const collapsed = swapMiss.classList.contains('hidden');
        missToggle.textContent = `${collapsed ? '▶' : '▼'} 无此片/已失效的源 ${misses.length} 个（点击${collapsed ? '展开' : '收起'}）`;
        missToggle.classList.toggle('hidden', misses.length === 0);
      };
      if (missToggle) {
        missToggle.addEventListener('click', () => {
          swapMiss.classList.toggle('hidden');
          updMissToggle();
        });
      }
      const updStat = () => {
        if (!alive() || !statEl) return;
        if (pending > 0) {
          statEl.innerHTML = `<span class="spin"></span> 探测中 ${others.length - pending}/${others.length} · 可换源 <b style="color:var(--acc)">${hits.length}</b> 个 · 无此片/失效 ${misses.length} 个`;
        } else if (hits.length > 0) {
          statEl.textContent = `✅ 探测完成 · ${hits.length} 个源有本片，点击即换且集数自动同步`;
        } else {
          statEl.textContent = '❌ 其他源都没有本片或已失效';
        }
        if (openBtn) {
          openBtn.disabled = pending > 0 || hits.length === 0;
          openBtn.textContent = pending > 0
            ? `🔍 探测中…（${hits.length} 可用）`
            : hits.length > 0 ? `🔍 选择播放源（${hits.length} 个可用）` : '暂无可用播放源';
        }
      };
      updStat();

      function openSwapModal() {
        const box = document.createElement('div');
        box.className = 'modal-mask';
        const row = (h) => `<a class="src-item" href="#/play/${esc(h.s.key)}/${encodeURIComponent(h.id)}?ep=${ei}&group=${gi}" title="${esc(h.s.name)} · 延迟${h.ms}ms · 点击切换并同步到第${ei + 1}集">
             ${srcIconHtml(h.s)}<i class="spd ${h.spdCls}">⚡${h.ms}ms</i><span>${esc(h.s.name)}</span><small>切换</small></a>`;
        const missRow = (m) => `<span class="src-item miss" title="${esc(m.s.name)} · ${m.why}">
             ${srcIconHtml(m.s)}${m.ms ? `<i class="spd ${m.spdCls}">⚡${m.ms}ms</i>` : ''}<span>${esc(m.s.name)}</span><small>${esc(m.why)}</small></span>`;
        box.innerHTML = `<div class="modal-box" style="width:min(92vw,540px)">
            <h3 style="margin-bottom:6px">⚡ 选择播放源</h3>
            <p class="hint" style="margin-bottom:12px">当前：${esc(src.name)} · 第 ${ei + 1} 集 · 点击后自动关闭并跳到同一集</p>
            <div class="swap-modal-list">${hits.map(row).join('') || '<p class="hint">没有找到可用播放源</p>'}</div>
            ${misses.length ? `<div style="margin-top:14px"><p class="hint" style="margin-bottom:8px">以下 ${misses.length} 个源无此片或已失效</p><div class="swap-modal-list">${misses.map(missRow).join('')}</div></div>` : ''}
          </div>`;
        // 点击任意可选源: 导航的同时自动关闭弹窗, 必须用 location.replace 避免历史堆叠导致无法返回
        box.addEventListener('click', (ev) => {
          const a = ev.target.closest('a.src-item');
          if (a) {
            ev.preventDefault();
            box.remove();
            location.replace(a.getAttribute('href'));
            return;
          }
          if (ev.target === box) box.remove();
        });
        const closeBtn = document.createElement('button');
        closeBtn.className = 'modal-close';
        closeBtn.textContent = '×';
        closeBtn.addEventListener('click', () => box.remove());
        // 注意: firstChild 可能是空白文本节点, 必须 querySelector 定位 modal-box
        const mbox = box.querySelector('.modal-box');
        if (mbox) mbox.appendChild(closeBtn);
        document.body.appendChild(box);
      }
      if (openBtn) openBtn.addEventListener('click', () => { if (!openBtn.disabled) openSwapModal(); });
      if (swapOk) {
        swapOk.addEventListener('click', (e) => {
          const a = e.target.closest('a.src-item');
          if (a) {
            e.preventDefault();
            location.replace(a.getAttribute('href'));
          }
        });
      }

      others.forEach((s) => {
        (async () => {
          const t0 = performance.now();
          try {
            // 9秒快速超时: 慢源不拖累整体
            const r2 = await API.search(s, vod.vod_name, 1, 9000);
            if (!alive()) return;
            const ms = Math.round(performance.now() - t0);
            const spdCls = ms < 900 ? 'sp-good' : ms < 2600 ? 'sp-mid' : 'sp-bad';
            const hit = (r2.list || []).find((v2) => norm(v2.vod_name) === norm(vod.vod_name));
            pending--;
            swapPending = pending;
            if (hit && hit.vod_id) {
              const hitObj = { s, ms, spdCls, id: hit.vod_id };
              hits.push(hitObj);
              swapHits.push(hitObj);
              if (hasPlaybackFailed && !autoFailoverTimer) {
                handlePlaybackFailure('swap_hit_arrived');
              }
              // 桌面端药丸(手机上该区域 display:none)
              if (swapOk) swapOk.insertAdjacentHTML('beforeend',
                `<a class="src-item" href="#/play/${esc(s.key)}/${encodeURIComponent(hit.vod_id)}?ep=${ei}&group=${gi}" title="${esc(s.name)} · 延迟${ms}ms · 点击切换并同步到第${ei + 1}集">
                   ${srcIconHtml(s)}<i class="spd ${spdCls}">⚡${ms}ms</i><span>${esc(s.name)}</span></a>`);
            } else {
              misses.push({ s, ms, spdCls, why: '无此片' });
              // 桌面端: 收进下方可展开区(同款排列); 手机端该区域 display:none
              if (swapMiss) swapMiss.insertAdjacentHTML('beforeend',
                `<span class="src-item miss" title="${esc(s.name)} · 响应${ms}ms但无本片">
                   ${srcIconHtml(s)}<i class="spd ${spdCls}">⚡${ms}ms</i><span>${esc(s.name)}</span><small>无此片</small></span>`);
              updMissToggle();
            }
          } catch (e) {
            if (!alive()) return;
            pending--;
            swapPending = pending;
            misses.push({ s, ms: 0, spdCls: '', why: '超时/失效' });
            if (swapMiss) swapMiss.insertAdjacentHTML('beforeend',
              `<span class="src-item miss" title="${esc(s.name)} · 请求超时或源已失效">
                 ${srcIconHtml(s)}<span>${esc(s.name)}</span><small class="fail">超时/失效</small></span>`);
            updMissToggle();
          }
          updStat();
          if (pending === 0 && hasPlaybackFailed && swapHits.length === 0) {
            handlePlaybackFailure('all_swap_finished');
          }
        })();
      });
    })();

    // 相关推荐(渐进式加载)
    loadRelated(vod, key, alive);

    renderSideEps();
    playCurrent(true);
  }

  /* ---- 播放页相关推荐: 优先当前播放源, 多关键词搜索, 边搜边显示, 不足28部逐级补足 ---- */
  const REL_COUNT = 28;
  function buildRelKeywords(vod) {
    const raw = String(vod.vod_name || '').trim();
    if (!raw) return [];
    const t1 = raw.replace(/[【\[（(].*?[】\]）)]/g, '').replace(/\d{4}$/, '').trim();
    const t2 = t1.replace(/第.{1,7}[季部].*$/, '').replace(/[：:].*$/, '').trim(); // 去季数/副标题
    const t3 = t1.length > 4 ? t1.slice(0, Math.ceil(t1.length / 2)) : '';          // 前半词根兜底
    return [...new Set([t1, t2, t3].map((k) => k.trim()).filter((k) => k && k.length >= 2))];
  }
  async function loadRelated(vod, curKey, alive) {
    const sec = document.getElementById('relSec');
    if (!sec || !alive()) return;
    sec.innerHTML = `
      <div class="row-head"><div class="row-title">相关推荐</div>
        <div class="rel-status" style="color:var(--dim);font-size:12.5px">⏳ 正在寻找相关影片…</div></div>
      <div class="grid rel-grid" id="relGrid">${skeletons(14)}</div>`;

    const setStatus = (text) => {
      if (alive()) { const el = $('.rel-status', sec); el && (el.textContent = text); }
    };
    const gridEl = () => document.getElementById('relGrid');

    const kws = buildRelKeywords(vod);
    const curSrc = findSourceByKey(curKey) || null;
    const others = visibleSources().filter((s) => s.key !== curKey);
    for (let i = others.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [others[i], others[j]] = [others[j], others[i]];
    }

    const seenR = new Set([String(vod.vod_name || '').replace(/\s/g, '')]);
    let relItems = [];
    let renderTimer = null;
    // 右侧竖排小卡(播放器旁)
    let railExtra = []; // 阶段D兜底: 当前源其他影片(非关键词命中)
    const railCardHtml = (it) => `
      <a class="rcard" href="#/play/${esc(it.sourceKey)}/${encodeURIComponent(it.id)}?ep=0&group=0" title="${esc(it.title)}">
        <div class="rcard-pic"><img loading="lazy" referrerpolicy="no-referrer" src="${esc(it.pic)}" alt="" onerror="this.style.visibility='hidden'"><span class="card-badge">${esc(it.remarks || '')}</span></div>
        <div class="rcard-name">${esc(it.title)}${it.sameSrc ? ' <i class="rail-tag">同源</i>' : ''}</div>
      </a>`;
    const renderRail = () => {
      if (!alive()) return;
      const r = $('#relRailList');
      if (r) r.innerHTML = relItems.concat(railExtra).slice(0, 12).map(railCardHtml).join('') || '<p class="hint" style="font-size:12.5px">暂无同类推荐</p>';
    };
    const renderGrid = () => {
      if (!alive()) return;
      const g = gridEl();
      if (g) g.innerHTML = relItems.slice(0, REL_COUNT).map(cardHtml).join('');
      renderRail();
    };
    const scheduleRender = () => {
      if (renderTimer) return;
      renderTimer = setTimeout(() => { renderTimer = null; renderGrid(); }, 150);
    };
    const absorb = (s, r) => {
      for (const v2 of (r.list || [])) {
        if (relItems.length >= REL_COUNT) break;
        const t = String(v2.vod_name || '').trim();
        if (!t || !v2.vod_pic) continue;
        const kk = t.replace(/\s/g, '') + '|' + (v2.vod_year || '');
        if (seenR.has(kk)) continue;
        seenR.add(kk);
        relItems.push({
          sourceKey: s.key, sourceName: s.name, id: v2.vod_id, title: t,
          pic: v2.vod_pic, remarks: v2.vod_remarks, year: v2.vod_year, typeName: v2.type_name,
        });
      }
      scheduleRender();
    };

    try {
      /* 阶段A: 当前播放源 · 多关键词并行搜索 */
      if (curSrc) {
        let doneKw = 0;
        for (const kw of kws.slice(0, 3)) {
          if (relItems.length >= REL_COUNT || !alive()) break;
          doneKw++;
          setStatus(`⏳ 正在「${cleanSrcName(curSrc)}」中搜索「${kw}」…`);
          try { absorb(curSrc, await API.search(curSrc, kw)); } catch (e) { /* ignore */ }
          setStatus(`⏳ 当前源已找到 ${relItems.length} 部（关键词 ${doneKw}/${Math.min(kws.length, 3)}）`);
        }

        /* 阶段B: 当前源同类影片补足(列表前3页按类型过滤) */
        if (relItems.length < REL_COUNT && alive()) {
          const bucket = Object.keys(CAT_REGEX).find((c) => CAT_REGEX[c].test(String(vod.type_name || '')));
          const re = bucket ? CAT_REGEX[bucket] : null;
          for (let pg = 1; pg <= 3 && relItems.length < REL_COUNT; pg++) {
            setStatus(`⏳ 当前源同类补充中… 已找到 ${relItems.length} 部`);
            try { absorb(curSrc, await API.list(curSrc, pg)); } catch (e) { break; }
            // absorb 不区分类别, 手动剔除非同类
            relItems = relItems.filter((it) => !re || re.test(String(it.typeName || '')));
            scheduleRender();
          }
        }
      }

      /* 阶段C: 其他源关键词兜底(保证推荐位不空) */
      if (relItems.length < REL_COUNT && alive()) {
        const kw = kws[0] || String(vod.vod_name || '');
        const batch = others.slice(0, 8);
        let doneCount = 0;
        const idxBox = { i: 0 };
        const worker = async () => {
          while (idxBox.i < batch.length) {
            if (!alive() || relItems.length >= REL_COUNT) return;
            const s = batch[idxBox.i++];
            try { absorb(s, await API.search(s, kw)); } catch (e) { /* 该源失败 */ }
            doneCount++;
            setStatus(`⏳ 其他源补充 ${doneCount}/${batch.length} · 共 ${relItems.length} 部`);
          }
        };
        await Promise.allSettled(Array.from({ length: Math.min(6, batch.length) }, worker));
      }

      /* 阶段D: 右侧栏兜底 —— 关键词没找到相似影片时, 直接推荐当前源的其他影片 */
      if (alive() && relItems.length + railExtra.length < 6 && curSrc) {
        setStatus('⏳ 正在补充本源其他影片…');
        const curId = String(vod.vod_id || '');
        for (let pg = 1; pg <= 2 && railExtra.length < 12 && alive(); pg++) {
          try {
            const r = await API.list(curSrc, pg);
            for (const v2 of (r.list || [])) {
              if (railExtra.length >= 12) break;
              if (String(v2.vod_id) === curId) continue; // 排除正在看的这部
              const t = String(v2.vod_name || '').trim();
              if (!t || !v2.vod_pic) continue;
              const kk = t.replace(/\s/g, '') + '|' + (v2.vod_year || '');
              if (seenR.has(kk)) continue;
              seenR.add(kk);
              railExtra.push({
                sourceKey: curSrc.key, sourceName: curSrc.name, id: v2.vod_id, title: t,
                pic: v2.vod_pic, remarks: v2.vod_remarks, year: v2.vod_year, typeName: v2.type_name,
                sameSrc: true,
              });
            }
          } catch (e) { break; }
          renderRail();
        }
      }

      if (!alive()) return;
      if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
      renderRail();
      relItems = relItems.slice(0, REL_COUNT);
      if (!relItems.length) { sec.innerHTML = ''; return; }
      sec.innerHTML = `
        <div class="row-head"><div class="row-title">相关推荐</div>
          <div style="color:var(--dim);font-size:12.5px">${relItems.length} 部相关影片</div></div>
        <div class="grid rel-grid">${relItems.map(cardHtml).join('')}</div>`;
    } catch (e) { /* 相关推荐失败不影响播放 */ }
  }

  /* ============================================================
     视图：手机扫码同步电视搜索遥控器 (#/tv-remote?sid=XXXX)
     ============================================================ */
  async function viewTvRemote(sid, alive) {
    const v = $('#view');
    const cleanSid = String(sid || '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
    const hotWords = ['九门', '老九门', '庆余年第二季', '凡人修仙传', '仙逆', '完美世界', '唐朝诡事录之西行', '白夜破晓', '墨雨云间', '剑来', '斗破苍穹', '狂飙'];
    v.innerHTML = `
      <div class="container auth-wrap" style="max-width:520px;padding-top:20px">
        <div class="admin-card" style="padding:22px 20px;border-radius:18px">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
            <div style="width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,#0ea5e9,#2563eb);display:flex;align-items:center;justify-content:center;font-size:22px;color:#fff;flex-shrink:0">📺</div>
            <div>
              <h3 style="margin:0;font-size:18px">电视搜索手机同步输入</h3>
              <p class="hint" style="margin:3px 0 0;font-size:12.5px">
                ${cleanSid ? `🟢 已配对电视房间号：<b>#${esc(cleanSid.slice(-6).toUpperCase())}</b>` : '⚠️ 未检测到电视配对码，请重新用手机扫描电视搜索页二维码'}
              </p>
            </div>
          </div>
          <div style="display:flex;gap:8px;margin-bottom:10px">
            <input class="field-input" id="tvrInput" placeholder="输入片名或拼音首字母（如：九门 / JM）" autocomplete="off" style="flex:1;font-size:16px;padding:12px 14px">
            <button class="btn primary" id="tvrSendBtn" style="padding:0 18px;font-weight:700;white-space:nowrap">🚀 推送到电视</button>
          </div>
          <div id="tvrStatus" style="font-size:13px;color:var(--ok);min-height:20px;margin-bottom:8px"></div>
          <div id="tvrSuggestBox" style="margin-bottom:14px"></div>
          <div style="border-top:1px solid var(--border);padding-top:12px">
            <div style="font-size:13px;font-weight:700;color:var(--dim);margin-bottom:8px">🔥 热门影片点一下直接推送到电视：</div>
            <div class="chips" id="tvrHotChips" style="flex-wrap:wrap;gap:8px">
              ${hotWords.map((w) => `<button type="button" class="chip" data-w="${esc(w)}">${esc(w)}</button>`).join('')}
            </div>
          </div>
        </div>
      </div>`;

    const inp = $('#tvrInput', v);
    const btn = $('#tvrSendBtn', v);
    const st = $('#tvrStatus', v);
    const sugBox = $('#tvrSuggestBox', v);

    async function pushToTv(word) {
      const q = String(word || inp.value || '').trim();
      if (!q) return toast('请输入要搜索的影片名称或拼音首字母', 'err');
      if (!cleanSid) return toast('未绑定电视房间号，请重新扫描电视上的二维码', 'err');
      inp.value = q;
      btn.disabled = true;
      btn.textContent = '推送中…';
      try {
        await API.tvSyncPush(cleanSid, q);
        if (st) st.innerHTML = `✅ 已同步推送「<b>${esc(q)}</b>」到电视大屏！电视端正在自动为您搜索…`;
        toast('已推送至电视：' + q, 'ok');
      } catch (e) {
        if (st) st.innerHTML = `<span style="color:var(--danger)">❌ 推送失败：${esc(e.message || '网络异常')}</span>`;
        toast(e.message || '推送失败', 'err');
      } finally {
        btn.disabled = false;
        btn.textContent = '🚀 推送到电视';
      }
    }

    let sugTimer = null;
    inp && inp.addEventListener('input', () => {
      clearTimeout(sugTimer);
      const val = inp.value.trim();
      if (!val) { if (sugBox) sugBox.innerHTML = ''; return; }
      sugTimer = setTimeout(async () => {
        if (!alive()) return;
        try {
          const r = await API.pySuggest(val);
          if (!alive() || !sugBox) return;
          const list = (r && r.list) || [];
          if (!list.length) { sugBox.innerHTML = ''; return; }
          sugBox.innerHTML = `
            <div style="font-size:12px;color:var(--dim);margin-bottom:6px">💡 猜你想搜（点击直接推送到电视）：</div>
            <div class="chips" style="flex-wrap:wrap;gap:6px">
              ${list.slice(0, 8).map((it) => `<button type="button" class="chip on" data-w="${esc(it.title)}">${esc(it.title)}</button>`).join('')}
            </div>`;
          $$('button[data-w]', sugBox).forEach((b) => b.addEventListener('click', () => pushToTv(b.dataset.w)));
        } catch (e) {}
      }, 160);
    });

    btn && btn.addEventListener('click', () => pushToTv());
    inp && inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') pushToTv(); });
    $$('#tvrHotChips button[data-w]', v).forEach((b) => b.addEventListener('click', () => pushToTv(b.dataset.w)));
    setTimeout(() => { try { inp && inp.focus(); } catch (e) {} }, 100);
  }

  /* ============================================================
     视图：登录 / 注册
     ============================================================ */
  async function viewLogin(alive, forced) {
    const v = $('#view');
    const allowReg = !State.settings || State.settings.allowRegister !== false;
    let mode = 'login';
    const render = () => {
      v.innerHTML = `
        <div class="container auth-wrap">
          <div class="login-box admin-card">
            <div class="login-logo">
              <img src="./icons/icon-192.png" alt="晓林影视">
            </div>
            <h3 style="text-align:center;margin-bottom:6px">${forced ? '登录后继续观看' : '欢迎回来'}</h3>
            ${forced ? '<p class="hint" style="text-align:center;margin-bottom:10px">本站已开启登录观看，请先登录或注册账号</p>' : ''}
            <div class="chips" style="justify-content:center;margin-bottom:14px">
              <button class="chip ${mode === 'login' ? 'on' : ''}" data-m="login">登 录</button>
              ${allowReg ? `<button class="chip ${mode === 'reg' ? 'on' : ''}" data-m="reg">注 册</button>` : ''}
            </div>
            <input class="field-input" id="authUser" placeholder="用户名（2-20位中文/字母/数字）" autocomplete="username">
            <input class="field-input" id="authPwd" type="password" placeholder="密码（至少6位）" style="margin-top:10px" autocomplete="current-password">
            ${mode === 'reg' ? '<input class="field-input" id="authPwd2" type="password" placeholder="确认密码" style="margin-top:10px">' : ''}
            <button class="btn primary" id="authBtn" style="width:100%;justify-content:center;margin-top:16px">${mode === 'login' ? '登 录' : '注册并登录'}</button>
          </div>
        </div>`;
      $$('.chips .chip', v).forEach((c) => c.addEventListener('click', () => { mode = c.dataset.m; render(); }));
      $('#authBtn').addEventListener('click', doAuth);
      $('#authPwd').addEventListener('keydown', (e) => e.key === 'Enter' && doAuth());
      // 电视/盒子: 系统输入法弹不出, 挂虚拟键盘
      if (isTvDevice()) { ['#authUser', '#authPwd', '#authPwd2'].forEach((sel) => { const i = $(sel, v); i && VKB.attach(i); }); }
    };
    async function doAuth() {
      const username = ($('#authUser') ? $('#authUser').value : '').trim();
      const pwd = $('#authPwd') ? $('#authPwd').value : '';
      if (!USERNAME_OK(username)) return toast('用户名需 2-20 位中文/字母/数字/下划线', 'err');
      if (pwd.length < 6) return toast('密码至少 6 位', 'err');
      const btn = $('#authBtn');
      if (btn && btn.disabled) return;
      const origTxt = btn ? btn.textContent : '登 录';
      if (btn) {
        btn.disabled = true;
        btn.textContent = mode === 'login' ? '⏳ 正在登录…' : '⏳ 正在注册并登录…';
      }
      try {
        let authRes = null;
        if (mode === 'login') authRes = await API.userLogin(username, pwd);
        else {
          if (pwd !== ($('#authPwd2') ? $('#authPwd2').value : '')) {
            if (btn) { btn.disabled = false; btn.textContent = origTxt; }
            return toast('两次输入的密码不一致', 'err');
          }
          authRes = await API.userRegister(username, pwd);
        }
        // 关闭 TV 虚拟键盘（若已弹出）
        try { VKB.hide(); } catch (e) {}

        // 0ms 瞬时更新用户状态并立即跳转页面，绝不卡在登录输入框页面
        State.me = username;
        store.set('cached_me', username);
        if (authRes && authRes.me) {
          State.meCreated = Number(authRes.me.createdAt || Date.now());
          State.adultAllowed = Boolean(authRes.me.adultAllowed);
          State.adultExpireAt = Number(authRes.me.adultExpireAt || 0);
          State.unreadMsgCount = Number(authRes.me.unreadMsgCount || 0);
        }
        updateUserBox();
        renderBottomNav();
        toast((mode === 'login' ? '欢迎回来，' : '注册成功，') + username, 'ok');

        let target = store.get('afterLogin', '') || '#/home';
        if (target === '#/login') target = '#/home';
        store.set('afterLogin', '');
        if ((location.hash || '') === target) route();
        else location.hash = target;

        // 后台静默同步收藏、用户详情与源配置，零阻塞跳转
        setTimeout(() => {
          pullFavsMerge();
          API.userMe().then((mm) => {
            if (mm && mm.me) {
              State.meCreated = Number(mm.me.createdAt || State.meCreated || 0);
              State.adultAllowed = Boolean(mm.me.adultAllowed);
              State.adultExpireAt = Number(mm.me.adultExpireAt || 0);
              State.unreadMsgCount = Number(mm.me.unreadMsgCount || 0);
              updateUserBox();
              renderBottomNav();
            }
          }).catch(() => {});
          API.getConfig().then((cfg) => {
            if (cfg) { State.config = cfg; store.set('cached_config', cfg); }
          }).catch(() => {});
        }, 20);
      } catch (e) {
        if (btn) { btn.disabled = false; btn.textContent = origTxt; }
        toast(e.message || '操作失败', 'err');
      }
    }
    render();
    if (!alive()) return;
  }
  function USERNAME_OK(u) { return /^[\w\u4e00-\u9fa5]{2,20}$/.test(u); }

  /* ---------------- 游客试看到期 → 弹出注册/登录框(不强制跳页) ---------------- */
  let trialModalShown = false;
  async function initGuest() {
    try {
      const r = await API.guestStatus();
      State.guest = { required: r.required !== false, ok: !!r.ok, remain: r.remainSec, totalMin: r.trialMinutes || 0 };
      if (State.guest.required && !r.ok && !State.me) showTrialModal(true);
    } catch (e) { /* 网络/离线时默认放行 */ }
  }
  function showTrialModal(force = false) {
    if (State.me || trialModalShown) return;
    trialModalShown = true;
    let mode = 'reg';
    const box = document.createElement('div');
    box.className = 'modal-mask trial-mask';
    box.innerHTML = `
      <div class="modal-box trial-box">
        <button type="button" class="modal-close t-close" aria-label="关闭">×</button>
        <div class="trial-hero">
          <div class="t-ico">🎬</div>
          <h3 class="t-title">游客免费试看已结束</h3>
          <p class="t-sub">${State.guest && State.guest.totalMin ? `已免费体验 ${State.guest.totalMin} 分钟` : '免费试看已结束'} · 注册账号可继续观看全部高清影片</p>
        </div>
        <div class="trial-tabs">
          <button type="button" class="t-tab on" data-m="reg">立即免费注册</button>
          <button type="button" class="t-tab" data-m="login">已有账号登录</button>
        </div>
        <div class="trial-form">
          <input class="field-input t-user" placeholder="用户名(2-20位)" autocomplete="username">
          <input class="field-input t-pwd" type="password" placeholder="密码(至少6位)" autocomplete="current-password">
          <input class="field-input t-pwd2" type="password" placeholder="确认密码" autocomplete="new-password">
          <button type="button" class="btn primary t-go">免费注册并继续播放</button>
          <p class="hint t-hint">注册完全免费 · 收藏与播放记录自动云同步</p>
        </div>
      </div>`;
    const close = () => { box.remove(); trialModalShown = false; };
    box.addEventListener('click', (ev) => { if (ev.target === box && !force) close(); });
    $('.t-close', box).addEventListener('click', close);
    const syncMode = () => {
      $$('.t-tab', box).forEach((b) => b.classList.toggle('on', b.dataset.m === mode));
      $('.t-pwd2', box).classList.toggle('hidden', mode === 'login');
      $('.t-go', box).textContent = mode === 'reg' ? '免费注册并继续播放' : '登 录 并继续播放';
      $('.t-title', box).textContent = mode === 'reg' ? '游客免费试看已结束' : '欢迎登录晓林影视';
    };
    $$('.t-tab', box).forEach((b) => b.addEventListener('click', () => { mode = b.dataset.m; syncMode(); }));
    const submit = async () => {
      const username = $('.t-user', box).value.trim();
      const pwd = $('.t-pwd', box).value;
      if (!USERNAME_OK(username)) return toast('用户名需 2-20 位中文/字母/数字/下划线', 'err');
      if (pwd.length < 6) return toast('密码至少 6 位', 'err');
      try {
        if (mode === 'reg') {
          if (pwd !== $('.t-pwd2', box).value) return toast('两次输入的密码不一致', 'err');
          await API.userRegister(username, pwd);
        } else {
          await API.userLogin(username, pwd);
        }
        State.me = username;
        store.set('cached_me', username);
        updateUserBox();
        renderBottomNav();
        toast((mode === 'reg' ? '注册成功，' : '欢迎回来，') + username + '，继续观影吧', 'ok');
        close();
        setTimeout(() => {
          pullFavsMerge();
          API.userMe().then((mm) => {
            if (mm && mm.me) {
              State.meCreated = Number(mm.me.createdAt || 0);
              State.adultAllowed = Boolean(mm.me.adultAllowed);
              State.adultExpireAt = Number(mm.me.adultExpireAt || 0);
              State.unreadMsgCount = Number(mm.me.unreadMsgCount || 0);
              updateUserBox();
              renderBottomNav();
            }
          }).catch(() => {});
          API.getConfig().then((cfg) => { if (cfg) State.config = cfg; }).catch(() => {});
        }, 20);
      } catch (e) { toast(e.message || '操作失败', 'err'); }
    };
    $('.t-go', box).addEventListener('click', submit);
    $('.t-pwd2', box).addEventListener('keydown', (e) => e.key === 'Enter' && submit());
    setTimeout(() => { const i = $('.t-user', box); i && i.focus(); }, 80);
  }

  /* ---------------- 私密福利专区：游客试看到期 → 专属注册/登录/卡密弹窗 ---------------- */
  let adultTrialModalShown = false;
  function showAdultTrialModal(adultTrialMin, onContinue) {
    if (State.me || adultTrialModalShown) return;
    adultTrialModalShown = true;
    let mode = 'reg'; // 'reg' | 'login' | 'card'
    const box = document.createElement('div');
    box.className = 'modal-mask trial-mask adult-trial-mask';
    box.innerHTML = `
      <div class="modal-box trial-box adult-trial-box" style="border:1px solid rgba(225,29,72,.45);box-shadow:0 20px 60px rgba(225,29,72,.25);width:min(92vw,440px)">
        <button type="button" class="modal-close t-close" aria-label="关闭">×</button>
        <div class="trial-hero" style="background:linear-gradient(180deg,rgba(225,29,72,.18),transparent)">
          <div class="t-ico">🔞</div>
          <h3 class="t-title" style="color:#ff4d6d">私密福利 · 免费试看已结束</h3>
          <p class="t-sub">${adultTrialMin ? `已免费体验 ${adultTrialMin} 分钟` : '免费试看已结束'} · 免费注册账号即赠福利特权，畅享完整无删减高清影片</p>
        </div>
        <div class="trial-tabs">
          <button type="button" class="t-tab on" data-m="reg">🎁 免费注册领特权</button>
          <button type="button" class="t-tab" data-m="login">已有账号登录</button>
          <button type="button" class="t-tab" data-m="card">🔑 卡密直接激活</button>
        </div>
        <div class="trial-form">
          <div id="atfRegLogin">
            <input class="field-input t-user" placeholder="用户名(2-20位中文/字母/数字)" autocomplete="username">
            <input class="field-input t-pwd" type="password" placeholder="密码(至少6位)" autocomplete="current-password" style="margin-top:10px">
            <input class="field-input t-pwd2" type="password" placeholder="确认密码" autocomplete="new-password" style="margin-top:10px">
          </div>
          <div id="atfCard" class="hidden">
            <p class="hint" style="margin-bottom:10px;line-height:1.5">若您已有激活卡密或会员激活码，可直接输入兑换开通专属特权。</p>
            <input class="field-input t-cardcode" placeholder="输入私密专区激活码（如：VIP888）">
          </div>
          <button type="button" class="btn primary t-go" style="background:linear-gradient(135deg,#e11d48,#be123c);margin-top:14px;font-weight:700">免费注册并继续播放完整版</button>
          <p class="hint t-hint" style="margin-top:10px">注册完全免费 · 自动赠送私密特权 · 随时跨设备同步</p>
        </div>
      </div>`;

    const close = () => {
      box.remove();
      adultTrialModalShown = false;
    };
    box.addEventListener('click', (ev) => {
      if (ev.target === box) close();
    });
    $('.t-close', box).addEventListener('click', close);

    const syncMode = () => {
      $$('.t-tab', box).forEach((b) => b.classList.toggle('on', b.dataset.m === mode));
      const regLogin = $('#atfRegLogin', box);
      const cardBox = $('#atfCard', box);
      const pwd2 = $('.t-pwd2', box);
      const btn = $('.t-go', box);
      const title = $('.t-title', box);
      const hint = $('.t-hint', box);

      if (mode === 'card') {
        regLogin.classList.add('hidden');
        cardBox.classList.remove('hidden');
        btn.textContent = '立即激活卡密并播放';
        title.textContent = '私密福利 · 卡密特权解锁';
        hint.textContent = '激活成功后将解除所有试看限制，解锁全区高清影视';
      } else {
        cardBox.classList.add('hidden');
        regLogin.classList.remove('hidden');
        pwd2.classList.toggle('hidden', mode === 'login');
        btn.textContent = mode === 'reg' ? '免费注册并继续播放完整版' : '登 录 并继续播放完整版';
        title.textContent = mode === 'reg' ? '私密福利 · 免费试看已结束' : '欢迎登录晓林影视';
        hint.textContent = mode === 'reg' ? '注册完全免费 · 自动赠送私密特权 · 随时跨设备同步' : '登录成功后将自动识别会员特权状态';
      }
    };

    $$('.t-tab', box).forEach((b) => b.addEventListener('click', () => { mode = b.dataset.m; syncMode(); }));

    const submit = async () => {
      try {
        if (mode === 'card') {
          const code = $('.t-cardcode', box).value.trim();
          if (!code) return toast('请输入卡密激活码', 'err');
          if (!State.me) {
            toast('请先注册或登录账号，以便将激活码绑定至您的专属账号', 'warn');
            mode = 'reg';
            syncMode();
            return;
          }
          await API.unlockAdult(code);
          toast('🎉 卡密激活成功！私密福利特权已开通', 'ok');
        } else {
          const username = $('.t-user', box).value.trim();
          const pwd = $('.t-pwd', box).value;
          if (!USERNAME_OK(username)) return toast('用户名需 2-20 位中文/字母/数字/下划线', 'err');
          if (pwd.length < 6) return toast('密码至少 6 位', 'err');
          if (mode === 'reg') {
            if (pwd !== $('.t-pwd2', box).value) return toast('两次输入的密码不一致', 'err');
            await API.userRegister(username, pwd);
          } else {
            await API.userLogin(username, pwd);
          }
          State.me = username;
          try {
            const mm = await API.userMe();
            if (mm && mm.me) {
              State.meCreated = Number(mm.me.createdAt || 0);
              State.adultAllowed = Boolean(mm.me.adultAllowed);
              State.adultExpireAt = Number(mm.me.adultExpireAt || 0);
              State.unreadMsgCount = Number(mm.me.unreadMsgCount || 0);
            }
          } catch (e) {}
        }
        try { State.config = await API.getConfig(); } catch (e) {}
        updateUserBox();
        renderBottomNav();
        pullFavsMerge();
        toast('🎉 登录成功，正在为您继续播放完整影片！', 'ok');
        close();
        if (typeof onContinue === 'function') onContinue();
      } catch (e) {
        toast(e.message || '操作失败', 'err');
      }
    };

    $('.t-go', box).addEventListener('click', submit);
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    });
    document.body.appendChild(box);
    setTimeout(() => {
      const i = $('.t-user:not(.hidden)', box) || $('.t-cardcode', box);
      i && i.focus();
    }, 100);
  }

  /* ------------------------------ 会员中心全量实时刷新 ------------------------------ */
  async function doGlobalUserRefresh(btnEl) {
    if (btnEl) {
      btnEl.disabled = true;
      btnEl.innerHTML = '<span class="spin"></span> 刷新中…';
    }
    LIST_PAGE_CACHE.delete('user');
    try {
      const [cRes, sRes, mRes, hRes] = await Promise.allSettled([
        API.getConfig(),
        API.getSettings(),
        API.userMe(),
        API.userHistory(),
      ]);
      if (cRes.status === 'fulfilled' && cRes.value) State.config = cRes.value;
      if (sRes.status === 'fulfilled' && sRes.value) State.settings = sRes.value;
      if (mRes.status === 'fulfilled' && mRes.value && mRes.value.me) {
        State.me = mRes.value.me.username;
        State.meCreated = Number(mRes.value.me.createdAt || 0);
        State.adultAllowed = Boolean(mRes.value.me.adultAllowed);
        State.adultExpireAt = Number(mRes.value.me.adultExpireAt || 0);
        State.unreadMsgCount = Number(mRes.value.me.unreadMsgCount || 0);
      }
      updateUserBox();
      renderBottomNav();
      toast('会员数据已刷新至最新', 'ok');
    } catch (err) {
      toast('刷新失败，请检查网络连接', 'err');
    } finally {
      const { parts } = parseHash();
      if (parts[0] === 'user') {
        const alive = makeAlive();
        viewUser(alive);
      }
    }
  }

  /* ============================================================
     视图：个人中心(现代流媒体 UI · 观看记录 / 我的收藏 / 搜索历史 / 独立私密福利专区)
     ============================================================ */
  async function viewUser(alive) {
    const life = { ok: alive };
    const v = $('#view');
    if (!State.me) { location.hash = '#/login'; return; }

    // 0ms 瞬时渲染会员中心：优先读取本地缓存历史与收藏，彻底告别 10-30 秒白屏等待！
    const cacheKey = 'cached_uhist:' + State.me;
    let data = store.get(cacheKey, null);
    const favs = store.get('favs', []);
    const watchItems = data && Array.isArray(data.items) ? data.items.filter((it) => it.kind === 'watch') : [];
    const searchItems = data && Array.isArray(data.items) ? data.items.filter((it) => it.kind === 'search') : [];
    const { query } = parseHash();
    let tab = (query && query.tab) ? query.tab : store.get('uTab', 'watch');
    const hasAdult = Boolean(State.config && State.config.adultEnabled);
    const isAdultUnlocked = Boolean((State.config && State.config.adultUnlocked) || State.adultAllowed);

    v.innerHTML = `
      <div class="container page-wrap">
        <!-- 头部个人资料横幅 -->
        <div class="user-hero-card">
          <div class="user-hero-main">
            <div class="user-profile-left">
              <div class="user-avatar-wrap">
                ${esc(String(State.me).slice(0, 1).toUpperCase())}
                ${isAdultUnlocked ? '<span class="user-avatar-crown">👑</span>' : ''}
              </div>
              <div class="user-profile-info">
                <div class="user-profile-title">
                  <span class="user-name-text">${esc(State.me)}</span>
                  ${hasAdult ? `
                    <span class="user-vip-tag ${isAdultUnlocked ? 'unlocked' : 'locked'}">
                      ${isAdultUnlocked ? ('👑 私密福利VIP特权 · 已激活' + (State.adultExpireAt ? ` (至 ${fmtDateTime(State.adultExpireAt).slice(0, 16)})` : '')) : '🔒 注册会员 · 私密福利未解锁'}
                    </span>` : ''}
                </div>
                <div class="user-profile-sub">
                  ${data && data.lastLoginAt ? '最近活跃时间：' + fmtDateTime(data.lastLoginAt) : '欢迎回到晓林影视会员中心'}
                </div>
              </div>
            </div>
            <div class="user-hero-actions">
              ${hasAdult && !isAdultUnlocked ? `
                <button class="btn primary small" id="uHeroUnlockBtn" style="background:linear-gradient(135deg,#e11d48,#be123c);font-weight:700">
                  👑 输入卡密解锁
                </button>` : ''}
              <button class="btn ghost small" id="uRefreshBtn" title="刷新个人数据">⟳ 刷新</button>
              <button class="btn ghost small" id="uLogout">退出登录</button>
            </div>
          </div>
        </div>

        <!-- 四宫格数据统计看板 -->
        <div class="user-kpi-grid">
          <div class="user-kpi-card">
            <div class="user-kpi-ico">⏱</div>
            <div class="user-kpi-content">
              <div class="user-kpi-label">累计观影时长</div>
              <div class="user-kpi-val">${fmtWatchSec(data ? data.watchSec : 0)}</div>
            </div>
          </div>
          <div class="user-kpi-card" style="cursor:pointer" data-jump="watch">
            <div class="user-kpi-ico">🎬</div>
            <div class="user-kpi-content">
              <div class="user-kpi-label">播放历史记录</div>
              <div class="user-kpi-val">${watchItems.length} <small style="font-size:13px;font-weight:400;color:var(--dim)">条</small></div>
            </div>
          </div>
          <div class="user-kpi-card" style="cursor:pointer" data-jump="fav">
            <div class="user-kpi-ico">⭐</div>
            <div class="user-kpi-content">
              <div class="user-kpi-label">我的收藏大片</div>
              <div class="user-kpi-val">${favs.length} <small style="font-size:13px;font-weight:400;color:var(--dim)">部</small></div>
            </div>
          </div>
          ${hasAdult ? `
            <div class="user-kpi-card vip-card ${isAdultUnlocked ? 'unlocked' : 'locked'}" style="cursor:pointer" id="uKpiAdultCard">
              <div class="user-kpi-ico">${isAdultUnlocked ? '👑' : '🔞'}</div>
              <div class="user-kpi-content">
                <div class="user-kpi-label">私密福利专区</div>
                <div class="user-kpi-val" style="color:${isAdultUnlocked ? 'var(--ok)' : 'var(--danger)'}">
                  ${isAdultUnlocked ? (State.adultExpireAt ? `至 ${fmtDateTime(State.adultExpireAt).slice(0, 10)} 有效` : '已解锁 · 点击直达') : '未解锁 · 点击解锁'}
                </div>
              </div>
            </div>` : `
            <div class="user-kpi-card" style="cursor:pointer" data-jump="search">
              <div class="user-kpi-ico">🔍</div>
              <div class="user-kpi-content">
                <div class="user-kpi-label">搜索记录</div>
                <div class="user-kpi-val">${searchItems.length} <small style="font-size:13px;font-weight:400;color:var(--dim)">条</small></div>
              </div>
            </div>`}
        </div>

        <!-- 现代化选项卡导航栏 -->
        <div class="user-tabs-bar" id="uTabs">
          <button class="user-tab-btn ${tab === 'watch' ? 'on' : ''}" data-t="watch">🎬 观看记录 (${watchItems.length})</button>
          <button class="user-tab-btn ${tab === 'fav' ? 'on' : ''}" data-t="fav">⭐ 我的收藏 (${favs.length})</button>
          <button class="user-tab-btn ${tab === 'search' ? 'on' : ''}" data-t="search">🔍 搜索记录 (${searchItems.length})</button>
          ${hasAdult ? `<a class="user-tab-btn tab-adult" href="#/adult" style="text-decoration:none">🔞 私密福利专区 ${isAdultUnlocked ? '👑' : '🔒'}</a>` : ''}
          <a class="user-tab-btn" href="#/messages" style="text-decoration:none">📬 站内消息${State.unreadMsgCount > 0 ? ` (${State.unreadMsgCount})` : ''}</a>
        </div>

        <div id="uBody"></div>
      </div>`;

    const body = $('#uBody');
    if (tab === 'adult') tab = 'watch';

    function renderBody() {
      $$('#uTabs .user-tab-btn').forEach((c) => c.classList.toggle('on', c.dataset.t === tab));
      store.set('uTab', tab);

      if (tab === 'fav') {
        body.innerHTML = favs.length
          ? `<div class="grid">${favs.map((f, i) => `
              <div class="hist-card" style="position:relative">
                ${cardHtml({ sourceKey: f.key, sourceName: '', id: f.id, title: f.title, pic: f.pic, remarks: f.remarks || '' })}
                <button class="hist-del" data-fi="${i}" title="取消收藏" style="position:absolute;top:6px;right:6px;z-index:3;background:rgba(0,0,0,.6);color:#fff;border:none;border-radius:50%;width:26px;height:26px;cursor:pointer;font-size:14px;line-height:1">×</button>
              </div>`).join('')}</div>`
          : '<div class="empty"><div class="big">⭐</div>还没有收藏大片，去首页逛逛吧</div>';
        $$('#uBody .hist-del').forEach((b) => b.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          favs.splice(Number(b.dataset.fi), 1);
          store.set('favs', favs);
          pushFavsToServer();
          renderBody();
          toast('已取消收藏');
        }));
      } else if (tab === 'watch') {
        body.innerHTML = watchItems.length
          ? `<div class="u-clear-row" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
               <span style="font-size:12.5px;color:var(--dim)">共 ${watchItems.length} 条播放记录（删除仅对自己隐藏）</span>
               <button class="btn ghost small" id="clearWatch">🗑 清空观看记录</button>
             </div>
             <div class="grid">${watchItems.map((it) => `
              <div class="hist-card" style="position:relative">
                ${cardHtml({ sourceKey: it.srcKey, sourceName: it.srcName, id: it.vidId, title: it.title, pic: it.pic, remarks: it.ep ? '看到 ' + it.ep : '', year: '', typeName: '' })}
                <button class="hist-del" data-id="${esc(it.id)}" title="删除该条记录" style="position:absolute;top:6px;right:6px;z-index:3;background:rgba(0,0,0,.6);color:#fff;border:none;border-radius:50%;width:26px;height:26px;cursor:pointer;font-size:14px;line-height:1">×</button>
              </div>`).join('')}</div>`
          : '<div class="empty"><div class="big">🎬</div>暂无观看记录，快去开启精彩观影吧</div>';
        bindHistDel();
        $('#clearWatch') && $('#clearWatch').addEventListener('click', async () => {
          if (!confirm('确定清空自己的观看记录？（管理员后台仍保留）')) return;
          await API.userClearHistory('watch');
          watchItems.length = 0;
          renderBody();
          toast('已清空观看记录');
        });
      } else if (tab === 'search') {
        body.innerHTML = searchItems.length
          ? `<div class="u-clear-row" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
               <span style="font-size:12.5px;color:var(--dim)">共 ${searchItems.length} 条搜索历史</span>
               <button class="btn ghost small" id="clearSearch">🗑 清空搜索记录</button>
             </div>
             <div class="search-hist-list">${searchItems.map((it) => `
              <div class="search-hist-row">
                <span class="sh-q">🔍 ${esc(it.title)}</span>
                <time>${fmtDateTime(it.ts)}</time>
                <a class="btn ghost small" href="#/search?q=${encodeURIComponent(it.title)}">再搜一次</a>
                <button class="hist-del row-del" data-id="${esc(it.id)}">×</button>
              </div>`).join('')}</div>`
          : '<div class="empty"><div class="big">🔍</div>暂无搜索历史记录</div>';
        bindHistDel();
        $('#clearSearch') && $('#clearSearch').addEventListener('click', async () => {
          if (!confirm('确定清空自己的搜索记录？（管理员后台仍保留）')) return;
          await API.userClearHistory('search');
          searchItems.splice(0);
          renderBody();
          toast('已清空搜索记录');
        });
      }
    }

    function bindHistDel() {
      $$('#uBody .hist-del[data-id]').forEach((b) => b.addEventListener('click', async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        await API.userDeleteHistory([b.dataset.id]);
        const all = watchItems.concat(searchItems);
        const idx = all.findIndex((x) => x.id === b.dataset.id);
        if (idx >= 0) all[idx].delUser = true;
        const wI = watchItems.findIndex((x) => x.id === b.dataset.id);
        if (wI >= 0) watchItems.splice(wI, 1);
        else { const sI = searchItems.findIndex((x) => x.id === b.dataset.id); if (sI >= 0) searchItems.splice(sI, 1); }
        renderBody();
        toast('已删除');
      }));
    }

    function bindUserHeaderEvents() {
      $$('#uTabs .user-tab-btn[data-t]').forEach((c) => c.addEventListener('click', () => { tab = c.dataset.t; renderBody(); }));
      $$('.user-kpi-card[data-jump]').forEach((c) => c.addEventListener('click', () => { tab = c.dataset.jump; renderBody(); }));
      $('#uKpiAdultCard') && $('#uKpiAdultCard').addEventListener('click', () => { location.hash = '#/adult'; });
      $('#uHeroUnlockBtn') && $('#uHeroUnlockBtn').addEventListener('click', () => {
        openUnlockModal(() => { viewUser(life.ok); });
      });
      $('#uRefreshBtn') && $('#uRefreshBtn').addEventListener('click', () => { doGlobalUserRefresh($('#uRefreshBtn')); });
      $('#uLogout') && $('#uLogout').addEventListener('click', async () => {
        try { await API.userLogout(); } catch (e) {}
        State.me = null;
        State.adultAllowed = false;
        State.adultExpireAt = 0;
        State.unreadMsgCount = 0;
        try { State.config = await API.getConfig(); } catch (e) {}
        updateUserBox();
        renderBottomNav();
        toast('已退出登录');
        location.hash = '#/home';
      });
    }

    activeListPage = {
      key: 'user',
      getState: () => ({ tab }),
      rebind: (alive2, state) => {
        life.ok = alive2;
        if (!life.ok()) return;
        if (state && state.tab) tab = state.tab;
        bindUserHeaderEvents();
        bindHistDel();
      },
    };

    bindUserHeaderEvents();
    renderBody();

    // 后台异步拉取最新云端观看历史与时长，完成后无感刷新当前面板
    API.userHistory().then((fresh) => {
      if (!life.ok() || !fresh) return;
      data = fresh;
      store.set(cacheKey, fresh);
      watchItems.length = 0;
      searchItems.length = 0;
      (fresh.items || []).forEach((it) => {
        if (it.kind === 'watch') watchItems.push(it);
        else if (it.kind === 'search') searchItems.push(it);
      });
      const subEl = $('.user-profile-sub', v);
      if (subEl && (fresh.lastLoginAt || (fresh.profile && fresh.profile.lastLoginAt))) {
        subEl.textContent = '最近活跃时间：' + fmtDateTime(fresh.lastLoginAt || fresh.profile.lastLoginAt);
      }
      const kpiVals = $$('.user-kpi-val', v);
      if (kpiVals[0]) kpiVals[0].textContent = fmtWatchSec(fresh.watchSec || 0);
      if (kpiVals[1]) kpiVals[1].innerHTML = `${watchItems.length} <small style="font-size:13px;font-weight:400;color:var(--dim)">条</small>`;
      if (kpiVals[2]) kpiVals[2].innerHTML = `${favs.length} <small style="font-size:13px;font-weight:400;color:var(--dim)">部</small>`;
      if (!hasAdult && kpiVals[3]) {
        kpiVals[3].innerHTML = `${searchItems.length} <small style="font-size:13px;font-weight:400;color:var(--dim)">条</small>`;
      }
      const wTab = $('#uTabs .user-tab-btn[data-t="watch"]', v);
      if (wTab) wTab.textContent = `🎬 观看记录 (${watchItems.length})`;
      const sTab = $('#uTabs .user-tab-btn[data-t="search"]', v);
      if (sTab) sTab.textContent = `🔍 搜索记录 (${searchItems.length})`;
      renderBody();
    }).catch(() => {});
  }

  /* ============================================================
     视图：私密福利专区 (独立顶级页面 #/adult)
     ============================================================ */
  async function viewAdult(alive) {
    updateTrackTitle('🔞 私密福利专区');
    const life = { ok: alive };
    const v = $('#view');

    const hasAdult = Boolean(State.config && State.config.adultEnabled);
    if (!hasAdult) {
      v.innerHTML = `
        <div class="container page-wrap">
          <div class="side-card" style="text-align:center;padding:50px 20px">
            <div style="font-size:52px">🔞</div>
            <h3 style="margin:16px 0 8px">私密福利专区未启用</h3>
            <p class="hint" style="max-width:440px;margin:0 auto 20px;line-height:1.6">
              当前系统暂未开启私密福利功能，或未配置相关采集源。<br>如有疑问请联系站长或管理员在后台开启。
            </p>
            <a class="btn primary" href="#/home">返回主站首页</a>
          </div>
        </div>`;
      return;
    }

    const adultTrialMin = Number(State.config && State.config.adultTrialMinutes !== undefined ? State.config.adultTrialMinutes : (State.settings && State.settings.adultTrialMinutes !== undefined ? State.settings.adultTrialMinutes : 10));
    const isGuest = !State.me;
    const canTrialPlay = isGuest && adultTrialMin > 0;

    if (isGuest && !canTrialPlay) {
      v.innerHTML = `
        <div class="container page-wrap">
          <div class="adult-feature-banner" style="margin-top:10px">
            <div class="adult-banner-head">
              <div class="adult-banner-title">
                <span class="adult-crown-ico">🔞</span>
                <div>
                  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                    <span style="font-size:18px;font-weight:700">私密福利 VIP 尊享特权专区</span>
                    <span class="user-vip-tag locked" style="font-size:11.5px">🔒 需登录会员账号</span>
                  </div>
                  <div class="adult-banner-sub">全网精选福利聚合 · 4K超清极速秒播 · 每日同步海量更新 · 严格隐私零痕迹</div>
                </div>
              </div>
            </div>
            <div class="adult-status-banner locked" style="margin-top:14px">
              <div>
                <b>🔒 专属私密空间 · 仅限会员访问</b>
                <div style="font-size:12.5px;opacity:.9;margin-top:2px">
                  本专区与主站影片完全隔离屏蔽，守护极致私密空间。新用户注册即可自动获赠福利特权体验！
                </div>
              </div>
              <div style="display:flex;gap:10px;flex-wrap:wrap">
                <a class="btn primary small" href="#/login" style="background:linear-gradient(135deg,#e11d48,#be123c);font-weight:700">
                  🔑 立即登录 / 注册
                </a>
                <a class="btn ghost small" href="#/home">返回主站</a>
              </div>
            </div>
            <div class="adult-perk-grid" style="margin-top:16px">
              <div class="adult-perk-item">
                <div class="adult-perk-title">⚡ 4K超清极速秒播</div>
                <div class="adult-perk-desc">专享独立高速直连流媒体节点，低延时秒起播，告别卡顿与缓冲等待。</div>
              </div>
              <div class="adult-perk-item">
                <div class="adult-perk-title">🔞 每日同步海量更新</div>
                <div class="adult-perk-desc">聚合数十家精品成人影视采集源，热门番号、欧美大片、日韩精品实时收录。</div>
              </div>
              <div class="adult-perk-item">
                <div class="adult-perk-title">🛡️ 端到端隐私零痕迹</div>
                <div class="adult-perk-desc">主站搜索与推荐完全隔离屏蔽，游客零痕迹，守护纯粹私密的专属观影空间。</div>
              </div>
              <div class="adult-perk-item">
                <div class="adult-perk-title">🎁 注册即赠福利特权</div>
                <div class="adult-perk-desc">新用户注册自动赠送福利特权，随时畅享专区全部影视资源。</div>
              </div>
            </div>
          </div>
        </div>`;
      return;
    }

    const adultSources = (State.config && State.config.adultSources) || [];
    if (!adultSources.length) {
      v.innerHTML = `
        <div class="container page-wrap">
          <div class="empty"><div class="big">🔞</div>私密福利功能已开启，但暂无可用福利源，请联系管理员在后台开启采集源。</div>
        </div>`;
      return;
    }

    let adultCurSrcKey = store.get('adultCurKey', adultSources[0].key);
    if (!adultSources.some((s) => s.key === adultCurSrcKey)) adultCurSrcKey = adultSources[0].key;
    let curSrc = adultSources.find((s) => s.key === adultCurSrcKey) || adultSources[0];

    const isUnlocked = Boolean(State.config && State.config.adultUnlocked);
    let adultPg = 1;
    let adultQuery = '';
    let adultCat = '';
    let scrollCleanup = null;
    let loadingMore = false;
    let hasMore = true;
    let totalCount = 0;
    let loadedVods = [];

    v.innerHTML = `
      <div class="container page-wrap">
        <!-- 👑 私密福利 VIP 尊享特权大横幅与专属说明 -->
        <div class="adult-feature-banner" id="adultFeatureBanner">
          <div class="adult-banner-head">
            <div class="adult-banner-title">
              <span class="adult-crown-ico">👑</span>
              <div>
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                  <span style="font-size:18px;font-weight:700">私密福利 VIP 尊享特权影院</span>
                  <span class="user-vip-tag ${isUnlocked ? 'unlocked' : (canTrialPlay ? 'trial' : 'locked')}" style="font-size:11.5px">
                    ${isUnlocked ? ('👑 VIP已解锁 · 全区畅播' + (State.adultExpireAt ? ` (至 ${fmtDateTime(State.adultExpireAt).slice(0, 10)})` : '')) : (canTrialPlay ? `⏱️ 游客试看中 · 每部免费 ${adultTrialMin} 分钟` : '🔒 注册会员 · 仅图片预览')}
                  </span>
                </div>
                <div class="adult-banner-sub">全网精选福利聚合 · 4K超清极速线路 · 每日同步海量更新 · 严格隐私零痕迹</div>
              </div>
            </div>
            <div style="display:flex;gap:8px;align-items:center">
              ${!isUnlocked ? (canTrialPlay ? `
                <button class="btn primary small" id="adultHeroRegBtn" style="background:linear-gradient(135deg,#e11d48,#be123c);font-weight:700">
                  🎁 注册领VIP
                </button>
                <button class="btn ghost small" id="adultHeroUnlockBtn" style="color:#fff;border-color:rgba(255,255,255,.3)">
                  🔑 卡密
                </button>` : `
                <button class="btn primary small" id="adultHeroUnlockBtn" style="background:linear-gradient(135deg,#e11d48,#be123c);font-weight:700">
                  🔑 卡密解锁
                </button>`) : ''}
              <button class="adult-banner-toggle" id="adultBannerToggle" type="button">
                <span id="adultToggleTxt">${store.get('adultDescFold', false) ? '展开说明 ▾' : '收起说明 ▴'}</span>
              </button>
            </div>
          </div>

          <div id="adultBannerBody" class="${store.get('adultDescFold', false) ? 'hidden' : ''}">
            <div class="adult-status-banner ${isUnlocked ? 'unlocked' : (canTrialPlay ? 'trial' : 'locked')}">
              <div>
                <b>${isUnlocked ? '👑 VIP 特权状态：已激活解锁' : (canTrialPlay ? `⏱️ 游客免登录免费试看体验中（限时 ${adultTrialMin} 分钟）` : '🔒 会员特权状态：未付费解锁（仅图片预览）')}</b>
                <div style="font-size:12.5px;opacity:.9;margin-top:2px">
                  ${isUnlocked
                    ? '您已享有专区全部影片无限制在线播放特权、多条超清CDN线路、智能瀑布流无限畅享！'
                    : (canTrialPlay
                      ? `当前专区内所有影片均可免登录免费试看前 ${adultTrialMin} 分钟。免费注册账号即赠送 VIP 特权，解除试看限制，解锁全区高清影片！`
                      : '当前为注册会员画册预览模式，视频流处于受限保护状态。输入卡密即可一秒升级为 VIP 尊享会员，解除全区视频在线播放！')}
                </div>
              </div>
              ${!isUnlocked ? (canTrialPlay ? `
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                  <button class="btn primary small" id="adultRegTrialBtn" style="background:linear-gradient(135deg,#e11d48,#be123c);font-weight:700;white-space:nowrap">
                    🎁 免费注册领VIP无限看
                  </button>
                  <button class="btn ghost small" id="uBannerUnlockBtn" style="color:#fff;border-color:rgba(255,255,255,.3);white-space:nowrap">
                    🔑 卡密解锁
                  </button>
                </div>` : `
                <button class="btn primary small" id="uBannerUnlockBtn" style="background:linear-gradient(135deg,#e11d48,#be123c);font-weight:700;white-space:nowrap">
                  🔑 立即输入卡密解锁
                </button>`) : ''}
            </div>

            <div class="adult-perk-grid">
              <div class="adult-perk-item">
                <div class="adult-perk-title">⚡ 4K超清极速秒播</div>
                <div class="adult-perk-desc">专享独立高速直连流媒体节点，低延时秒起播，告别卡顿与缓冲等待。</div>
              </div>
              <div class="adult-perk-item">
                <div class="adult-perk-title">🔞 每日同步海量更新</div>
                <div class="adult-perk-desc">聚合数十家精品成人影视采集源，热门番号、欧美大片、日韩精品实时收录。</div>
              </div>
              <div class="adult-perk-item">
                <div class="adult-perk-title">🛡️ 端到端隐私零痕迹</div>
                <div class="adult-perk-desc">主站搜索与推荐完全隔离屏蔽，游客零痕迹，守护纯粹私密的专属观影空间。</div>
              </div>
              <div class="adult-perk-item">
                <div class="adult-perk-title">💻📱 多端智能交互适配</div>
                <div class="adult-perk-desc">电脑端点击自动新标签页便捷多开，手机端轻触本标签全屏起播，支持瀑布流滑动。</div>
              </div>
            </div>

            <div class="adult-guide-strip">
              <div class="adult-guide-pill"><span>🖥️ 电脑端：</span>点击任意影片自动新建标签页播放，选片更惬意</div>
              <div class="adult-guide-pill"><span>📱 手机端：</span>点击任意影片本标签内直接全屏播放，丝滑流畅</div>
              <div class="adult-guide-pill"><span>📜 智能瀑布流：</span>下拉触底自动加载下一页，无需手动翻页</div>
              <div class="adult-guide-pill"><span>⚠️ 声明：</span>本专区内容严禁未成年人访问，请妥善保管您的账号</div>
            </div>
          </div>
        </div>

        <div class="adult-src-wrapper">
          <button class="btn ghost small adult-switch-mobile" id="adultSrcPickBtn">
            🔀 切换福利源：当前「${esc(cleanSrcName(curSrc))}」 ${speedBadge(curSrc.key)}
          </button>
          <div class="src-layout">
            <aside class="src-list" id="adultSrcList">
              ${adultSources.map((s) => `
                <div class="src-row ${s.key === curSrc.key ? 'on' : ''}" data-k="${esc(s.key)}" style="cursor:pointer" title="${esc(cleanSrcName(s))}">
                  ${srcIconHtml(s)}
                  <span class="src-name">${esc(cleanSrcName(s))}</span>
                  <span class="src-speed" data-sk="${esc(s.key)}">${speedBadge(s.key)}</span>
                </div>`).join('')}
            </aside>
            <div class="src-main" id="adultSrcMain">
              <div class="src-panel-head">
                <div class="src-panel-title">
                  ${srcIconHtml(curSrc)} ${esc(cleanSrcName(curSrc))} <i class="adult-tag">私密专区</i>
                  <span class="vip-status-pill ${isUnlocked ? 'unlocked' : (canTrialPlay ? 'trial' : 'locked')}">
                    ${isUnlocked ? '👑 VIP已解锁播放' : (canTrialPlay ? `⏱️ 试看 ${adultTrialMin} 分钟` : '🔒 仅图片预览模式')}
                  </span>
                  <span class="src-panel-sub">${adultQuery ? '搜索「' + esc(adultQuery) + '」' : adultCat ? '分类筛选' : '最新影片'}</span>
                </div>
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                  ${!isUnlocked ? (canTrialPlay ? `
                    <button class="btn primary small" id="uBtnReg" style="background:linear-gradient(135deg,#e11d48,#be123c);font-weight:700">
                      🎁 注册领VIP
                    </button>
                    <button class="btn ghost small" id="uBtnUnlock" style="border-color:rgba(255,255,255,.3)">
                      🔑 卡密
                    </button>` : `
                    <button class="btn primary small" id="uBtnUnlock" style="background:linear-gradient(135deg,#e11d48,#be123c);font-weight:700">
                      🔑 立即输入卡密解锁
                    </button>`) : ''}
                  <form class="src-page-search" id="adultSearchForm" style="margin:0" onsubmit="return false">
                    <input type="search" id="adultSearchInput" placeholder="在福利源中搜片..." value="${esc(adultQuery)}" autocomplete="off" />
                    <button class="btn primary small" id="adultSearchBtn" type="button">搜索</button>
                    ${adultQuery ? `<button class="btn ghost small" id="adultSearchClear" type="button">看全部</button>` : ''}
                  </form>
                </div>
              </div>

              <!-- 动态分类导航胶囊 -->
              <div class="chips src-cats" id="adultCats"></div>

              <!-- 状态与数量指示 -->
              <div class="src-status" id="adultStatus"></div>

              <!-- 影片瀑布流海报网格 -->
              <div class="grid" id="adultGrid"></div>

              <!-- 瀑布流触底监听与加载指示器 -->
              <div class="infinite-loader" id="adultSentinel"></div>
            </div>
          </div>
        </div>
      </div>`;

    // 测速
    for (const s of adultSources) {
      if (!speedGet(s.key)) {
        (async () => {
          const t0 = performance.now();
          let rec;
          try { await API.list(s, 1); rec = { ms: Math.round(performance.now() - t0), fail: false, ts: Date.now() }; }
          catch (e) { rec = { ms: 0, fail: true, ts: Date.now() }; }
          speedCache.set(s.key, rec);
          refreshSpeedBadges();
          persistSpeed();
        })();
      }
    }

    function bindBannerAndUnlock() {
      const bannerToggle = $('#adultBannerToggle');
      const bannerBody = $('#adultBannerBody');
      const toggleTxt = $('#adultToggleTxt');
      if (bannerToggle && bannerBody) {
        bannerToggle.addEventListener('click', () => {
          const isFold = bannerBody.classList.toggle('hidden');
          store.set('adultDescFold', isFold);
          if (toggleTxt) toggleTxt.textContent = isFold ? '展开说明 ▾' : '收起说明 ▴';
        });
      }
      const doUnlock = () => openUnlockModal(() => viewAdult(life.ok));
      $('#adultHeroUnlockBtn') && $('#adultHeroUnlockBtn').addEventListener('click', doUnlock);
      $('#uBannerUnlockBtn') && $('#uBannerUnlockBtn').addEventListener('click', doUnlock);
      $('#uBtnUnlock') && $('#uBtnUnlock').addEventListener('click', doUnlock);
      $('#adultHeroRegBtn') && $('#adultHeroRegBtn').addEventListener('click', () => showAdultTrialModal(adultTrialMin, () => viewAdult(life.ok)));
      $('#adultRegTrialBtn') && $('#adultRegTrialBtn').addEventListener('click', () => showAdultTrialModal(adultTrialMin, () => viewAdult(life.ok)));
      $('#uBtnReg') && $('#uBtnReg').addEventListener('click', () => showAdultTrialModal(adultTrialMin, () => viewAdult(life.ok)));
    }

    function bindSources() {
      // 移动端弹窗切源
      $('#adultSrcPickBtn') && $('#adultSrcPickBtn').addEventListener('click', () => {
        const box = document.createElement('div');
        box.className = 'modal-mask';
        box.innerHTML = `<div class="modal-box" style="width:min(92vw,500px)">
            <h3 style="margin-bottom:6px">🔀 切换私密福利源</h3>
            <p class="hint" style="margin-bottom:12px">点击任意源即可实时切换 · ⚡ 为实测响应延时</p>
            <div class="swap-modal-list">${adultSources.map((s) => `
              <div class="src-row ${s.key === curSrc.key ? 'on' : ''}" data-k="${esc(s.key)}" style="cursor:pointer">
                ${srcIconHtml(s)}
                <span class="src-name">${esc(cleanSrcName(s))}</span>
                <span class="src-speed">${speedBadge(s.key)}</span>
              </div>`).join('')}</div>
          </div>`;
        box.addEventListener('click', (ev) => {
          const row = ev.target.closest('.src-row');
          if (row) {
            adultCurSrcKey = row.dataset.k;
            store.set('adultCurKey', adultCurSrcKey);
            box.remove();
            viewAdult(life.ok);
          } else if (ev.target === box) {
            box.remove();
          }
        });
        const closeBtn = document.createElement('button');
        closeBtn.className = 'modal-close';
        closeBtn.textContent = '×';
        closeBtn.addEventListener('click', () => box.remove());
        box.querySelector('.modal-box').appendChild(closeBtn);
        document.body.appendChild(box);
      });

      // 侧边栏切源
      $$('#adultSrcList .src-row').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (adultCurSrcKey === btn.dataset.k) return;
          adultCurSrcKey = btn.dataset.k;
          store.set('adultCurKey', adultCurSrcKey);
          viewAdult(life.ok);
        });
      });
    }

    function bindSearch() {
      $('#adultSearchBtn') && $('#adultSearchBtn').addEventListener('click', () => {
        adultQuery = ($('#adultSearchInput').value || '').trim();
        fetchAdultList(true);
      });
      $('#adultSearchInput') && $('#adultSearchInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          adultQuery = ($('#adultSearchInput').value || '').trim();
          fetchAdultList(true);
        }
      });
      $('#adultSearchClear') && $('#adultSearchClear').addEventListener('click', () => {
        adultQuery = '';
        if ($('#adultSearchInput')) $('#adultSearchInput').value = '';
        fetchAdultList(true);
      });
    }

    // 动态分类
    const catsEl = $('#adultCats');
    (async () => {
      const cats = await loadSourceCats(curSrc, life.ok);
      if (!life.ok() || !catsEl) return;
      if (cats && cats.length) {
        catsEl.classList.remove('hidden');
        catsEl.innerHTML = `
          <button class="chip ${!adultCat ? 'on' : ''}" data-cat="">全部</button>
          ${cats.map((c) => `<button class="chip ${adultCat === c.id ? 'on' : ''}" data-cat="${esc(c.id)}">${esc(c.name)}</button>`).join('')}
        `;
        $$('#adultCats .chip').forEach((c) => {
          c.addEventListener('click', () => {
            adultCat = c.dataset.cat || '';
            adultQuery = '';
            if ($('#adultSearchInput')) $('#adultSearchInput').value = '';
            $$('#adultCats .chip').forEach((x) => x.classList.toggle('on', x === c));
            fetchAdultList(true);
          });
        });
      } else {
        catsEl.classList.add('hidden');
      }
    })();

    function bindAdultCardClicks(container) {
      if (!container) return;
      const cards = container.querySelectorAll('.adult-vod-card:not([data-bound])');
      cards.forEach((el) => {
        el.setAttribute('data-bound', '1');
        el.addEventListener('click', (ev) => {
          const vidId = el.dataset.id;
          const vod = loadedVods.find((x) => String(x.vod_id) === String(vidId));
          if (!vod) return;

          const canPlay = isUnlocked || canTrialPlay;
          if (!canPlay) {
            ev.preventDefault();
            openPicPreviewModal(vod, curSrc);
            return;
          }

          const playHref = `#/play/${encodeURIComponent(curSrc.key)}/${encodeURIComponent(vidId)}?ep=0&group=0`;
          if (!isMobileDevice()) {
            ev.preventDefault();
            window.open(playHref, '_blank');
          } else {
            ev.preventDefault();
            location.hash = playHref;
          }
        });
      });
    }

    function initInfiniteScroll() {
      if (scrollCleanup) { scrollCleanup(); scrollCleanup = null; }
      const sentinel = $('#adultSentinel');
      if (!sentinel) return;

      const triggerNext = () => {
        if (!life.ok() || loadingMore || !hasMore) return;
        adultPg++;
        fetchAdultList(false);
      };

      let obs = null;
      if (window.IntersectionObserver) {
        obs = new IntersectionObserver((entries) => {
          if (entries[0] && entries[0].isIntersecting) {
            triggerNext();
          }
        }, { rootMargin: '600px 0px' });
        obs.observe(sentinel);
      }

      const onScroll = () => {
        if (!life.ok() || loadingMore || !hasMore) return;
        const rect = sentinel.getBoundingClientRect();
        if (rect.top <= window.innerHeight + 650) {
          triggerNext();
        }
      };
      window.addEventListener('scroll', onScroll, { passive: true });

      const r = sentinel.getBoundingClientRect();
      if (r.top <= window.innerHeight + 650 && hasMore && !loadingMore) {
        triggerNext();
      }

      scrollCleanup = () => {
        if (obs) { obs.disconnect(); obs = null; }
        window.removeEventListener('scroll', onScroll);
      };
    }

    async function fetchAdultList(isFirstPage = false) {
      const grid = $('#adultGrid');
      const statusEl = $('#adultStatus');
      const sentinel = $('#adultSentinel');
      if (!grid || !life.ok()) return;

      if (isFirstPage) {
        if (scrollCleanup) { scrollCleanup(); scrollCleanup = null; }
        adultPg = 1;
        hasMore = true;
        loadingMore = false;
        loadedVods = [];
        grid.innerHTML = skeletons(14);
        if (statusEl) statusEl.textContent = '⏳ 正在加载福利影片…';
        if (sentinel) {
          sentinel.className = 'infinite-loader';
          sentinel.innerHTML = '<span class="spin"></span> 正在加载影片…';
        }
      }

      loadingMore = true;
      if (sentinel && !isFirstPage) {
        sentinel.className = 'infinite-loader';
        sentinel.innerHTML = `<span class="spin"></span> 正在自动加载第 ${adultPg} 页影片…`;
      }

      let r;
      try {
        r = adultQuery
          ? await API.search(curSrc, adultQuery, adultPg)
          : await API.list(curSrc, adultPg, adultCat);
      } catch (e) {
        loadingMore = false;
        if (!life.ok()) return;
        if (isFirstPage) {
          grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="big">⚠️</div>加载失败：${esc(e.message)}<div style="margin-top:12px"><button class="btn primary small" id="adultRetryBtn">🔄 重试</button></div></div>`;
          $('#adultRetryBtn') && $('#adultRetryBtn').addEventListener('click', () => fetchAdultList(true));
          if (statusEl) statusEl.textContent = '❌ 加载失败';
          if (sentinel) sentinel.innerHTML = '';
        } else {
          if (sentinel) {
            sentinel.innerHTML = `<span>⚠️ 第 ${adultPg} 页加载失败</span> <button class="btn ghost small infinite-retry-btn" id="adultMoreRetryBtn">🔄 点击重试</button>`;
            $('#adultMoreRetryBtn') && $('#adultMoreRetryBtn').addEventListener('click', () => fetchAdultList(false));
          }
        }
        return;
      }

      if (!life.ok()) {
        loadingMore = false;
        return;
      }
      loadingMore = false;

      const list = (r && r.list) || [];
      const pageCount = Number(r && r.pagecount) || 1;
      totalCount = Number(r && r.total) || (isFirstPage ? list.length : totalCount + list.length);

      if (isFirstPage) {
        if (!list.length) {
          hasMore = false;
          grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="big">🙈</div>没有找到符合条件的私密福利影片</div>`;
          if (statusEl) statusEl.textContent = '未检索到影片';
          if (sentinel) sentinel.innerHTML = '';
          return;
        }
        grid.innerHTML = '';
      }

      if (!list.length || (pageCount && adultPg >= pageCount)) {
        hasMore = false;
      }

      list.forEach((vod) => {
        if (vod && vod.vod_id && !loadedVods.some((x) => String(x.vod_id) === String(vod.vod_id))) {
          loadedVods.push(vod);
        }
      });

      const isMobile = isMobileDevice();
      const htmlChunk = list.map((v) => {
        const pic = v.vod_pic || '';
        const title = v.vod_name || '';
        const remarks = v.vod_remarks || '';
        const year = v.vod_year || '';
        const type = v.type_name || '';
        const canPlay = isUnlocked || canTrialPlay;
        const playHref = `#/play/${encodeURIComponent(curSrc.key)}/${encodeURIComponent(v.vod_id)}?ep=0&group=0`;
        const targetAttr = canPlay ? (isMobile ? '_self' : '_blank') : '_self';
        return `
          <a class="card adult-vod-card" href="${canPlay ? playHref : 'javascript:;'}" target="${targetAttr}" data-id="${esc(v.vod_id)}" title="${esc(title)}">
            <div class="card-poster">
              <img loading="lazy" referrerpolicy="no-referrer" src="${esc(pic)}" alt="${esc(title)}"
                   onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🎬</text></svg>'">
              <span class="card-badge">${esc(remarks || year || '18+')}</span>
              <span class="card-lock-badge ${isUnlocked ? 'unlocked' : (canTrialPlay ? 'trial' : 'locked')}">
                ${isUnlocked ? '▶ 可播放' : (canTrialPlay ? `⏱️ 试看${adultTrialMin}分钟` : '🔒 预览大图')}
              </span>
              <span class="card-play-ico"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>
            </div>
            <div class="card-name" title="${esc(title)}">${esc(title)}</div>
            <div class="card-sub">${esc(year || '福利')}${type ? ' · ' + esc(type) : ''}</div>
          </a>`;
      }).join('');

      grid.insertAdjacentHTML('beforeend', htmlChunk);
      bindAdultCardClicks(grid);

      if (statusEl) {
        statusEl.textContent = `⚡ 已瀑布流加载 ${loadedVods.length} 部 · 第 1~${adultPg} 页 (共 ${totalCount} 部)`;
      }

      if (sentinel) {
        if (!hasMore) {
          sentinel.className = 'infinite-loader no-more';
          sentinel.innerHTML = `🎉 已加载全部内容（共 ${loadedVods.length} 部影片）`;
        } else {
          sentinel.className = 'infinite-loader';
          sentinel.innerHTML = `<span class="spin"></span> 向下滑动自动加载更多精彩影片…`;
        }
      }

      if (hasMore) {
        initInfiniteScroll();
      }
    }

    bindBannerAndUnlock();
    bindSources();
    bindSearch();

    activeListPage = {
      key: 'adult',
      getState: () => ({ adultCurSrcKey, adultPg, adultCat, adultQuery }),
      rebind: (alive2, state) => {
        life.ok = alive2;
        if (!life.ok()) return;
        if (state) {
          if (state.adultCurSrcKey) adultCurSrcKey = state.adultCurSrcKey;
          if (state.adultPg) adultPg = state.adultPg;
          if (state.adultCat) adultCat = state.adultCat;
          if (state.adultQuery) adultQuery = state.adultQuery;
        }
        bindBannerAndUnlock();
        bindSources();
        bindSearch();
        bindAdultCardClicks($('#adultGrid') || v);
        initInfiniteScroll();
      },
    };

    fetchAdultList(true);
  }

  /* ============================================================
     视图：站内消息中心
     ============================================================ */
  async function viewMessages(alive) {
    const life = { ok: alive };
    const v = $('#view');
    if (!State.me) {
      v.innerHTML = `
        <div class="container page-wrap msg-wrap">
          <div class="side-card" style="text-align:center;padding:50px 20px">
            <div style="font-size:52px">📬</div>
            <h3 style="margin:16px 0 8px">请先登录查看站内消息</h3>
            <p class="hint" style="max-width:440px;margin:0 auto 20px;line-height:1.6">
              登录后即可接收系统通知、特权到期提醒与私密福利开启指引。<br>新用户注册自动赠送私密福利影片特权！
            </p>
            <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
              <a class="btn primary" href="#/login">立即登录 / 注册</a>
              <a class="btn ghost" href="#/home">返回首页</a>
            </div>
          </div>
        </div>`;
      return;
    }

    v.innerHTML = `
      <div class="container page-wrap msg-wrap">
        <div class="msg-head">
          <div>
            <h2 style="font-size:20px;margin:0;display:flex;align-items:center;gap:8px">
              📬 站内消息中心
            </h2>
            <div style="font-size:12px;color:var(--dim);margin-top:4px" id="msgStatHint">正在同步消息…</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <button class="btn ghost small" id="msgReadAllBtn" style="display:none">全部标为已读</button>
            <a class="btn ghost small" href="#/user">返回个人中心</a>
          </div>
        </div>
        <div id="msgListBody" class="msg-list">
          <div class="msg-empty"><span class="spin"></span> 正在加载消息…</div>
        </div>
      </div>`;

    async function loadMsgList() {
      try {
        const res = await API.userMessages();
        if (!life.ok()) return;
        const list = (res && res.messages) || [];
        const unreadList = list.filter((m) => !m.read);
        State.unreadMsgCount = unreadList.length;
        renderBottomNav();

        const statHint = $('#msgStatHint');
        if (statHint) {
          statHint.textContent = list.length
            ? `共 ${list.length} 条通知${unreadList.length ? ` · ${unreadList.length} 条未读` : ' · 全部已读'}`
            : '暂无站内通知';
        }
        const readAllBtn = $('#msgReadAllBtn');
        if (readAllBtn) readAllBtn.style.display = unreadList.length > 0 ? '' : 'none';

        const body = $('#msgListBody');
        if (!body) return;
        if (!list.length) {
          body.innerHTML = `
            <div class="side-card msg-empty">
              <div style="font-size:44px;margin-bottom:10px">📭</div>
              <div>暂无站内消息</div>
              <p class="hint" style="margin-top:6px">系统通知、特权赠送与升级提醒都会在此显示</p>
            </div>`;
          return;
        }

        body.innerHTML = list.map((m) => {
          const isAdult = /福利|特权|成人|私密/.test(m.title + m.content);
          return `
            <div class="msg-card ${m.read ? '' : 'unread'}" data-id="${esc(m.id)}">
              <div class="msg-card-top">
                <div class="msg-card-title">
                  ${m.read ? '' : '<span class="msg-dot" title="未读"></span>'}
                  <span>${esc(m.title)}</span>
                </div>
                <time class="msg-card-time">${fmtDateTime(m.createdAt)}</time>
              </div>
              <div class="msg-card-body">${esc(m.content).replace(/\n/g, '<br>')}</div>
              <div class="msg-card-footer">
                ${isAdult ? '<a class="btn primary small" href="#/user?tab=adult" style="font-weight:700">🚀 直达私密福利专区</a>' : ''}
                ${m.read ? '' : `<button type="button" class="btn ghost small btn-read-msg" data-id="${esc(m.id)}">标为已读</button>`}
                <button type="button" class="btn ghost small btn-del-msg" data-id="${esc(m.id)}" title="删除消息" style="color:var(--dim)">🗑</button>
              </div>
            </div>`;
        }).join('');

        // 绑定单条已读
        $$('.btn-read-msg', body).forEach((btn) => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            try {
              await API.userReadMessage(id);
              loadMsgList();
            } catch (err) { toast('操作失败：' + err.message, 'err'); }
          });
        });

        // 绑定单条删除
        $$('.btn-del-msg', body).forEach((btn) => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            if (!confirm('确定删除此条消息？')) return;
            try {
              await API.userDeleteMessage(id);
              toast('消息已删除', 'ok');
              loadMsgList();
            } catch (err) { toast('删除失败：' + err.message, 'err'); }
          });
        });

      } catch (err) {
        if (!life.ok()) return;
        const body = $('#msgListBody');
        if (body) {
          body.innerHTML = `<div class="side-card msg-empty"><div style="font-size:44px">⚠️</div>加载消息失败：${esc(err.message)}</div>`;
        }
      }
    }

    const readAllBtn = $('#msgReadAllBtn');
    if (readAllBtn) {
      readAllBtn.addEventListener('click', async () => {
        try {
          await API.userReadMessage(null);
          State.unreadMsgCount = 0;
          toast('所有消息已标为已读', 'ok');
          loadMsgList();
        } catch (err) { toast('操作失败：' + err.message, 'err'); }
      });
    }

    await loadMsgList();
  }

  /* ============================================================
     视图：影视源(左侧文字源列表常驻 · 右侧该源分类/搜索/影片)
     ============================================================ */
  // 源小图标: 普通源=胶片放映图标, 成人源=红色 18+ 圆环徽标
  function srcIconHtml(s) {
    return s && s.adult
      ? `<svg class="src-ico adult" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.8" fill="none" stroke="currentColor" stroke-width="2"/><text x="12" y="15.4" text-anchor="middle" font-size="8.6" font-weight="800" fill="currentColor">18+</text></svg>`
      : `<svg class="src-ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.1" y="4.3" width="17.8" height="15.4" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M7.3 4.8v14.4M16.7 4.8v14.4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10.5 9.1v5.8l4.8-2.9z" fill="currentColor"/></svg>`;
  }

  /* ---- 源测速 ---- */
  const speedCache = new Map(); // key -> {ms, fail, ts}
  function speedGet(key) {
    const c = speedCache.get(key);
    if (!c) return null;
    if (Date.now() - c.ts > 10 * 60 * 1000) { speedCache.delete(key); return null; }
    return c;
  }
  function speedBadge(key) {
    const c = speedGet(key);
    if (!c) return '<i class="sp sp-unk">…</i>';
    if (c.fail) return '<i class="sp sp-bad">失败</i>';
    if (c.ms < 900) return `<i class="sp sp-good">${c.ms}ms</i>`;
    if (c.ms < 2600) return `<i class="sp sp-mid">${c.ms}ms</i>`;
    return `<i class="sp sp-bad">${c.ms}ms</i>`;
  }
  function refreshSpeedBadges() {
    $$('.src-speed[data-sk]').forEach((el) => { el.innerHTML = speedBadge(el.dataset.sk); });
  }
  let speedPersistTimer = null;
  function persistSpeed() {
    if (speedPersistTimer) return;
    speedPersistTimer = setTimeout(() => {
      speedPersistTimer = null;
      const obj = {};
      for (const [k, c] of speedCache) obj[k] = c;
      store.set('srcSpeed', obj);
    }, 800);
  }
  /** 恢复上次测速缓存(10分钟内有效) */
  function restoreSpeeds() {
    const saved = store.get('srcSpeed', {});
    for (const [k, c] of Object.entries(saved)) speedCache.set(k, c);
    refreshSpeedBadges();
  }
  async function startSpeedTests(alive) {
    const todo = visibleSources().filter((s) => !speedGet(s.key));
    const stat = $('#speedStat');
    let idx = 0, done = 0;
    const total = todo.length;
    const tick = () => { if (stat && alive()) stat.textContent = total ? `⚡ 测速中 ${done}/${total}` : ''; };
    tick();
    const worker = async () => {
      while (idx < total) {
        if (!alive()) return;
        const s = todo[idx++];
        const t0 = performance.now();
        let rec;
        try { await API.list(s, 1); rec = { ms: Math.round(performance.now() - t0), fail: false, ts: Date.now() }; }
        catch (e) { rec = { ms: 0, fail: true, ts: Date.now() }; }
        speedCache.set(s.key, rec);
        done++;
        tick();
        refreshSpeedBadges();
        persistSpeed();
      }
    };
    if (total) await Promise.allSettled(Array.from({ length: Math.min(6, total) }, worker));
    if (alive() && stat) stat.textContent = '⚡ 测速完成';
  }

  /* ---- 源分类节点 ---- */
  async function loadSourceCats(src, alive) {
    const ck = 'cats:' + src.key;
    const c = store.get(ck, null);
    if (c && Array.isArray(c.list) && Date.now() - c.ts < 86400000) return c.list;
    try {
      const r = await API.categories(src);
      if (!alive()) return [];
      const cls = (r && r.class) || [];
      const list = cls.filter((x) => x.type_id != null && x.type_name).map((x) => ({ id: String(x.type_id), name: String(x.type_name).trim() })).slice(0, 40);
      store.set(ck, { ts: Date.now(), list });
      return list;
    } catch (e) { return []; }
  }

  async function viewSources(selKey, query, alive) {
    const v = $('#view');
    restoreSpeeds(); // 先恢复测速缓存, 便于默认选中快速源
    const list = visibleSources();
    if (!list.length) {
      v.innerHTML = '<div class="container empty"><div class="big">📭</div>没有可用影视源，请检查后台设置<br><br><a class="btn ghost small" href="#/' + esc(store.get('adminPathLive', 'xiaolin1991')) + '">前往后台</a></div>';
      return;
    }
    if (!selKey || !list.some((s) => s.key === selKey)) {
      const last = store.get('lastSrc', '');
      if (list.some((s) => s.key === last)) selKey = last;
      else {
        // 默认选已知测速最快且可用的源
        let best = null, bestMs = Infinity;
        for (const s of list) {
          const c = speedGet(s.key);
          if (c && !c.fail && c.ms < bestMs) { best = s; bestMs = c.ms; }
        }
        selKey = best ? best.key : list[0].key;
      }
    }
    const cur = list.find((s) => s.key === selKey);
    store.set('lastSrc', selKey);
    const q = query.q || '';
    const cat = query.cat || '';
    const sortBySpeed = store.get('srcSortBySpeed', false);

    const ordered = sortBySpeed
      ? [...list].sort((a, b) => {
          const ca = speedGet(a.key), cb = speedGet(b.key);
          const va = ca ? (ca.fail ? 9e5 : ca.ms) : Infinity;
          const vb = cb ? (cb.fail ? 9e5 : cb.ms) : Infinity;
          return va - vb;
        })
      : list;

    v.innerHTML = `
      <div class="container page-wrap">
        <div class="page-head"><div class="page-title">🎬 影视源</div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <span id="speedStat" style="color:var(--dim);font-size:12.5px"></span>
            <button class="chip ${sortBySpeed ? 'on' : ''}" id="sortSpeed" title="按响应速度排序">⚡ 速度优先</button>
          </div>
        </div>
        <button class="btn ghost small src-switch-m" id="srcPickBtn" type="button">🔀 切换播放源：当前「${esc(cleanSrcName(cur))}」 ${speedBadge(cur.key)}</button>
        <div class="src-layout">
          <aside class="src-list" id="srcList">
            ${ordered.map((s) => `
              <a class="src-row ${s.key === cur.key ? 'on' : ''} ${s.adult ? 'adult' : ''}" href="#/sources/${encodeURIComponent(s.key)}" title="${esc(cleanSrcName(s))}${s.adult ? ' · 成人源' : ''}">
                ${srcIconHtml(s)}
                <span class="src-name">${esc(cleanSrcName(s))}${s.custom ? ' <i class="src-mini-tag">自</i>' : ''}</span>
                <span class="src-speed" data-sk="${esc(s.key)}">${speedBadge(s.key)}</span>
              </a>`).join('')}
          </aside>
          <div class="src-main" id="srcMain"></div>
        </div>
      </div>`;
    if (!alive()) return;

    function bindSourcesChrome() {
      const sortBtn = $('#sortSpeed');
      if (sortBtn) sortBtn.addEventListener('click', () => {
        store.set('srcSortBySpeed', !store.get('srcSortBySpeed', false));
        route();
      });
      const pickBtn = $('#srcPickBtn');
      if (pickBtn) pickBtn.addEventListener('click', () => {
        document.querySelectorAll('.modal-mask').forEach(m => m.remove());
        const box = document.createElement('div');
        box.className = 'modal-mask';
        box.innerHTML = `<div class="modal-box" style="width:min(92vw,540px)">
            <h3 style="margin-bottom:6px">🔀 选择播放源</h3>
            <p class="hint" style="margin-bottom:12px">点击任意源切换 · ⚡ 为实测响应速度</p>
            <div class="swap-modal-list">${ordered.map((s) => `
              <a class="src-row ${s.key === cur.key ? 'on' : ''} ${s.adult ? 'adult' : ''}" href="#/sources/${encodeURIComponent(s.key)}">
                ${srcIconHtml(s)}
                <span class="src-name">${esc(cleanSrcName(s))}${s.custom ? ' <i class="src-mini-tag">自</i>' : ''}</span>
                <span class="src-speed">${speedBadge(s.key)}</span>
              </a>`).join('')}</div>
          </div>`;
        box.addEventListener('click', (ev) => {
          if (ev.target === box) {
            box.remove();
          } else if (ev.target.closest('a.src-row')) {
            setTimeout(() => box.remove(), 120);
          }
        });
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'modal-close';
        closeBtn.textContent = '×';
        closeBtn.setAttribute('aria-label', '关闭');
        closeBtn.addEventListener('click', () => box.remove());
        const mbox1918 = box.querySelector('.modal-box');
        if (mbox1918) mbox1918.appendChild(closeBtn);
        document.body.appendChild(box);
      });
    }
    bindSourcesChrome();

    mountSourcePanel(cur, q, cat, alive, bindSourcesChrome);
    startSpeedTests(alive);
  }

  async function mountSourcePanel(src, q, cat, alive, bindSourcesChrome) {
    const main = $('#srcMain');
    if (!main) return;
    main.innerHTML = `
      <div class="src-panel-head">
        <div class="src-panel-title">
          ${srcIconHtml(src)} ${esc(cleanSrcName(src))}${src.adult ? ' <i class="adult-tag">成人源</i>' : ''}
          <span class="src-panel-sub">${q ? '搜索「' + esc(q) + '」' : cat ? '分类：' + esc(cat) : '最新影片'}</span>
        </div>
        <form class="src-page-search" id="srcPageSearch">
          <input type="search" id="srcPageQ" placeholder="在该源内搜索片名…" value="${esc(q)}" autocomplete="off">
          <button class="btn primary small" type="submit">搜索</button>
          ${q ? `<a class="btn ghost small" href="#/sources/${encodeURIComponent(src.key)}">看最新</a>` : ''}
        </form>
      </div>
      <div class="chips src-cats hidden" id="srcCats"></div>
      <div class="src-status" id="srcStatus"></div>
      <div class="grid" id="srcGrid">${skeletons(HOME_ROW_COUNT)}</div>
      <div class="scroll-sentinel" id="srcSentinel"></div>`;

    let page = 1, busy = false, exhausted = false, consecFails = 0;
    const life = { ok: alive };
    const grid = $('#srcGrid'), statusEl = $('#srcStatus');

    const setStatus = (t) => { if (life.ok() && statusEl) statusEl.textContent = t; };
    const fetchPage = (p, timeout) => (q ? API.search(src, q, p, timeout) : API.list(src, p, cat, timeout));

    function showLoadError(msg) {
      setHtml(grid, `<div class="empty" style="grid-column:1/-1"><div class="big">⚠️</div>
        <p>${esc(msg)}</p>
        <button class="btn primary small" id="srcRetry" style="margin-top:10px">🔄 重试</button></div>`);
      setStatus('❌ ' + msg);
      $('#srcRetry') && $('#srcRetry').addEventListener('click', () => {
        exhausted = false; consecFails = 0; page = 1;
        setHtml(grid, skeletons(HOME_ROW_COUNT));
        loadPage();
      });
    }

    async function loadPage() {
      if (busy || exhausted || !life.ok()) return;
      busy = true;
      setStatus('⏳ 正在加载…');
      try {
        // 每波并发抓2页: 谁先回来谁先显示; 失败的页自动跳过不挡路
        const batch = [page, page + 1];
        const results = await Promise.allSettled(batch.map((p) => fetchPage(p, 12000)));
        if (!life.ok()) return;
        let addedAny = false;
        for (let i = 0; i < results.length; i++) {
          const g = $('#srcGrid');
          if (!g) return;
          if (results[i].status !== 'fulfilled') { consecFails++; continue; }
          const items = ((results[i].value && results[i].value.list) || [])
            .filter((vod) => String(vod.vod_name || '').trim())
            .filter((vod, idx, arr) => arr.findIndex((x) => x.vod_id === vod.vod_id) === idx); // 波内去重
          if (!items.length) { consecFails++; continue; }
          consecFails = 0;
          addedAny = true;
          // 首批到达立即清掉骨架屏(修复"前两行一直空白")
          if (g.querySelector('.skl-card')) g.innerHTML = '';
          g.insertAdjacentHTML('beforeend', items.map((vod) => cardHtml({
            sourceKey: src.key, sourceName: src.name, id: vod.vod_id,
            title: String(vod.vod_name).trim(), pic: vod.vod_pic,
            remarks: vod.vod_remarks, year: vod.vod_year, typeName: vod.type_name,
          })).join(''));
        }
        const prevPage = page;
        page += batch.length;
        const shown = $$('#srcGrid .card').length;
        if (addedAny) {
          setStatus(prevPage === 1 ? `已显示 ${shown} 部 · 下滑自动加载` : `已显示 ${shown} 部`);
        } else if ((consecFails >= 4 && !addedAny) || (prevPage === 1 && !$('#srcGrid .card'))) {
          // 整个源都失败/无数据
          if (!$('#srcGrid .card')) {
            showLoadError(q ? '没有找到相关内容，换个关键词或分类试试' : '该源暂时无法访问或没有内容');
          } else { exhausted = true; setStatus(`✅ 已加载全部（${shown} 部）`); }
        } else {
          exhausted = true;
          setStatus(shown ? `✅ 已加载全部（${shown} 部）` : '');
        }
        if (addedAny && shown < HOME_ROW_COUNT * 3 && !exhausted && life.ok()) {
          // 第一屏还没填满就继续补(递归受 busy 守护)
          await loadPage();
        }
      } catch (err) {
        // 任何意外异常都不能卡死 busy 标志(iPad 老 WebKit 实测会因此永久停在骨架屏)
        console.warn('[sources] loadPage error:', err);
        if (life.ok()) showLoadError('加载出错：' + (err && err.message ? err.message : '未知错误'));
      } finally {
        busy = false; // 关键: 无论成功失败/提前return, 必须解锁
      }
    }

    function attachPanelEvents() {
      const senEl = $('#srcSentinel');
      if (senEl && 'IntersectionObserver' in window) {
        const io2 = new IntersectionObserver((es) => {
          es.forEach((en) => { if (en.isIntersecting && !exhausted) loadPage(); });
        }, { rootMargin: '600px' });
        io2.observe(senEl);
      }
      const onSourcesScroll = () => {
        if (busy || exhausted || !life.ok()) return;
        const sen = $('#srcSentinel');
        if (!sen) return;
        const r = sen.getBoundingClientRect();
        if (r.top <= window.innerHeight + 650) loadPage();
      };
      window.addEventListener('scroll', onSourcesScroll, { passive: true });

      const form = $('#srcPageSearch');
      if (form) form.addEventListener('submit', (e) => {
        e.preventDefault();
        const nq = ($('#srcPageQ') || {}).value.trim();
        if (nq && nq !== q) location.hash = `#/sources/${encodeURIComponent(src.key)}?q=` + encodeURIComponent(nq);
      });
      $$('#srcCats .chip').forEach((chipEl) => chipEl.addEventListener('click', () => {
        const cId = chipEl.dataset.cat;
        location.hash = `#/sources/${encodeURIComponent(src.key)}${cId ? '?cat=' + encodeURIComponent(cId) : ''}`;
      }));
      const retry = $('#srcRetry');
      if (retry) retry.addEventListener('click', () => {
        exhausted = false; consecFails = 0; page = 1;
        setHtml(grid, skeletons(HOME_ROW_COUNT));
        loadPage();
      });
    }

    function registerSourceListPage() {
      activeListPage = {
        key: listRouteKey(['sources', src.key], { q, cat }),
        getState: () => ({ selKey: src.key, q, cat, page, exhausted }),
        rebind: (alive2, st) => {
          life.ok = alive2;
          busy = false;
          if (!life.ok()) return;
          if (st && st.page != null) page = st.page;
          if (st && st.exhausted != null) exhausted = st.exhausted;
          attachPanelEvents();
          if (bindSourcesChrome) bindSourcesChrome();
          const senEl = $('#srcSentinel');
          const r = senEl && senEl.getBoundingClientRect();
          if (r && r.top < window.innerHeight + 650 && !exhausted) loadPage();
        },
      };
    }

    // 分类节点(异步加载, 不阻塞首屏)
    loadSourceCats(src, alive).then((cats) => {
      if (!life.ok() || !cats.length) return;
      const box = $('#srcCats');
      if (!box) return;
      box.classList.remove('hidden');
      box.innerHTML = [`<button class="chip ${!cat ? 'on' : ''}" data-cat="">全部</button>`]
        .concat(cats.map((c2) => `<button class="chip ${cat === c2.id ? 'on' : ''}" data-cat="${esc(c2.id)}" title="${esc(c2.name)}">${esc(c2.name)}</button>`))
        .join('');
      $$('#srcCats .chip').forEach((chipEl) => chipEl.addEventListener('click', () => {
        const cId = chipEl.dataset.cat;
        location.hash = `#/sources/${encodeURIComponent(src.key)}${cId ? '?cat=' + encodeURIComponent(cId) : ''}`;
      }));
    });

    await loadPage();
    if (!life.ok()) return;
    attachPanelEvents();
    registerSourceListPage();
    // 首屏未填满时继续补
    const chain = () => {
      if (exhausted || !life.ok()) return;
      const senEl = $('#srcSentinel');
      if (!senEl) return;
      const r = senEl.getBoundingClientRect();
      if (r.top < window.innerHeight + 500) loadPage().then(chain);
    };
    chain();
  }

  /* ============================================================
     视图：电视直播
     ============================================================ */
  /* ============================================================
     视图：下载 APP(安卓 APK / 电视 / iOS PWA 教程)
     ============================================================ */
  /* ============================================================
     视图：下载 APP(设备智能检测 / 多平台独立客户端 / iOS 免签描述文件)
     ============================================================ */
  function detectClientDevice() {
    const ua = navigator.userAgent || '';
    const isIpad = /iPad/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isIphone = /iPhone|iPod/i.test(ua);
    const isAndroid = /Android/i.test(ua);
    const isTv = isTvDevice() || /Android.*(LargeScreen|TV|Box|SmartTV|GoogleTV)/i.test(ua);
    const isMac = /Macintosh|Mac OS X/i.test(ua) && !isIpad;
    const isWindows = /Windows/i.test(ua);

    let brand = '安卓手机 / 平板';
    if (isAndroid) {
      if (/Huawei|Honor/i.test(ua)) brand = '华为 / 荣耀手机';
      else if (/Xiaomi|Redmi|MIUI|HyperOS/i.test(ua)) brand = '小米 / 红米手机';
      else if (/OPPO|Realme|OnePlus/i.test(ua)) brand = 'OPPO / 一加手机';
      else if (/vivo|iQOO/i.test(ua)) brand = 'vivo / iQOO 手机';
      else if (/SAMSUNG|SM-/i.test(ua)) brand = '三星手机 / 平板';
    }

    if (isTv) {
      return { type: 'tv', name: '智能电视 / 电视盒子', icon: '📺', isMobile: true };
    }
    if (isIpad) {
      return { type: 'ipad', name: '苹果 iPad 平板', icon: '📱', isMobile: true };
    }
    if (isIphone) {
      return { type: 'iphone', name: '苹果 iPhone 手机', icon: '🍎', isMobile: true };
    }
    if (isAndroid) {
      return { type: 'android', name: brand, icon: '🤖', isMobile: true };
    }
    if (isWindows) {
      return { type: 'windows', name: 'Windows 电脑', icon: '💻', isMobile: false };
    }
    if (isMac) {
      return { type: 'mac', name: 'Mac 苹果电脑', icon: '🖥️', isMobile: false };
    }
    return { type: 'pc', name: '桌面电脑浏览器', icon: '💻', isMobile: false };
  }

  async function viewDownload(alive, initialTarget) {
    const v = $('#view');
    const dlUrl = resolveDownloadUrl((State.settings && State.settings.downloadUrl) || '');
    const dlUrlTv = resolveDownloadUrl((State.settings && State.settings.downloadUrlTv) || '');
    const dlUrlIphone = resolveDownloadUrl((State.settings && (State.settings.downloadUrlIos || State.settings.downloadUrlIphone)) || '');
    const dlUrlIpad = resolveDownloadUrl((State.settings && State.settings.downloadUrlIpad) || '');
    const dlUrlPc = resolveDownloadUrl((State.settings && State.settings.downloadUrlPc) || '');
    const dlUrlMac = resolveDownloadUrl((State.settings && State.settings.downloadUrlMac) || '');
    const customClients = (State.settings && Array.isArray(State.settings.customClients))
      ? State.settings.customClients.filter(c => c && c.url && c.enabled !== false)
      : [];
    const dev = detectClientDevice();
    const siteName = esc((State.settings && State.settings.siteName) || '晓林影院');

    // 智能推荐版本信息计算
    let recIcon = '✨';
    let recTitle = '';
    let recDesc = '';
    let recPrimaryBtn = '';
    let recGuideBtn = '';

    if (dev.type === 'android') {
      recIcon = '🤖';
      recTitle = `推荐安装：安卓客户端官方版 (APK)`;
      recDesc = `针对您的「${dev.name}」深度适配 · 原画超清秒播 · 支持全屏手势调节音量与亮度 · 告别浏览器卡顿`;
      recPrimaryBtn = dlUrl
        ? `<a class="btn primary dl-rec-btn" href="${esc(dlUrl)}" target="_blank" rel="noopener">📥 立即下载安卓版 (推荐此版本)</a>`
        : `<span class="dl-soon">安卓安装包整备中</span>`;
      recGuideBtn = `<button type="button" class="btn ghost js-scroll-to" data-target="dl-android-guide">⚠️ 报毒/拦截放行指引 ↓</button>`;
    } else if (dev.type === 'iphone') {
      recIcon = '🍎';
      recTitle = `推荐安装：苹果 iPhone 手机专版 (免签版)`;
      recDesc = `专为苹果 iPhone 打造 · 免签证书描述文件封装 · 永久有效不掉签 · 独立全屏运行 · 丝滑秒播`;
      recPrimaryBtn = dlUrlIphone
        ? `<a class="btn primary dl-rec-btn" href="${esc(dlUrlIphone)}" target="_blank" rel="noopener">🍎 立即安装 iPhone 版 (推荐此版本)</a>`
        : `<span class="dl-soon">iPhone 版整备中</span>`;
      recGuideBtn = `<button type="button" class="btn ghost js-scroll-to" data-target="dl-ios-guide">📖 4步安装教程 ↓</button>`;
    } else if (dev.type === 'ipad') {
      recIcon = '📱';
      recTitle = `推荐安装：苹果 iPad 平板专版 (免签版)`;
      recDesc = `专为苹果 iPad 大屏触控优化 · 免签证书描述文件封装 · 永不掉签 · 支持横屏与多任务分屏`;
      recPrimaryBtn = (dlUrlIpad || dlUrlIphone)
        ? `<a class="btn primary dl-rec-btn" href="${esc(dlUrlIpad || dlUrlIphone)}" target="_blank" rel="noopener">📱 立即安装 iPad 专版 (推荐此版本)</a>`
        : `<span class="dl-soon">iPad 专版整备中</span>`;
      recGuideBtn = `<button type="button" class="btn ghost js-scroll-to" data-target="dl-ios-guide">📖 4步安装教程 ↓</button>`;
    } else if (dev.type === 'tv') {
      recIcon = '📺';
      recTitle = `推荐安装：智能电视 / 电视盒子 TV 专版 (APK)`;
      recDesc = `专为大屏遥控器交互设计 · 原画 4K 超清秒播 · 自带智能换台与多源切换`;
      recPrimaryBtn = dlUrlTv
        ? `<a class="btn primary dl-rec-btn" href="${esc(dlUrlTv)}" target="_blank" rel="noopener">📺 立即下载 TV 专版 (推荐此版本)</a>`
        : `<span class="dl-soon">TV 包可联系管理员获取</span>`;
      recGuideBtn = '';
    } else if (dev.type === 'windows') {
      recIcon = '💻';
      recTitle = `检测到您当前使用 Windows 电脑系统`;
      if (dlUrlPc) {
        recDesc = `推荐下载 Windows 官方客户端：独立桌面窗口运行 · 硬件加速 · 4K 原画超清极致秒播！`;
        recPrimaryBtn = `<a class="btn primary dl-rec-btn" href="${esc(dlUrlPc)}" target="_blank" rel="noopener">💻 立即下载 Windows 客户端 (推荐此版本)</a>`;
      } else {
        recDesc = `电脑网页端已具备完整的 4K 原画超清体验！若需在手机或电视等设备上观影，可选择下方对应版本：`;
        recPrimaryBtn = dlUrl ? `<a class="btn primary dl-rec-btn" href="${esc(dlUrl)}" target="_blank" rel="noopener">🤖 下载安卓版 APK</a>` : '';
      }
      recGuideBtn = dlUrlIphone ? `<a class="btn ghost" href="${esc(dlUrlIphone)}" target="_blank" rel="noopener">🍎 iPhone 描述文件</a>` : `<button type="button" class="btn ghost js-scroll-to" data-target="dl-ios-guide">🍎 苹果安装指引</button>`;
    } else if (dev.type === 'mac') {
      recIcon = '🖥️';
      recTitle = `检测到您当前使用 Mac 苹果电脑系统`;
      if (dlUrlMac) {
        recDesc = `推荐下载 Mac 官方客户端：原生丝滑体验 · 4K 超清秒播与双向云同步！`;
        recPrimaryBtn = `<a class="btn primary dl-rec-btn" href="${esc(dlUrlMac)}" target="_blank" rel="noopener">🖥️ 立即下载 Mac 客户端 (推荐此版本)</a>`;
      } else {
        recDesc = `Mac 网页端已具备完整的 4K 原画超清体验！若需在 iPhone 或 iPad 上安装，请选择下方对应版本：`;
        recPrimaryBtn = (dlUrlIpad || dlUrlIphone) ? `<a class="btn primary dl-rec-btn" href="${esc(dlUrlIpad || dlUrlIphone)}" target="_blank" rel="noopener">📱 获取 iPad / iPhone 版</a>` : '';
      }
      recGuideBtn = dlUrlIphone ? `<a class="btn ghost" href="${esc(dlUrlIphone)}" target="_blank" rel="noopener">🍎 iPhone 描述文件</a>` : `<button type="button" class="btn ghost js-scroll-to" data-target="dl-ios-guide">🍎 苹果安装指引</button>`;
    } else {
      recIcon = '💻';
      recTitle = `检测到您当前使用电脑端浏览器 (${dev.name})`;
      recDesc = `电脑网页端已具备完整的 4K 原画超清体验！若需在手机或智能电视上安装观影，请选择下方对应版本下载：`;
      recPrimaryBtn = dlUrl
        ? `<a class="btn primary dl-rec-btn" href="${esc(dlUrl)}" target="_blank" rel="noopener">🤖 下载安卓版 APK</a>`
        : '';
      recGuideBtn = dlUrlIphone
        ? `<a class="btn ghost" href="${esc(dlUrlIphone)}" target="_blank" rel="noopener">🍎 iPhone 描述文件</a>`
        : `<button type="button" class="btn ghost js-scroll-to" data-target="dl-ios-guide">🍎 苹果安装指引</button>`;
    }

    const apkBtn = dlUrl
      ? `<a class="btn primary" href="${esc(dlUrl)}" target="_blank" rel="noopener">📥 下载安卓 APK</a>`
      : `<span class="dl-soon">安装包整备中 · 可先看下方教程</span>`;
    const tvBtn = dlUrlTv
      ? `<a class="btn primary" href="${esc(dlUrlTv)}" target="_blank" rel="noopener">📥 下载 TV / 盒子版</a>`
      : '';
    const iphoneBtn = dlUrlIphone
      ? `<a class="btn primary" href="${esc(dlUrlIphone)}" target="_blank" rel="noopener" style="margin-bottom:10px">🍎 安装 iPhone 客户端</a>`
      : `<span class="dl-soon" style="margin-bottom:10px">iPhone 包整备中</span>`;
    const ipadBtn = (dlUrlIpad || dlUrlIphone)
      ? `<a class="btn primary" href="${esc(dlUrlIpad || dlUrlIphone)}" target="_blank" rel="noopener" style="margin-bottom:10px">📱 安装 iPad 专版</a>`
      : `<span class="dl-soon" style="margin-bottom:10px">iPad 专版整备中</span>`;
    const pcBtn = dlUrlPc
      ? `<a class="btn primary" href="${esc(dlUrlPc)}" target="_blank" rel="noopener">💻 下载 Windows 客户端</a>`
      : `<span class="dl-soon">Windows 客户端整备中</span>`;
    const macBtn = dlUrlMac
      ? `<a class="btn primary" href="${esc(dlUrlMac)}" target="_blank" rel="noopener">🖥️ 下载 Mac 客户端</a>`
      : `<span class="dl-soon">Mac 客户端整备中</span>`;

    const inAppNotice = inApp() ? `
      <div class="dl-notice-banner">
        <span>✅ <b>当前已在客户端内</b>：您当前正在使用官方 App 客户端访问。若需更新或为其他设备下载安装包，请在下方操作。</span>
      </div>` : '';

    v.innerHTML = `
      <div class="container page-wrap dl-wrap">

        ${inAppNotice}

        <!-- 🌟 智能设备检测与推荐下载卡片 -->
        <section class="dl-rec-card">
          <div class="dl-rec-header">
            <div class="dl-rec-radar-wrap">
              <span class="dl-rec-radar"></span> 智能设备检测匹配
            </div>
            <div class="dl-rec-device-tag">
              当前设备：<b>${esc(dev.icon)} ${esc(dev.name)}</b>
            </div>
          </div>
          <div class="dl-rec-body">
            <div class="dl-rec-main-info">
              <div class="dl-rec-icon">${esc(recIcon)}</div>
              <div class="dl-rec-texts">
                <div class="dl-rec-title">
                  <span>${esc(recTitle)}</span>
                  <span class="dl-rec-hot-tag">⭐ 本机最推荐</span>
                </div>
                <div class="dl-rec-desc">${esc(recDesc)}</div>
              </div>
            </div>
            <div class="dl-rec-actions">
              ${recPrimaryBtn}
              ${recGuideBtn}
            </div>
          </div>
        </section>

        <!-- Hero -->
        <section class="dl-hero">
          <i class="dl-blob b1"></i><i class="dl-blob b2"></i><i class="dl-blob b3"></i>
          <img class="dl-icon" src="./icons/icon-192.png" alt="app">
          <h2 class="dl-name">${siteName} <em>App</em></h2>
          <p class="dl-slogan">装进口袋的私人影院 —— 全屏沉浸 · 收藏云同步 · 大屏同享</p>
          <div class="dl-hero-cta">
            ${apkBtn}
            ${dlUrlIphone ? `<a class="btn primary" href="${esc(dlUrlIphone)}" target="_blank" rel="noopener">🍎 安装 iPhone 版</a>` : ''}
            ${dlUrlIpad ? `<a class="btn primary" href="${esc(dlUrlIpad)}" target="_blank" rel="noopener">📱 安装 iPad 版</a>` : ''}
            <button type="button" class="btn ghost js-scroll-to" data-target="dl-ios-guide">🍎 苹果安装教程</button>
          </div>
        </section>

        <!-- 特性条 -->
        <section class="dl-strip">
          <span>🎬 全屏沉浸</span><span>☁️ 双向云同步</span><span>⚡ 聚合秒搜</span><span>📶 电视直播</span><span>🌗 护眼暗色</span>
        </section>

        <!-- 多端客户端卡片列表 -->
        <section class="dl-grid">
          <!-- 1. 安卓手机 / 平板 -->
          <div class="dl-card ${dev.type === 'android' ? 'hot matched' : ''}">
            ${dev.type === 'android' ? '<i class="dl-ribbon">⭐ 本机最适配</i>' : ''}
            <div class="dl-badge" style="--bd1:#3ddc84;--bd2:#0f9d58">🤖</div>
            <h4>安卓手机 / 平板</h4>
            <p>独立客户端 · 原画超清秒播<br>覆盖安装不丢收藏与播放进度</p>
            ${apkBtn}
            <div style="margin-top:10px">
              <button type="button" class="btn ghost small js-scroll-to" data-target="dl-android-guide" style="font-size:11.5px;padding:4px 10px;cursor:pointer">⚠️ 报毒/拦截放行指引 ↓</button>
            </div>
          </div>

          <!-- 2. 电视 / 机顶盒 -->
          <div class="dl-card ${dev.type === 'tv' ? 'hot matched' : ''}">
            ${dev.type === 'tv' ? '<i class="dl-ribbon">⭐ 本机最适配</i>' : ''}
            <div class="dl-badge" style="--bd1:#8ab4ff;--bd2:#5b7fff">📺</div>
            <h4>电视 / 机顶盒</h4>
            <p>内置 TV 启动器 · 遥控器直用<br>大屏观影最佳选择</p>
            ${tvBtn || '<span class="dl-soon">TV 包可联系管理员获取</span>'}
          </div>

          <!-- 3. iPhone 手机专版 -->
          <div class="dl-card ${dev.type === 'iphone' ? 'hot matched' : ''}" id="dl-iphone">
            ${dev.type === 'iphone' ? '<i class="dl-ribbon">⭐ 本机最适配</i>' : ''}
            <div class="dl-badge iosb">🍎</div>
            <h4>iPhone 手机专版</h4>
            <div style="margin-bottom:8px">
              <span class="chip on" style="font-size:11px;background:rgba(91,140,255,.15);color:var(--acc);border-color:rgba(91,140,255,.3)">
                免签描述文件 · 永不掉签
              </span>
            </div>
            ${iphoneBtn}
            <div style="margin-top:8px">
              <button type="button" class="btn ghost small js-scroll-to" data-target="dl-ios-guide" style="font-size:11.5px;padding:4px 10px;cursor:pointer">📖 描述文件 4步安装教程 ↓</button>
            </div>
          </div>

          <!-- 4. iPad 平板专版 -->
          <div class="dl-card ${dev.type === 'ipad' ? 'hot matched' : ''}" id="dl-ipad">
            ${dev.type === 'ipad' ? '<i class="dl-ribbon">⭐ 本机最适配</i>' : ''}
            <div class="dl-badge" style="--bd1:#a855f7;--bd2:#7c3aed">📱</div>
            <h4>iPad 平板专版</h4>
            <div style="margin-bottom:8px">
              <span class="chip on" style="font-size:11px;background:rgba(168,85,247,.15);color:#c084fc;border-color:rgba(168,85,247,.3)">
                大屏免签 · 分屏多任务
              </span>
            </div>
            ${ipadBtn}
            <div style="margin-top:8px">
              <button type="button" class="btn ghost small js-scroll-to" data-target="dl-ios-guide" style="font-size:11.5px;padding:4px 10px;cursor:pointer">📖 描述文件 4步安装教程 ↓</button>
            </div>
          </div>

          <!-- 5. Windows 电脑客户端 -->
          <div class="dl-card ${dev.type === 'windows' ? 'hot matched' : ''}" id="dl-pc">
            ${dev.type === 'windows' ? '<i class="dl-ribbon">⭐ 本机最适配</i>' : ''}
            <div class="dl-badge" style="--bd1:#0ea5e9;--bd2:#0284c7">💻</div>
            <h4>Windows 电脑客户端</h4>
            <p>支持 Win10 / Win11 桌面版<br>硬件加速 · 4K 原画极致秒播</p>
            ${pcBtn}
          </div>

          <!-- 6. Mac 苹果电脑客户端 -->
          <div class="dl-card ${dev.type === 'mac' ? 'hot matched' : ''}" id="dl-mac">
            ${dev.type === 'mac' ? '<i class="dl-ribbon">⭐ 本机最适配</i>' : ''}
            <div class="dl-badge" style="--bd1:#64748b;--bd2:#334155">🖥️</div>
            <h4>Mac 电脑客户端</h4>
            <p>macOS 原生独立窗口观影<br>双向云同步 · 丝滑触控板手势</p>
            ${macBtn}
          </div>

          <!-- 7. 管理员自定义设备客户端 (若有) -->
          ${customClients.map(c => `
          <div class="dl-card">
            <div class="dl-badge" style="--bd1:#f59e0b;--bd2:#d97706">${esc(c.icon || '📱')}</div>
            <h4>${esc(c.name)}</h4>
            <p>${esc(c.desc || '官方独立客户端 · 畅享原画秒播')}</p>
            <a class="btn primary" href="${esc(resolveDownloadUrl(c.url))}" target="_blank" rel="noopener">📥 立即下载 ${esc(c.name)}</a>
          </div>`).join('')}
        </section>

        <!-- 安卓手机报毒/风险放行指引 -->
        <section class="dl-guide-card" id="dl-android-guide">
          <div class="dl-guide-head">
            <div class="dl-guide-title">
              <span>⚠️ 安卓手机安装「报毒 / 高风险 / 不安全」放行指引</span>
            </div>
            <span style="font-size:12px;color:var(--dim)">纯净官方无毒 · 厂商外部应用保护策略</span>
          </div>
          <p class="hint" style="line-height:1.6;margin-bottom:12px">
            由于本软件为开源与官方独立分发包，未向各大手机厂商缴纳高额上架审核费，部分手机（华为、小米、OPPO、vivo 等）自带的安全管家会弹出【未经安全审核】、【高风险应用】或【恶意软件/报毒】警告。这是手机厂商防止用户安装外部软件的<b>常见保护性拦截</b>，本软件<b>承诺绝无病毒</b>，请按对应机型指引放心继续安装：
          </p>

          <div class="dl-brand-grid">
            <div class="dl-brand-box warn">
              <div class="dl-brand-name">
                <span>🔴 华为手机 / 鸿蒙系统 (HarmonyOS)</span>
                <span class="dl-brand-pill">纯净模式拦截</span>
              </div>
              <ol class="dl-brand-steps">
                <li>安装时若弹出「华为纯净模式」阻断安装；</li>
                <li>点击弹窗中的 <b>【了解风险】</b>（或右上角 ⚙️ 设置）；</li>
                <li>勾选并点击 <b>【继续安装】</b>（或临时退出纯净模式）；</li>
                <li>验证您的 <b>锁屏密码 / 指纹</b> 即可顺利安装完成。</li>
              </ol>
            </div>

            <div class="dl-brand-box warn">
              <div class="dl-brand-name">
                <span>🟠 小米手机 / 红米 (MIUI / HyperOS)</span>
                <span class="dl-brand-pill">风险应用检测</span>
              </div>
              <ol class="dl-brand-steps">
                <li>安装时若提示「检测到风险 / 未经安全检测」；</li>
                <li>不要点击取消，点击下方的灰色小字 <b>【了解风险并继续安装】</b>；</li>
                <li>在二次提示框中勾选 <b>「我已了解可能存在的风险」</b>；</li>
                <li>点击 <b>【确认 / 继续安装】</b> 即可完成安装。</li>
              </ol>
            </div>

            <div class="dl-brand-box warn">
              <div class="dl-brand-name">
                <span>🔵 OPPO / vivo / iQOO / 一加</span>
                <span class="dl-brand-pill">未知来源保护</span>
              </div>
              <ol class="dl-brand-steps">
                <li>若提示「未在应用商店收录」或「发现病毒风险」；</li>
                <li>点击底部的 <b>【继续安装】</b> 或 <b>【忽略风险并安装】</b>；</li>
                <li>输入您的 <b>手机锁屏密码</b> 或账号密码授权即可。</li>
              </ol>
            </div>

            <div class="dl-brand-box">
              <div class="dl-brand-name">
                <span>🌐 各大手机浏览器 (Chrome / UC / 夸克 / QQ)</span>
                <span class="dl-brand-pill" style="background:rgba(34,197,94,.15);color:#4ade80">文件类型提示</span>
              </div>
              <ol class="dl-brand-steps">
                <li>下载 APK 时提示「此类型文件可能会损害您的设备」；</li>
                <li>点击 <b>【仍要下载】</b> 或 <b>【确定】</b>；</li>
                <li>下载完成后在浏览器「下载管理」中点击安装包进行安装。</li>
              </ol>
            </div>
          </div>
        </section>

        <!-- 苹果 iOS 免签描述文件安装指引 -->
        <section class="dl-guide-card" id="dl-ios-guide">
          <div class="dl-guide-head">
            <div class="dl-guide-title">
              <span>🍎 苹果 iPhone / iPad 免签证书（配置描述文件）安装教程</span>
            </div>
            <span class="chip on" style="font-size:11.5px;background:rgba(91,140,255,.15);color:var(--acc);border-color:rgba(91,140,255,.3)">免证书签名 · 永不掉签 · 独立全屏</span>
          </div>

          <div style="padding:10px 14px;border-radius:10px;background:rgba(234,179,8,.1);border:1px solid rgba(234,179,8,.25);font-size:13px;line-height:1.6;margin-bottom:14px">
            <b style="color:#facc15">⚠️ 苹果用户关键提示：</b>
            必须使用 iPhone / iPad 自带的 <b>Safari 浏览器</b> 访问并安装（微信内请点右上角「⋯」选择「在 Safari 中打开」）。
          </div>

          <div class="dl-ios-steps-box">
            <div class="dl-ios-step-row">
              <div class="dl-ios-step-num">1</div>
              <div class="dl-ios-step-text">
                <b>下载描述文件：</b>使用 Safari 打开本页面，点击上方 <b>【🍎 安装 iPhone 客户端】</b> 或 <b>【📱 安装 iPad 专版】</b> 按钮。
              </div>
            </div>
            <div class="dl-ios-step-row">
              <div class="dl-ios-step-num">2</div>
              <div class="dl-ios-step-text">
                <b>允许下载配置：</b>Safari 弹出提示<i>「此网站正尝试下载一个配置描述文件，您要允许吗？」</i>，点击 <b>【允许】</b>，下载完成后提示<i>「已下载描述文件」</i>，点击【关闭】。
              </div>
            </div>
            <div class="dl-ios-step-row">
              <div class="dl-ios-step-num">3</div>
              <div class="dl-ios-step-text">
                <b>打开设备设置：</b>返回手机/平板主屏幕，打开 <b>【设置】⚙️</b>，在顶部个人账号正下方即可看到 <b>【已下载描述文件】</b>（若未显示，可前往「设置」➔「通用」➔「VPN 与设备管理」）。
              </div>
            </div>
            <div class="dl-ios-step-row">
              <div class="dl-ios-step-num">4</div>
              <div class="dl-ios-step-text">
                <b>点击安装并激活：</b>点击进入描述文件，点击右上角 <b>【安装】</b>，输入您的 <b>设备锁屏密码</b>，随后再次点击底部 <b>【安装】</b>。安装完成后桌面上将自动生成官方 App 图标，点击即可畅享观影！
              </div>
            </div>
          </div>

          <div style="margin-top:14px;padding-top:12px;border-top:1px dashed var(--card-br)">
            <h4 style="font-size:13px;color:var(--dim);margin-bottom:6px">💡 备用轻量免安装方案（Safari 添加到主屏幕 PWA）：</h4>
            <p class="hint" style="margin:0;font-size:12px;line-height:1.7">
              在 Safari 中点底部中间的 <b>分享按钮 ⎋</b> ➔ 下滑选择 <b>【添加到主屏幕】</b> ➔ 点右上角 <b>【添加】</b>，同样可以获得与 App 完全一致的独立全屏体验！
            </p>
          </div>
        </section>

        <!-- FAQ -->
        <section class="side-card dl-faq">
          <h4>🛠️ 安装小贴士</h4>
          <ul class="dl-steps">
            <li>安卓提示「未知来源」：设置中允许，或选「仅本次允许」</li>
            <li>华为 / 鸿蒙拦截时选择「继续安装」即可，不会影响系统安全</li>
            <li>覆盖升级无需卸载：登录账号后收藏与观看进度云端同步</li>
            <li>iOS 免签描述文件直接在桌面长按即可卸载，随时可重新添加</li>
          </ul>
        </section>
      </div>`;

    function scrollToGuide(targetId) {
      const el = document.getElementById(targetId);
      if (!el) return;
      const topbar = document.getElementById('topbar');
      const topbarHeight = (topbar && topbar.offsetHeight) || 60;
      const rect = el.getBoundingClientRect();
      const targetY = window.pageYOffset + rect.top - topbarHeight - 14;
      window.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' });
    }

    $$('.js-scroll-to', v).forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const tid = btn.dataset.target;
        if (tid) scrollToGuide(tid);
      });
    });

    if (initialTarget) {
      setTimeout(() => scrollToGuide(initialTarget), 120);
    }
  }

  /* ---- APP 下载引导弹窗与客户端识别 ---- */
  // 已在官方 App 内? (安卓壳 WebView 专属UA / iOS PWA standalone 模式)
  // UA: … XIAOLIN-TV-APP/<versionName>/<versionCode>
  function inApp() {
    return /XIAOLIN-TV-APP/i.test(navigator.userAgent || '') || isStandalone();
  }
  function isClientOrDownloaded() {
    return inApp();
  }
  function parseAppClient() {
    const m = (navigator.userAgent || '').match(/XIAOLIN-TV-APP\/([^/\s]+)(?:\/(\d+))?/i);
    if (!m) return null;
    return { name: String(m[1] || ''), code: Math.max(0, parseInt(m[2] || '0', 10) || 0) };
  }
  /** 下载地址: 允许 http(s) 或站内相对路径 /APP/... → 绝对 URL */
  function resolveDownloadUrl(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    if (/^https?:\/\//i.test(s)) return s;
    if (s.startsWith('/')) {
      try { return new URL(s, location.origin).href; } catch (e) { return s; }
    }
    return '';
  }
  function isValidDownloadUrlInput(raw) {
    const s = String(raw || '').trim();
    if (!s) return true;
    return /^https?:\/\//i.test(s) || s.startsWith('/');
  }
  function isMobileUA() { if (isTvDevice()) return false; return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || ''); }
  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  }

  /* ---- 手机网页端（非 APP）观看时限与强制下载客户端拦截 ---- */
  let mobileLimitModalShown = false;
  function checkMobileWebLimit(videoEl, deltaSec = 0) {
    if (!isMobileUA() || inApp()) return false;
    const st = State.settings || {};
    const limitMin = Number(st.mobileWebLimitMinutes === undefined ? 10 : st.mobileWebLimitMinutes);
    if (limitMin < 0) return false; // -1 = 不限制
    if (limitMin === 0) {
      // 0 = 完全禁止手机网页端播放，进入即要求下载官方 APP
      if (videoEl) { try { videoEl.pause(); } catch (e) {} }
      showMobileLimitModal(0);
      return true;
    }
    const limitSec = limitMin * 60;
    let watched = Number(store.get('mobile_web_watched_secs', 0)) || 0;
    if (deltaSec > 0) {
      watched += deltaSec;
      store.set('mobile_web_watched_secs', watched);
    }
    if (watched >= limitSec) {
      if (videoEl) { try { videoEl.pause(); } catch (e) {} }
      showMobileLimitModal(limitMin);
      return true;
    }
    return false;
  }

  function showMobileLimitModal(limitMin) {
    if (mobileLimitModalShown || document.getElementById('mobileLimitMask')) return;
    mobileLimitModalShown = true;
    const box = document.createElement('div');
    box.id = 'mobileLimitMask';
    box.className = 'modal-mask mobile-limit-mask';
    const siteName = esc((State.settings && State.settings.siteName) || '晓林影视');
    const apkUrl = resolveDownloadUrl((State.settings && State.settings.downloadUrl) || '/APP/xiaolintv-phone-latest.apk');
    box.innerHTML = `
      <div class="modal-box promo-box mobile-limit-box" style="text-align:center;max-width:390px;padding:32px 24px">
        <div style="font-size:52px;line-height:1;margin-bottom:12px">📱</div>
        <h3 class="promo-title" style="margin-bottom:8px">手机网页端试看已结束</h3>
        <p class="hint" style="margin:12px 0 20px;line-height:1.6;font-size:14px">
          ${limitMin === 0 ? '为了保证极致观影画质与全屏交互体验，手机端请使用官方客户端观看。' : `您已达到手机浏览器免费试看（${limitMin} 分钟）时限。`}<br>
          请下载安装 <b>${siteName}</b> 官方 APP，畅享无限制高速播放、双向云同步与全屏手势！
        </p>
        <a class="btn primary promo-go" id="mobileLimitDlBtn" href="${esc(apkUrl)}" style="width:100%;justify-content:center;padding:14px;font-size:16px;font-weight:700" target="_blank" rel="noopener">
          ⬇️ 立即免费下载客户端
        </a>
        <div style="margin-top:14px;font-size:12px;color:var(--dim)">
          已下载安装？在手机中打开桌面 APP 即可无限制畅享全站影片
        </div>
      </div>`;
    document.body.appendChild(box);
    const dlBtn = $('#mobileLimitDlBtn', box);
    if (dlBtn) {
      dlBtn.addEventListener('click', () => {
        store.set('appDownloaded', true);
        buildNav();
        toast('正在开始下载官方客户端…', 'ok');
      });
    }
  }

  function openAppPromoModal() {
    if (isClientOrDownloaded()) return;
    const box = document.createElement('div');
    box.className = 'modal-mask';
    box.innerHTML = `<div class="modal-box promo-box">
        <button class="modal-close promo-x">×</button>
        <div class="promo-hero">
          <img class="promo-icon" src="./icons/icon-192.png" alt="App">
          <div class="promo-title-wrap">
            <h3 class="promo-title">${esc((State.settings && State.settings.siteName) || '晓林影院')}</h3>
            <div class="promo-sub">掌上观影 · 沉浸体验</div>
            <div class="promo-stars">★★★★★ <small>口碑推荐</small></div>
          </div>
        </div>
        <div class="promo-feats">
          <span>🎬 全屏播放</span><span>☁️ 收藏云同步</span><span>📺 电视盒子</span><span>⚡ 秒开换源</span>
        </div>
        <a class="btn primary promo-go" href="#/download" id="promoDlBtn">📥 免费安装</a>
        <button class="promo-skip" id="promoForever">已安装，不再提示</button>
      </div>`;
    box.addEventListener('click', (ev) => {
      if (ev.target === box) box.remove();
      if (ev.target.closest('a.promo-go')) setTimeout(() => box.remove(), 0);
    });
    $('.promo-x', box).addEventListener('click', () => box.remove()); // × 关闭 = 10 天后再弹
    $('#promoForever', box).addEventListener('click', () => {
      store.set('appPromoState', Object.assign({}, store.get('appPromoState', {}), { forever: true }));
      box.remove();
      toast('好的，不再打扰');
    });
    document.body.appendChild(box);
  }
  function maybeAppPromo() {
    try {
      if (!State.settings || State.settings.appPromoEnabled === false) return; // 后台总开关
      if (isClientOrDownloaded()) return;                                     // 已在客户端或已下载: 一律不弹
      if (!isMobileUA()) return;
      // 只对「已注册登录」的用户弹: 未登录/纯游客永远安静
      if (!State.me || State.me === '管理员') return;
      // 注册满 2 小时才出现(账号创建时间由服务端下发, 换设备同样准确)
      const created = Number(State.meCreated || 0);
      if (!created || Date.now() - created < 2 * 3600 * 1000) return;
      if ((location.hash || '').startsWith('#/download')) return;
      const st = store.get('appPromoState', {});
      if (st.forever) return;                                                  // 用户永久关闭
      const TEN_DAYS = 10 * 24 * 3600 * 1000;
      if (st.lastShown && Date.now() - st.lastShown < TEN_DAYS) return;        // 10天内不重复
      store.set('appPromoState', Object.assign({}, st, { lastShown: Date.now() }));
      setTimeout(openAppPromoModal, 1500);                                     // 等首屏渲染完再弹
    } catch (e) { /* ignore */ }
  }

  /* ---- App 内版本更新弹窗 ---- */
  function openAppUpdateModal(opts) {
    const { latestName, latestCode, force, changelog, apkUrl, platform } = opts;
    if (document.getElementById('appUpdateMask')) return;
    const client = parseAppClient();
    const box = document.createElement('div');
    box.id = 'appUpdateMask';
    box.className = 'modal-mask app-update-mask' + (force ? ' force-mask' : '');
    const notes = (changelog || '').trim()
      ? `<div class="upd-notes">${esc(changelog).replace(/\n/g, '<br>')}</div>`
      : '<div class="upd-notes dim">修复问题并提升稳定性，建议立即更新。</div>';
    const platLabel = platform === 'ios' ? '🍎 iPhone / iPad' : (platform === 'tv' ? '📺 TV 电视版' : '🤖 安卓手机版');

    box.innerHTML = `<div class="modal-box promo-box upd-box">
        ${force ? '' : '<button type="button" class="modal-close promo-x" aria-label="关闭">×</button>'}
        <div class="promo-hero">
          <img class="promo-icon" src="./icons/icon-192.png" alt="App">
          <div class="promo-title-wrap">
            <h3 class="promo-title">${force ? '🚨 发现重要强制更新' : '发现新版本'}</h3>
            <div class="promo-sub">v${esc(latestName || String(latestCode))} (${platLabel})${client && client.name ? ` · 当前 ${esc(client.name)}` : ''}</div>
          </div>
        </div>
        ${notes}
        <a class="btn primary promo-go" id="updGoBtn" href="${esc(apkUrl)}" target="_blank" rel="noopener">⬇️ 立即更新 (${platLabel})</a>
        ${force ? '<div class="upd-force-tip" style="color:var(--danger);font-weight:700;margin-top:10px;text-align:center">⚠️ 此版本为强制更新，必须更新后方可继续使用</div>' : '<button type="button" class="promo-skip" id="updLater">稍后提醒</button>'}
      </div>`;

    if (force) {
      // 强制更新：阻断背景点击与传播，阻断视频播放
      box.addEventListener('click', (ev) => { ev.stopPropagation(); });
      const blocker = setInterval(() => {
        const v = $('video');
        if (v && !v.paused) { try { v.pause(); } catch (e) {} }
        if (!document.getElementById('appUpdateMask')) clearInterval(blocker);
      }, 300);
    } else {
      const close = () => {
        store.set('appUpdateState', Object.assign({}, store.get('appUpdateState', {}) || {}, { skipCode: latestCode, skipAt: Date.now() }));
        box.remove();
      };
      box.addEventListener('click', (ev) => { if (ev.target === box) close(); });
      const x = $('.promo-x', box);
      if (x) x.addEventListener('click', close);
      const later = $('#updLater', box);
      if (later) later.addEventListener('click', close);
    }
    document.body.appendChild(box);
  }

  /** 版本号比对: a < b 返回 -1, a == b 返回 0, a > b 返回 1 */
  function compareVersion(v1, v2) {
    const s1 = String(v1 || '').trim().replace(/^v/i, '');
    const s2 = String(v2 || '').trim().replace(/^v/i, '');
    if (!s1 && !s2) return 0;
    if (!s1) return -1;
    if (!s2) return 1;
    const p1 = s1.split('.').map((x) => parseInt(x, 10) || 0);
    const p2 = s2.split('.').map((x) => parseInt(x, 10) || 0);
    const len = Math.max(p1.length, p2.length);
    for (let i = 0; i < len; i++) {
      const n1 = p1[i] || 0;
      const n2 = p2[i] || 0;
      if (n1 < n2) return -1;
      if (n1 > n2) return 1;
    }
    return 0;
  }

  function maybeAppUpdate() {
    try {
      if (!inApp()) return;
      const client = parseAppClient();
      if (!client) return;
      const st = State.settings || {};
      const latestCode = Math.max(0, Math.round(Number(st.appPublishedCode || st.appVersionCode || 0)) || 0);
      const latestName = String(st.appPublishedName || st.appVersionName || '').trim();

      // 双重版本检测：满足 versionCode 更大，或 versionName (如 0.24 > 0.23) 更大，即判定有新版
      let hasUpdate = false;
      if (latestCode > 0 && client.code > 0) {
        if (latestCode > client.code) hasUpdate = true;
      }
      if (!hasUpdate && latestName && client.name) {
        if (compareVersion(client.name, latestName) < 0) hasUpdate = true;
      }
      // 如果都没指定有效号，不触发
      if (!hasUpdate) return;

      const isIos = /iPhone|iPad|iPod/i.test(navigator.userAgent || '');
      const isTv = isTvDevice() || (client && client.name && /tv/i.test(client.name));
      let apkUrl = '';
      let platform = 'android';
      if (isIos) {
        apkUrl = resolveDownloadUrl(st.downloadUrlIos || st.downloadUrl || '');
        platform = 'ios';
      } else if (isTv) {
        apkUrl = resolveDownloadUrl(st.downloadUrlTv || st.downloadUrl || '');
        platform = 'tv';
      } else {
        apkUrl = resolveDownloadUrl(st.downloadUrl || '/APP/xiaolintv-phone-latest.apk');
        platform = 'android';
      }
      if (!apkUrl) return;

      const force = Boolean(st.appPublishedForce !== undefined ? st.appPublishedForce : st.appForceUpdate);
      if (force) {
        // 强制更新：立即暂停正在播放的视频，阻断一切观看
        const v = $('video');
        if (v) { try { v.pause(); } catch (e) {} }
      } else {
        const skip = store.get('appUpdateState', {}) || {};
        // 非强制模式：同一版本点「稍后」后 12 小时内不重复
        const verId = latestCode || latestName;
        if (skip.skipCode === verId && skip.skipAt && Date.now() - skip.skipAt < 12 * 3600 * 1000) return;
      }
      setTimeout(() => openAppUpdateModal({
        latestName: latestName || String(latestCode),
        latestCode,
        force,
        changelog: st.appPublishedChangelog || st.appChangelog || '',
        apkUrl,
        platform,
      }), force ? 100 : 1200);
    } catch (e) { /* ignore */ }
  }


  /* ============================================================
     视图：电视直播 (TV大屏 / 电脑宽屏 / 手机竖屏 三端专属直播工作台)
     ============================================================ */
  async function viewLive(query) {
    const v = $('#view');
    v.innerHTML = `
      <div class="container page-wrap live-cockpit-page">
        <div class="live-cockpit" id="liveCockpit">
          <!-- 左栏：频道分类 -->
          <aside class="live-col-groups" id="liveGroupsCol">
            <div class="live-col-head">频道分类</div>
            <div class="live-groups-list" id="liveGroups"></div>
          </aside>

          <!-- 中栏：频道列表 -->
          <section class="live-col-channels" id="liveChsCol">
            <div class="live-col-head">
              <span id="liveGroupTitle">频道列表</span>
              <small id="liveGroupCount" style="color:var(--dim);font-size:12px;font-weight:500"></small>
            </div>
            <div class="live-filter-box" id="liveFilterBox">
              <input type="search" id="liveFilterInput" placeholder="快速搜台（如 CCTV5 / 卫视）…" autocomplete="off">
            </div>
            <div class="live-channels-list" id="liveChs">
              <div class="empty" style="padding:40px 16px"><span class="spin"></span> 正在加载高清直播频道…</div>
            </div>
          </section>

          <!-- 右栏：16:9 实时直播播放舱 + 极速换线与遥控面板 -->
          <section class="live-col-stage" id="liveStageCol">
            <div class="live-stage-header">
              <div class="live-now-badge">
                <span class="live-dot"></span>
                <span class="live-now-label">LIVE 实时直播</span>
                <strong id="nowName">正在连接频道…</strong>
              </div>
              <div class="live-now-meta" id="liveNowMeta"></div>
            </div>

            <div class="video-wrap live-video-wrap" id="videoWrap">
              <video id="videoEl" playsinline webkit-playsinline autoplay></video>
              <div class="video-tip hidden" id="videoTip"></div>
            </div>

            <div class="live-ctrl-panel">
              <div class="live-lines-bar" id="liveLinesWrap">
                <span class="live-lines-label">⇄ 极速换线：</span>
                <div class="live-lines-list" id="liveLinesList"></div>
              </div>
              <div class="live-action-bar">
                <div class="live-action-left">
                  <button type="button" class="btn ghost small live-act-btn" id="livePrevChBtn">⏮ 上一台</button>
                  <button type="button" class="btn ghost small live-act-btn" id="liveNextChBtn">⏭ 下一台</button>
                  <button type="button" class="btn ghost small live-act-btn" id="liveFavCurBtn">☆ 收藏频道</button>
                </div>
                <div class="live-action-right">
                  <button type="button" class="btn primary small live-act-btn" id="liveFsBtn">🖥 全屏观看</button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>`;

    let rawData;
    try {
      rawData = State.liveCache || (State.liveCache = await API.getLive());
    } catch (e) {
      const chBox = $('#liveChs');
      if (chBox) {
        chBox.innerHTML = `<div class="empty" style="padding:36px 16px"><div class="big">📡</div>直播源加载失败：${esc(e.message)}<br><small>可在后台配置其他直播源地址</small></div>`;
      }
      return;
    }
    if (!rawData || !rawData.groups || !rawData.groups.length) {
      const chBox = $('#liveChs');
      if (chBox) {
        chBox.innerHTML = '<div class="empty" style="padding:36px 16px"><div class="big">📭</div>直播源为空，请在后台添加直播源地址</div>';
      }
      return;
    }

    // 前端二次清洗分类与频道名（兼容本地缓存旧数据，彻底剔除 Undefined/Religious/News 与 24秒短视频假源）
    function classifyGroup(gName, title) {
      const comb = String(gName || '') + ' ' + String(title || '');
      if (/religious|religion|christian|islam|buddh|church|bible|worship|购物|导购|测试|test/i.test(comb)) return null;
      if (/CCTV|CGTN|央视|中央|风云|第一剧场|怀旧剧场|世界地理|兵器科技|女性时尚/i.test(comb)) return '央视频道';
      if (/卫视/.test(title) && !/凤凰|星空|澳亚|东森|中天|三立|纬来|八大|民视|华视|台视|中视/i.test(title)) return '卫视频道';
      if (/港澳|香港|澳门|台湾|国际|海外|翡翠|明珠|TVB|VIUTV|HOY|RTHK|凤凰|星空|华视|中视|台视|民视|东森|三立|中天|纬来|八大|澳视|Now|HBO|BBC|CNN|NHK|CNA|ABN/i.test(comb)) return '港澳台/国际';
      if (/电影|影院|剧场|少儿|卡通|动漫|金鹰卡通|卡酷|炫动|纪实|体育|音乐|戏曲|欢笑|CHC|NewTV|SiTV|iHOT|咪咕|求索/i.test(comb)) return '影视/特色';
      if (/地方|北京|上海|广东|深圳|广州|浙江|杭州|江苏|山东|四川|湖北|湖南|河南|福建|安徽|辽宁|重庆|天津|河北|山西|内蒙古|吉林|黑龙江|江西|广西|海南|贵州|云南|陕西|甘肃|珠江|南方|钱江|民生|经视|都市|公共|新闻/i.test(comb)) return '地方频道';
      if (/[\u4e00-\u9fa5]/.test(title)) return '地方频道';
      return null;
    }

    function normalizeChTitle(rawTitle) {
      let s = String(rawTitle || '').trim();
      s = s.replace(/\[[^\]]*\]/g, '').replace(/\((?:1080p|720p|576p|480p|50fps|25fps|HD|FHD|UHD|HEVC|IPv6|IPv4|备用|测试)\)/gi, '').trim();
      const cctvMap = {
        '1': 'CCTV-1 综合', '2': 'CCTV-2 财经', '3': 'CCTV-3 综艺', '4': 'CCTV-4 中文国际',
        '5': 'CCTV-5 体育', '5+': 'CCTV-5+ 体育赛事', '6': 'CCTV-6 电影', '7': 'CCTV-7 国防军事',
        '8': 'CCTV-8 电视剧', '9': 'CCTV-9 纪录', '10': 'CCTV-10 科教', '11': 'CCTV-11 戏曲',
        '12': 'CCTV-12 社会与法', '13': 'CCTV-13 新闻', '14': 'CCTV-14 少儿', '15': 'CCTV-15 音乐',
        '16': 'CCTV-16 奥林匹克', '17': 'CCTV-17 农业农村'
      };
      const m = s.match(/^CCTV[-_\s]*(\d+\+?)(?:\s|$|[-_])/i);
      if (m && cctvMap[m[1].toUpperCase()]) return cctvMap[m[1].toUpperCase()];
      return s || rawTitle;
    }

    function getChannelCoreKey(name) {
      if (!name) return '';
      const cctv = name.match(/CCTV[-_\s]*(\d+\+?)/i);
      if (cctv) return 'CCTV' + cctv[1].toUpperCase();
      const ws = name.match(/([\u4e00-\u9fa5]{2,4})卫视/);
      if (ws) return ws[1] + '卫视';
      return name.trim().toUpperCase().replace(/[\s\-_()（）]+/g, '');
    }

    function scoreLine(url, tag) {
      if (/kwimgs\.com\/bs3\/video-hls/i.test(url)) return -999; // 剔除快手短视频假源
      try {
        const u = new URL(url);
        const port = u.port || (u.protocol === 'https:' ? '443' : '80');
        const isHttps = u.protocol === 'https:';
        let sc = 50;
        if (tag === 'official') sc += 35;
        if (isHttps && port === '443') sc += 30;
        else if (port === '80' || port === '8080') sc += 20;
        else sc -= 25;
        if (/\[/.test(u.hostname)) sc -= 15; // IPv6 在纯 IPv4 宽带下置后作为备用
        return sc;
      } catch (e) {
        return 0;
      }
    }

    // 聚合全部合法频道，按标准分类归并，并将同名频道的多条线路合并为一个频道实体
    const ORDER = ['央视频道', '卫视频道', '地方频道', '影视/特色', '港澳台/国际'];
    const groupBuckets = new Map();
    ORDER.forEach((gn) => groupBuckets.set(gn, new Map()));

    const allLinesByCore = new Map();

    for (const g of (rawData.groups || [])) {
      for (const ch of (g.channels || [])) {
        if (!ch || !ch.url || /kwimgs\.com\/bs3\/video-hls/i.test(ch.url)) continue;
        // 修正旧缓存中误标为 CCTV-13 的浙江中国蓝新闻流
        let fixedName = ch.name;
        let fixedGroup = g.name;
        if (/ali-m-l\.cztv\.com\/channels\/lantian\/channel21/i.test(ch.url) && /CCTV/i.test(fixedName)) {
          fixedName = '中国蓝新闻直播';
          fixedGroup = '地方频道';
        }
        const normG = classifyGroup(fixedGroup, fixedName);
        if (!normG) continue;
        const cleanName = normalizeChTitle(fixedName);
        const coreKey = getChannelCoreKey(cleanName);
        if (!coreKey) continue;

        const lineObj = {
          name: cleanName,
          url: ch.url,
          logo: ch.logo || '',
          tag: ch.tag || '',
          score: scoreLine(ch.url, ch.tag)
        };

        if (!allLinesByCore.has(coreKey)) allLinesByCore.set(coreKey, []);
        const existingLines = allLinesByCore.get(coreKey);
        if (!existingLines.some((x) => x.url === lineObj.url)) {
          existingLines.push(lineObj);
        }

        if (!groupBuckets.has(normG)) groupBuckets.set(normG, new Map());
        const gMap = groupBuckets.get(normG);
        if (!gMap.has(coreKey)) {
          gMap.set(coreKey, {
            coreKey,
            name: cleanName,
            logo: ch.logo || '',
            group: normG,
            url: ch.url
          });
        } else if (!gMap.get(coreKey).logo && ch.logo) {
          gMap.get(coreKey).logo = ch.logo;
        }
      }
    }

    // 对每个频道的候选线路按得分排序，并把最优线路作为默认 url
    for (const [ck, lines] of allLinesByCore.entries()) {
      lines.sort((a, b) => b.score - a.score);
    }

    const cleanGroups = [];
    for (const gn of ORDER) {
      const gMap = groupBuckets.get(gn);
      if (!gMap || !gMap.size) continue;
      const chList = [...gMap.values()].map((item) => {
        const lines = allLinesByCore.get(item.coreKey) || [];
        return {
          coreKey: item.coreKey,
          name: item.name,
          logo: item.logo,
          group: item.group,
          url: lines[0] ? lines[0].url : item.url,
          lineCount: Math.max(1, lines.length)
        };
      });
      if (gn === '央视频道') {
        const cctvRank = (name) => {
          const m = String(name || '').match(/CCTV[-_\s]*(\d+)(\+)?/i);
          if (!m) return 999;
          return Number(m[1]) * 2 + (m[2] ? 1 : 0);
        };
        chList.sort((a, b) => cctvRank(a.name) - cctvRank(b.name));
      }
      cleanGroups.push({ name: gn, channels: chList });
    }

    let favs = store.get('favChs', []);
    const favGroup = {
      name: '⭐ 我的收藏',
      isFav: true,
      channels: favs.map((f) => {
        const ck = getChannelCoreKey(f.name);
        const lines = allLinesByCore.get(ck) || [];
        return {
          coreKey: ck,
          name: normalizeChTitle(f.name),
          logo: f.logo || '',
          group: '⭐ 我的收藏',
          url: f.url,
          lineCount: Math.max(1, lines.length)
        };
      })
    };
    const groups = [...cleanGroups, favGroup];

    // 默认选中第一个非空分类（央视频道），彻底告别一进直播页显示空收藏黑框的问题
    let curG = 0;
    let filterKw = '';
    let curCoreKey = '';
    let curPlayingName = '';
    let curPlayingLogo = '';
    let curPlayingLines = [];
    let curLineIndex = 0;
    let liveWatchdogTimer = null;

    function syncFavGroup() {
      favs = store.get('favChs', []);
      favGroup.channels = favs.map((f) => {
        const ck = getChannelCoreKey(f.name);
        const lines = allLinesByCore.get(ck) || [];
        return {
          coreKey: ck,
          name: normalizeChTitle(f.name),
          logo: f.logo || '',
          group: '⭐ 我的收藏',
          url: f.url,
          lineCount: Math.max(1, lines.length)
        };
      });
    }

    function renderGroups() {
      const box = $('#liveGroups');
      if (!box) return;
      box.innerHTML = groups.map((g, i) => `
        <button type="button" class="live-group-btn ${i === curG ? 'on' : ''}" data-i="${i}">
          <span class="lg-name">${esc(g.name)}</span>
          <i class="lg-cnt">${g.channels.length}</i>
        </button>`).join('');
      $$('#liveGroups .live-group-btn').forEach((b) => {
        b.addEventListener('click', () => {
          curG = Number(b.dataset.i);
          filterKw = '';
          const inp = $('#liveFilterInput');
          if (inp) inp.value = '';
          renderGroups();
          renderChs();
        });
      });
    }

    function getVisibleChannels() {
      if (filterKw) {
        const kw = filterKw.toLowerCase();
        const allCh = [];
        const seen = new Set();
        for (const g of cleanGroups) {
          for (const ch of g.channels) {
            if (seen.has(ch.coreKey)) continue;
            if (ch.name.toLowerCase().includes(kw) || titleInitials(ch.name).toLowerCase().includes(kw)) {
              seen.add(ch.coreKey);
              allCh.push(ch);
            }
          }
        }
        return allCh;
      }
      const g = groups[curG] || groups[0];
      return g ? g.channels : [];
    }

    function renderChs() {
      const box = $('#liveChs');
      const gTitle = $('#liveGroupTitle');
      const gCount = $('#liveGroupCount');
      if (!box) return;
      const g = groups[curG] || groups[0];
      const list = getVisibleChannels();
      if (gTitle) gTitle.textContent = filterKw ? `搜索：${filterKw}` : (g ? g.name : '频道列表');
      if (gCount) gCount.textContent = `共 ${list.length} 台`;

      if (!list.length) {
        box.innerHTML = `<div class="empty" style="padding:36px 14px;font-size:13.5px">${
          g && g.isFav ? '暂无收藏频道，点击右下方「☆ 收藏频道」即可添加' : '未找到匹配的直播频道'
        }</div>`;
        return;
      }

      box.innerHTML = list.map((ch, i) => {
        const isOn = ch.coreKey === curCoreKey;
        const numStr = String(i + 1).padStart(2, '0');
        return `
          <button type="button" class="live-ch ${isOn ? 'on' : ''}" data-ck="${esc(ch.coreKey)}" data-u="${esc(ch.url)}" data-n="${esc(ch.name)}" data-l="${esc(ch.logo || '')}">
            <span class="lch-num">${numStr}</span>
            <div class="lch-info">
              <div class="lch-name">${esc(ch.name)}</div>
              <div class="lch-sub">${ch.lineCount > 1 ? `${ch.lineCount} 条备用源` : '高清直播'}</div>
            </div>
            ${ isOn ? '<span class="lch-wave">直播中</span>' : `<span class="lch-badge">${ch.lineCount}线</span>` }
          </button>`;
      }).join('');

      $$('#liveChs .live-ch').forEach((el) => {
        el.addEventListener('click', () => {
          playCh(el.dataset.u, el.dataset.n, el.dataset.l);
        });
      });
    }

    function updateFavCurBtn() {
      const btn = $('#liveFavCurBtn');
      if (!btn) return;
      const isFav = favs.some((f) => getChannelCoreKey(f.name) === curCoreKey);
      btn.textContent = isFav ? '★ 已收藏' : '☆ 收藏频道';
      btn.classList.toggle('primary', isFav);
    }

    function renderLineButtons() {
      const wrap = $('#liveLinesWrap');
      const list = $('#liveLinesList');
      if (!wrap || !list) return;
      if (!curPlayingLines || !curPlayingLines.length) {
        list.innerHTML = '<span style="font-size:12px;color:var(--dim)">默认主线路</span>';
        return;
      }
      list.innerHTML = curPlayingLines.slice(0, 8).map((line, idx) => {
        const isCur = idx === curLineIndex;
        let tagTxt = idx === 0 ? '主线高清' : `备用线 ${idx + 1}`;
        if (line.tag === 'official') tagTxt = '官方1080P';
        return `<button type="button" class="live-line-pill ${isCur ? 'on' : ''}" data-lidx="${idx}">线路 ${idx + 1} · ${esc(tagTxt)}</button>`;
      }).join('');

      $$('#liveLinesList .live-line-pill').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = Number(btn.dataset.lidx);
          if (curPlayingLines[idx]) {
            curLineIndex = idx;
            playCurrentLine(true);
          }
        });
      });
    }

    function playCurrentLine(isManual) {
      clearTimeout(liveWatchdogTimer);
      if (!curPlayingLines.length) return;
      const cur = curPlayingLines[curLineIndex];
      const url = cur.url;
      const name = curPlayingName || cur.name;
      const video = $('#videoEl');
      const tip = $('#videoTip');
      if (!video) return;

      if (checkMobileWebLimit(video)) return;
      if (inApp()) maybeAppUpdate();

      renderLineButtons();
      updateFavCurBtn();

      const isHttpsPage = location.protocol === 'https:';
      const isHttpStream = /^http:\/\//i.test(url);
      const isAlreadyProxied = url.includes('/api/live/stream?url=');

      // 在 Android TV / 手机 APK 内已开启 MIXED_CONTENT_ALWAYS_ALLOW，可直接拉取 HTTP 直播流获得最低延迟；浏览器 HTTPS 下走安全代理
      const inNativeApk = Boolean(window.AndroidBridge);
      let targetPlayUrl = url;
      let isProxied = false;
      if (isHttpsPage && isHttpStream && !isAlreadyProxied && !inNativeApk) {
        targetPlayUrl = '/api/live/stream?url=' + encodeURIComponent(url);
        isProxied = true;
      }

      const nowEl = $('#nowName');
      const metaEl = $('#liveNowMeta');
      if (nowEl) nowEl.textContent = name;
      if (metaEl) {
        metaEl.innerHTML = `<span class="live-meta-pill">线路 ${curLineIndex + 1}/${curPlayingLines.length}</span>` +
          (cur.tag === 'official' ? '<span class="live-meta-pill ok">⚡ 1080P 官方源</span>' : (isProxied ? '<span class="live-meta-pill">🛡️ 安全加速</span>' : '<span class="live-meta-pill">🟢 直连秒播</span>'));
      }
      updateTrackTitle('电视直播：' + name);

      const switchNextLine = (reason) => {
        clearTimeout(liveWatchdogTimer);
        if (curLineIndex + 1 < Math.min(8, curPlayingLines.length)) {
          curLineIndex++;
          toast(`线路 ${curLineIndex} 响应较慢，已自动切换至线路 ${curLineIndex + 1}`, 'info');
          playCurrentLine(false);
        } else if (tip) {
          tip.classList.remove('hidden');
          tip.innerHTML = `
            <div style="padding:18px;text-align:center;line-height:1.6">
              <div style="font-size:16px;font-weight:700;margin-bottom:6px">⚠️ 当前频道各线路暂时繁忙</div>
              <div style="font-size:13px;color:var(--dim);margin-bottom:12px">您可以点击下方按钮重试，或切换左侧其他频道观看</div>
              <div style="display:flex;gap:10px;justify-content:center">
                <button type="button" class="btn primary small" id="liveRetryBtn">🔄 重新连接</button>
                <button type="button" class="btn ghost small" id="liveSkipNextBtn">⏭ 换下一台</button>
              </div>
            </div>`;
          const rb = $('#liveRetryBtn');
          if (rb) rb.onclick = () => { curLineIndex = 0; playCurrentLine(true); };
          const sb = $('#liveSkipNextBtn');
          if (sb) sb.onclick = () => stepChannel(1);
        }
      };

      // 6.5 秒直播流断流/超时看门狗：若 6.5 秒内未渲染出画面自动切下一条线路
      liveWatchdogTimer = setTimeout(() => {
        if (!video.isConnected) return;
        if (video.readyState < 2) {
          switchNextLine('watchdog_timeout');
        }
      }, 6500);

      video.addEventListener('playing', () => {
        clearTimeout(liveWatchdogTimer);
        if (tip) { tip.classList.add('hidden'); tip.innerHTML = ''; }
      }, { once: true });

      Player.play(video, targetPlayUrl, tip, {
        optimize: !!(State.settings && State.settings.playerOptimize),
        onError: () => switchNextLine('player_error'),
      });

      $$('#liveChs .live-ch').forEach((el) => {
        const on = el.dataset.ck === curCoreKey;
        el.classList.toggle('on', on);
      });
      store.set('lastCh', { url, name, logo: curPlayingLogo });
    }

    function playCh(url, name, logo) {
      const cleanName = normalizeChTitle(name);
      curCoreKey = getChannelCoreKey(cleanName);
      curPlayingName = cleanName;
      curPlayingLogo = logo || '';
      const lines = allLinesByCore.get(curCoreKey) || [];
      curPlayingLines = lines.length ? lines.slice() : [{ name: cleanName, url, score: 50 }];
      curLineIndex = 0;
      renderChs();
      playCurrentLine(false);
    }

    function stepChannel(delta) {
      const list = getVisibleChannels();
      if (!list.length) return;
      const idx = list.findIndex((c) => c.coreKey === curCoreKey);
      const nextIdx = idx < 0 ? 0 : (idx + delta + list.length) % list.length;
      const target = list[nextIdx];
      if (target) playCh(target.url, target.name, target.logo);
    }

    // 绑定控制栏事件
    const prevBtn = $('#livePrevChBtn');
    const nextBtn = $('#liveNextChBtn');
    const favBtn = $('#liveFavCurBtn');
    const fsBtn = $('#liveFsBtn');
    const filterInp = $('#liveFilterInput');

    if (prevBtn) prevBtn.addEventListener('click', () => stepChannel(-1));
    if (nextBtn) nextBtn.addEventListener('click', () => stepChannel(1));
    if (favBtn) {
      favBtn.addEventListener('click', () => {
        if (!curCoreKey || !curPlayingName) return;
        const list = store.get('favChs', []);
        const idx = list.findIndex((f) => getChannelCoreKey(f.name) === curCoreKey);
        if (idx >= 0) {
          list.splice(idx, 1);
          toast('已取消收藏频道');
        } else {
          const primaryUrl = curPlayingLines[0] ? curPlayingLines[0].url : '';
          list.unshift({ name: curPlayingName, url: primaryUrl, logo: curPlayingLogo, group: '收藏' });
          toast('⭐ 已加入收藏频道', 'ok');
        }
        store.set('favChs', list);
        syncFavGroup();
        renderGroups();
        if (groups[curG] && groups[curG].isFav) renderChs();
        updateFavCurBtn();
      });
    }

    // 直播全屏切换（兼容 TV 遥控器、电脑真全屏与手机全屏）
    function toggleLiveFullscreen() {
      const wrap = $('#videoWrap');
      const video = $('#videoEl');
      if (!wrap) return;
      const isFsNow = document.body.classList.contains('live-fs-mode') || document.fullscreenElement || document.webkitFullscreenElement;
      if (isFsNow) {
        document.body.classList.remove('live-fs-mode');
        const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
        if (fsEl) {
          try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (e) {}
        }
      } else {
        document.body.classList.add('live-fs-mode');
        if (!isTvDevice()) {
          try {
            if (wrap.requestFullscreen) wrap.requestFullscreen().catch(() => {});
            else if (wrap.webkitRequestFullscreen) wrap.webkitRequestFullscreen();
            else if (video && video.webkitEnterFullscreen) video.webkitEnterFullscreen();
          } catch (e) {}
        }
      }
    }

    if (fsBtn) fsBtn.addEventListener('click', toggleLiveFullscreen);
    const vWrap = $('#videoWrap');
    if (vWrap) {
      vWrap.addEventListener('dblclick', toggleLiveFullscreen);
    }

    if (filterInp) {
      filterInp.addEventListener('input', () => {
        filterKw = filterInp.value.trim();
        renderChs();
      });
    }

    renderGroups();
    renderChs();

    // 默认自动起播：优先恢复上次有效频道（排除旧假源），否则默认播央视频道第 1 台（CCTV-1 综合）
    const last = store.get('lastCh', null);
    const isLastFake = last && (/kwimgs\.com/i.test(last.url || '') || (/ali-m-l\.cztv\.com.*channel21/i.test(last.url || '') && /CCTV/i.test(last.name || '')));
    if (last && last.url && !isLastFake && !query.noResume) {
      playCh(last.url, last.name, last.logo || '');
    } else {
      const firstGroup = cleanGroups[0];
      const firstCh = firstGroup && firstGroup.channels[0];
      if (firstCh) playCh(firstCh.url, firstCh.name, firstCh.logo);
    }
  }

  /* ============================================================
     视图：后台管理
     ============================================================ */
  async function viewAdmin(query, seg) {
    const v = $('#view');
    const usedSeg = seg || (parseHash().parts[0] || 'xiaolin1991');

    /* ---- 入口守卫: 已有会话任意入口直达; 未登录时路径必须与服务端配置一致 ---- */
    let hasSession = false;
    try { await API.adminSession(); hasSession = true; } catch (e) { /* 未登录 */ }
    if (!hasSession) {
      const okPath = await API.checkAdminPath(usedSeg).then((r) => !!r.ok).catch(() => usedSeg === 'xiaolin1991');
      if (!okPath) {
        v.innerHTML = `<div class="container empty"><div class="big">🕳️</div>页面不存在或已迁移<br>
          <small class="hint" style="margin-top:6px">后台入口可能已被管理员自定义，请使用正确入口地址</small></div>`;
        return;
      }
    }

    /* 未登录 → 登录卡片 */
    if (!hasSession) {
      v.innerHTML = `<div class="adm-login-wrap">
        <div class="login-box admin-card adm-login-card">
          <div class="login-logo">
            <img src="./icons/icon-192.png" alt="晓林影视">
          </div>
          <h3 class="adm-login-title">管理员登录</h3>
          <p class="hint adm-login-sub">输入管理密码进入后台控制台</p>
          <input class="field-input" id="pwdInput" type="password" placeholder="请输入管理密码" autocomplete="current-password">
          <button class="btn primary" id="loginBtn" style="width:100%;justify-content:center;margin-top:14px">登 录</button>
          <p class="hint" style="text-align:center;margin-top:14px">初始密码 admin123 · 可在安全中心修改</p>
        </div></div>`;
      const doLogin = async () => {
        const pwd = $('#pwdInput').value;
        if (!pwd) return toast('请输入密码', 'err');
        const btn = $('#loginBtn');
        if (btn) { btn.disabled = true; btn.textContent = '登录中…'; }
        try {
          await API.adminLogin(pwd);
          store.set('adminPathLive', usedSeg);
          toast('登录成功', 'ok');
          // 先切到加载态, 再完整重进后台(避免停在登录页干等)
          v.innerHTML = `<div class="adm-login-wrap"><div class="login-box admin-card adm-login-card" style="text-align:center">
            <div class="spin" style="margin:8px auto"></div>
            <p style="margin-top:14px;font-weight:600">正在进入后台…</p>
          </div></div>`;
          await viewAdmin(null, usedSeg);
        } catch (e) {
          if (btn) { btn.disabled = false; btn.textContent = '登 录'; }
          if (/Failed to fetch|NetworkError|Load failed/i.test(e.message)) {
            toast('无法连接后端：本地请先运行 npm run dev 并访问 http://127.0.0.1:8787', 'err');
          } else {
            toast(e.message === 'unauthorized' || e.message === '密码错误' ? '密码错误' : e.message, 'err');
          }
        }
      };
      $('#loginBtn').addEventListener('click', doLogin);
      $('#pwdInput').addEventListener('keydown', (e) => e.key === 'Enter' && doLogin());
      setTimeout(() => { const i = $('#pwdInput'); i && i.focus(); }, 60);
      return;
    }

    /* 已登录 → 记住入口并渲染面板 */
    store.set('adminPathLive', usedSeg);
    renderPanel();

    /* ============================ 后台面板(侧边栏多标签) ============================ */
    const ADM_TABS = [
      ['stats', '📊 流量统计'],
      ['users', '👥 用户管理'],
      ['cfg', '📡 采集源配置'],
      ['tvbox', '📺 TVBox 配置'],
      ['sources', '🧩 影视源管理'],
      ['site', '⚙️ 站点设置'],
      ['app', '📲 APP推广'],
      ['backup', '🗄️ 数据与 GitHub 同步'],
      ['sec', '🔐 安全中心'],
      ['sys', 'ℹ️ 系统信息'],
    ];
    let admTab = 'stats';
    let lastSettings = null;

    async function renderPanel() {
      let s;
      try { s = await API.adminGetSettings(); } catch (e) { toast('会话过期，请重新登录', 'err'); location.hash = '#/'; return; }
      lastSettings = s;
      const v2 = $('#view');
      v2.innerHTML = `
        <div class="admin-layout">
          <div class="adm-topbar">
            <div>
              <div class="adm-brand">后台管理</div>
              <div class="adm-brand-sub">${esc(s.siteName || '晓林影视')}</div>
            </div>
            <div class="adm-top-actions">
              <span class="status-pill ${s.storage === 'memory' ? 'warn' : 'ok'}">${
                s.storage === 'd1+kv' ? 'D1+KV 双轨存储' : (s.storage === 'd1' ? 'D1 数据库' : (s.storage === 'kv' ? 'KV 持久存储' : '内存临时存储'))
              }</span>
              <a class="btn ghost small" href="#/home">回前台</a>
              <button class="btn ghost small" id="logoutBtn">退出登录</button>
            </div>
          </div>
          <div class="adm-shell">
            <aside class="adm-side" id="admSide">
              ${ADM_TABS.map(([k, label]) => `<button type="button" class="adm-nav-item${k === admTab ? ' on' : ''}" data-tab="${k}">${label}</button>`).join('')}
            </aside>
            <div class="adm-main" id="admMain"></div>
          </div>
        </div>`;
      $('#logoutBtn').addEventListener('click', async () => { try { await API.adminLogout(); } catch (e) {} toast('已退出'); viewAdmin(null, usedSeg); });
      $$('#admSide .adm-nav-item').forEach((b) => b.addEventListener('click', () => {
        admTab = b.dataset.tab;
        $$('#admSide .adm-nav-item').forEach((x) => x.classList.toggle('on', x.dataset.tab === admTab));
        renderAdmTab(lastSettings);
      }));
      renderAdmTab(s);
    }

    /* ---- Cloudflare D1 数据库 & KV 存储连通性交互卡片 ---- */
    function buildStorageCardHtml(s) {
      const isDual = s.storage === 'd1+kv';
      const isD1 = s.storage === 'd1';
      const isKv = s.storage === 'kv';
      const isMem = s.storage === 'memory';

      const pillClass = isDual || isD1 ? 'ok' : (isKv ? 'warn' : 'warn');
      const pillText = isDual ? '🟢 D1+KV 双轨就绪' : (isD1 ? '🟢 D1 数据库就绪' : (isKv ? '🟡 KV 存储就绪' : '🔴 临时内存模式'));

      const d1InitialPill = isDual || isD1 ? '<span class="status-pill ok" id="storageD1Pill">🟢 已连接</span>' : '<span class="status-pill warn" id="storageD1Pill">🔴 未检测到绑定</span>';
      const kvInitialPill = isDual || isKv ? '<span class="status-pill ok" id="storageKvPill">🟢 已连接</span>' : '<span class="status-pill warn" id="storageKvPill">🔴 未检测到绑定</span>';

      const d1InitialDesc = isDual || isD1
        ? 'D1 关系型数据库已接入（主存储）。点击上方按钮可执行 SQL 写入/读取/删除完整闭环探针测试。'
        : '未检测到 D1 数据库绑定（变量名需为 dianying）。若未配置，全局站点设置将无法使用 SQL 存储。';

      const kvInitialDesc = isDual || isKv
        ? 'KV 命名空间已接入（灾备双写）。点击上方按钮可执行边缘键值写入/读取/删除闭环探针测试。'
        : '未检测到 KV 命名空间绑定（变量名需为 dianying_KV）。建议配置以实现边缘多节点灾备双写备份。';

      const summaryStyle = (isDual || isD1)
        ? 'background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.3);color:var(--ok)'
        : (isKv ? 'background:rgba(234,179,8,.1);border:1px solid rgba(234,179,8,.3);color:var(--warning, #eab308)' : 'background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.3);color:var(--danger)');

      let summaryHtml = '';
      if (isDual) {
        summaryHtml = '<b>🟢 存储架构卓越【D1+KV 双轨持久存储】</b>：已检测到 Cloudflare D1 (<code>dianying</code>) 数据库与 KV (<code>dianying_KV</code>) 双重绑定！所有修改实时存储至 D1 SQL 数据库并自动双写备份至 KV，全球边缘秒级同步，高可靠防丢。';
      } else if (isD1) {
        summaryHtml = '<b>🟢 存储架构正常【D1 数据库持久存储】</b>：已检测到 Cloudflare D1 (<code>dianying</code>) 数据库持久化绑定，所有配置与修改已永久保存在 SQL 数据库并在边缘节点同步。建议在控制台同时绑定 KV (<code>dianying_KV</code>) 开启灾备双写。';
      } else if (isKv) {
        summaryHtml = '<b>🟡 存储架构基础【KV 持久存储】</b>：已检测到 Cloudflare KV (<code>dianying_KV</code>) 绑定。推荐在控制台或 wrangler.toml 同时绑定 D1 (<code>dianying</code>) 数据库，享受双轨 SQL 备份与更快读写体验！';
      } else {
        summaryHtml = '<b>⚠️ 当前运行在【临时内存模式】（未绑定 Cloudflare D1 或 KV）</b>：在此模式下，后台修改的配置仅保存在当前单个边缘节点内存中，无痕窗口、换设备或节点重启后将还原为默认设置！请按下方指引绑定 D1 与 KV。';
      }

      return `
        <div class="admin-card" id="storageCard" style="margin-bottom:18px;border:1px solid var(--card-br);box-shadow:0 6px 20px rgba(0,0,0,.06)">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px">
            <div style="display:flex;align-items:center;gap:10px">
              <h3 style="margin-bottom:0;font-size:16px">🗄️ Cloudflare D1 数据库与 KV 存储检测</h3>
              <span class="status-pill ${pillClass}" id="storageOverallPill">${pillText}</span>
            </div>
            <button type="button" class="btn primary small" id="runStorageCheckBtn" style="font-weight:700;display:inline-flex;align-items:center;gap:6px">
              <span id="storageCheckBtnText">🔍 一键检测存储连通性</span>
            </button>
          </div>
          <p class="hint" style="margin-top:0;margin-bottom:14px">
            实时执行写-读-删闭环探针，真实校验 Cloudflare D1 (<code>dianying</code>) 与 KV (<code>dianying_KV</code>) 的数据库权限、延迟及表结构完整性，避免因未绑定或配置错误导致前后台修改丢失。
          </p>

          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin-bottom:12px">
            <!-- D1 数据库卡片 -->
            <div id="storageD1Box" style="background:var(--bg2);border:1px solid ${isDual || isD1 ? 'rgba(34,197,94,.3)' : 'rgba(239,68,68,.3)'};border-radius:12px;padding:14px 16px">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
                <div style="font-weight:700;font-size:13.5px;display:flex;align-items:center;gap:6px">
                  <span>🗄️ D1 数据库</span>
                  <code style="font-size:11.5px;color:var(--dim)">dianying</code>
                </div>
                ${d1InitialPill}
              </div>
              <div id="storageD1Msg" style="font-size:12.5px;color:var(--txt);line-height:1.6">${d1InitialDesc}</div>
              <div style="margin-top:8px;font-size:11.5px;color:var(--dim);display:flex;justify-content:space-between;align-items:center;border-top:1px dashed var(--card-br);padding-top:6px">
                <span>绑定变量名：<b id="storageD1Binding">${isDual || isD1 ? 'dianying' : '未检测到'}</b></span>
                <span id="storageD1Latency">耗时：—</span>
              </div>
            </div>

            <!-- KV 命名空间卡片 -->
            <div id="storageKvBox" style="background:var(--bg2);border:1px solid ${isDual || isKv ? 'rgba(34,197,94,.3)' : 'rgba(239,68,68,.3)'};border-radius:12px;padding:14px 16px">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
                <div style="font-weight:700;font-size:13.5px;display:flex;align-items:center;gap:6px">
                  <span>⚡ KV 命名空间</span>
                  <code style="font-size:11.5px;color:var(--dim)">dianying_KV</code>
                </div>
                ${kvInitialPill}
              </div>
              <div id="storageKvMsg" style="font-size:12.5px;color:var(--txt);line-height:1.6">${kvInitialDesc}</div>
              <div style="margin-top:8px;font-size:11.5px;color:var(--dim);display:flex;justify-content:space-between;align-items:center;border-top:1px dashed var(--card-br);padding-top:6px">
                <span>绑定变量名：<b id="storageKvBinding">${isDual || isKv ? 'dianying_KV' : '未检测到'}</b></span>
                <span id="storageKvLatency">耗时：—</span>
              </div>
            </div>
          </div>

          <div id="storageSummaryBox" style="padding:10px 14px;border-radius:10px;font-size:12.5px;line-height:1.6;${summaryStyle}">
            ${summaryHtml}
          </div>

          <details class="adm-details" id="storageHelpDetails" style="margin-top:12px;background:var(--bg2);border:1px dashed var(--card-br);border-radius:10px;padding:10px 14px;font-size:12.5px" ${isMem ? 'open' : ''}>
            <summary style="font-size:13px;font-weight:600;color:var(--dim)">📘 查看 Cloudflare 控制台 D1 & KV 快速绑定步骤（只需 30 秒）</summary>
            <div style="margin-top:10px;line-height:1.7;color:var(--txt)">
              <div style="margin-bottom:8px">
                <b>步骤 1：进入项目设置</b><br>
                登录 <a href="https://dash.cloudflare.com" target="_blank" rel="noreferrer" style="color:var(--acc);text-decoration:underline">Cloudflare 仪表板</a> ➔ <b>Workers 和 Pages</b> ➔ 点击您的影视项目（如 <code>dianying</code>） ➔ 顶部<b>「设置」 (Settings)</b> ➔ <b>「绑定」 (Bindings)</b>。
              </div>
              <div style="margin-bottom:8px">
                <b>步骤 2：添加 D1 数据库绑定</b><br>
                点击「添加」➔ 选择 <b>D1 数据库</b> ➔ 变量名称必须填写：<code style="user-select:all;font-weight:700">dianying</code> ➔ D1 数据库选择：<code>dianying</code>（若无请先在左侧存储菜单创建）。
              </div>
              <div style="margin-bottom:8px">
                <b>步骤 3：添加 KV 命名空间绑定</b><br>
                点击「添加」➔ 选择 <b>KV 命名空间</b> ➔ 变量名称必须填写：<code style="user-select:all;font-weight:700">dianying_KV</code> ➔ KV 命名空间选择：<code>dianying_KV</code>（若无请先在左侧存储菜单创建）。
              </div>
              <div style="margin-top:8px;color:var(--dim)">
                💡 添加完成后点击 <b>「保存并部署」 (Save and deploy)</b>，随后回到本页面点击上方「🔍 一键检测存储连通性」即可完成实时在线校验！
              </div>
            </div>
          </details>
        </div>`;
    }

    function setupStorageCard(s) {
      const btn = $('#runStorageCheckBtn');
      const btnText = $('#storageCheckBtnText');
      if (!btn) return;

      const runCheck = async (isManual = true) => {
        btn.disabled = true;
        if (btnText) btnText.innerHTML = '<span class="spin"></span> 正在深度探测 D1 & KV 读写…';
        try {
          const res = await API.adminStorageCheck();
          applyStorageResult(res);
          if (isManual) {
            if (res.d1 && res.d1.ok && res.kv && res.kv.ok) {
              toast(`🎉 D1 & KV 存储检测 100% 通过！D1 (${res.d1.latencyMs}ms) · KV (${res.kv.latencyMs}ms)`, 'ok');
            } else if (res.d1 && res.d1.ok) {
              toast(`✅ D1 数据库检测通过（${res.d1.latencyMs}ms）！建议补充绑定 dianying_KV`, 'ok');
            } else if (res.kv && res.kv.ok) {
              toast(`✅ KV 存储检测通过（${res.kv.latencyMs}ms）！推荐绑定 dianying 升级为关系型数据库`, 'ok');
            } else {
              toast('⚠️ 未检测到有效存储绑定，当前处于临时内存模式', 'err');
            }
          }
        } catch (err) {
          if (isManual) toast('存储检测失败：' + (err.message || '网络超时'), 'err');
        } finally {
          btn.disabled = false;
          if (btnText) btnText.textContent = '🔍 重新检测连通性';
        }
      };

      const applyStorageResult = (res) => {
        if (!res) return;
        const d1Box = $('#storageD1Box');
        const d1Pill = $('#storageD1Pill');
        const d1Msg = $('#storageD1Msg');
        const d1Binding = $('#storageD1Binding');
        const d1Latency = $('#storageD1Latency');

        const kvBox = $('#storageKvBox');
        const kvPill = $('#storageKvPill');
        const kvMsg = $('#storageKvMsg');
        const kvBinding = $('#storageKvBinding');
        const kvLatency = $('#storageKvLatency');

        const overallPill = $('#storageOverallPill');
        const sumBox = $('#storageSummaryBox');

        // D1 状态更新
        if (d1Box && res.d1) {
          d1Box.style.borderColor = res.d1.ok ? 'rgba(34,197,94,.4)' : 'rgba(239,68,68,.4)';
          if (d1Pill) {
            d1Pill.className = `status-pill ${res.d1.ok ? 'ok' : 'warn'}`;
            d1Pill.textContent = res.d1.ok ? `🟢 读写通过 (${res.d1.latencyMs}ms)` : (res.d1.missing ? '🔴 未检测到绑定' : '❌ 读写异常');
          }
          if (d1Msg) d1Msg.textContent = res.d1.msg || (res.d1.ok ? 'D1 数据库连接与读写正常' : 'D1 未就绪');
          if (d1Binding) d1Binding.textContent = res.d1.binding || (res.d1.missing ? '未绑定' : 'dianying');
          if (d1Latency) d1Latency.textContent = res.d1.ok ? `耗时：${res.d1.latencyMs}ms` : '耗时：—';
        }

        // KV 状态更新
        if (kvBox && res.kv) {
          kvBox.style.borderColor = res.kv.ok ? 'rgba(34,197,94,.4)' : 'rgba(239,68,68,.4)';
          if (kvPill) {
            kvPill.className = `status-pill ${res.kv.ok ? 'ok' : 'warn'}`;
            kvPill.textContent = res.kv.ok ? `🟢 读写通过 (${res.kv.latencyMs}ms)` : (res.kv.missing ? '🔴 未检测到绑定' : '❌ 读写异常');
          }
          if (kvMsg) kvMsg.textContent = res.kv.msg || (res.kv.ok ? 'KV 命名空间连接与读写正常' : 'KV 未就绪');
          if (kvBinding) kvBinding.textContent = res.kv.binding || (res.kv.missing ? '未绑定' : 'dianying_KV');
          if (kvLatency) kvLatency.textContent = res.kv.ok ? `耗时：${res.kv.latencyMs}ms` : '耗时：—';
        }

        // 总体状态更新
        const isDual = res.d1 && res.d1.ok && res.kv && res.kv.ok;
        const isD1 = res.d1 && res.d1.ok;
        const isKv = res.kv && res.kv.ok;
        const isMem = !isD1 && !isKv;

        if (overallPill) {
          overallPill.className = `status-pill ${isDual || isD1 ? 'ok' : (isKv ? 'warn' : 'warn')}`;
          overallPill.textContent = isDual ? '🟢 D1+KV 双轨就绪' : (isD1 ? '🟢 D1 数据库就绪' : (isKv ? '🟡 KV 存储就绪' : '🔴 临时内存模式'));
        }

        // 同步更新顶栏 status-pill
        const topPill = $('.adm-top-actions .status-pill');
        if (topPill) {
          topPill.className = `status-pill ${isMem ? 'warn' : 'ok'}`;
          topPill.textContent = isDual ? 'D1+KV 双轨存储' : (isD1 ? 'D1 数据库' : (isKv ? 'KV 持久存储' : '内存临时存储'));
        }

        if (sumBox) {
          if (isDual) {
            sumBox.style.background = 'rgba(34,197,94,.1)';
            sumBox.style.borderColor = 'rgba(34,197,94,.3)';
            sumBox.style.color = 'var(--ok)';
            sumBox.innerHTML = `<b>🟢 存储架构卓越【D1+KV 双轨持久存储】</b>：已完成 D1 (<code>${esc(res.d1.binding || 'dianying')}</code>) 与 KV (<code>${esc(res.kv.binding || 'dianying_KV')}</code>) 实时闭环读写测试（响应延迟：D1 ${res.d1.latencyMs}ms，KV ${res.kv.latencyMs}ms）。所有配置与用户数据均受双重保障，全球边缘秒级同步！`;
          } else if (isD1) {
            sumBox.style.background = 'rgba(34,197,94,.1)';
            sumBox.style.borderColor = 'rgba(34,197,94,.3)';
            sumBox.style.color = 'var(--ok)';
            sumBox.innerHTML = `<b>🟢 存储架构正常【D1 数据库持久存储】</b>：D1 (<code>${esc(res.d1.binding || 'dianying')}</code>) 读写校验通过（响应耗时 ${res.d1.latencyMs}ms）。建议在 Cloudflare 仪表板同时绑定 KV (<code>dianying_KV</code>) 开启全球边缘秒级容灾备份。`;
          } else if (isKv) {
            sumBox.style.background = 'rgba(234,179,8,.1)';
            sumBox.style.borderColor = 'rgba(234,179,8,.3)';
            sumBox.style.color = 'var(--warning, #eab308)';
            sumBox.innerHTML = `<b>🟡 存储架构基础【KV 命名空间持久存储】</b>：KV (<code>${esc(res.kv.binding || 'dianying_KV')}</code>) 读写校验通过（响应耗时 ${res.kv.latencyMs}ms）。推荐在 Cloudflare 仪表板添加 D1 数据库 <code>dianying</code> 绑定，享受更强的 SQL 关系存储体验！`;
          } else {
            sumBox.style.background = 'rgba(239,68,68,.12)';
            sumBox.style.borderColor = 'rgba(239,68,68,.3)';
            sumBox.style.color = 'var(--danger)';
            sumBox.innerHTML = '<b>⚠️ 当前运行在【临时内存模式】（未检测到 D1 或 KV 绑定）</b>：在此模式下，后台修改的配置仅保存在当前单个边缘节点内存中，无痕窗口、换设备或节点重启后将还原为默认设置！请展开下方步骤完成 Cloudflare 绑定。';
          }
        }
      };

      btn.addEventListener('click', () => runCheck(true));
      // 进入该标签页时自动静默探测一次，精准获取当前毫秒延迟
      runCheck(false);
    }

    function renderAdmTab(s) {
      const main = $('#admMain');
      if (!main || !s) return;
      main.scrollTop = 0;

      /* ---------------- 📊 流量统计 ---------------- */
      if (admTab === 'stats') {
        const defaultHours = Number(s && s.statsRetentionHours !== undefined ? s.statsRetentionHours : (lastSettings && lastSettings.statsRetentionHours !== undefined ? lastSettings.statsRetentionHours : 24));
        main.innerHTML = `
          <div class="admin-card">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap">
              <div>
                <h3 style="margin-bottom:4px">📊 流量与访客足迹统计 (按独立 IP 分类归纳)</h3>
                <p class="hint" style="margin:0 0 10px">自动按访客独立 IP 归并，杜绝混杂。点击任意 IP 即可深钻查看其打开的页面、观看的影片、停留时长、用户名与设备详情。</p>
              </div>
              <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
                <div style="display:flex;align-items:center;gap:6px">
                  <span style="font-size:12.5px;color:var(--dim);white-space:nowrap">保留统计周期:</span>
                  <select id="statsHoursSel" class="adm-select" style="padding:4px 8px;font-size:12.5px;border-radius:6px;background:rgba(255,255,255,0.06);color:var(--txt);border:1px solid var(--card-br)">
                    <option value="1">最近 1 小时</option>
                    <option value="6">最近 6 小时</option>
                    <option value="12">最近 12 小时</option>
                    <option value="24">最近 24 小时 (1天)</option>
                    <option value="72">最近 3 天</option>
                    <option value="168">最近 7 天</option>
                    <option value="0">全部历史记录</option>
                  </select>
                </div>
                <button class="btn ghost small" id="saveRetentionBtn" title="将当前选中的时间窗口保存为后台自动清理周期">💾 设为默认保留周期</button>
                <button class="btn ghost small" id="refreshStatsBtn">🔄 刷新</button>
                <button class="btn danger small" id="clearStatsBtn">🗑 清空全部数据</button>
              </div>
            </div>

            <div class="stat-chips" style="margin-top:12px">
              <span class="stat-chip">今日访问PV <b id="stPvToday">—</b></span>
              <span class="stat-chip">总访问量PV <b id="stPvTotal">—</b></span>
              <span class="stat-chip">独立 IP 数 <b id="stUniq">—</b></span>
              <span class="stat-chip">搜索总次数 <b id="stSearch">—</b></span>
              <span class="stat-chip">统计行数 <b id="stTotalLogs">—</b></span>
            </div>

            <div style="margin-top:14px">
              <div style="font-size:13px;font-weight:600;margin-bottom:6px;color:var(--txt)">🔥 热门访问排行</div>
              <div class="stat-paths" id="statPaths"></div>
            </div>

            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:20px;flex-wrap:wrap">
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                <input type="text" id="ipFilterInput" class="adm-input" placeholder="🔍 快速搜索 IP、归属地、用户、设备、内容..." style="width:280px;padding:6px 10px;font-size:12.5px;border-radius:6px">
                <span id="ipStatsCount" style="font-size:12px;color:var(--dim)"></span>
              </div>
              <span style="font-size:12px;color:var(--dim)">💡 点击任一行或「🔍 查看完整轨迹」按钮，可深钻查看访客访问足迹</span>
            </div>

            <div id="statIpTableWrap" class="table-scroll" style="margin-top:10px"></div>
          </div>`;

        const sel = $('#statsHoursSel');
        if (sel) sel.value = String(defaultHours);

        let rawIpList = [];
        let filteredIpList = [];
        let ipPg = 0;
        const IP_PER = 10;

        function showIpDetailModal(item) {
          const oldModal = $('#ipDetailModalBackdrop');
          if (oldModal) oldModal.remove();

          const modal = document.createElement('div');
          modal.id = 'ipDetailModalBackdrop';
          modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(4px)';
          modal.innerHTML = `
            <div class="modal-card" style="max-width:1120px;width:min(96vw,1120px);max-height:92vh;display:flex;flex-direction:column;background:#ffffff;color:#1e293b;border:1px solid #e2e8f0;border-radius:16px;box-shadow:0 25px 65px rgba(0,0,0,0.35);overflow:hidden;animation:popIn .2s ease-out">
              <!-- 弹窗顶栏 (亮色白底) -->
              <div style="padding:16px 24px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #e2e8f0;background:#f8fafc">
                <div>
                  <div style="font-size:17px;font-weight:700;display:flex;align-items:center;gap:10px;color:#0f172a;flex-wrap:wrap">
                    <span>🌐 访客 IP 访问轨迹深钻</span>
                    <code style="background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe;padding:3px 12px;border-radius:6px;font-size:15px;font-family:monospace;font-weight:700">${esc(item.ip)}</code>
                  </div>
                  <div style="font-size:13px;color:#64748b;margin-top:5px;line-height:1.5">
                    📍 <b style="color:#334155">IP归属地：</b>${esc(item.geo || '未知地区')} &nbsp;·&nbsp; 🕒 <b style="color:#334155">最近活跃：</b>${fmtDateTime(item.lastTs)}
                  </div>
                </div>
                <button type="button" id="closeIpModalBtn" style="border:none;background:#e2e8f0;color:#475569;width:34px;height:34px;border-radius:8px;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s" title="关闭窗口">✕</button>
              </div>

              <!-- 弹窗主体内容 (白色背景) -->
              <div style="padding:22px 24px;overflow-y:auto;flex:1;background:#ffffff">
                <!-- 4个访客概要卡片 (纯白底，柔和浅灰边框，清晰黑字) -->
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px;margin-bottom:22px">
                  <div style="padding:14px 16px;border-radius:10px;background:#f8fafc;border:1px solid #e2e8f0">
                    <div style="font-size:12px;color:#64748b;font-weight:500">访问用户身份</div>
                    <div style="font-size:15px;font-weight:700;margin-top:6px;color:#0f172a">
                      ${item.u ? `<span style="background:#e0f2fe;color:#0369a1;padding:3px 10px;border-radius:6px;font-size:13px">👤 ${esc(item.u)}</span>` : '<span style="background:#f1f5f9;color:#475569;padding:3px 10px;border-radius:6px;font-size:13px">👤 游客 (未登录)</span>'}
                    </div>
                  </div>

                  <div style="padding:14px 16px;border-radius:10px;background:#f8fafc;border:1px solid #e2e8f0">
                    <div style="font-size:12px;color:#64748b;font-weight:500">访问设备 / 操作系统</div>
                    <div style="font-size:14px;font-weight:700;margin-top:6px;color:#0f172a;line-height:1.4" title="${esc(item.ua || '')}">
                      ${esc(item.device || '标准浏览器')}
                    </div>
                  </div>

                  <div style="padding:14px 16px;border-radius:10px;background:#f8fafc;border:1px solid #e2e8f0">
                    <div style="font-size:12px;color:#64748b;font-weight:500">累计访问次数 (PV)</div>
                    <div style="font-size:22px;font-weight:800;color:#0f172a;margin-top:4px">
                      ${item.count} <span style="font-size:13px;font-weight:normal;color:#64748b">次</span>
                    </div>
                  </div>

                  <div style="padding:14px 16px;border-radius:10px;background:#f8fafc;border:1px solid #e2e8f0">
                    <div style="font-size:12px;color:#64748b;font-weight:500">累计停留 / 观看时长</div>
                    <div style="font-size:20px;font-weight:800;color:#2563eb;margin-top:4px">
                      ${fmtWatchSec(item.duration)}
                    </div>
                  </div>
                </div>

                <!-- 轨迹足迹列表 -->
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
                  <h4 style="margin:0;font-size:15px;font-weight:700;color:#0f172a;display:flex;align-items:center;gap:6px">
                    <span>👣 详细操作历史轨迹</span>
                    <span style="font-size:12.5px;color:#64748b;font-weight:normal">(共 ${item.actions.length} 条记录，按时间最新在前展示)</span>
                  </h4>
                </div>

                <div class="table-scroll" style="border:1px solid #e2e8f0;border-radius:10px;max-height:460px;background:#ffffff">
                  <table style="width:100%;border-collapse:collapse;font-size:13px;color:#1e293b;text-align:left;min-width:860px">
                    <thead style="background:#f1f5f9;color:#475569;border-bottom:2px solid #cbd5e1;position:sticky;top:0;z-index:10">
                      <tr>
                        <th style="padding:11px 14px;width:150px;white-space:nowrap;font-weight:600">访问时间</th>
                        <th style="padding:11px 14px;min-width:180px;font-weight:600">看到什么内容 (浏览详情)</th>
                        <th style="padding:11px 14px;min-width:170px;font-weight:600">打开什么页面 (路由地址)</th>
                        <th style="padding:11px 14px;width:115px;white-space:nowrap;font-weight:600">停留/观看时长</th>
                        <th style="padding:11px 14px;width:95px;white-space:nowrap;font-weight:600">用户名</th>
                        <th style="padding:11px 14px;width:130px;font-weight:600">访问设备</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${(item.actions || []).map((act, idx) => `
                        <tr style="border-bottom:1px solid #f1f5f9;background:${idx % 2 === 0 ? '#ffffff' : '#fafafa'};transition:background .15s" onmouseover="this.style.background='#f0f9ff'" onmouseout="this.style.background='${idx % 2 === 0 ? '#ffffff' : '#fafafa'}'">
                          <td style="padding:10px 14px;white-space:nowrap;color:#64748b;font-size:12px;font-family:monospace">${fmtDateTime(act.ts)}</td>
                          <td style="padding:10px 14px;line-height:1.5">
                            <b style="color:#0f172a;font-size:13.5px">${esc(act.title || (act.kind === 'search' ? '🔍 搜索：' + (act.q || '') : (act.path || '页面访问')))}</b>
                          </td>
                          <td style="padding:10px 14px;line-height:1.4">
                            <a href="${esc(act.path || '#/')}" target="_blank" rel="noopener" style="color:#2563eb;word-break:break-all;text-decoration:none;font-size:12px" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${esc(act.path || '#/')}</a>
                          </td>
                          <td style="padding:10px 14px;white-space:nowrap">
                            <span style="color:${act.duration > 0 ? '#0284c7' : '#94a3b8'};font-weight:700;font-size:13px">${fmtWatchSec(act.duration)}</span>
                          </td>
                          <td style="padding:10px 14px;white-space:nowrap">
                            ${act.u ? `<span style="background:#e0f2fe;color:#0369a1;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600">${esc(act.u)}</span>` : '<span style="background:#f1f5f9;color:#64748b;padding:2px 8px;border-radius:4px;font-size:12px">游客</span>'}
                          </td>
                          <td style="padding:10px 14px;color:#475569;font-size:12px;line-height:1.4">${esc(act.device || item.device || '网页端')}</td>
                        </tr>`).join('')}
                    </tbody>
                  </table>
                </div>
              </div>

              <!-- 弹窗底栏 -->
              <div style="padding:14px 24px;border-top:1px solid #e2e8f0;display:flex;justify-content:flex-end;align-items:center;gap:12px;background:#f8fafc">
                <button type="button" id="closeIpModalBtnBottom" style="padding:7px 18px;border-radius:8px;border:1px solid #cbd5e1;background:#ffffff;color:#334155;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 1px 2px rgba(0,0,0,0.05)">关闭窗口</button>
              </div>
            </div>`;

          document.body.appendChild(modal);

          const closeModal = () => modal.remove();
          modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
          $('#closeIpModalBtn') && $('#closeIpModalBtn').addEventListener('click', closeModal);
          $('#closeIpModalBtnBottom') && $('#closeIpModalBtnBottom').addEventListener('click', closeModal);

          const onKeyDown = (e) => {
            if (e.key === 'Escape') {
              closeModal();
              window.removeEventListener('keydown', onKeyDown);
            }
          };
          window.addEventListener('keydown', onKeyDown);
        }

        function renderIpTablePage() {
          const wrap = $('#statIpTableWrap');
          if (!wrap) return;

          const total = filteredIpList.length;
          const pages = Math.max(1, Math.ceil(total / IP_PER));
          if (ipPg > pages - 1) ipPg = pages - 1;
          if (ipPg < 0) ipPg = 0;

          const curSlice = filteredIpList.slice(ipPg * IP_PER, (ipPg + 1) * IP_PER);
          $('#ipStatsCount').textContent = `共 ${total} 个独立 IP${rawIpList.length !== total ? ' (从 ' + rawIpList.length + ' 个过滤)' : ''}`;

          if (!curSlice.length) {
            wrap.innerHTML = '<p class="hint" style="padding:24px 0;text-align:center">暂无匹配的 IP 记录</p>';
            return;
          }

          const rowsHtml = curSlice.map((it) => `
            <tr class="adm-ip-row" data-ip="${esc(it.ip)}" style="cursor:pointer" title="点击查看该 IP 详细访问轨迹">
              <td style="white-space:nowrap"><b style="font-family:monospace;color:var(--txt);font-size:13px">${esc(it.ip)}</b></td>
              <td><div style="white-space:normal;line-height:1.45;word-break:break-word">${esc(it.geo || '未知地区')}</div></td>
              <td style="white-space:nowrap">${it.u ? `<span class="badge ok">👤 ${esc(it.u)}</span>` : '<span class="badge dim">游客</span>'}</td>
              <td><div style="white-space:normal;line-height:1.4;color:var(--dim);word-break:break-word"><small>${esc(it.device || '标准浏览器')}</small></div></td>
              <td style="text-align:center;white-space:nowrap"><b>${it.count}</b> 次</td>
              <td style="text-align:center;white-space:nowrap"><span style="color:var(--theme-dot);font-weight:700">${fmtWatchSec(it.duration)}</span></td>
              <td><div style="white-space:normal;line-height:1.45;word-break:break-word" title="${esc(it.latestTitle || it.latestPath || '—')}">${esc(it.latestTitle || it.latestPath || '—')}</div></td>
              <td style="white-space:nowrap"><small style="color:var(--dim);font-family:monospace">${fmtDateTime(it.lastTs)}</small></td>
              <td style="text-align:center;white-space:nowrap">
                <button type="button" class="btn primary small view-ip-btn" data-ip="${esc(it.ip)}" style="padding:4px 10px;font-size:12px;white-space:nowrap">🔍 查看轨迹</button>
              </td>
            </tr>`).join('');

          wrap.innerHTML = `
            <table class="adm-table" style="width:100%;table-layout:auto">
              <thead>
                <tr>
                  <th style="width:130px;white-space:nowrap">访客 IP</th>
                  <th style="min-width:180px;max-width:280px">IP归属地 / 运营商</th>
                  <th style="width:95px;white-space:nowrap">用户名</th>
                  <th style="min-width:120px;max-width:180px">访问设备</th>
                  <th style="width:80px;text-align:center;white-space:nowrap">访问次数</th>
                  <th style="width:105px;text-align:center;white-space:nowrap">累计停留时长</th>
                  <th style="min-width:160px;max-width:260px">最近浏览内容</th>
                  <th style="width:140px;white-space:nowrap">最近访问时间</th>
                  <th style="width:115px;text-align:center;white-space:nowrap">操作</th>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
            </table>
            ${total > IP_PER ? `
              <div class="pager" style="display:flex;gap:12px;align-items:center;justify-content:center;margin-top:14px">
                <button class="btn ghost small" id="stIpPrev" ${ipPg <= 0 ? 'disabled' : ''}>‹ 上一页</button>
                <span style="color:var(--dim);font-size:12.5px">第 ${ipPg + 1} / ${pages} 页 · 共 ${total} 个独立 IP</span>
                <button class="btn ghost small" id="stIpNext" ${ipPg >= pages - 1 ? 'disabled' : ''}>下一页 ›</button>
              </div>` : ''}`;

          $('#stIpPrev') && $('#stIpPrev').addEventListener('click', () => { ipPg--; renderIpTablePage(); });
          $('#stIpNext') && $('#stIpNext').addEventListener('click', () => { ipPg++; renderIpTablePage(); });

          // 绑定点击事件，打开深钻弹窗
          $$('.adm-ip-row', wrap).forEach((tr) => {
            tr.addEventListener('click', (e) => {
              const ip = tr.dataset.ip;
              const found = rawIpList.find((x) => x.ip === ip);
              if (found) showIpDetailModal(found);
            });
          });
        }

        function applyIpFilter() {
          const filterVal = String($('#ipFilterInput') ? $('#ipFilterInput').value : '').trim().toLowerCase();
          if (!filterVal) {
            filteredIpList = rawIpList.slice();
          } else {
            filteredIpList = rawIpList.filter((it) => {
              const str = [it.ip, it.geo, it.u, it.device, it.latestTitle, it.latestPath].join(' ').toLowerCase();
              return str.includes(filterVal);
            });
          }
          ipPg = 0;
          renderIpTablePage();
        }

        async function loadStats(hoursOverride) {
          const h = (hoursOverride !== undefined && hoursOverride !== null)
            ? Number(hoursOverride)
            : Number($('#statsHoursSel') ? $('#statsHoursSel').value : defaultHours);

          try {
            const d = await API.adminStats(h);
            $('#stPvToday').textContent = d.pvToday || 0;
            $('#stPvTotal').textContent = d.pvTotal || 0;
            $('#stUniq').textContent = d.uniqIp || 0;
            $('#stSearch').textContent = d.searches || 0;
            $('#stTotalLogs').textContent = d.totalLogs || 0;

            const maxN = Math.max(1, ...(d.byPath || []).map((x) => x.n));
            $('#statPaths').innerHTML = (d.byPath || []).map((p) => `
              <div class="stat-path-row">
                <span class="sp-k" title="${esc(p.k)}">${esc(p.k)}</span>
                <div class="sp-bar"><i style="width:${Math.round((p.n / maxN) * 100)}%"></i></div>
                <b>${p.n}</b>
              </div>`).join('') || '<p class="hint" style="margin-top:8px">暂无页面访问数据</p>';

            rawIpList = d.ipList || [];
            applyIpFilter();
          } catch (e) {
            toast('获取统计数据失败: ' + e.message, 'err');
          }
        }

        $('#statsHoursSel').addEventListener('change', () => {
          loadStats(Number($('#statsHoursSel').value));
        });

        $('#saveRetentionBtn').addEventListener('click', async () => {
          const h = Number($('#statsHoursSel').value);
          try {
            await API.adminSaveSettings({ statsRetentionHours: h });
            if (lastSettings) lastSettings.statsRetentionHours = h;
            s.statsRetentionHours = h;
            State.settings = Object.assign({}, State.settings, { statsRetentionHours: h });
            const label = h === 0 ? '全部历史记录' : (h >= 24 ? (h / 24 + ' 天') : (h + ' 小时'));
            toast('已将数据保留周期设为【' + label + '】，系统将按此周期自动清理过期记录', 'ok');
          } catch (e) {
            toast('保存失败: ' + e.message, 'err');
          }
        });

        $('#ipFilterInput').addEventListener('input', applyIpFilter);
        $('#refreshStatsBtn').addEventListener('click', () => loadStats());
        $('#clearStatsBtn').addEventListener('click', async () => {
          if (!confirm('确定清空全部统计数据？不可恢复。')) return;
          try {
            await API.adminClearStats();
            toast('统计数据已清空', 'ok');
            loadStats();
          } catch (e) {
            toast('清空失败: ' + e.message, 'err');
          }
        });

        loadStats(defaultHours);
      }

      /* ---------------- 👥 用户管理 ---------------- */
      else if (admTab === 'users') {
        main.innerHTML = `
          <div class="admin-card">
            <h3>👥 用户管理</h3>
            <div class="admin-row">
              <div class="admin-label">强制登录观看<small>开启后游客可先试看（时长见下行），到期弹出注册框；关闭 = 完全免登录自由观看</small></div>
              <label class="switch"><input type="checkbox" id="requireLoginSwitch" ${s.requireLogin !== false ? 'checked' : ''}><span class="track"></span></label>
            </div>
            <div class="admin-row">
              <div class="admin-label">开放前台注册<small>关闭后新用户无法自行注册</small></div>
              <label class="switch"><input type="checkbox" id="allowRegisterSwitch" ${s.allowRegister !== false ? 'checked' : ''}><span class="track"></span></label>
            </div>
            <div class="admin-row">
              <div class="admin-label">新会员注册自动赠送福利<small>新用户注册自动赠送私密福利影片特权（0~3个月），并自动发送使用说明站内信</small></div>
              <div style="display:flex;gap:8px;align-items:center;flex-shrink:0">
                <select class="field-input" id="regGiftMonthsSelect" style="width:130px">
                  <option value="0" ${Number(s.regGiftAdultMonths || 0) === 0 ? 'selected' : ''}>不赠送</option>
                  <option value="1" ${Number(s.regGiftAdultMonths === undefined ? 1 : s.regGiftAdultMonths) === 1 ? 'selected' : ''}>赠送 1 个月</option>
                  <option value="2" ${Number(s.regGiftAdultMonths || 0) === 2 ? 'selected' : ''}>赠送 2 个月</option>
                  <option value="3" ${Number(s.regGiftAdultMonths || 0) === 3 ? 'selected' : ''}>赠送 3 个月</option>
                </select>
                <button class="btn primary small" id="saveRegGiftBtn">保存</button>
              </div>
            </div>
            <div class="admin-row" id="trialRow">
              <div class="admin-label">游客试看时长<small>新 IP / 新设备 / 新访客无需注册即可试看 <b id="trialHintMin">${Number(s.trialMinutes === undefined ? 20 : s.trialMinutes)}</b> 分钟，到期自动弹出注册框；填 <b>0</b> = 不提供试看（立即要求登录）。<b id="trialDepHint" style="color:${s.requireLogin !== false ? 'var(--ok)' : 'var(--danger)'}">${s.requireLogin !== false ? '✔ 已生效（强制登录观看开启中）' : '⚠ 未生效：请先开启上方「强制登录观看」'}</b></small></div>
              <div style="display:flex;gap:8px;align-items:center;flex-shrink:0">
                <input class="field-input" id="trialMinInput" type="number" min="0" max="2880" step="1" style="width:92px;text-align:center" value="${Number(s.trialMinutes === undefined ? 20 : s.trialMinutes)}">
                <span style="color:var(--dim);font-size:12.5px">分钟</span>
                <button class="btn primary small" id="saveTrialBtn">保存</button>
              </div>
            </div>
            <p class="hint">查看每个用户的注册时间、最近登录 IP、搜索与观看记录（<b>包含用户已删除的记录</b>，灰色标记）。</p>
            <div style="margin-top:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
              <button class="btn primary small" id="loadUsersBtn">🔄 刷新用户列表</button>
              <span style="color:var(--dim);font-size:12px" id="usersStat"></span>
            </div>
            <div id="usersTable" class="table-scroll" style="margin-top:10px"></div>
            <div id="userLogDetail" style="margin-top:14px"></div>
          </div>

          <!-- 📢 全网站内消息广播推送 (全员直达) -->
          <div class="admin-card" style="margin-top:16px">
            <h3>📢 全网站内消息广播推送 (全员推送)</h3>
            <p class="hint">
              向全站所有已注册的会员批量发送站内消息。用户登录后将在「消息」选项卡和底部导航收到红点与未读提醒。<br>
              注：新用户注册时的「自动赠送福利欢迎信」依然<b>全自动触发必发</b>，不受此广播功能影响。
            </p>
            <div style="margin-top:12px;display:flex;flex-direction:column;gap:12px">
              <div>
                <label class="field-label">📢 广播消息标题 <span style="color:var(--danger)">*</span></label>
                <input class="field-input" id="broadcastTitleInput" placeholder="例如：【系统公告】4K超清福利新源上线 / 周末观影特权升级" maxlength="60">
              </div>
              <div>
                <label class="field-label">📝 广播正文内容 <span style="color:var(--danger)">*</span></label>
                <textarea class="field-input" id="broadcastContentInput" rows="4" placeholder="在此输入要向全站所有会员广播的消息正文...&#10;支持换行排版与表情符号"></textarea>
              </div>
              <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:12px">
                <div>
                  <label class="field-label">🔗 动作按钮文字 (选填)</label>
                  <input class="field-input" id="broadcastActionTextInput" placeholder="例如：立即前往体验 / 了解详情">
                </div>
                <div>
                  <label class="field-label">🌐 动作跳转链接 (选填，站内 hash 或外部链接)</label>
                  <input class="field-input" id="broadcastActionUrlInput" placeholder="例如：#/adult 或 #/download">
                </div>
              </div>
              <div style="display:flex;gap:10px;align-items:center;margin-top:4px;flex-wrap:wrap">
                <button class="btn primary" id="sendBroadcastBtn" style="background:linear-gradient(135deg,#e11d48,#be123c);font-weight:700">
                  🚀 立即向全网会员广播推送
                </button>
                <button class="btn ghost" id="refreshBroadcastHistoryBtn">🔄 刷新广播历史</button>
              </div>
            </div>

            <!-- 历史广播记录 -->
            <div style="margin-top:16px;border-top:1px dashed var(--card-br);padding-top:12px">
              <h4 style="font-size:13.5px;color:var(--dim);margin-bottom:8px">📋 近期广播推送记录</h4>
              <div id="broadcastHistoryList" style="font-size:12.5px;color:var(--dim)">加载中…</div>
            </div>
          </div>`;
        $('#requireLoginSwitch').addEventListener('change', async (e) => {
          const on = e.target.checked;
          try {
            await API.adminSaveSettings({ requireLogin: on });
            State.settings = Object.assign({}, State.settings, { requireLogin: on });
            syncTrialDep(on);
            toast(on ? '已开启：游客试看后需注册' : '已关闭：所有人免登录自由观看（试看机制停用）', on ? 'ok' : 'err');
          } catch (err) { e.target.checked = !on; toast('保存失败：' + err.message, 'err'); }
        });
        function syncTrialDep(on) {
          const row = $('#trialRow');
          const dep = $('#trialDepHint');
          if (!row) return;
          row.style.opacity = on ? '' : '.55';
          if (dep) {
            dep.textContent = on ? '✔ 已生效（强制登录观看开启中）' : '⚠ 未生效：请先开启上方「强制登录观看」';
            dep.style.color = on ? 'var(--ok)' : 'var(--danger)';
          }
        }
        $('#allowRegisterSwitch').addEventListener('change', async (e) => {
          const on = e.target.checked;
          try {
            await API.adminSaveSettings({ allowRegister: on });
            State.settings = Object.assign({}, State.settings, { allowRegister: on });
            toast(on ? '已开放注册' : '已关闭注册', 'ok');
          } catch (err) { e.target.checked = !on; toast('保存失败：' + err.message, 'err'); }
        });
        $('#saveRegGiftBtn').addEventListener('click', async () => {
          const m = Number($('#regGiftMonthsSelect').value);
          try {
            await API.adminSaveSettings({ regGiftAdultMonths: m });
            s.regGiftAdultMonths = m;
            State.settings = Object.assign({}, State.settings, { regGiftAdultMonths: m });
            toast(`新注册赠送特权设置已保存：${m === 0 ? '不赠送' : '赠送 ' + m + ' 个月'}`, 'ok');
          } catch (err) { toast('保存失败：' + err.message, 'err'); }
        });
        $('#saveTrialBtn').addEventListener('click', async () => {
          const n = Math.round(Number($('#trialMinInput').value));
          if (!isFinite(n) || n < 0 || n > 2880) return toast('试看时长需为 0-2880 的整数分钟', 'err');
          try {
            await API.adminSaveSettings({ trialMinutes: n });
            const hint = $('#trialHintMin');
            if (hint) hint.textContent = n;
            State.settings = Object.assign({}, State.settings, { trialMinutes: n });
            toast(`游客试看时长已保存：${n === 0 ? '立即要求登录' : n + ' 分钟'}`, 'ok');
          } catch (err) { toast('保存失败：' + err.message, 'err'); }
        });
        async function showUserLog(u) {
          const box = $('#userLogDetail');
          box.innerHTML = '<p class="hint">加载中…</p>';
          try {
            const d = await API.adminUserLog(u);
            const rows = d.items.map((it) => `
              <div class="ulog-row ${it.delUser ? 'del' : ''}">
                <span class="ulog-kind">${it.kind === 'search' ? '🔍' : '▶️'}</span>
                <span class="ulog-title" title="${esc(it.title)}">${esc(it.title)}${it.kind === 'watch' && it.ep ? ' <small>· ' + esc(it.ep) + '</small>' : ''}</span>
                ${it.kind === 'watch' ? `<span class="ulog-meta">${fmtWatchSec(it.t)}</span>` : ''}
                <span class="ulog-meta">${fmtDateTime(it.ts)}</span>
                <span class="ulog-meta">${esc(it.ip || '—')}${it.geo ? '<br>' + esc(it.geo) : ''}</span>
                ${it.delUser ? '<span class="ulog-tag">用户已删</span>' : ''}
                <button class="hist-del row-del" data-id="${esc(it.id)}" title="彻底删除">×</button>
              </div>`).join('');
            box.innerHTML = `
              <div class="userlog-box">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
                  <h4 style="font-size:14.5px">📋 「${esc(d.username)}」的完整记录（${d.items.length} 条 · 累计观看 ${fmtWatchSec(d.watchSec)}）</h4>
                  <div style="display:flex;gap:8px">
                    <button class="btn danger small" id="hardClearAll">🗑 彻底清空全部记录</button>
                    <button class="btn ghost small" id="closeUserLog">收起</button>
                  </div>
                </div>
                <p class="hint">注册 ${fmtDateTime(d.createdAt)} · 最近登录 ${fmtDateTime(d.lastLoginAt)} · IP ${esc(d.lastLoginIp || '—')}${d.lastLoginIpGeo ? '（' + esc(d.lastLoginIpGeo) + '）' : ''} · 灰色行 = 用户已自行删除</p>
                <div style="margin-top:8px">${rows || '<p class="hint">暂无记录</p>'}</div>
              </div>`;
            $('#closeUserLog').addEventListener('click', () => { box.innerHTML = ''; });
            $('#hardClearAll').addEventListener('click', async () => {
              if (!confirm(`彻底删除「${u}」的全部记录？不可恢复！`)) return;
              await API.adminDeleteUserLog(u, null, true);
              toast('已彻底清空', 'ok');
              showUserLog(u);
            });
            $$('#userLogDetail .row-del').forEach((b) => b.addEventListener('click', async () => {
              if (!confirm('彻底删除该条记录？')) return;
              await API.adminDeleteUserLog(u, [b.dataset.id], false);
              toast('已删除', 'ok');
              showUserLog(u);
            }));
          } catch (e) { box.innerHTML = `<p class="hint">加载失败：${esc(e.message)}</p>`; }
        }
        async function loadUsers() {
          const table = $('#usersTable'), stat = $('#usersStat');
          try {
            const r = await API.adminUsers();
            stat.textContent = `共 ${r.users.length} 个注册用户`;
            table.innerHTML = r.users.length ? `
              <table class="adm-table" style="min-width:960px">
                <thead><tr><th>用户</th><th>注册时间</th><th>最近登录</th><th>登录IP / 归属地</th><th style="text-align:center">私密福利</th><th>累计观看</th><th>有效/总记录</th><th style="text-align:right">操作</th></tr></thead>
                <tbody>${r.users.map((u) => `
                  <tr>
                    <td>${esc(u.username)}</td>
                    <td>${fmtDateTime(u.createdAt)}</td>
                    <td>${fmtDateTime(u.lastLoginAt)}</td>
                    <td>${esc(u.lastLoginIp || '—')}${u.lastLoginIpGeo ? '<br><small style="color:var(--dim)">' + esc(u.lastLoginIpGeo) + '</small>' : ''}</td>
                    <td title="需全局「成人内容」开关开启生效；绿色=已解锁播放，灰色=未解锁(仅预览)"><button type="button" class="u-adult-tag ${u.adultAllowed ? 'on' : 'off'}" data-u="${esc(u.username)}">${u.adultAllowed ? ('已解锁' + (u.adultExpireAt ? `<br><small style="font-size:11px;opacity:.85">至 ${fmtDateTime(u.adultExpireAt).slice(0, 10)}</small>` : '')) : '未解锁'}</button></td>
                    <td>${fmtWatchSec(u.watchSec)}</td>
                    <td>${u.activeItems}/${u.totalItems}</td>
                    <td style="white-space:nowrap;text-align:right">
                      <button class="btn ghost small u-log" data-u="${esc(u.username)}">📋 记录</button>
                      <button class="btn danger small u-del" data-u="${esc(u.username)}">🗑 删户</button>
                    </td>
                  </tr>`).join('')}</tbody>
              </table>` : '<p class="hint">暂无注册用户（开放注册后，前台 #/login 可注册）</p>';
            $$('#usersTable .u-log').forEach((b) => b.addEventListener('click', () => showUserLog(b.dataset.u)));
            $$('#usersTable .u-adult-tag').forEach((el) => el.addEventListener('click', async () => {
              const to = el.classList.contains('off');
              el.disabled = true;
              try {
                await API.adminUserAdult(el.dataset.u, to);
                el.classList.toggle('on', to);
                el.classList.toggle('off', !to);
                el.textContent = to ? '已解锁' : '未解锁';
                toast(to ? `已为「${el.dataset.u}」开通私密福利播放权限` : `已将「${el.dataset.u}」设为未解锁预览模式`, 'ok');
              } catch (e) { toast('操作失败：' + e.message, 'err'); }
              el.disabled = false;
            }));
            $$('#usersTable .u-del').forEach((b) => b.addEventListener('click', async () => {
              if (!confirm(`确定删除用户「${b.dataset.u}」及其全部数据？不可恢复！`)) return;
              await API.adminDeleteUser(b.dataset.u);
              toast('用户已删除', 'ok');
              loadUsers();
            }));
          } catch (e) {
            stat.textContent = '';
            table.innerHTML = `<p class="hint">用户列表加载失败：${esc(e.message)}（本地需绑定 KV 才能使用用户系统）</p>`;
          }
        }
        $('#loadUsersBtn').addEventListener('click', loadUsers);
        loadUsers();

        async function loadBroadcastHistory() {
          const el = $('#broadcastHistoryList');
          if (!el) return;
          try {
            const res = await API.adminBroadcastHistory();
            const list = (res && res.history) || [];
            if (!list.length) {
              el.innerHTML = '<span class="hint">暂无全网广播推送记录</span>';
              return;
            }
            el.innerHTML = list.map((b) => `
              <div style="padding:10px 12px;margin-bottom:8px;border-radius:8px;background:rgba(255,255,255,.03);border:1px solid var(--card-br)">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
                  <b style="color:var(--txt)">${esc(b.title)}</b>
                  <time style="font-size:11.5px;color:var(--dim)">${fmtDateTime(b.createdAt)} · 成功推送 ${b.recipientCount || 0} 人</time>
                </div>
                <div style="margin-top:4px;color:var(--dim);font-size:12px;white-space:pre-wrap;line-height:1.5">${esc(b.content)}</div>
                ${b.actionText ? `<div style="margin-top:6px;font-size:11.5px"><span class="chip on">${esc(b.actionText)} ➔ ${esc(b.actionUrl || '')}</span></div>` : ''}
              </div>
            `).join('');
          } catch (e) {
            el.innerHTML = `<span class="hint" style="color:var(--danger)">加载历史失败：${esc(e.message)}</span>`;
          }
        }

        $('#refreshBroadcastHistoryBtn') && $('#refreshBroadcastHistoryBtn').addEventListener('click', loadBroadcastHistory);

        $('#sendBroadcastBtn') && $('#sendBroadcastBtn').addEventListener('click', async () => {
          const title = ($('#broadcastTitleInput').value || '').trim();
          const content = ($('#broadcastContentInput').value || '').trim();
          const actionText = ($('#broadcastActionTextInput').value || '').trim();
          const actionUrl = ($('#broadcastActionUrlInput').value || '').trim();

          if (!title) return toast('请输入广播消息标题', 'err');
          if (!content) return toast('请输入广播正文内容', 'err');

          if (!confirm(`确认向全站所有已注册会员推送此广播？\n\n标题：${title}\n\n该操作不可撤回！`)) return;

          const btn = $('#sendBroadcastBtn');
          btn.disabled = true;
          btn.textContent = '⏳ 正在群发推送中…';
          try {
            const res = await API.adminBroadcastMessage(title, content, actionText, actionUrl);
            if (res.ok) {
              toast(`🎉 全网广播推送成功！共推送至 ${res.sentCount || 0} 位会员`, 'ok');
              $('#broadcastTitleInput').value = '';
              $('#broadcastContentInput').value = '';
              $('#broadcastActionTextInput').value = '';
              $('#broadcastActionUrlInput').value = '';
              loadBroadcastHistory();
            } else {
              toast('推送失败：' + (res.error || '未知错误'), 'err');
            }
          } catch (e) {
            toast('推送请求失败：' + e.message, 'err');
          } finally {
            btn.disabled = false;
            btn.textContent = '🚀 立即向全网会员广播推送';
          }
        });

        loadBroadcastHistory();
      }

      /* ---------------- 📡 采集源配置 ---------------- */
      else if (admTab === 'cfg') {
        main.innerHTML = `
          <div class="admin-card">
            <h3>📡 采集源配置（支持多个）</h3>
            <p class="hint">每行一个配置地址，可添加多个，<b>按行顺序合并</b>（前面的源优先、后面的只补缺）。留空恢复默认 LunaTV-config。也可以粘贴 <code>{</code> 开头的 JSON 直接作为唯一来源。</p>
            <label class="field-label">当前生效：${s.configFrom === 'inline-json' ? '后台内联 JSON' : s.configFrom === 'multi-url' ? `多地址合并（${(s.effectiveConfigUrls || []).length} 个）` : '默认 LunaTV-config'}</label>
            <textarea class="field-input" id="cfgUrlsInput" rows="7" placeholder="https://config1.example/xxx.json&#10;https://config2.example/yyy.json">${esc((s.effectiveConfigUrls || []).join('\n'))}</textarea>
            <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">
              <button class="btn primary" id="saveCfgBtn">保存采集源配置</button>
              <button class="btn ghost" id="resetCfgBtn">清空并恢复默认(LunaTV-config)</button>
            </div>
          </div>`;
        $('#saveCfgBtn').addEventListener('click', async () => {
          const raw = $('#cfgUrlsInput').value.trim();
          if (raw.startsWith('{')) {
            try { JSON.parse(raw); } catch (e) { return toast('JSON 格式有误：' + e.message, 'err'); }
            try {
              await API.adminSaveSettings({ configUrl: raw });
              State.config = await API.getConfig();
              toast(`内联 JSON 已保存：当前 ${State.config.count} 个源可用`, 'ok');
              renderPanel();
            } catch (err) { toast('保存失败：' + err.message, 'err'); }
            return;
          }
          const lines = raw.split(/\r?\n/).map((x) => x.trim()).filter((x) => /^https?:\/\//i.test(x));
          if (raw && !lines.length) return toast('每行需为 http(s) 配置地址', 'err');
          try {
            await API.adminSaveSettings({ configUrls: lines });
            State.config = await API.getConfig();
            toast(`已保存 ${lines.length} 个采集源：合并后 ${State.config.count} 个源可用`, 'ok');
            renderPanel();
          } catch (err) { toast('保存失败：' + err.message, 'err'); }
        });
        $('#resetCfgBtn').addEventListener('click', async () => {
          try {
            await API.adminSaveSettings({ configUrl: '' });
            State.config = await API.getConfig();
            toast('已清空并恢复默认采集源配置', 'ok');
            renderPanel();
          } catch (err) { toast('操作失败：' + err.message, 'err'); }
        });
      }

      /* ---------------- 📺 TVBox / 影视仓（只读固定链接） ---------------- */
      else if (admTab === 'tvbox') {
        const tvboxBase = location.origin + '/api/tvbox.json';
        const lunaBase = location.origin + '/api/tvbox/lunatv.json';
        main.innerHTML = `
          <div class="admin-card" id="tvboxCard">
            <h3>📺 TVBox / 影视仓 配置</h3>
            <p class="hint">以下地址由本站<strong>自动固定生成</strong>，不可修改。填入 TVBox、影视仓、蜂蜜影视等 App 的「配置地址 / 接口」即可；源列表与「影视源管理」中已启用的源同步（苹果 CMS V10 · <code>type: 1</code>）。</p>
            <div class="tvbox-fixed-row">
              <div class="admin-label">TVBox 标准格式<small>sites[] · 推荐 · 只读</small></div>
              <code class="tvbox-fixed-url" id="tvboxStdUrl">${esc(tvboxBase)}</code>
              <button class="btn ghost small" id="copyTvboxStd" type="button">📋 复制</button>
            </div>
            <div class="tvbox-fixed-row" style="margin-top:14px">
              <div class="admin-label">LunaTV 格式<small>api_site · 部分分支 · 只读</small></div>
              <code class="tvbox-fixed-url" id="tvboxLunaUrl">${esc(lunaBase)}</code>
              <button class="btn ghost small" id="copyTvboxLuna" type="button">📋 复制</button>
            </div>
            <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap;align-items:center">
              <button class="btn primary small" id="testTvboxBtn" type="button">🔍 检测配置是否正常</button>
              <span id="tvboxStat" style="color:var(--dim);font-size:12.5px"></span>
            </div>
            <pre id="tvboxPreview" class="hint" style="margin-top:12px;max-height:220px;overflow:auto;background:var(--card);padding:10px;border-radius:8px;font-size:11.5px;white-space:pre-wrap;display:none"></pre>
          </div>`;
        const copyUrl = async (text) => {
          try { await navigator.clipboard.writeText(text); toast('已复制', 'ok'); }
          catch (e) { toast('复制失败，请手动全选复制', 'err'); }
        };
        $('#copyTvboxStd') && $('#copyTvboxStd').addEventListener('click', () => copyUrl(tvboxBase));
        $('#copyTvboxLuna') && $('#copyTvboxLuna').addEventListener('click', () => copyUrl(lunaBase));
        $('#testTvboxBtn') && $('#testTvboxBtn').addEventListener('click', async () => {
          const stat = $('#tvboxStat');
          const pre = $('#tvboxPreview');
          if (stat) stat.innerHTML = '<span class="spin"></span> 检测中…';
          if (pre) { pre.style.display = 'none'; pre.textContent = ''; }
          try {
            const r = await API.adminTvboxCheck();
            if (stat) {
              stat.innerHTML = r.siteCount
                ? `${r.ok ? '✅' : '⚠️'} ${r.siteCount} 个点播源 · ${r.liveCount} 个直播${r.badCount ? ' · ' + r.badCount + ' 个源 api 无效' : ''}${r.probe ? (r.probe.ok ? ' · 首个源「' + esc(r.probe.name) + '」接口正常' : ' · 首个源探测: ' + esc(r.probe.msg || '失败')) : ''}`
                : '⚠️ 暂无可用源，请先在「影视源管理」启用源';
            }
            if (pre) {
              pre.style.display = 'block';
              pre.textContent = JSON.stringify({ sample: r.sample, probe: r.probe, tvboxUrl: r.tvboxUrl }, null, 2)
                + (r.siteCount > 3 ? '\n… 共 ' + r.siteCount + ' 个源' : '');
            }
            toast(r.ok && (!r.probe || r.probe.ok) ? 'TVBox 配置检测通过' : '请查看检测结果', r.ok ? 'ok' : 'err');
          } catch (err) {
            if (stat) stat.textContent = '❌ 检测失败：' + err.message;
            toast('检测失败：' + err.message, 'err');
          }
        });
      }

      /* ---------------- 🧩 影视源管理 ---------------- */
      else if (admTab === 'sources') {
        main.innerHTML = `
          <div class="admin-card">
            <h3>🧩 影视源管理 <small style="color:var(--dim);font-weight:400;font-size:12px">内置 ${(s.allSources || []).filter((x) => !x.custom).length} 个 · 自定义 ${(s.customSources || []).length} 个</small></h3>
            <p class="hint">内置源每日同步自 LunaTV-config，可临时<b>停用/启用</b>；自定义源可自由添加（填苹果CMS V10 的 <code>api.php/provide/vod</code> 接口地址），保存后立即全站生效。</p>
            <div style="display:flex;gap:10px;margin:12px 0">
              <button class="btn primary small" id="addSrcBtn">＋ 添加影视源</button>
              <button class="btn ghost small" id="saveSourcesBtn">💾 保存影视源设置</button>
              <span style="align-self:center;color:var(--dim);font-size:12px" id="srcCountInfo"></span>
            </div>
            <div class="src-edit-head src-edit-row" style="border-bottom:1px solid var(--card-br)">
              <span style="font-size:11.5px;color:var(--dim)">启用</span>
              <span style="font-size:11.5px;color:var(--dim)">名称</span>
              <span style="font-size:11.5px;color:var(--dim)">接口地址 API</span>
              <span style="font-size:11.5px;color:var(--dim)">详情页(选填)</span>
              <span></span>
            </div>
            <div id="srcEditor"></div>
            <div class="pager" id="srcPager" style="display:flex;gap:10px;align-items:center;justify-content:center;margin-top:12px"></div>
          </div>
          <div class="admin-card">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
              <h3 style="margin:0">📺 电视直播源</h3>
              <button class="btn ghost small" id="resetLiveBtn" type="button" title="填入推荐的高可用直播源">恢复推荐高质量直播源</button>
            </div>
            <p class="hint" style="margin-top:6px">每行一个 m3u 直播源地址，保存后全站生效。支持普通 HTTP 直播流（系统已内置 HTTPS 代理网关自动转接，无惧 Mixed Content 拦截）。推荐源：<br>
              <code>https://live.zbds.top/tv/iptv4.m3u</code>（全量央视/卫视/地方，含 HTTPS 高清台标）<br>
              <code>https://iptv-org.github.io/iptv/countries/cn.m3u</code>（iptv-org 国际公开源）</p>
            <textarea class="field-area" id="liveInput" style="min-height:110px;font-family:monospace;font-size:12px">${esc((s.liveSources || []).join('\n'))}</textarea>
            <button class="btn primary" id="saveLiveBtn" style="margin-top:14px">保存直播源</button>
          </div>`;
        const customRows = (s.customSources || []).map((x) => Object.assign({}, x));
        const disabledSet = new Set(s.disabledSources || []);
        const builtins = (s.allSources || []).filter((x) => !x.custom);
        const editor = $('#srcEditor');
        function updateCountInfo() {
          const info = $('#srcCountInfo');
          if (info) info.textContent = `内置 ${builtins.length} 个（停用 ${[...disabledSet].filter((k) => !customRows.some((c) => c.key === k)).length}） · 自定义 ${customRows.length} 个`;
        }
        let bpg = 1;
        const BPER = 8;
        function renderEditor() {
          const rowHtml = [];
          const bTotal = Math.max(1, Math.ceil(builtins.length / BPER));
          if (bpg > bTotal) bpg = bTotal;
          for (const b of builtins.slice((bpg - 1) * BPER, bpg * BPER)) {
            const off = disabledSet.has(b.key);
            rowHtml.push(`
              <div class="src-edit-row builtin" data-bk="${esc(b.key)}">
                <input type="checkbox" class="src-en" ${off ? '' : 'checked'} title="启用/停用">
                <span class="ro" title="${esc(cleanSrcName(b))}${b.adult ? ' · 成人源' : ''}">${srcIconHtml(b)} ${esc(cleanSrcName(b))}</span>
                <span class="ro" title="${esc(b.api)}">${esc(b.api)}</span>
                <span class="ro src-edit-col-detail">—</span>
                <span style="font-size:11px;color:var(--dim)">${b.adult ? '🔞内置' : '内置'}</span>
              </div>`);
          }
          customRows.forEach((row, ri) => {
            rowHtml.push(`
              <div class="src-edit-row" data-ri="${ri}">
                <input type="checkbox" class="src-en" ${disabledSet.has(row.key) ? '' : 'checked'}>
                <input type="text" class="src-name" value="${esc(row.name || '')}" placeholder="名称">
                <input type="text" class="src-api" value="${esc(row.api || '')}" placeholder="https://xxx/api.php/provide/vod">
                <input type="text" class="src-detail src-edit-col-detail" value="${esc(row.detail || '')}" placeholder="选填">
                <button class="btn danger small src-del" type="button">删除</button>
              </div>`);
          });
          editor.innerHTML = rowHtml.join('');
          const pager = $('#srcPager');
          if (pager) {
            pager.innerHTML = builtins.length > BPER ? `
              <button class="btn ghost small" id="bPrev" ${bpg <= 1 ? 'disabled' : ''}>‹ 上一页</button>
              <span style="color:var(--dim);font-size:12px">内置源第 ${bpg}/${bTotal} 页 · 共 ${builtins.length} 个</span>
              <button class="btn ghost small" id="bNext" ${bpg >= bTotal ? 'disabled' : ''}>下一页 ›</button>` : '';
            const pv = $('#bPrev'), nx = $('#bNext');
            pv && pv.addEventListener('click', () => { bpg--; renderEditor(); });
            nx && nx.addEventListener('click', () => { bpg++; renderEditor(); });
          }
          $$('.src-edit-row', editor).forEach((tr) => {
            const en = $('.src-en', tr);
            en.addEventListener('change', () => {
              const bk = tr.dataset.bk;
              if (bk != null) { off2set(disabledSet, bk, !en.checked); }
              else {
                const row = customRows[Number(tr.dataset.ri)];
                row._enabled = en.checked;
              }
              updateCountInfo();
            });
            const del = $('.src-del', tr);
            del && del.addEventListener('click', () => {
              const row = customRows[Number(tr.dataset.ri)];
              if (row.key) disabledSet.delete(row.key);
              customRows.splice(Number(tr.dataset.ri), 1);
              renderEditor();
              updateCountInfo();
            });
          });
        }
        function off2set(set, key, off) { if (off) set.add(key); else set.delete(key); }
        $('#addSrcBtn').addEventListener('click', () => {
          customRows.push({ key: '', name: '', api: '', detail: '', _enabled: true });
          renderEditor();
          updateCountInfo();
          editor.lastElementChild && editor.lastElementChild.scrollIntoView({ block: 'center', behavior: 'smooth' });
        });
        $('#saveSourcesBtn').addEventListener('click', async () => {
          const rows = $$('.src-edit-row:not(.builtin)', editor);
          const cleaned = [];
          for (const tr of rows) {
            const name = $('.src-name', tr).value.trim();
            const api = $('.src-api', tr).value.trim();
            const detail = $('.src-detail', tr).value.trim();
            const enabled = $('.src-en', tr).checked;
            if (!api) continue;
            let host = '';
            try { host = new URL(api).hostname.toLowerCase(); } catch (e) { toast('接口地址无效：' + name, 'err'); return; }
            cleaned.push({ key: host, name: name || host, api, detail, _enabled: enabled });
          }
          const seenKeys = new Set();
          const finalCustom = [];
          for (const c of cleaned) {
            let k = c.key; let n = 1;
            while (seenKeys.has(k)) k = c.key + '-' + (++n);
            seenKeys.add(k);
            finalCustom.push({ key: k, name: c.name, api: c.api, detail: c.detail });
            if (!c._enabled) disabledSet.add(k); else disabledSet.delete(k);
          }
          try {
            await API.adminSaveSources(finalCustom, [...disabledSet]);
            State.config = await API.getConfig();
            toast(`影视源设置已保存：${finalCustom.length} 个自定义源生效`, 'ok');
            renderPanel();
          } catch (err) { toast('保存失败：' + err.message, 'err'); }
        });
        renderEditor();
        updateCountInfo();
        $('#resetLiveBtn') && $('#resetLiveBtn').addEventListener('click', () => {
          $('#liveInput').value = [
            'https://live.zbds.top/tv/iptv4.m3u',
            'https://iptv-org.github.io/iptv/countries/cn.m3u',
          ].join('\n');
          toast('已填入推荐高质量直播源，请点击「保存直播源」生效', 'ok');
        });
        $('#saveLiveBtn').addEventListener('click', async () => {
          try {
            const urls = $('#liveInput').value.split('\n').map((x) => x.trim()).filter(Boolean);
            const res = await API.adminSaveSettings({ liveSources: urls, liveSourcesAllowEmpty: true });
            if (lastSettings) lastSettings.liveSources = (res.settings && res.settings.liveSources) || urls;
            State.liveCache = null;
            toast('直播源已保存，直播缓存已重置立即生效', 'ok');
          } catch (err) { toast('保存失败：' + err.message, 'err'); }
        });
      }

      /* ---------------- ⚙️ 站点设置 ---------------- */
      else if (admTab === 'site') {
        main.innerHTML = `
          ${buildStorageCardHtml(s)}
          <div class="admin-card adult-toggle-card ${s.adultEnabled ? 'on' : ''}" id="adultCard">
            <div class="admin-row">
              <div class="admin-label">🔞 全局私密福利专区
                <small>开启后，私密福利仅在登录且解锁特权的会员专区可见（常规主站完全隔离纯净）。当前状态：
                  <b id="adultState" style="color:${s.adultEnabled ? 'var(--danger)' : 'var(--ok)'}">${s.adultEnabled ? '已开启' : '已关闭'}</b></small>
              </div>
              <label class="switch red"><input type="checkbox" id="adultSwitch" ${s.adultEnabled ? 'checked' : ''}><span class="track"></span></label>
            </div>
            <div id="adultExtraFields" style="${s.adultEnabled ? '' : 'display:none;'};margin-top:14px;border-top:1px dashed var(--card-br);padding-top:14px">
              <!-- 📱 手机端底部导航私密福利开关 -->
              <div class="admin-row" style="margin-bottom:12px;padding:12px;background:rgba(255,255,255,.03);border-radius:10px;border:1px solid var(--card-br)">
                <div class="admin-label">📱 手机端底部导航栏私密福利入口
                  <small>开启后，手机底部第3项将显示「私密福利」；关闭时，手机底部始终显示标准的「电视直播」。当前状态：
                    <b id="adultBottomNavState" style="color:${s.adultBottomNav ? 'var(--danger)' : 'var(--dim)'}">${s.adultBottomNav ? '已开启' : '已关闭'}</b></small>
                </div>
                <label class="switch"><input type="checkbox" id="adultBottomNavSwitch" ${s.adultBottomNav ? 'checked' : ''}><span class="track"></span></label>
              </div>

              <!-- 👤 未登录游客可见性开关 -->
              <div class="admin-row" style="margin-bottom:14px;padding:12px;background:rgba(255,255,255,.03);border-radius:10px;border:1px solid var(--card-br)">
                <div class="admin-label">👤 允许未登录访客/无痕模式显示入口
                  <small><b>开启</b>：无痕或未登录访客在手机端也能看到「私密福利」入口，点击展示特权介绍并引导注册登录；<b>关闭（严格隐蔽）</b>：未登录游客绝对隐藏。当前：
                    <b id="adultGuestState" style="color:${s.adultGuestVisible ? 'var(--danger)' : 'var(--ok)'}">${s.adultGuestVisible ? '允许游客可见（引导注册）' : '未登录严格隐藏（完全隐蔽）'}</b></small>
                </div>
                <label class="switch"><input type="checkbox" id="adultGuestSwitch" ${s.adultGuestVisible ? 'checked' : ''}><span class="track"></span></label>
              </div>

              <!-- ⏱️ 游客试看时长（分钟） -->
              <div class="admin-row" style="margin-bottom:14px;padding:12px;background:rgba(255,255,255,.03);border-radius:10px;border:1px solid var(--card-br)">
                <div class="admin-label">⏱️ 游客免登录免费试看时长（分钟）
                  <small>设置游客在私密福利专区免登录可试看时长（默认 <b>10</b> 分钟，填 <b>0</b> 表示禁止试看必须登录）。到期后视频将自动暂停并弹出注册/登录引导窗口。<br>当前：<b id="adultTrialHintMin" style="color:var(--ok)">${Number(s.adultTrialMinutes === undefined ? 10 : s.adultTrialMinutes)} 分钟</b></small>
                </div>
                <input class="field-input" id="adultTrialMinInput" type="number" min="0" max="1440" step="1" style="width:92px;text-align:center" value="${Number(s.adultTrialMinutes === undefined ? 10 : s.adultTrialMinutes)}">
              </div>

              <label class="field-label">私密福利激活码 / 卡密（支持多个，逗号分隔，如：VIP888, VIP999）</label>
              <input class="field-input" id="adultUnlockCodeInput" value="${esc(s.adultUnlockCode || 'VIP888')}" placeholder="VIP888">
              <label class="field-label" style="margin-top:10px">付费解锁 / 赞助客服说明文案</label>
              <textarea class="field-area" id="adultPayDescInput" style="min-height:60px">${esc(s.adultPayDesc || '')}</textarea>
              <label class="field-label" style="margin-top:10px">收款二维码 / 客服微信图片 URL（留空则不显示）</label>
              <input class="field-input" id="adultPayQrInput" value="${esc(s.adultPayQr || '')}" placeholder="https://example.com/pay-qr.png">
              <button class="btn primary small" id="saveAdultConfigBtn" style="margin-top:12px">保存私密福利配置</button>
            </div>
            <p class="hint" style="margin-top:10px">⚠️ 网站常规页面（首页、分类、搜索、源列表）不会出现任何 18+ 源；未登录访客无论手机端或电脑端均绝无入口和内容泄露。</p>
          </div>
          <div class="admin-card">
            <h3>🎨 站点设置</h3>
            <label class="field-label">站点主标题</label>
            <input class="field-input" id="siteNameInput" value="${esc(s.siteName)}" maxlength="40">
            <label class="field-label" style="margin-top:10px">网站副标题 / Slogan（展示在网站标题与首页）</label>
            <input class="field-input" id="siteSloganInput" value="${esc(s.siteSlogan || '')}" placeholder="海量高清 · 聚合秒播 · 极简私人影院" maxlength="100">
            <label class="field-label" style="margin-top:10px">默认配色主题（新访客首次进入时生效）</label>
            <select class="field-input" id="themeSelect">
              ${THEME_META.map((t) => `<option value="${t.id}" ${s.defaultTheme === t.id ? 'selected' : ''}>${t.name}</option>`).join('')}
            </select>
            <label class="field-label" style="margin-top:12px">网站版式（UI 皮肤切换 · 仅管理员可设）</label>
            <select class="field-input" id="uiLayoutSelect">
              <option value="modern" ${s.uiLayout !== 'classic' ? 'selected' : ''}>✨ 流光旗舰版 UI（全新双栏巨幕 + TOP10热榜 · 推荐）</option>
              <option value="classic" ${s.uiLayout === 'classic' ? 'selected' : ''}>🎨 经典版 UI（原有顶部导航界面）</option>
            </select>
            <label class="field-label" style="margin-top:12px">全站默认日夜模式（新访客首次进入时默认，用户前台切换后自动永久记忆）</label>
            <select class="field-input" id="uiModernThemeSelect">
              <option value="light" ${s.uiModernTheme !== 'dark' ? 'selected' : ''}>☀️ 护眼白天模式（暖瓷白底 · 默认推荐）</option>
              <option value="dark" ${s.uiModernTheme === 'dark' ? 'selected' : ''}>🌙 沉浸夜间模式（深色影院）</option>
            </select>
            <div style="margin-top:12px;padding:12px 14px;background:var(--bg2);border:1px solid var(--card-br);border-radius:12px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
              <div>
                <div style="font-size:13.5px;font-weight:700">📺 TV 电视大屏终端版调试预览</div>
                <div style="font-size:12px;color:var(--dim);margin-top:2px">前台已隐藏 TV 入口，管理员可在此直接预览腾讯TV极光大屏 UI（进入后点底部「退出TV模式」即可返回）</div>
              </div>
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                <a class="btn ghost small" href="?tv=1#/home" target="_blank" rel="noopener">📺 新窗口预览 TV 版</a>
                <a class="btn primary small" href="?tv=1#/home">📺 当前窗口进入 TV 版</a>
              </div>
            </div>
            <label class="field-label" style="margin-top:10px">全站公告（留空则不显示）</label>
            <textarea class="field-area" id="annInput" maxlength="300">${esc(s.announcement)}</textarea>
            <label class="field-label" style="margin-top:14px">🏠 首页默认加载的影视源（每行一个 key，按顺序，最多12个；留空 = 默认精选）<br>
              <small style="font-weight:400;color:var(--dim)">建议填测速最快的源。可用 key 如：${esc((State.config ? State.config.sources : []).slice(0, 8).map((x) => x.key).join('、'))} …</small></label>
            <textarea class="field-area" id="homeSrcInput" style="min-height:96px;font-family:monospace;font-size:12px">${esc((s.homeSources || []).join('\n'))}</textarea>
            <button class="btn primary" id="saveSiteBtn" style="margin-top:14px">保存站点设置</button>
          </div>
          <div class="admin-card" id="playOptCard">
            <h3>⚡ 播放加载优化</h3>
            <p class="hint">影响电脑与手机的 HLS 起播速度。<b>保持现状</b>使用原有稳健参数；<b>开启优化</b>会优先低码率起播、预取分片并用 Worker 解码，通常黑屏更短。开关即时保存，新打开的影片生效。</p>
            <div class="admin-row">
              <div class="admin-label">加载优化
                <small>当前：<b id="playOptLabel" style="color:${s.playerOptimize ? 'var(--ok)' : 'var(--dim)'}">${s.playerOptimize ? '已开启优化' : '保持现状'}</b></small>
              </div>
              <label class="switch"><input type="checkbox" id="playOptSw" ${s.playerOptimize ? 'checked' : ''}><span class="track"></span></label>
            </div>
          </div>
          <div class="admin-card" id="wmCard">
            <h3>💧 播放器水印</h3>
            <p class="hint">电脑 / 手机 / App 共用。建议使用透明底 <b>PNG</b> 图片（外链 URL）。关闭则不显示。</p>
            <div class="admin-row">
              <div class="admin-label">启用水印
                <small>当前：<b id="wmEnLabel" style="color:${s.wmEnabled ? 'var(--ok)' : 'var(--dim)'}">${s.wmEnabled ? '已开启' : '已关闭'}</b></small>
              </div>
              <label class="switch"><input type="checkbox" id="wmEnSw" ${s.wmEnabled ? 'checked' : ''}><span class="track"></span></label>
            </div>
            <label class="field-label" style="margin-top:10px">显示方式</label>
            <select class="field-input" id="wmModeSel">
              <option value="corner" ${s.wmMode !== 'center' ? 'selected' : ''}>右下角 · 播放中一直显示</option>
              <option value="center" ${s.wmMode === 'center' ? 'selected' : ''}>正中间 · 开始播放时短暂显示</option>
            </select>
            <label class="field-label" style="margin-top:10px">正中模式显示时长（秒，1–60，默认 2）</label>
            <input class="field-input" id="wmDurationInput" type="number" min="1" max="60" step="1" value="${esc(String(Math.min(60, Math.max(1, Number(s.wmDuration == null ? 2 : s.wmDuration) || 2))))}">
            <label class="field-label" style="margin-top:10px">水印图片 URL（png 推荐）</label>
            <input class="field-input" id="wmUrlInput" value="${esc(s.wmUrl || '')}" placeholder="https://example.com/logo.png" maxlength="500">
            <label class="field-label" style="margin-top:10px">透明度（0.15–1，默认 0.55）</label>
            <input class="field-input" id="wmOpacityInput" type="number" min="0.15" max="1" step="0.05" value="${esc(String(s.wmOpacity == null ? 0.55 : s.wmOpacity))}">
            ${s.wmUrl ? `<div style="margin-top:12px"><img src="${esc(s.wmUrl)}" alt="预览" style="max-height:64px;max-width:180px;object-fit:contain;background:rgba(0,0,0,.35);padding:8px;border-radius:8px" onerror="this.style.display='none'"></div>` : ''}
            <button class="btn primary" id="wmSaveBtn" style="margin-top:14px">保存水印设置</button>
          </div>`;
        $('#saveAdultConfigBtn') && $('#saveAdultConfigBtn').addEventListener('click', async () => {
          const rawMin = Number($('#adultTrialMinInput') ? $('#adultTrialMinInput').value : 10);
          const trialMin = (isFinite(rawMin) && rawMin >= 0) ? Math.round(rawMin) : 10;
          try {
            await API.adminSaveSettings({
              adultUnlockCode: $('#adultUnlockCodeInput').value.trim(),
              adultPayDesc: $('#adultPayDescInput').value.trim(),
              adultPayQr: $('#adultPayQrInput').value.trim(),
              adultTrialMinutes: trialMin,
            });
            if (lastSettings) lastSettings.adultTrialMinutes = trialMin;
            if (State.settings) State.settings.adultTrialMinutes = trialMin;
            if ($('#adultTrialHintMin')) $('#adultTrialHintMin').textContent = trialMin + ' 分钟';
            renderBottomNav();
            toast('✅ 私密福利配置已保存（试看：' + (trialMin === 0 ? '禁止试看' : trialMin + '分钟') + '）', 'ok');
          } catch (e) { toast('保存失败：' + e.message, 'err'); }
        });
        $('#adultTrialMinInput') && $('#adultTrialMinInput').addEventListener('input', (e) => {
          const val = Number(e.target.value);
          if ($('#adultTrialHintMin')) {
            $('#adultTrialHintMin').textContent = (isFinite(val) && val >= 0) ? (val === 0 ? '0 分钟（禁止试看）' : val + ' 分钟') : '--';
          }
        });
        $('#adultBottomNavSwitch') && $('#adultBottomNavSwitch').addEventListener('change', async (e) => {
          const on = e.target.checked;
          try {
            const res = await API.adminSaveSettings({ adultBottomNav: on });
            if (lastSettings) lastSettings.adultBottomNav = on;
            if (State.settings) State.settings.adultBottomNav = on;
            if (res.settings) State.settings = Object.assign({}, State.settings, { adultBottomNav: !!res.settings.adultBottomNav });
            $('#adultBottomNavState').textContent = on ? '已开启' : '已关闭';
            $('#adultBottomNavState').style.color = on ? 'var(--danger)' : 'var(--dim)';
            renderBottomNav();
            toast(on ? '📱 手机端底部导航福利入口已开启' : '✅ 手机端底部导航已恢复为「电视直播」', on ? 'warn' : 'ok');
          } catch (err) {
            e.target.checked = !on;
            toast('保存失败：' + err.message, 'err');
          }
        });
        $('#adultGuestSwitch') && $('#adultGuestSwitch').addEventListener('change', async (e) => {
          const on = e.target.checked;
          try {
            const res = await API.adminSaveSettings({ adultGuestVisible: on });
            if (lastSettings) lastSettings.adultGuestVisible = on;
            if (State.settings) State.settings.adultGuestVisible = on;
            if (res.settings) State.settings = Object.assign({}, State.settings, { adultGuestVisible: !!res.settings.adultGuestVisible });
            $('#adultGuestState').textContent = on ? '允许游客可见（引导注册）' : '未登录严格隐藏（完全隐蔽）';
            $('#adultGuestState').style.color = on ? 'var(--danger)' : 'var(--ok)';
            renderBottomNav();
            toast(on ? '👤 已开启访客可见（未登录访客在手机端也将显示入口并引导注册）' : '✅ 已开启严格隐蔽（未登录访客绝对隐藏入口）', on ? 'warn' : 'ok');
          } catch (err) {
            e.target.checked = !on;
            toast('保存失败：' + err.message, 'err');
          }
        });
        $('#adultSwitch').addEventListener('change', async (e) => {
          const on = e.target.checked;
          try {
            const res = await API.adminSaveSettings({ adultEnabled: on });
            State.config = await API.getConfig();
            if (lastSettings) lastSettings.adultEnabled = on;
            if (State.settings) State.settings.adultEnabled = on;
            $('#adultState').textContent = on ? '已开启' : '已关闭';
            $('#adultState').style.color = on ? 'var(--danger)' : 'var(--ok)';
            $('#adultCard').classList.toggle('on', on);
            const extra = $('#adultExtraFields');
            if (extra) extra.style.display = on ? '' : 'none';
            renderBottomNav();
            toast(on ? '⚠️ 私密福利专区已全局开启' : '✅ 成人内容已全站关闭', on ? 'err' : 'ok');
          } catch (err) { e.target.checked = !on; toast('保存失败：' + err.message, 'err'); }
        });
        $('#saveSiteBtn').addEventListener('click', async () => {
          try {
            const homeLines = $('#homeSrcInput').value.split('\n').map((x) => x.trim()).filter(Boolean);
            const res = await API.adminSaveSettings({
              siteName: $('#siteNameInput').value,
              siteSlogan: $('#siteSloganInput').value,
              defaultTheme: $('#themeSelect').value,
              uiLayout: $('#uiLayoutSelect').value,
              uiModernTheme: $('#uiModernThemeSelect').value,
              announcement: $('#annInput').value,
              homeSources: homeLines,
            });
            State.settings = Object.assign({}, State.settings, { siteName: res.settings.siteName,
              siteSlogan: res.settings.siteSlogan,
              announcement: res.settings.announcement,
              homeSources: res.settings.homeSources || [],
              uiLayout: res.settings.uiLayout,
              uiModernTheme: res.settings.uiModernTheme,
             });
            store.set('cached_settings', State.settings);
            if (lastSettings) {
              lastSettings.siteName = res.settings.siteName;
              lastSettings.siteSlogan = res.settings.siteSlogan;
              lastSettings.announcement = res.settings.announcement;
              lastSettings.homeSources = res.settings.homeSources || [];
              lastSettings.defaultTheme = res.settings.defaultTheme;
              lastSettings.uiLayout = res.settings.uiLayout;
              lastSettings.uiModernTheme = res.settings.uiModernTheme;
            }
            LIST_PAGE_CACHE.delete('home');
            applyUiMode(res.settings.uiLayout || 'modern', res.settings.uiModernTheme || 'light');
            $('#brandName').textContent = res.settings.siteName;
            document.title = res.settings.siteSlogan ? `${res.settings.siteName} - ${res.settings.siteSlogan}` : res.settings.siteName;
            applyAnnouncement(res.settings.announcement);
            toast(`站点设置已保存（副标题与首页源 ${homeLines.length} 个）`, 'ok');
          } catch (err) { toast('保存失败：' + err.message, 'err'); }
        });
        $('#playOptSw').addEventListener('change', async (e) => {
          const on = e.target.checked;
          const label = $('#playOptLabel');
          try {
            const res = await API.adminSaveSettings({ playerOptimize: on });
            const saved = !!(res.settings && res.settings.playerOptimize);
            e.target.checked = saved;
            State.settings = Object.assign({}, State.settings, { playerOptimize: saved });
            if (lastSettings) lastSettings.playerOptimize = saved;
            if (label) {
              label.textContent = saved ? '已开启优化' : '保持现状';
              label.style.color = saved ? 'var(--ok)' : 'var(--dim)';
            }
            toast(saved ? '已开启播放加载优化（新打开影片生效）' : '已恢复播放默认参数（保持现状）', 'ok');
          } catch (err) {
            e.target.checked = !on;
            toast('保存失败：' + err.message, 'err');
          }
        });
        $('#wmSaveBtn').addEventListener('click', async () => {
          const enabled = $('#wmEnSw').checked;
          const mode = $('#wmModeSel').value === 'center' ? 'center' : 'corner';
          const url = $('#wmUrlInput').value.trim();
          const opacity = Number($('#wmOpacityInput').value);
          const duration = Math.round(Number($('#wmDurationInput').value));
          if (enabled && !url) return toast('开启水印时请填写 PNG 图片地址', 'err');
          if (url && !/^https?:\/\//i.test(url) && !url.startsWith('data:image/')) return toast('图片地址需为 http(s) 或 data:image', 'err');
          if (!isFinite(duration) || duration < 1 || duration > 60) return toast('显示时长需为 1-60 秒', 'err');
          try {
            const res = await API.adminSaveSettings({ wmEnabled: enabled, wmMode: mode, wmUrl: url, wmOpacity: opacity, wmDuration: duration });
            const st = res.settings || {};
            State.settings = Object.assign({}, State.settings, { wmEnabled: !!st.wmEnabled,
              wmMode: st.wmMode === 'center' ? 'center' : 'corner',
              wmUrl: st.wmUrl || '',
              wmOpacity: Number(st.wmOpacity == null ? 0.55 : st.wmOpacity),
              wmDuration: Math.min(60, Math.max(1, Number(st.wmDuration == null ? 2 : st.wmDuration) || 2)),
             });
            if (lastSettings) {
              lastSettings.wmEnabled = State.settings.wmEnabled;
              lastSettings.wmMode = State.settings.wmMode;
              lastSettings.wmUrl = State.settings.wmUrl;
              lastSettings.wmOpacity = State.settings.wmOpacity;
              lastSettings.wmDuration = State.settings.wmDuration;
            }
            const lb = $('#wmEnLabel');
            if (lb) {
              lb.textContent = State.settings.wmEnabled ? '已开启' : '已关闭';
              lb.style.color = State.settings.wmEnabled ? 'var(--ok)' : 'var(--dim)';
            }
            toast('水印设置已保存（新打开影片生效）', 'ok');
          } catch (err) { toast('保存失败：' + err.message, 'err'); }
        });
        $('#wmEnSw').addEventListener('change', () => {
          const lb = $('#wmEnLabel');
          if (!lb) return;
          const on = $('#wmEnSw').checked;
          lb.textContent = on ? '已开启（记得点保存）' : '已关闭（记得点保存）';
          lb.style.color = on ? 'var(--ok)' : 'var(--dim)';
        });
        setupStorageCard(s);
      }

      /* ---------------- 📲 APP推广 / 版本更新 ---------------- */
      else if (admTab === 'app') {
        const phoneMode = s.downloadUrlMode === 'custom' ? 'custom' : 'fixed';
        const tvMode = (s.downloadUrlTvMode === 'fixed' || s.downloadUrlTvMode === 'custom') ? s.downloadUrlTvMode : 'off';
        const iosMode = (s.downloadUrlIosMode === 'fixed' || s.downloadUrlIosMode === 'custom') ? s.downloadUrlIosMode : 'off';
        const ipadMode = (s.downloadUrlIpadMode === 'fixed' || s.downloadUrlIpadMode === 'custom') ? s.downloadUrlIpadMode : 'off';
        const pcMode = s.downloadUrlPcMode === 'custom' ? 'custom' : 'off';
        const macMode = s.downloadUrlMacMode === 'custom' ? 'custom' : 'off';
        let curCustomClients = Array.isArray(s.customClients) ? JSON.parse(JSON.stringify(s.customClients)) : [];
        const fixedPhone = '/APP/xiaolintv-phone-latest.apk';
        const fixedTv = '/APP/xiaolintv-tv-latest.apk';
        const fixedIos = '/APP/xiaolintv-ios-latest.mobileconfig';
        const fixedIpad = '/APP/xiaolintv-ios-latest.mobileconfig';

        // 线上生效状态计算
        const isLive = s.appVersionActive !== false && ((s.appPublishedCode && s.appPublishedCode > 0) || (s.appVersionCode && s.appVersionCode > 0));
        const liveCode = s.appPublishedCode || s.appVersionCode || 0;
        const liveName = s.appPublishedName || s.appVersionName || (liveCode ? '1.0.' + liveCode : '');
        const liveChangelog = s.appPublishedChangelog || s.appChangelog || '';
        const liveForce = Boolean(s.appPublishedForce !== undefined ? s.appPublishedForce : s.appForceUpdate);
        const liveAt = s.appPublishedAt || s.appManifestAt || '';

        // 待发布草稿区计算（自由修改）
        const draftCode = s.appDraftCode || liveCode || 0;
        const draftName = s.appDraftName || liveName || (draftCode ? '1.0.' + draftCode : '');
        const draftChangelog = s.appDraftChangelog || liveChangelog || '';
        const draftForce = Boolean(s.appDraftForce !== undefined ? s.appDraftForce : liveForce);

        main.innerHTML = `
          <div class="admin-card">
            <h3>📲 APP下载与移动端访问控制</h3>
            <p class="hint">控制手机浏览器访问与安装策略。默认用站内<strong>固定最新包</strong>：CI 每次覆盖同名文件，链接永不变。需要外部网盘或分发时可切换「自定义」。</p>
            
            <label style="display:flex;align-items:center;gap:10px;margin:10px 0;cursor:pointer">
              <span class="switch"><input type="checkbox" id="promoSw" ${s.appPromoEnabled !== false ? 'checked' : ''}><span class="track"></span></span>
              <b>启用手机网页端「下载APP」推广弹窗</b>
            </label>

            <label class="field-label" style="margin-top:14px">📱 手机网页端试看限制（分钟）</label>
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
              <input class="field-input" id="mobileLimitInput" type="number" min="-1" max="2880" step="1" style="width:110px;text-align:center" value="${Number(s.mobileWebLimitMinutes === undefined ? 10 : s.mobileWebLimitMinutes)}">
              <span style="font-size:13px;color:var(--dim)">分钟（填 <b>0</b> = 完全禁止手机浏览器播放，进入即弹窗强制下载客户端；填 <b>-1</b> = 不限制）</span>
            </div>

            <h4 style="margin:18px 0 8px;font-size:14px">📱 手机版 APK</h4>
            <div class="dl-mode-row" id="phoneModeRow">
              <button type="button" class="chip dl-mode-btn ${phoneMode === 'fixed' ? 'on' : ''}" data-mode="fixed">固定最新包</button>
              <button type="button" class="chip dl-mode-btn ${phoneMode === 'custom' ? 'on' : ''}" data-mode="custom">自定义</button>
            </div>
            <div id="phoneFixedBox" class="${phoneMode === 'fixed' ? '' : 'hidden'}" style="margin-top:10px">
              <div class="field-input" style="opacity:.85;cursor:default;user-select:all">${esc(fixedPhone)}</div>
              <p class="hint" style="margin-top:6px">每次打包自动覆盖此文件 → 用户始终下到最新版。生效地址：<code>${esc(location.origin + fixedPhone)}</code></p>
            </div>
            <div id="phoneCustomBox" class="${phoneMode === 'custom' ? '' : 'hidden'}" style="margin-top:10px">
              <label class="field-label">自定义下载地址（留空则下载页不显示安装按钮）</label>
              <input class="field-input" id="dlUrlInput" value="${esc(s.downloadUrl || '')}" placeholder="https://… 或 /APP/xxx.apk">
            </div>

            <h4 style="margin:22px 0 8px;font-size:14px">📺 TV / 机顶盒版 APK</h4>
            <div class="dl-mode-row" id="tvModeRow">
              <button type="button" class="chip dl-mode-btn ${tvMode === 'off' ? 'on' : ''}" data-mode="off">关闭</button>
              <button type="button" class="chip dl-mode-btn ${tvMode === 'fixed' ? 'on' : ''}" data-mode="fixed">固定最新包</button>
              <button type="button" class="chip dl-mode-btn ${tvMode === 'custom' ? 'on' : ''}" data-mode="custom">自定义</button>
            </div>
            <div id="tvOffHint" class="${tvMode === 'off' ? '' : 'hidden'}" style="margin-top:10px">
              <p class="hint">已关闭：下载页不显示 TV 安装按钮（TV 包未上线时可保持关闭）。</p>
            </div>
            <div id="tvFixedBox" class="${tvMode === 'fixed' ? '' : 'hidden'}" style="margin-top:10px">
              <div class="field-input" style="opacity:.85;cursor:default;user-select:all">${esc(fixedTv)}</div>
              <p class="hint" style="margin-top:6px">对应文件：<code>${esc(location.origin + fixedTv)}</code></p>
            </div>
            <div id="tvCustomBox" class="${tvMode === 'custom' ? '' : 'hidden'}" style="margin-top:10px">
              <label class="field-label">自定义 TV 下载地址</label>
              <input class="field-input" id="dlUrlTvInput" value="${esc(s.downloadUrlTv || '')}" placeholder="https://… 或 /APP/xxx.apk">
            </div>

            <!-- 3. iPhone 手机专版 -->
            <h4 style="margin:22px 0 8px;font-size:14px">🍎 苹果 iPhone 手机专版</h4>
            <div class="dl-mode-row" id="iosModeRow">
              <button type="button" class="chip dl-mode-btn ${iosMode === 'off' ? 'on' : ''}" data-mode="off">关闭（使用主屏教程）</button>
              <button type="button" class="chip dl-mode-btn ${iosMode === 'fixed' ? 'on' : ''}" data-mode="fixed">固定最新包</button>
              <button type="button" class="chip dl-mode-btn ${iosMode === 'custom' ? 'on' : ''}" data-mode="custom">自定义下载/安装地址</button>
            </div>
            <div id="iosOffHint" class="${iosMode === 'off' ? '' : 'hidden'}" style="margin-top:10px">
              <p class="hint">已关闭 iPhone 安装链接：前台下载页仅展示 Safari 添加到主屏幕教程。</p>
            </div>
            <div id="iosFixedBox" class="${iosMode === 'fixed' ? '' : 'hidden'}" style="margin-top:10px">
              <div class="field-input" style="opacity:.85;cursor:default;user-select:all">${esc(fixedIos)}</div>
              <p class="hint" style="margin-top:6px">免签名描述文件（CI 每次构建自动生成/覆盖），iPhone 安装即得主屏全屏图标、锁屏也能横屏铺满。生效地址：<code>${esc(location.origin + fixedIos)}</code>；如要发 IPA 免签包可切「自定义」填 <code>/APP/xiaolintv-ios-latest.ipa</code></p>
            </div>
            <div id="iosCustomBox" class="${iosMode === 'custom' ? '' : 'hidden'}" style="margin-top:10px">
              <label class="field-label">iPhone 安装/下载地址（免签描述文件 .mobileconfig / IPA / TestFlight / 分发链接）</label>
              <input class="field-input" id="dlUrlIosInput" value="${esc(s.downloadUrlIos || '')}" placeholder="https://… 或 /APP/xiaolin-iphone.mobileconfig">
            </div>

            <!-- 4. iPad 平板专版 -->
            <h4 style="margin:22px 0 8px;font-size:14px">📱 苹果 iPad 平板专版</h4>
            <div class="dl-mode-row" id="ipadModeRow">
              <button type="button" class="chip dl-mode-btn ${ipadMode === 'off' ? 'on' : ''}" data-mode="off">关闭（使用主屏教程）</button>
              <button type="button" class="chip dl-mode-btn ${ipadMode === 'fixed' ? 'on' : ''}" data-mode="fixed">固定最新包</button>
              <button type="button" class="chip dl-mode-btn ${ipadMode === 'custom' ? 'on' : ''}" data-mode="custom">自定义下载/安装地址</button>
            </div>
            <div id="ipadOffHint" class="${ipadMode === 'off' ? '' : 'hidden'}" style="margin-top:10px">
              <p class="hint">已关闭 iPad 安装链接：若有 iPhone 链接则共用，否则前台展示 Safari 教程。</p>
            </div>
            <div id="ipadFixedBox" class="${ipadMode === 'fixed' ? '' : 'hidden'}" style="margin-top:10px">
              <div class="field-input" style="opacity:.85;cursor:default;user-select:all">${esc(fixedIpad)}</div>
              <p class="hint" style="margin-top:6px">iPad 同样使用免签名描述文件（CI 自动生成/覆盖）。生效地址：<code>${esc(location.origin + fixedIpad)}</code>；如要发 iPad 专版 IPA 可切「自定义」填 <code>/APP/xiaolintv-ipad-latest.ipa</code></p>
            </div>
            <div id="ipadCustomBox" class="${ipadMode === 'custom' ? '' : 'hidden'}" style="margin-top:10px">
              <label class="field-label">iPad 专属下载/安装地址（iPad 专版描述文件 .mobileconfig / IPA / 分发链接）</label>
              <input class="field-input" id="dlUrlIpadInput" value="${esc(s.downloadUrlIpad || '')}" placeholder="https://… 或 /APP/xiaolin-ipad.mobileconfig">
            </div>

            <!-- 5. Windows 电脑客户端 -->
            <h4 style="margin:22px 0 8px;font-size:14px">💻 Windows 电脑客户端</h4>
            <div class="dl-mode-row" id="pcModeRow">
              <button type="button" class="chip dl-mode-btn ${pcMode === 'off' ? 'on' : ''}" data-mode="off">关闭</button>
              <button type="button" class="chip dl-mode-btn ${pcMode === 'custom' ? 'on' : ''}" data-mode="custom">自定义下载地址</button>
            </div>
            <div id="pcOffHint" class="${pcMode === 'off' ? '' : 'hidden'}" style="margin-top:10px">
              <p class="hint">已关闭：前台提示电脑网页端已享 4K 超清秒播。</p>
            </div>
            <div id="pcCustomBox" class="${pcMode === 'custom' ? '' : 'hidden'}" style="margin-top:10px">
              <label class="field-label">Windows 客户端下载地址（.exe / .zip / 网盘下载直链）</label>
              <input class="field-input" id="dlUrlPcInput" value="${esc(s.downloadUrlPc || '')}" placeholder="https://… 或 /APP/xiaolin-win-setup.exe">
            </div>

            <!-- 6. Mac 苹果电脑客户端 -->
            <h4 style="margin:22px 0 8px;font-size:14px">🖥️ Mac 苹果电脑客户端</h4>
            <div class="dl-mode-row" id="macModeRow">
              <button type="button" class="chip dl-mode-btn ${macMode === 'off' ? 'on' : ''}" data-mode="off">关闭</button>
              <button type="button" class="chip dl-mode-btn ${macMode === 'custom' ? 'on' : ''}" data-mode="custom">自定义下载地址</button>
            </div>
            <div id="macOffHint" class="${macMode === 'off' ? '' : 'hidden'}" style="margin-top:10px">
              <p class="hint">已关闭：前台提示 Mac 网页端已享 4K 超清秒播。</p>
            </div>
            <div id="macCustomBox" class="${macMode === 'custom' ? '' : 'hidden'}" style="margin-top:10px">
              <label class="field-label">Mac 客户端下载地址（.dmg / .app.zip / 网盘下载直链）</label>
              <input class="field-input" id="dlUrlMacInput" value="${esc(s.downloadUrlMac || '')}" placeholder="https://… 或 /APP/xiaolin-mac.dmg">
            </div>

            <!-- 7. 更多自定义设备客户端管理 -->
            <div style="border-top:1px dashed var(--card-br);padding-top:16px;margin-top:20px">
              <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:10px">
                <h4 style="margin:0;font-size:14px;color:var(--acc)">🌐 更多自定义设备客户端（支持自主增删任意设备）</h4>
                <button type="button" class="btn small" id="addCustomClientBtn" style="background:rgba(91,140,255,.15);color:var(--acc);border:1px solid rgba(91,140,255,.3)">
                  ➕ 添加新设备客户端
                </button>
              </div>
              <p class="hint" style="margin-bottom:12px">
                管理员可根据需要任意增加其他设备版本（如：鸿蒙 NEXT 原生版、Linux 客户端、车机中控版、掌机版等），保存后自动在前台下载中心生成独立卡片！
              </p>
              <div id="customClientsContainer" style="display:flex;flex-direction:column;gap:10px"></div>
            </div>

            <button class="btn primary" id="savePromoBtn" style="margin-top:16px">保存全平台下载与访问控制</button>
          </div>

          <!-- 🛰️ 自动同步 GitHub Releases 到站内 /APP -->
          <div class="admin-card" style="margin-top:16px">
            <h3>🛰️ 自动获取最新 APP（私有仓 Releases → 站内 /APP）</h3>
            <p class="hint">
              一键从 GitHub 私有仓库读取<strong>最新 Release</strong>：① 同步版本号到站内（客户端更新弹窗的检测依据）；② 安装包按需代理到站内 <code>/APP/</code> 目录，访客直接下载、<strong>无需 GitHub 权限</strong>；③ iPhone/iPad 下载地址<strong>自动填写</strong>（您已自定义的地址不会被覆盖，可随时改回自定义）。<br>
              ⚙️ 前提：Worker 机密已配置 <code>GITHUB_TOKEN</code>（仓库读取权限）。同步结果会填入下方「待发布草稿」，确认后点【🚀 确认正式发布】即向客户端弹窗。
            </p>
            <div style="display:flex;gap:10px;flex-wrap:wrap">
              <button class="btn primary" id="syncReleaseBtn" type="button">🛰️ 自动获取最新 APP 版本（GitHub Releases）</button>
              <button class="btn primary" id="triggerBuildBtn" type="button" style="background:linear-gradient(135deg,#b45309,#d97706)">🚀 确认网页正常，一键构建客户端（安卓 + 苹果 + Docker）</button>
              <button class="btn ghost" id="ghTokenTestBtn" type="button">🔍 一键检测 Token 与仓库权限</button>
            </div>
            <div id="syncReleaseResult"></div>
          </div>


          <!-- 🔄 App 版本更新两阶段确认发布卡片 -->
          <div class="admin-card" style="margin-top:16px">
            <h3>🔄 App 版本更新管理（两阶段安全确认发布）</h3>
            <p class="hint">
              🛡️ <b>防误报机制</b>：无论是从 GitHub 自动获取还是手动输入，获取后均保留在下方<strong>待发布草稿区</strong>，您可以自由增删、扩充润色更新说明；<br>
              <strong>绝不自动向客户端弹窗</strong>！只有当您确认无误并点击<strong>【🚀 确认正式发布更新给客户端】</strong>后，客户端才会弹出更新弹窗。
            </p>

            <!-- 诊断：当前访问环境与当前已安装 App 版本 -->
            ${(() => {
              const client = parseAppClient();
              if (client && (client.name || client.code)) {
                return `
                  <div style="margin:10px 0;padding:10px 14px;border-radius:10px;background:rgba(59,130,246,.12);border:1px solid rgba(59,130,246,.3);color:#93c5fd;font-size:13px;display:flex;align-items:center;gap:8px">
                    <span style="font-size:18px">📱</span>
                    <div>
                      <b>当前设备正在运行官方客户端：</b>
                      版本名 <code>v${esc(client.name || '未知')}</code>，内部编号 versionCode: <code>${client.code}</code>
                      <div style="font-size:11.5px;color:var(--dim);margin-top:2px">（系统已识别当前 App 版本，您在下方发布的版本号大于该数字即可触发更新）</div>
                    </div>
                  </div>`;
              }
              return `
                <div style="margin:10px 0;padding:8px 12px;border-radius:8px;background:rgba(255,255,255,.02);border:1px solid var(--card-br);color:var(--dim);font-size:12px">
                  ℹ️ 当前使用的是浏览器访问后台。若使用您手机上打包的 APP 打开此页面，此处会自动显示该 APP 的真实版本号与编号。
                </div>`;
            })()}

            <!-- 区块 1：当前线上客户端生效状态 -->
            <div style="margin:14px 0;padding:14px 16px;border-radius:12px;background:var(--card-bg,rgba(255,255,255,.03));border:1px solid var(--card-br,rgba(255,255,255,.1))">
              <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
                <div style="display:flex;align-items:center;gap:10px">
                  <span class="chip ${isLive ? 'on' : ''}" style="${isLive ? 'background:rgba(34,197,94,.18);color:#4ade80;border-color:rgba(34,197,94,.4)' : 'background:rgba(239,68,68,.15);color:#f87171;border-color:rgba(239,68,68,.3)'}">
                    ${isLive ? '🟢 正在向客户端推送' : '⏸️ 已暂停向客户端推送'}
                  </span>
                  <b style="font-size:15px">线上生效版本：v${esc(liveName || '未发布')}</b>
                  <span style="font-size:12px;color:var(--dim)">(versionCode: ${liveCode})</span>
                </div>
                <div style="display:flex;gap:8px">
                  ${isLive ? `
                    <button type="button" class="btn danger small" id="pauseAppPushBtn">⏸️ 暂停推送（停止弹窗）</button>
                  ` : (liveCode ? `
                    <button type="button" class="btn success small" id="resumeAppPushBtn" style="background:linear-gradient(135deg,#16a34a,#15803d)">▶️ 恢复推送</button>
                  ` : '')}
                </div>
              </div>
              <div style="margin-top:10px;display:flex;gap:16px;font-size:12px;color:var(--dim);flex-wrap:wrap">
                <span>更新模式：<b>${liveForce ? '🔴 强制更新（客户端不可跳过）' : '⚪ 普通更新提示（可稍后）'}</b></span>
                <span>发布时间：<b>${liveAt ? esc(String(liveAt).replace('T', ' ').slice(0, 19)) : '未记录'}</b></span>
              </div>
              <div style="margin-top:8px">
                <label class="field-label" style="font-size:12px;margin-bottom:4px">当前线上更新说明预览：</label>
                <pre style="margin:0;padding:8px 12px;border-radius:8px;background:rgba(0,0,0,.25);font-size:12px;white-space:pre-wrap;line-height:1.5;max-height:80px;overflow-y:auto;color:var(--dim)">${esc(liveChangelog || '（暂无更新说明）')}</pre>
              </div>
            </div>

            <!-- 区块 2：待发布版本手动编辑与推送区 -->
            <div style="border-top:1px dashed var(--card-br);padding-top:16px;margin-top:16px">
              <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:12px">
                <h4 style="margin:0;font-size:14px;color:var(--acc)">📝 待发布新版本（手动设置与更新内容编写）</h4>
              </div>
              <p class="hint" style="margin-bottom:12px">
                💡 <b>手动更新推送机制</b>：请在本地自行编译打包并将安装包覆盖上传至 <code>/APP</code> 目录（或填写上方自定义下载地址），然后在下方填写最新版本号与更新说明。点击<b>【🚀 确认正式发布更新给客户端】</b>即刻向客户端触发全网弹窗更新！勾选<b>【强制更新】</b>则客户端必须更新才能继续使用。<br>
                📌 <b>关于 versionCode</b>：这是打包时嵌入在 APK 内部的正整数（如 1、2、80），<strong>只有当此数值大于用户手机里已安装的数值时，App 才会触发更新</strong>！若需立即验证弹窗效果，可在此处填写一个较大的数字（例如 <code>99</code>）并勾选强制更新发布测试。
              </p>

              <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:12px">
                <div>
                  <label class="field-label">最新 versionCode（正整数，与打包编号对应）</label>
                  <input class="field-input" id="appDraftCodeInput" type="number" min="0" step="1" value="${esc(String(draftCode || 0))}" placeholder="例如 80">
                </div>
                <div>
                  <label class="field-label">版本名称（如 1.0.80）</label>
                  <input class="field-input" id="appDraftNameInput" value="${esc(draftName || '')}" placeholder="例如 1.0.80">
                </div>
              </div>

              <label class="field-label" style="margin-top:12px">🔄 App 版本更新说明（可自定义编写、分行详细描述）</label>
              <textarea class="field-input" id="appDraftChangelogInput" rows="5" placeholder="请在此编写或扩充更新说明，例如：&#10;1. 优化私密福利专区体验&#10;2. 播放器支持全屏滑动手势快进&#10;3. 修复弱网环境下播放缓冲问题">${esc(draftChangelog || '')}</textarea>

              <label style="display:flex;align-items:center;gap:10px;margin:14px 0;cursor:pointer">
                <span class="switch"><input type="checkbox" id="appDraftForceSw" ${draftForce ? 'checked' : ''}><span class="track"></span></span>
                <b>强制更新</b><span style="color:var(--danger);font-size:12.5px;font-weight:700">（勾选后客户端必须更新才能继续观看影片，无法跳过）</span>
              </label>

              <div style="display:flex;gap:12px;align-items:center;margin-top:16px;flex-wrap:wrap">
                <button class="btn primary" id="publishAppVerBtn" style="background:linear-gradient(135deg,#16a34a,#15803d);font-weight:700" type="button">
                  🚀 确认正式发布更新给客户端（触发弹窗）
                </button>
                <button class="btn ghost" id="saveDraftAppVerBtn" type="button">
                  💾 仅保存为草稿（不向客户端发布）
                </button>
              </div>
            </div>
          </div>`;

        let curPhoneMode = phoneMode;
        let curTvMode = tvMode;
        let curIosMode = iosMode;
        let curIpadMode = ipadMode;
        let curPcMode = pcMode;
        let curMacMode = macMode;

        const syncPhoneUi = () => {
          $$('#phoneModeRow .dl-mode-btn').forEach((b) => b.classList.toggle('on', b.dataset.mode === curPhoneMode));
          $('#phoneFixedBox').classList.toggle('hidden', curPhoneMode !== 'fixed');
          $('#phoneCustomBox').classList.toggle('hidden', curPhoneMode !== 'custom');
        };
        const syncTvUi = () => {
          $$('#tvModeRow .dl-mode-btn').forEach((b) => b.classList.toggle('on', b.dataset.mode === curTvMode));
          $('#tvOffHint').classList.toggle('hidden', curTvMode !== 'off');
          $('#tvFixedBox').classList.toggle('hidden', curTvMode !== 'fixed');
          $('#tvCustomBox').classList.toggle('hidden', curTvMode !== 'custom');
        };
        const syncIosUi = () => {
          $$('#iosModeRow .dl-mode-btn').forEach((b) => b.classList.toggle('on', b.dataset.mode === curIosMode));
          $('#iosOffHint').classList.toggle('hidden', curIosMode !== 'off');
          $('#iosFixedBox').classList.toggle('hidden', curIosMode !== 'fixed');
          $('#iosCustomBox').classList.toggle('hidden', curIosMode !== 'custom');
        };
        const syncIpadUi = () => {
          $$('#ipadModeRow .dl-mode-btn').forEach((b) => b.classList.toggle('on', b.dataset.mode === curIpadMode));
          $('#ipadOffHint').classList.toggle('hidden', curIpadMode !== 'off');
          $('#ipadFixedBox').classList.toggle('hidden', curIpadMode !== 'fixed');
          $('#ipadCustomBox').classList.toggle('hidden', curIpadMode !== 'custom');
        };
        const syncPcUi = () => {
          $$('#pcModeRow .dl-mode-btn').forEach((b) => b.classList.toggle('on', b.dataset.mode === curPcMode));
          $('#pcOffHint').classList.toggle('hidden', curPcMode !== 'off');
          $('#pcCustomBox').classList.toggle('hidden', curPcMode !== 'custom');
        };
        const syncMacUi = () => {
          $$('#macModeRow .dl-mode-btn').forEach((b) => b.classList.toggle('on', b.dataset.mode === curMacMode));
          $('#macOffHint').classList.toggle('hidden', curMacMode !== 'off');
          $('#macCustomBox').classList.toggle('hidden', curMacMode !== 'custom');
        };

        $$('#phoneModeRow .dl-mode-btn').forEach((btn) => {
          btn.addEventListener('click', () => { curPhoneMode = btn.dataset.mode; syncPhoneUi(); });
        });
        $$('#tvModeRow .dl-mode-btn').forEach((btn) => {
          btn.addEventListener('click', () => { curTvMode = btn.dataset.mode; syncTvUi(); });
        });
        $$('#iosModeRow .dl-mode-btn').forEach((btn) => {
          btn.addEventListener('click', () => { curIosMode = btn.dataset.mode; syncIosUi(); });
        });
        $$('#ipadModeRow .dl-mode-btn').forEach((btn) => {
          btn.addEventListener('click', () => { curIpadMode = btn.dataset.mode; syncIpadUi(); });
        });
        $$('#pcModeRow .dl-mode-btn').forEach((btn) => {
          btn.addEventListener('click', () => { curPcMode = btn.dataset.mode; syncPcUi(); });
        });
        $$('#macModeRow .dl-mode-btn').forEach((btn) => {
          btn.addEventListener('click', () => { curMacMode = btn.dataset.mode; syncMacUi(); });
        });

        function renderCustomClientsList() {
          const wrap = $('#customClientsContainer');
          if (!wrap) return;
          if (!curCustomClients.length) {
            wrap.innerHTML = '<div style="padding:14px;text-align:center;color:var(--dim);background:rgba(0,0,0,.15);border-radius:10px;font-size:12.5px">暂无自定义设备客户端。点击上方「➕ 添加新设备客户端」即可自主添加车机版、Linux版、鸿蒙NEXT版等</div>';
            return;
          }
          wrap.innerHTML = curCustomClients.map((c, i) => `
            <div class="custom-client-row" style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:rgba(255,255,255,.03);border:1px solid var(--card-br);border-radius:10px;flex-wrap:wrap">
              <input class="field-input cc-icon" style="width:52px;text-align:center;font-size:18px" value="${esc(c.icon || '📱')}" placeholder="图标" title="图标 Emoji">
              <input class="field-input cc-name" style="width:160px;font-weight:700" value="${esc(c.name || '')}" placeholder="设备名称(如:鸿蒙NEXT)">
              <input class="field-input cc-url" style="flex:1;min-width:200px" value="${esc(c.url || '')}" placeholder="下载链接(https://... 或 /APP/...)">
              <input class="field-input cc-desc" style="flex:1;min-width:180px" value="${esc(c.desc || '')}" placeholder="简要说明(可选)">
              <button type="button" class="btn danger small cc-del-btn" data-idx="${i}">🗑️ 删除</button>
            </div>
          `).join('');

          $$('.cc-del-btn', wrap).forEach((btn) => {
            btn.addEventListener('click', () => {
              const idx = parseInt(btn.dataset.idx, 10);
              curCustomClients.splice(idx, 1);
              renderCustomClientsList();
            });
          });
          $$('.cc-icon', wrap).forEach((inp, idx) => {
            inp.addEventListener('input', () => { curCustomClients[idx].icon = inp.value.trim(); });
          });
          $$('.cc-name', wrap).forEach((inp, idx) => {
            inp.addEventListener('input', () => { curCustomClients[idx].name = inp.value.trim(); });
          });
          $$('.cc-url', wrap).forEach((inp, idx) => {
            inp.addEventListener('input', () => { curCustomClients[idx].url = inp.value.trim(); });
          });
          $$('.cc-desc', wrap).forEach((inp, idx) => {
            inp.addEventListener('input', () => { curCustomClients[idx].desc = inp.value.trim(); });
          });
        }
        renderCustomClientsList();

        $('#addCustomClientBtn') && $('#addCustomClientBtn').addEventListener('click', () => {
          curCustomClients.push({
            id: 'client_' + Date.now(),
            icon: '📱',
            name: '新设备客户端',
            url: '',
            desc: '官方独立客户端 · 畅享原画秒播',
            enabled: true,
          });
          renderCustomClientsList();
        });

        $('#savePromoBtn').addEventListener('click', async () => {
          const url = ($('#dlUrlInput') && $('#dlUrlInput').value.trim()) || '';
          const urlTv = ($('#dlUrlTvInput') && $('#dlUrlTvInput').value.trim()) || '';
          const urlIos = ($('#dlUrlIosInput') && $('#dlUrlIosInput').value.trim()) || '';
          const urlIpad = ($('#dlUrlIpadInput') && $('#dlUrlIpadInput').value.trim()) || '';
          const urlPc = ($('#dlUrlPcInput') && $('#dlUrlPcInput').value.trim()) || '';
          const urlMac = ($('#dlUrlMacInput') && $('#dlUrlMacInput').value.trim()) || '';
          const mobileLimit = Number(($('#mobileLimitInput') && $('#mobileLimitInput').value) || 10);
          if (curPhoneMode === 'custom' && !isValidDownloadUrlInput(url)) {
            return toast('手机自定义地址需为 http(s) 或站内路径 /APP/...', 'err');
          }
          if (curTvMode === 'custom' && !isValidDownloadUrlInput(urlTv)) {
            return toast('TV 自定义地址需为 http(s) 或站内路径 /APP/...', 'err');
          }
          if (curIosMode === 'custom' && !isValidDownloadUrlInput(urlIos)) {
            return toast('iPhone 自定义地址需为 http(s) 或站内路径 /APP/...', 'err');
          }
          if (curIpadMode === 'custom' && !isValidDownloadUrlInput(urlIpad)) {
            return toast('iPad 自定义地址需为 http(s) 或站内路径 /APP/...', 'err');
          }
          if (curPcMode === 'custom' && !isValidDownloadUrlInput(urlPc)) {
            return toast('Windows 自定义地址需为 http(s) 或站内路径 /APP/...', 'err');
          }
          if (curMacMode === 'custom' && !isValidDownloadUrlInput(urlMac)) {
            return toast('Mac 自定义地址需为 http(s) 或站内路径 /APP/...', 'err');
          }
          try {
            const patch = {
              appPromoEnabled: $('#promoSw').checked,
              mobileWebLimitMinutes: mobileLimit,
              downloadUrlMode: curPhoneMode,
              downloadUrl: url,
              downloadUrlTvMode: curTvMode,
              downloadUrlTv: urlTv,
              downloadUrlIosMode: curIosMode,
              downloadUrlIos: urlIos,
              downloadUrlIpadMode: curIpadMode,
              downloadUrlIpad: urlIpad,
              downloadUrlPcMode: curPcMode,
              downloadUrlPc: urlPc,
              downloadUrlMacMode: curMacMode,
              downloadUrlMac: urlMac,
              customClients: curCustomClients,
            };
            await API.adminSaveSettings(patch);
            const effPhone = curPhoneMode === 'custom' ? url : fixedPhone;
            const effTv = curTvMode === 'fixed' ? fixedTv : (curTvMode === 'custom' ? urlTv : '');
            const effIos = curIosMode === 'custom' ? urlIos : '';
            const effIpad = curIpadMode === 'custom' ? urlIpad : '';
            const effPc = curPcMode === 'custom' ? urlPc : '';
            const effMac = curMacMode === 'custom' ? urlMac : '';
            State.settings = {
              ...State.settings,
              ...patch,
              downloadUrl: effPhone,
              downloadUrlTv: effTv,
              downloadUrlIos: effIos,
              downloadUrlIpad: effIpad,
              downloadUrlPc: effPc,
              downloadUrlMac: effMac,
              customClients: curCustomClients,
            };
            store.set('cached_settings', State.settings);
            toast('全平台客户端下载与访问控制已保存', 'ok');
          } catch (err) { toast('保存失败：' + err.message, 'err'); }
        });

        // 保存草稿（不向客户端下发更新）
        $('#saveDraftAppVerBtn') && $('#saveDraftAppVerBtn').addEventListener('click', async () => {
          const code = Math.max(0, Math.round(Number(($('#appDraftCodeInput') && $('#appDraftCodeInput').value) || 0)));
          const name = (($('#appDraftNameInput') && $('#appDraftNameInput').value) || '').trim();
          const log = (($('#appDraftChangelogInput') && $('#appDraftChangelogInput').value) || '').trim();
          const force = Boolean($('#appDraftForceSw') && $('#appDraftForceSw').checked);
          try {
            await API.adminSaveSettings({
              appDraftCode: code,
              appDraftName: name,
              appDraftChangelog: log,
              appDraftForce: force,
            });
            toast('草稿已保存（未向客户端发布更新）', 'ok');
          } catch (err) { toast('保存失败：' + err.message, 'err'); }
        });

        // 确认正式发布更新给客户端
        $('#publishAppVerBtn') && $('#publishAppVerBtn').addEventListener('click', async () => {
          const code = Math.max(0, Math.round(Number(($('#appDraftCodeInput') && $('#appDraftCodeInput').value) || 0)));
          const name = (($('#appDraftNameInput') && $('#appDraftNameInput').value) || '').trim();
          const log = (($('#appDraftChangelogInput') && $('#appDraftChangelogInput').value) || '').trim();
          const force = Boolean($('#appDraftForceSw') && $('#appDraftForceSw').checked);

          if (!code) return toast('请先输入或提取有效的 versionCode（需大于0的整数）', 'err');
          const confirmMsg = `确认将版本 v${name || code} (Code: ${code}) 正式发布？\n\n` +
            `• 更新模式：${force ? '🔴 强制更新（不可跳过）' : '⚪ 普通提示更新'}\n` +
            `• 发布后，客户端打开或播放时将立即收到更新弹窗！`;
          if (!confirm(confirmMsg)) return;

          try {
            const patch = {
              appVersionActive: true,
              appPublishedCode: code,
              appPublishedName: name || ('1.0.' + code),
              appPublishedChangelog: log,
              appPublishedForce: force,
              appPublishedAt: new Date().toISOString(),
              appDraftCode: code,
              appDraftName: name,
              appDraftChangelog: log,
              appDraftForce: force,
            };
            const res = await API.adminSaveSettings(patch);
            const fresh = await API.adminGetSettings();
            lastSettings = fresh;
            State.settings = Object.assign({}, State.settings, fresh);
            store.set('cached_settings', State.settings);
            toast(`🚀 版本 v${name || code} 已正式发布！客户端将收到更新弹窗`, 'ok');
            renderAdmTab(fresh);
          } catch (err) { toast('发布失败：' + err.message, 'err'); }
        });

        // 暂停向客户端推送更新
        $('#pauseAppPushBtn') && $('#pauseAppPushBtn').addEventListener('click', async () => {
          if (!confirm('确认暂停向客户端推送更新弹窗？暂停后客户端将不再收到弹窗提示。')) return;
          try {
            await API.adminSaveSettings({ appVersionActive: false });
            const fresh = await API.adminGetSettings();
            lastSettings = fresh;
            State.settings = Object.assign({}, State.settings, { appVersionActive: false, appVersionCode: 0 });
            toast('已暂停客户端版本更新推送', 'ok');
            renderAdmTab(fresh);
          } catch (err) { toast('操作失败：' + err.message, 'err'); }
        });

        // 恢复向客户端推送更新
        $('#resumeAppPushBtn') && $('#resumeAppPushBtn').addEventListener('click', async () => {
          try {
            await API.adminSaveSettings({ appVersionActive: true });
            const fresh = await API.adminGetSettings();
            lastSettings = fresh;
            State.settings = Object.assign({}, State.settings, { appVersionActive: true, appVersionCode: fresh.appPublishedCode || fresh.appVersionCode });
            toast('已恢复向客户端推送更新弹窗', 'ok');
            renderAdmTab(fresh);
          } catch (err) { toast('操作失败：' + err.message, 'err'); }
        });

        // 🛰️ 自动获取最新 APP（GitHub 私有仓 Releases → 站内 /APP）
        $('#syncReleaseBtn') && $('#syncReleaseBtn').addEventListener('click', async () => {
          const btn = $('#syncReleaseBtn');
          const boxEl = $('#syncReleaseResult');
          btn.disabled = true;
          btn.innerHTML = '<span class="spin"></span> 正在从 GitHub 私有仓获取最新 Release…';
          if (boxEl) boxEl.innerHTML = '';
          try {
            const r = await API.adminSyncRelease();
            if (!r || r.ok === false) throw new Error((r && r.error) || '同步失败');
            // 自动填入「待发布草稿」，管理员确认后一键发布弹窗
            if ($('#appDraftCodeInput')) $('#appDraftCodeInput').value = r.versionCode || 0;
            if ($('#appDraftNameInput')) $('#appDraftNameInput').value = r.versionName || '';
            if ($('#appDraftChangelogInput') && r.changelog) $('#appDraftChangelogInput').value = r.changelog;
            const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
            const rows = [
              ['📱 安卓手机', r.assets && r.assets.phone],
              ['📺 电视/盒子', r.assets && r.assets.tv],
              ['🍎 iPhone 免签 IPA', r.assets && r.assets.ios],
              ['📟 iPad 免签 IPA', r.assets && r.assets.ipad],
            ].map(([label, a]) =>
              `<div style="display:flex;justify-content:space-between;gap:8px;padding:5px 0;border-bottom:1px dashed var(--card-br);font-size:12.5px">`
              + `<span>${label}</span>`
              + `<span style="color:${a ? 'var(--ok)' : 'var(--dim)'}">${a ? esc(a.name) + ' · ' + fmtSize(a.size) : '本次 Release 未找到'}</span></div>`
            ).join('');
            if (boxEl) {
              boxEl.innerHTML = `<div style="margin-top:12px;padding:10px 12px;border-radius:10px;background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.25)">
                <div style="font-weight:700;color:var(--ok);margin-bottom:6px">✅ 已同步最新 Release v${esc(r.versionName || '')}（versionCode ${r.versionCode}）</div>
                ${rows}
                <div style="margin-top:8px;color:var(--dim);font-size:12px;line-height:1.7">
                  · 安装包已可通过站内 <code>/APP/&lt;文件名&gt;</code> 直接下载（按需代理，访客无需 GitHub 权限）<br>
                  · 版本号与更新说明已填入下方「待发布草稿」，确认后点【🚀 确认正式发布】即向客户端弹窗<br>
                  · iOS/iPad 下载地址已自动填写（若您曾自定义则保持原样）
                </div>
              </div>`;
            }
            toast('已获取最新 Release v' + (r.versionName || ''), 'ok');
          } catch (err) {
            if (boxEl) {
              boxEl.innerHTML = `<div style="margin-top:12px;padding:10px 12px;border-radius:10px;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.3);color:#f87171;font-size:12.5px;line-height:1.7">
                ❌ ${esc(err.message || '同步失败')}<br>
                排查：① Worker → 设置 → 变量和机密，确认已配置机密 <code>GITHUB_TOKEN</code>（私有仓读取权限）；② 仓库变量 <code>GITHUB_REPO</code> 为 <code>xiaolin1991/dianying</code>；③ 仓库已有成功发布的 Release。
              </div>`;
            }
            toast('同步失败：' + err.message, 'err');
          } finally {
            btn.disabled = false;
            btn.textContent = '🛰️ 自动获取最新 APP 版本（GitHub Releases）';
          }
        });
        // 🚀 一键构建客户端（安卓 + 苹果 + Docker → 统一 Release）
        $('#triggerBuildBtn') && $('#triggerBuildBtn').addEventListener('click', async () => {
          if (!confirm('确认当前网页版浏览与功能均已正常？\n\n点击确定将立即触发全平台客户端构建：\n• 安卓手机/电视 APK\n• iPhone/iPad 免签 IPA\n• Docker 镜像\n\n约 3-8 分钟后完成并自动发布到 GitHub Releases，旧版本会被自动清理。\n构建完成后回到本页点「🛰️ 自动获取最新 APP」即可同步到站内。')) return;
          const btn = $('#triggerBuildBtn');
          const boxEl = $('#syncReleaseResult');
          btn.disabled = true;
          btn.innerHTML = '<span class="spin"></span> 正在下达构建命令…';
          try {
            const r = await API.adminTriggerBuild();
            if (!r || r.ok === false) throw new Error((r && r.error) || '触发失败');
            if (boxEl) {
              boxEl.innerHTML = `<div style="margin-top:12px;padding:10px 12px;border-radius:10px;background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.3);color:#93c5fd;font-size:12.5px;line-height:1.8">
                🚀 <b>构建命令已下达！</b>GitHub Actions 正在构建全平台客户端：<br>
                · 安卓 APK（手机 + 电视）· iPhone/iPad 免签 IPA · Docker 镜像<br>
                · 约 3-8 分钟后自动发布统一 Release，并自动清理历史旧版本<br>
                · 可到 GitHub → Actions →「Build APP (APK + iOS IPA + Docker)」查看进度；完成后回本站点「🛰️ 自动获取最新 APP」同步版本号与下载地址
              </div>`;
            }
            toast('构建已触发，请稍候约 3-8 分钟', 'ok');
          } catch (err) {
            toast('触发失败：' + err.message, 'err');
          } finally {
            btn.disabled = false;
            btn.textContent = '🚀 确认网页正常，一键构建客户端（安卓 + 苹果 + Docker）';
          }
        });


        // 🔍 一键检测 GitHub Token 与仓库权限（配置在「数据与 GitHub 同步」页，与同步共用同一个 Token）
        $('#ghTokenTestBtn') && $('#ghTokenTestBtn').addEventListener('click', async () => {
          const btn = $('#ghTokenTestBtn');
          const boxEl = $('#syncReleaseResult');
          btn.disabled = true;
          btn.innerHTML = '<span class="spin"></span> 正在检测 Token 与仓库权限…';
          if (boxEl) boxEl.innerHTML = '';
          try {
            const r = await API.adminGithubTest({});
            const scopes = String((r && r.scopes) || '');
            const canRepo = r && r.ok !== false;
            const canWorkflow = /workflow/i.test(scopes);
            if (boxEl) {
              boxEl.innerHTML = `<div style="margin-top:12px;padding:10px 12px;border-radius:10px;background:${canRepo ? 'rgba(34,197,94,.08)' : 'rgba(239,68,68,.08)'};border:1px solid ${canRepo ? 'rgba(34,197,94,.25)' : 'rgba(239,68,68,.3)'};font-size:12.5px;line-height:1.9">
                <div style="font-weight:700;color:${canRepo ? 'var(--ok)' : '#f87171'}">${canRepo ? '✅ Token 有效，仓库可访问' : '❌ 检测未通过'}</div>
                <div>账号：<code>${esc(String((r && r.user) || '-'))}</code> · 仓库：<code>${esc(String((r && r.repo) || '-'))}</code></div>
                <div>Token 权限 scopes：<code>${esc(scopes || '（未返回，细粒度 Token 常见）')}</code></div>
                <div>workflow 权限（一键构建必需）：<b style="color:${canWorkflow ? 'var(--ok)' : '#fbbf24'}">${canWorkflow ? '已具备 ✅' : '未检测到（若是经典 PAT 请勾选 workflow；细粒度 Token 需 Actions: Read and write 权限）'}</b></div>
                ${r && r.error ? `<div style="color:#f87171">错误：${esc(String(r.error))}</div>` : ''}
                <div style="color:var(--dim)">💡 Token 配置入口：后台「🗄️ 数据与 GitHub 同步」→ GitHub Personal Access Token 输入框 → 保存。此处与一键同步/一键构建共用同一 Token，无需再配 Cloudflare 环境变量。</div>
              </div>`;
            }
            toast(canRepo ? 'Token 检测通过' : 'Token 检测未通过', canRepo ? 'ok' : 'err');
          } catch (err) {
            if (boxEl) {
              boxEl.innerHTML = `<div style="margin-top:12px;padding:10px 12px;border-radius:10px;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.3);color:#f87171;font-size:12.5px;line-height:1.8">
                ❌ 检测失败：${esc(err.message || '未知错误')}<br>
                Token 配置入口：后台「🗄️ 数据与 GitHub 同步」→ GitHub Personal Access Token → 保存（需 repo + workflow 权限）。
              </div>`;
            }
            toast('检测失败：' + err.message, 'err');
          } finally {
            btn.disabled = false;
            btn.textContent = '🔍 一键检测 Token 与仓库权限';
          }
        });

      }

      /* ---------------- 🗄️ 数据与 GitHub 同步 ---------------- */
      else if (admTab === 'backup') {
        main.innerHTML = `
          <!-- 🐙 GitHub 数据中心双向同步 (依托 GitHub 为持久化存储) -->
          <div class="admin-card">
            <h3>GitHub 数据中心双向同步 <small style="color:var(--dim);font-weight:400;font-size:12px">（依托 GitHub 为持久化存储）</small></h3>
            <p class="hint">无需购买昂贵的数据库，直接将影视源、系统设置、用户信息及历史收藏自动同步至您的专属 GitHub 仓库中！即使 Cloudflare 未绑定 KV 命名空间，也能永久保存！</p>

            <div style="margin:14px 0 16px">
              <div style="font-size:12px;color:var(--dim);margin-bottom:6px">开启 GitHub 双向持久化同步</div>
              <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
                <span class="switch"><input type="checkbox" id="ghSyncSw" ${s.githubSyncEnabled ? 'checked' : ''}><span class="track"></span></span>
                <b>激活 GitHub 仓库同步驱动</b>
              </label>
            </div>

            <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:14px">
              <div>
                <label class="field-label">GitHub 用户名或组织名 (Owner)</label>
                <input class="field-input" id="ghOwnerInput" value="${esc(s.githubOwner || 'xiaolin1991')}" placeholder="xiaolin1991">
              </div>
              <div>
                <label class="field-label">仓库名称 (Repo)</label>
                <input class="field-input" id="ghRepoInput" value="${esc(s.githubRepo || 'dianying')}" placeholder="dianying">
              </div>
              <div>
                <label class="field-label">分支名称 (Branch)</label>
                <input class="field-input" id="ghBranchInput" value="${esc(s.githubBranch || 'main')}" placeholder="main">
              </div>
              <div>
                <label class="field-label">存储文件夹目录前缀</label>
                <input class="field-input" id="ghPrefixInput" value="${esc(s.githubPrefix || 'data')}" placeholder="data">
              </div>
            </div>

            <div style="margin-top:14px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
                <label class="field-label" style="margin-bottom:0">GitHub Personal Access Token (PAT，需具备 repo 写入权限)</label>
                ${s.hasGithubToken ? `<span style="font-size:12px;color:var(--ok)">已配置: <code>${esc(s.githubTokenMasked)}</code></span>` : ''}
              </div>
              <div style="position:relative;display:flex;align-items:center">
                <input class="field-input" id="ghTokenInput" type="password" placeholder="${s.hasGithubToken ? '若无需更改请留空 (当前已保存: ' + esc(s.githubTokenMasked) + ')' : 'ghp_xxxxxxxxxxxxxxxxxxxx'}" style="padding-right:42px">
                <button type="button" id="toggleGhTokenBtn" style="position:absolute;right:8px;background:none;border:none;cursor:pointer;font-size:16px;opacity:.7" title="切换显示明文/密码">👁️</button>
              </div>
              <p class="hint" style="margin-top:6px">提示：可在 GitHub ➔ Settings ➔ Developer settings ➔ Personal access tokens 生成（需勾选 <b>repo</b> 与 <b>workflow</b> 权限）。保存后后台打包与数据同步立即生效，无需配置 Cloudflare 环境变量！</p>
            </div>

            <div id="ghSyncStat" style="display:none;margin-top:14px;padding:12px 16px;border-radius:10px;font-size:13px;line-height:1.6"></div>

            <div style="display:flex;gap:10px;margin-top:18px;flex-wrap:wrap;align-items:center">
              <button type="button" class="btn ghost" id="ghTestBtn">🔍 测试仓库连通性</button>
              <button type="button" class="btn primary" id="ghSaveBtn" style="background:linear-gradient(135deg,#2563eb,#1d4ed8);font-weight:700">💾 保存 GitHub 配置</button>
              <button type="button" class="btn ghost" id="ghPushBtn">⬆️ 一键备份所有数据到 GitHub (Push)</button>
              <button type="button" class="btn ghost" id="ghPullBtn">⬇️ 从 GitHub 拉取数据恢复 (Pull)</button>
            </div>
          </div>

          <!-- 🗄️ 本地数据备份 / 迁移 -->
          <div class="admin-card" style="margin-top:16px">
            <h3>🗄️ 本地数据备份 / 迁移 <small style="color:var(--dim);font-weight:400;font-size:12px">（JSON 文件导入导出，Cloudflare ↔ VPS/Docker 互通）</small></h3>
            <p class="hint">导出内容：<b>站点设置 · 注册用户 · 观看历史 · 收藏 · 流量统计</b>。迁移到自托管服务器：旧环境导出 JSON → 新环境后台「恢复备份」即可无缝搬家（详见 docs/DEPLOY-VPS.md、docs/DEPLOY-BT.md）。</p>
            <div style="display:flex;gap:10px;align-items:center;margin-top:12px;flex-wrap:wrap">
              <button class="btn primary" id="bkExpBtn">⬇️ 导出备份(JSON)</button>
              <input type="file" id="bkImpFile" accept=".json,application/json" style="display:none">
              <button class="btn ghost" id="bkImpBtn">⬆️ 恢复备份</button>
              <select class="field-input" id="bkMode" style="width:auto;padding:8px 10px">
                <option value="merge" selected>合并模式(保留现有,推荐)</option>
                <option value="replace">覆盖模式(完全以备份为准)</option>
              </select>
              <span id="bkStat" style="color:var(--dim);font-size:12px"></span>
            </div>
            <p class="hint" style="margin-top:10px">💡 自托管(Docker/宝塔)用户也可直接备份数据目录里的 <code>kv.json</code> 文件，效果等同。</p>
          </div>`;

        // 切换 PAT 密码明文显示
        let ghTokenVisible = false;
        $('#toggleGhTokenBtn') && $('#toggleGhTokenBtn').addEventListener('click', () => {
          const inp = $('#ghTokenInput');
          if (!inp) return;
          ghTokenVisible = !ghTokenVisible;
          inp.type = ghTokenVisible ? 'text' : 'password';
          $('#toggleGhTokenBtn').textContent = ghTokenVisible ? '🔒' : '👁️';
        });

        const showGhStat = (msg, isOk) => {
          const el = $('#ghSyncStat');
          if (!el) return;
          el.style.display = 'block';
          el.style.background = isOk ? 'rgba(34,197,94,.1)' : 'rgba(239,68,68,.12)';
          el.style.border = isOk ? '1px solid rgba(34,197,94,.3)' : '1px solid rgba(239,68,68,.3)';
          el.style.color = isOk ? 'var(--ok)' : 'var(--danger)';
          el.innerHTML = msg;
        };

        // 测试仓库连通性
        $('#ghTestBtn') && $('#ghTestBtn').addEventListener('click', async () => {
          const btn = $('#ghTestBtn');
          const token = ($('#ghTokenInput') && $('#ghTokenInput').value.trim()) || '';
          const owner = ($('#ghOwnerInput') && $('#ghOwnerInput').value.trim()) || '';
          const repo = ($('#ghRepoInput') && $('#ghRepoInput').value.trim()) || '';
          btn.disabled = true; btn.textContent = '⏳ 测试中…';
          try {
            const r = await API.adminGithubTest({ token, owner, repo });
            if (r.ok) {
              showGhStat(esc(r.msg), true);
              toast('GitHub 连通测试通过！', 'ok');
            } else {
              showGhStat('❌ ' + esc(r.error || '连通失败'), false);
              toast('测试失败：' + (r.error || '未知错误'), 'err');
            }
          } catch (e) {
            showGhStat('❌ 测试失败：' + esc(e.message), false);
            toast('测试失败：' + e.message, 'err');
          } finally {
            btn.disabled = false; btn.textContent = '🔍 测试仓库连通性';
          }
        });

        // 保存 GitHub 配置
        $('#ghSaveBtn') && $('#ghSaveBtn').addEventListener('click', async () => {
          const btn = $('#ghSaveBtn');
          const token = ($('#ghTokenInput') && $('#ghTokenInput').value.trim()) || '';
          const owner = ($('#ghOwnerInput') && $('#ghOwnerInput').value.trim()) || 'xiaolin1991';
          const repo = ($('#ghRepoInput') && $('#ghRepoInput').value.trim()) || 'dianying';
          const branch = ($('#ghBranchInput') && $('#ghBranchInput').value.trim()) || 'main';
          const prefix = ($('#ghPrefixInput') && $('#ghPrefixInput').value.trim()) || 'data';
          const enabled = Boolean($('#ghSyncSw') && $('#ghSyncSw').checked);
          btn.disabled = true; btn.textContent = '⏳ 保存中…';
          try {
            const patch = {
              githubOwner: owner,
              githubRepo: repo,
              githubBranch: branch,
              githubPrefix: prefix,
              githubSyncEnabled: enabled,
            };
            if (token) patch.githubToken = token;
            await API.adminSaveSettings(patch);
            const fresh = await API.adminGetSettings();
            lastSettings = fresh;
            State.settings = Object.assign({}, State.settings, fresh);
            toast('GitHub 配置已保存！后台打包与数据同步已绑定', 'ok');
            renderAdmTab(fresh);
          } catch (e) {
            toast('保存失败：' + e.message, 'err');
          } finally {
            btn.disabled = false; btn.textContent = '💾 保存 GitHub 配置';
          }
        });

        // 一键备份数据到 GitHub (Push)
        $('#ghPushBtn') && $('#ghPushBtn').addEventListener('click', async () => {
          const btn = $('#ghPushBtn');
          btn.disabled = true; btn.textContent = '⏳ 正在向 GitHub 推送备份…';
          try {
            const r = await API.adminGithubPush();
            if (r.ok) {
              showGhStat(`✅ ${esc(r.msg)} (包含 ${r.keyCount || 0} 个数据键)`, true);
              toast('全站数据已成功备份至 GitHub 仓库！', 'ok');
            } else {
              showGhStat('❌ 备份失败：' + esc(r.error || '未知错误'), false);
              toast('备份失败：' + (r.error || '未知错误'), 'err');
            }
          } catch (e) {
            showGhStat('❌ 备份异常：' + esc(e.message), false);
            toast('备份失败：' + e.message, 'err');
          } finally {
            btn.disabled = false; btn.textContent = '⬆️ 一键备份所有数据到 GitHub (Push)';
          }
        });

        // 从 GitHub 拉取数据恢复 (Pull)
        $('#ghPullBtn') && $('#ghPullBtn').addEventListener('click', async () => {
          if (!confirm('确认从 GitHub 仓库拉取备份数据并恢复？这将合并更新当前系统的配置与数据。')) return;
          const btn = $('#ghPullBtn');
          btn.disabled = true; btn.textContent = '⏳ 正在从 GitHub 拉取恢复…';
          try {
            const r = await API.adminGithubPull();
            if (r.ok) {
              showGhStat(`✅ ${esc(r.msg)} (更新了 ${r.restored} 项数据)`, true);
              toast('已成功从 GitHub 恢复全站数据！', 'ok');
              State.config = await API.getConfig();
              const fresh = await API.adminGetSettings();
              lastSettings = fresh;
              renderPanel();
            } else {
              showGhStat('❌ 恢复失败：' + esc(r.error || '未知错误'), false);
              toast('恢复失败：' + (r.error || '未知错误'), 'err');
            }
          } catch (e) {
            showGhStat('❌ 恢复异常：' + esc(e.message), false);
            toast('恢复失败：' + e.message, 'err');
          } finally {
            btn.disabled = false; btn.textContent = '⬇️ 从 GitHub 拉取数据恢复 (Pull)';
          }
        });

        // 本地 JSON 导出
        $('#bkExpBtn').addEventListener('click', async () => {
          const btn = $('#bkExpBtn');
          btn.disabled = true; btn.textContent = '⏳ 导出中…';
          try {
            const data = await API.adminBackup();
            const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `xiaolintv-backup-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 4000);
            $('#bkStat').textContent = `已导出 ${Object.keys(data.kv || {}).length} 个键`;
            toast('备份已导出，请妥善保管该文件', 'ok');
          } catch (e) { toast('导出失败：' + e.message, 'err'); }
          btn.disabled = false; btn.textContent = '⬇️ 导出备份(JSON)';
        });
        $('#bkImpBtn').addEventListener('click', () => $('#bkImpFile').click());
        $('#bkImpFile').addEventListener('change', async () => {
          const f = $('#bkImpFile').files[0];
          if (!f) return;
          const mode = $('#bkMode').value;
          let data;
          try { data = JSON.parse(await f.text()); } catch (e) { return toast('文件不是有效 JSON', 'err'); }
          if (!data.kv) return toast('不是本系统的备份文件(缺少 kv 字段)', 'err');
          if (!confirm(`将按「${mode === 'merge' ? '合并' : '覆盖'}」模式恢复 ${Object.keys(data.kv).length} 个键${mode === 'replace' ? '，现有数据会被覆盖！' : ''}，继续？`)) {
            $('#bkImpFile').value = '';
            return;
          }
          try {
            const r = await API.adminRestore(mode, data.kv);
            toast(`已恢复 ${r.restored} 个键(${r.mode})`, 'ok');
            State.config = await API.getConfig();
            renderPanel();
          } catch (e) { toast('恢复失败：' + e.message, 'err'); }
          $('#bkImpFile').value = '';
        });
      }

      /* ---------------- 🔐 安全中心 ---------------- */
      else if (admTab === 'sec') {
        main.innerHTML = `
          <div class="admin-card">
            <h3>🔑 修改管理密码</h3>
            <p class="hint">修改后立即生效，旧会话全部失效，需用新密码重新登录。无需进 Cloudflare 改环境变量。</p>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-top:10px">
              <input class="field-input" id="oldPwd" type="password" placeholder="当前密码">
              <input class="field-input" id="newPwd" type="password" placeholder="新密码(至少6位)">
              <input class="field-input" id="newPwd2" type="password" placeholder="确认新密码">
            </div>
            <button class="btn primary" id="savePwdBtn" style="margin-top:14px">确认修改密码</button>
          </div>
          <div class="admin-card">
            <h3>🚪 后台入口路径</h3>
            <p class="hint">自定义后台访问地址：<b>留空/填 xiaolin1991</b> 使用默认 <code>#/xiaolin1991</code>；例如填 <code>my-panel</code> 后，只有 <code>#/my-panel</code> 能进入后台，旧地址对外显示「页面不存在」。<br>当前完整入口：<code>${esc(location.origin + '/' + (s.adminPath || 'xiaolin1991'))}</code>（建议收藏到书签）</p>
            <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:10px">
              <input class="field-input" id="admPathInput" style="max-width:260px" value="${esc(s.adminPath || '')}" placeholder="xiaolin1991（留空=默认）" maxlength="40">
              <button class="btn primary" id="saveAdmPathBtn">保存入口路径</button>
            </div>
          </div>`;
        $('#savePwdBtn').addEventListener('click', async () => {
          const o = $('#oldPwd').value, n1 = $('#newPwd').value, n2 = $('#newPwd2').value;
          if (!o) return toast('请输入当前密码', 'err');
          if (n1.length < 6) return toast('新密码至少 6 位', 'err');
          if (n1 !== n2) return toast('两次输入的新密码不一致', 'err');
          try {
            await API.adminChangePassword(o, n1);
            toast('密码已修改，请用新密码重新登录', 'ok');
            try { await API.adminLogout(); } catch (e) {}
            viewAdmin(null, usedSeg);
          } catch (err) { toast('修改失败：' + err.message, 'err'); }
        });
        $('#saveAdmPathBtn').addEventListener('click', async () => {
          const np = $('#admPathInput').value.trim().toLowerCase();
          if (np && !/^[a-z0-9][a-z0-9-_]{1,39}$/.test(np)) return toast('仅支持 2-40 位小写字母/数字/短横线', 'err');
          try {
            const res = await API.adminSaveSettings({ adminPath: np });
            const eff = (res.settings && res.settings.adminPath) || 'xiaolin1991';
            store.set('adminPathLive', eff);
            toast(`入口路径已保存：今后请从 /${eff} 进入后台`, 'ok');
            setTimeout(() => { location.href = '/' + eff; }, 900);
          } catch (err) { toast('保存失败：' + err.message, 'err'); }
        });
      }

      /* ---------------- ℹ️ 系统信息 ---------------- */
      else if (admTab === 'sys') {
        main.innerHTML = `
          ${buildStorageCardHtml(s)}
          <div class="admin-card">
            <h3>ℹ️ 系统运行信息</h3>
            <div class="admin-row"><div class="admin-label">数据存储方式<small>${
              s.storage === 'd1+kv'
                ? '已绑定 D1 数据库 (dianying) + KV (dianying_KV)，SQL 双轨持久存储，重启不丢失'
                : (s.storage === 'd1'
                  ? '已绑定 Cloudflare D1 数据库 (dianying)，SQL 持久存储，重启不丢失'
                  : (s.storage === 'kv'
                    ? '已绑定 Cloudflare KV (dianying_KV)，重启不丢失'
                    : '未绑定 D1/KV，当前保存在实例内存，重部署后恢复默认。绑定方法见部署指南'))
            }</small></div>
              <span class="status-pill ${s.storage === 'memory' ? 'warn' : 'ok'}">${
                s.storage === 'd1+kv' ? 'D1 + KV 双轨' : (s.storage === 'd1' ? 'D1 数据库' : (s.storage === 'kv' ? 'KV 存储' : 'Memory'))
              }</span></div>
            <div class="admin-row"><div class="admin-label">管理密码<small>${s.hasCustomPassword ? '后台已自定义 ✔（修改请用「安全中心」）' : s.passwordFromEnv ? '来自环境变量 ADMIN_PASSWORD ✔' : '使用默认密码 admin123，建议尽快修改'}</small></div>
              <span class="status-pill ${s.hasCustomPassword || s.passwordFromEnv ? 'ok' : 'warn'}">${s.hasCustomPassword ? '后台自定义' : s.passwordFromEnv ? '环境变量' : '默认'}</span></div>
            <div class="admin-row"><div class="admin-label">影视源配置<small>${(s.customSources || []).length} 个自定义源 · ${(s.disabledSources || []).length} 个停用中 · 内置源每日同步自 LunaTV-config</small></div>
              <span class="status-pill ok">${State.config.count}/${State.config.total} 源可用</span></div>
            <div class="admin-row"><div class="admin-label">后台入口<small>${s.adminPath ? `已自定义：#/${esc(s.adminPath)}` : '默认：#/xiaolin1991（可在安全中心自定义）'}</small></div>
              <span class="status-pill ${s.adminPath ? 'ok' : 'warn'}">${s.adminPath ? '自定义' : '默认'}</span></div>
          </div>`;
        setupStorageCard(s);
      }
    }
  }

  /* ------------------------------ 公告 ------------------------------ */
  function applyAnnouncement(text) {
    const bar = $('#announceBar');
    if (!text || store.get('annDismissed') === text) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    $('#announceText').textContent = text;
  }

  /* ------------------------------ 启动 ------------------------------ */
  async function boot() {
    // 电视/盒子/TV预览模式: 启用 10-foot 腾讯TV极光大屏 UI
    if (isTvDevice()) {
      document.body.classList.add('tv');
      document.documentElement.classList.add('tv-root');
    }
    // 顶栏「☀️ 护眼日间 / 🌙 沉浸夜间」一键切换与本地永久记忆
    const colorModeBtn = $('#colorModeBtn');
    if (colorModeBtn) {
      colorModeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const cur = document.body.getAttribute('data-mtheme') === 'dark' ? 'dark' : 'light';
        const next = cur === 'light' ? 'dark' : 'light';
        applyModernTheme(next, true);
        toast(next === 'light' ? '☀️ 已切换为护眼日间模式（已为您自动记忆）' : '🌙 已切换为沉浸夜间模式（已为您自动记忆）', 'ok');
      });
    }

    // 鼠标悬停预取 (Hover Prefetch): 电脑端鼠标悬停海报 100ms 自动后台预取详情与播放串，点击零等待秒开
    let hoverPrefetchTimer = null;
    document.addEventListener('pointerover', (e) => {
      if (isMobileDevice()) return;
      const card = e.target.closest('a.card');
      if (!card) return;
      clearTimeout(hoverPrefetchTimer);
      hoverPrefetchTimer = setTimeout(() => {
        const href = card.getAttribute('href') || '';
        const m = href.match(/^#\/(?:play|detail)\/([^/?#]+)\/([^/?#]+)/);
        if (m && API.prefetchDetail) {
          try {
            const sKey = decodeURIComponent(m[1]);
            const vId = decodeURIComponent(m[2]);
            const src = findSourceByKey(sKey);
            if (src && !src.adult) API.prefetchDetail(src, vId);
          } catch (err) {}
        }
      }, 100);
    }, { passive: true });
    // 静态事件
    $('#themeBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      const pop = $('#themePop');
      if (!pop) return;
      pop.classList.toggle('hidden');
    });
    $('#announceClose').addEventListener('click', () => {
      store.set('annDismissed', $('#announceText').textContent);
      $('#announceBar').classList.add('hidden');
    });
    const doSearch = () => {
      const q = $('#searchInput').value.trim();
      if (q) {
        pushSearchHist(q);
        $('#searchPop') && $('#searchPop').classList.add('hidden');
        location.hash = '#/search?q=' + encodeURIComponent(q);
      }
    };
    // 搜索历史下拉
    const searchInput = $('#searchInput');
    const searchPop = $('#searchPop');
    function renderSearchPop() {
      if (!searchPop) return;
      const h = store.get('searchHist', []);
      const rect = searchInput.getBoundingClientRect();
      searchPop.style.top = (rect.bottom + 8) + 'px';
      searchPop.style.right = Math.max(10, window.innerWidth - rect.right) + 'px';
      if (!h.length) { searchPop.classList.add('hidden'); return; }
      searchPop.innerHTML = `
        <div class="sp-head"><span>最近搜索</span><button id="clearSHist" type="button">清空</button></div>
        ${h.map((k) => `<div class="sp-item" data-q="${esc(k)}">
          <svg viewBox="0 0 24 24" class="ico"><path d="M10 2a8 8 0 105.3 14l4.4 4.4 1.4-1.4-4.4-4.4A8 8 0 0010 2zm0 2a6 6 0 110 12 6 6 0 010-12z"/></svg>
          <span>${esc(k)}</span></div>`).join('')}`;
      $$('.sp-item', searchPop).forEach((el) => el.addEventListener('click', () => {
        searchInput.value = el.dataset.q;
        doSearch();
      }));
      $('#clearSHist').addEventListener('click', (e) => {
        e.stopPropagation();
        store.set('searchHist', []);
        searchPop.classList.add('hidden');
      });
      searchPop.classList.remove('hidden');
    }
    searchInput.addEventListener('focus', renderSearchPop);
    searchInput.addEventListener('click', renderSearchPop);
    $('#searchBtn').addEventListener('click', (e) => { e.stopPropagation(); doSearch(); });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#themePop') && !e.target.closest('#themeBtn')) $('#themePop').classList.add('hidden');
      if (!e.target.closest('#searchPop') && !e.target.closest('.searchbox')) searchPop && searchPop.classList.add('hidden');
    });
    $('#searchInput').addEventListener('keydown', (e) => e.key === 'Enter' && doSearch());
    // 🎙 语音搜索(桌面/手机/支持的电视盒子): 识别中文后直接搜索
    const vBtn = $('#voiceBtn');
    if (vBtn) vBtn.addEventListener('click', () => startVoice((t) => { searchInput.value = t; doSearch(); }));
    // 电视/盒子: 顶栏输入框挂虚拟键盘
    if (isTvDevice()) VKB.attach(searchInput);

    // 手机端: 放大镜按钮 → 搜索弹窗(输入/历史 → 确认立即跳转并关闭)
    const mBtn = $('#searchMBtn');
    if (mBtn) {
      mBtn.addEventListener('click', () => {
        const box = document.createElement('div');
        box.className = 'modal-mask';
        const hist = store.get('searchHist', []);
        box.innerHTML = `<div class="modal-box" style="width:min(92vw,420px)">
            <h3 style="margin-bottom:12px">🔍 搜索影视</h3>
            <div style="display:flex;gap:8px">
              <input id="mSearchInput" class="field-input" style="flex:1;min-width:0;font-size:16px" type="search" placeholder="电影 / 剧集 / 综艺…" autocomplete="off">
              <button class="btn ghost" id="mVoice" style="flex-shrink:0;padding:0 13px" title="语音搜索">🎙</button>
              <button class="btn primary" id="mSearchGo" style="flex-shrink:0">搜索</button>
            </div>
            ${hist.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px">${hist.map((k) =>
              `<button class="chip m-sh" data-q="${esc(k)}">${esc(k)}</button>`).join('')}</div>` : ''}
          </div>`;
        const go = () => {
          const q = $('#mSearchInput', box).value.trim();
          if (!q) return;
          pushSearchHist(q);
          box.remove();
          location.hash = '#/search?q=' + encodeURIComponent(q);
        };
        $('#mSearchGo', box).addEventListener('click', go);
        const mVoice = $('#mVoice', box);
        if (mVoice) mVoice.addEventListener('click', () => startVoice((t) => { const i = $('#mSearchInput', box); i.value = t; go(); }));
        if (isTvDevice()) { const mi = $('#mSearchInput', box); if (mi) VKB.attach(mi); }
        $('#mSearchInput', box).addEventListener('keydown', (e) => e.key === 'Enter' && go());
        $$('.m-sh', box).forEach((el) => el.addEventListener('click', () => {
          pushSearchHist(el.dataset.q);
          box.remove();
          location.hash = '#/search?q=' + encodeURIComponent(el.dataset.q);
        }));
        box.addEventListener('click', (ev) => { if (ev.target === box) box.remove(); });
        document.body.appendChild(box);
        setTimeout(() => { const inp = $('#mSearchInput', box); inp && inp.focus(); }, 50);
      });
    }
    window.addEventListener('scroll', () => $('#backTop').classList.toggle('show', window.scrollY > 600));
    $('#backTop').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    if ('scrollRestoration' in history) {
      try { history.scrollRestoration = 'manual'; } catch (e) {}
    }
    window.addEventListener('hashchange', route);

    /* ------------------------------ 移动端顶部下拉刷新手势 (Pull-to-Refresh) ------------------------------ */
    function initPullToRefresh() {
      let startY = 0;
      let isTracking = false;
      let isRefreshing = false;

      let bar = $('#pullRefreshBar');
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'pullRefreshBar';
        bar.className = 'pull-refresh-bar';
        bar.innerHTML = '<span class="ptr-icon">↓</span> <span class="ptr-text">下拉即可刷新</span>';
        document.body.appendChild(bar);
      }
      const ptrIcon = bar.querySelector('.ptr-icon');
      const ptrText = bar.querySelector('.ptr-text');

      window.addEventListener('touchstart', (e) => {
        if (isRefreshing) return;
        if (e.target.closest('#videoWrap, .player-wrap, input, textarea, select')) return;
        const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
        if (scrollY <= 2) {
          startY = e.touches[0].clientY;
          isTracking = true;
        } else {
          isTracking = false;
        }
      }, { passive: true });

      window.addEventListener('touchmove', (e) => {
        if (!isTracking || isRefreshing) return;
        const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
        if (scrollY > 2) {
          isTracking = false;
          bar.classList.remove('pulling', 'active', 'ready');
          bar.style.height = '0px';
          return;
        }
        const curY = e.touches[0].clientY;
        const diff = curY - startY;
        if (diff > 10) {
          const pullDist = Math.min(65, Math.round(diff * 0.42));
          bar.classList.add('pulling');
          bar.style.height = pullDist + 'px';
          bar.style.opacity = Math.min(1, pullDist / 35);
          if (pullDist >= 50) {
            bar.classList.add('ready');
            ptrText.textContent = '释放立即刷新';
          } else {
            bar.classList.remove('ready');
            ptrText.textContent = '下拉即可刷新';
          }
        }
      }, { passive: true });

      const endPull = async () => {
        if (!isTracking || isRefreshing) return;
        isTracking = false;
        if (bar.classList.contains('ready')) {
          isRefreshing = true;
          bar.classList.remove('pulling', 'ready');
          bar.classList.add('active');
          bar.style.height = '46px';
          bar.style.opacity = '1';
          bar.innerHTML = '<span class="spin"></span> <span class="ptr-text">正在刷新数据…</span>';

          try {
            const { parts, query } = parseHash();
            const rKey = listRouteKey(parts, query);
            if (rKey) LIST_PAGE_CACHE.delete(rKey);

            if (parts[0] === 'user') {
              await doGlobalUserRefresh();
            } else {
              await route();
            }
            bar.innerHTML = '<span style="color:var(--ok)">✓</span> <span class="ptr-text">刷新完成</span>';
          } catch (err) {
            bar.innerHTML = '<span style="color:var(--danger)">⚠️</span> <span class="ptr-text">刷新失败</span>';
          } finally {
            setTimeout(() => {
              bar.classList.remove('active');
              bar.style.height = '0px';
              bar.style.opacity = '0';
              setTimeout(() => {
                bar.innerHTML = '<span class="ptr-icon">↓</span> <span class="ptr-text">下拉即可刷新</span>';
                isRefreshing = false;
              }, 220);
            }, 500);
          }
        } else {
          bar.classList.remove('pulling', 'ready', 'active');
          bar.style.height = '0px';
          bar.style.opacity = '0';
        }
      };

      window.addEventListener('touchend', endPull, { passive: true });
      window.addEventListener('touchcancel', endPull, { passive: true });
    }
    initPullToRefresh();

    buildThemePop();
    buildNav();
    applyTheme(store.get('theme', null) || 'midnight');
    // 首屏即时应用: 优先读取用户本地记忆的日间/夜间模式(默认护眼白天模式 light)与版式(默认流光旗舰版 modern)
    applyUiLayout(store.get('uiLayout', 'modern'));
    applyModernTheme(getEffectiveColorMode(store.get('uiModernTheme', 'light')), false);

    // 向 TV 大屏终端层(tv.js)提前暴露能力桥
    window.XLTV = {
      ti: titleInitials,
      idx: TitleIdx,
      isTv: isTvDevice,
      setTvMode: (on) => {
        try {
          if (on) {
            localStorage.setItem('ntv:tvMode', '1');
            sessionStorage.setItem('ntv_tv_override', '1');
          } else {
            localStorage.removeItem('ntv:tvMode');
            sessionStorage.removeItem('ntv_tv_override');
          }
        } catch (e) {}
        const u = new URL(location.href);
        if (on) u.searchParams.set('tv', '1');
        else u.searchParams.delete('tv');
        location.href = u.pathname + u.search + (location.hash || '#/home');
      },
      getState: () => State,
      visibleSources,
      featuredSources,
      findSourceByKey,
      cardHtml,
      pushSearchHist,
      logSearch,
      store,
      toast,
      openUnlockModal,
      route,
    };

    // file:// 直接打开 index.html 时, 前端无法访问 /api/* 后端
    if (location.protocol === 'file:') {
      $('#view').innerHTML = `<div class="container empty" style="padding-top:110px">
        <div class="big">📂</div>
        <p style="font-size:17px;font-weight:700">不能直接双击打开 index.html</p>
        <p style="margin-top:12px;color:var(--dim);font-size:13.5px;line-height:2">
          本站需要后端支持。请在项目文件夹打开终端运行:<br>
          <code style="background:var(--card);padding:3px 10px;border-radius:7px">npm run dev</code><br>
          然后浏览器访问 <b>http://127.0.0.1:8787</b></p></div>`;
      return;
    }

    // 0ms 瞬时冷热双轨启动 (SWR): 若本地已有上次缓存的 settings 与 config，0毫秒立即进 route() 渲染首屏！
    let fastBooted = false;
    const cachedSettings = store.get('cached_settings', null);
    const cachedConfig = store.get('cached_config', null);
    const cachedMe = store.get('cached_me', null);
    if (cachedSettings && cachedConfig && Array.isArray(cachedConfig.sources) && cachedConfig.sources.length) {
      State.settings = cachedSettings;
      State.config = cachedConfig;
      State.me = cachedMe;
      applyUiMode(State.settings.uiLayout || 'modern', State.settings.uiModernTheme || 'light');
      const sTitle0 = State.settings.siteName || '晓林影视';
      const sSlogan0 = State.settings.siteSlogan || '';
      $('#brandName').textContent = sTitle0;
      document.title = sSlogan0 ? `${sTitle0} - ${sSlogan0}` : sTitle0;
      applyAnnouncement(State.settings.announcement);
      updateUserBox();
      renderBottomNav();
      fastBooted = true;
      try { window.dispatchEvent(new CustomEvent('xl:ready')); } catch (e) {}
      route();
    }

    // 并行拉取最新设置、源配置与登录态(不再串行阻塞)
    const [setRes, cfgRes, meRes] = await Promise.allSettled([
      API.getSettings(),
      API.getConfig(),
      API.userMe(),
    ]);

    if (setRes.status === 'fulfilled' && setRes.value && cfgRes.status === 'fulfilled' && cfgRes.value) {
      const prevLayout = State.settings ? State.settings.uiLayout : null;
      State.settings = setRes.value;
      State.config = cfgRes.value;
      store.set('cached_settings', State.settings);
      store.set('cached_config', State.config);
      if (fastBooted && prevLayout && prevLayout !== State.settings.uiLayout) {
        LIST_PAGE_CACHE.delete('home');
      }
    } else if (!fastBooted) {
      const errMsg = (setRes.reason && setRes.reason.message) || (cfgRes.reason && cfgRes.reason.message) || '网络异常';
      $('#view').innerHTML = `<div class="container empty" style="padding-top:120px">
        <div class="big">🛠️</div><p style="font-weight:700">后端服务连接失败：${esc(errMsg)}</p>
        <p style="margin-top:10px;color:var(--dim);font-size:13px;line-height:2">
          · 本地预览：项目文件夹运行 <code style="background:var(--card);padding:2px 8px;border-radius:6px">npm run dev</code>，再访问 http://127.0.0.1:8787<br>
          · 线上部署：确认 _worker.js 与静态资源已一起部署（Workers 或 Pages 高级模式），详见 部署指南.md</p>
        <p style="margin-top:14px"><button class="btn primary" onclick="location.reload()">重试</button></p></div>`;
      return;
    }

    if (meRes.status === 'fulfilled' && meRes.value && meRes.value.me) {
      const m = meRes.value;
      State.me = m.me.username;
      State.meCreated = Number(m.me.createdAt || 0);
      State.adultAllowed = Boolean(m.me.adultAllowed);
      State.adultExpireAt = Number(m.me.adultExpireAt || 0);
      State.unreadMsgCount = Number(m.me.unreadMsgCount || 0);
      store.set('cached_me', State.me);
      pullFavsMerge();
    } else {
      State.me = null;
      store.set('cached_me', null);
      // 仅当存在管理员会话令牌或访问后台路由时才探测 adminSession，省去普通访客每次401往返
      const hasAdmTok = Boolean(sessionStorage.getItem('ntv:adminToken')) || /ntv_auth=/.test(document.cookie || '');
      const isAdmHash = /^#\/(xiaolin1991|admin)/i.test(location.hash || '') || /^\/(xiaolin1991|admin)(?:\/|$)/i.test(location.pathname || '');
      if (hasAdmTok || isAdmHash) {
        try {
          await API.adminSession();
          State.me = '管理员';
          store.set('cached_me', '管理员');
        } catch (e2) {}
      }
    }

    updateUserBox();
    renderBottomNav();

    if (!store.get('theme', null) && State.settings.defaultTheme) applyTheme(State.settings.defaultTheme);
    applyUiMode(State.settings.uiLayout || 'modern', State.settings.uiModernTheme || 'light');
    const sTitle = State.settings.siteName || '晓林影视';
    const sSlogan = State.settings.siteSlogan || '';
    $('#brandName').textContent = sTitle;
    document.title = sSlogan ? `${sTitle} - ${sSlogan}` : sTitle;
    applyAnnouncement(State.settings.announcement);

    if (!fastBooted) {
      try { window.dispatchEvent(new CustomEvent('xl:ready')); } catch (e) {}
      route();
    }
    maybeAppPromo();  // 首屏就绪后判断是否弹下载引导
    maybeAppUpdate(); // App 内版本更新检查
    initGuest();
    window.addEventListener('xl:need-login', () => showTrialModal(true));
  }

  boot();
})();
