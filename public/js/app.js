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
      const ua = navigator.userAgent || '';
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
    if (/[a-zA-Z]/.test(ch)) return ch.toUpperCase();
    const cmp = (a, b) => (pyCmp ? pyCmp.compare(a, b) : (a < b ? -1 : a > b ? 1 : 0));
    // 找到最后一个 <= ch 的边界字
    let lo = 0, hi = PY_BOUNDS.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cmp(PY_BOUNDS[mid], ch) <= 0) { ans = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return ans >= 0 ? PY_LETTERS[ans] : '';
  }
  function titleInitials(name) {
    let out = '';
    for (const ch of String(name || '')) {
      const c = pyInitial(ch);
      if (c) out += c;
      if (out.length >= 8) break;
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
    if (sec < 60) return sec + ' 秒';
    const m = Math.floor(sec / 60);
    if (m < 60) return m + ' 分钟';
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
  };

  const FEATURED_ORDER = ['dbzy.tv', 'mtzy.me', 'iqiyizyapi.com', 'ruyizy.cn', 'tyyszy.com', 'bfzy.tv', 'wolongzyw.com'];
  const CAT_REGEX = {
    '电影': /(电影|片)$|电影/,
    '剧集': /(剧|连续剧)/,
    '综艺': /(综艺|真人秀|晚会)/,
    '动漫': /(动漫|动画|漫画)/,
  };
  const YEARS = ['全部', '2026', '2025', '2024', '2023', '2022', '2021', '2020'];

  // 成人内容仅由后台总开关控制(服务器端过滤), 前台不再展示任何开关
  function visibleSources() {
    if (!State.config) return [];
    return State.config.sources;
  }

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
  function logSearch(q) {
    if (!q) return;
    if (State.me) API.userLogSearch(q); // 用户维度记录
    try { // 全站统计(含未登录)
      const payload = JSON.stringify({ q });
      if (navigator.sendBeacon) navigator.sendBeacon('/api/stats/search', new Blob([payload], { type: 'application/json' }));
      else fetch('/api/stats/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(() => {});
    } catch (e) {}
  }
  function trackVisit(path) {
    try {
      const payload = JSON.stringify({ path });
      if (navigator.sendBeacon) navigator.sendBeacon('/api/stats/visit', new Blob([payload], { type: 'application/json' }));
      else fetch('/api/stats/visit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(() => {});
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
  /** 卡片为真实链接, 新标签页打开详情, 不丢失当前搜索/浏览页 */
  function cardHtml(item) {
    indexTitle(item); // 登记到全站标题索引(供首字母快搜)
    // 海报卡片直接进播放器页面(跳过详情中间页); 详情仍可从播放页「← 详情」进入
    const href = `#/play/${esc(item.sourceKey)}/${encodeURIComponent(item.id)}?ep=0&group=0`;
    return `
      <a class="card" href="${href}" target="_blank" rel="noopener">
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
    { id: 'midnight', name: '暗夜蓝', dot: '#5b8cff', bg: '#070b14' },
    { id: 'emerald', name: '翡翠绿', dot: '#34d399', bg: '#06110d' },
    { id: 'sunset', name: '落日橙', dot: '#ff8a3d', bg: '#150e08' },
    { id: 'sakura', name: '樱花粉', dot: '#ff6b9d', bg: '#fdf4f7' },
    { id: 'ocean', name: '海洋青', dot: '#0ea5b7', bg: '#f1f9fc' },
    { id: 'royal', name: '鎏金紫', dot: '#a78bfa', bg: '#100c1c' },
    // 节日主题
    { id: 'christmas', name: '圣诞夜 🎄', dot: '#e0393e', bg: '#071410' },
    { id: 'spring', name: '新春红 🧨', dot: '#ffb347', bg: '#1c0808' },
    { id: 'lantern', name: '元宵灯彩 🏮', dot: '#ff7ab6', bg: '#170b20' },
    { id: 'halloween', name: '万圣夜 🎃', dot: '#ff8a3d', bg: '#140b1d' },
    { id: 'valentine', name: '情人节 💝', dot: '#ff5d73', bg: '#fdf0f2' },
    { id: 'midautumn', name: '中秋月 🌕', dot: '#f5c66d', bg: '#0a1224' },
  ];
  function applyTheme(id) {
    if (!THEME_META.some((t) => t.id === id)) id = 'midnight';
    document.documentElement.setAttribute('data-theme', id);
    store.set('theme', id);
    $$('#themePop .theme-item').forEach((el) => el.classList.toggle('active', el.dataset.tid === id));
  }
  function buildThemePop() {
    const pop = $('#themePop');
    pop.innerHTML = THEME_META.map((t) => `
      <div class="theme-item ${store.get('theme') === t.id ? 'active' : ''}" data-tid="${t.id}">
        <span class="theme-dot" style="background:${t.bg}; box-shadow: inset 0 0 0 10px ${t.dot}"></span>
        <span>${t.name}</span>
      </div>`).join('');
    $$('.theme-item', pop).forEach((el) => el.addEventListener('click', () => {
      applyTheme(el.dataset.tid);
      toast('已切换主题：' + THEME_META.find((x) => x.id === el.dataset.tid).name, 'ok');
    }));
  }

  /* ------------------------------ 导航 ------------------------------ */
  const NAVS = [
    ['#/home', '首页'], ['#/browse/电影', '电影'], ['#/browse/剧集', '剧集'],
    ['#/browse/综艺', '综艺'], ['#/browse/动漫', '动漫'], ['#/sources', '影视源'], ['#/live', '电视直播'],
    ['#/download', '下载APP'],
  ];
  function buildNav() {
    // 已在官方 App 内(WebView 专属 UA) → 自动隐藏「下载APP」入口
    const items = inApp() ? NAVS.filter(([href]) => href !== '#/download') : NAVS;
    $('#mainNav').innerHTML = items.map(([href, label]) =>
      `<a href="${href}" data-href="${href}">${label}</a>`).join('');
  }
  function markNav(hash) {
    $$('#mainNav a').forEach((a) => a.classList.toggle('active', hash.startsWith(a.dataset.href)));
  }

  /* ------------------------------ 路由 ------------------------------ */
  function parseHash() {
    let h = location.hash.replace(/^#/, '') || '/home';
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
    Player.destroy();
    markNav('#/' + (parts[0] || 'home'));
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
    const alive = makeAlive(); // 页面切换后旧异步任务自动失效
    const dec = (s) => { try { return decodeURIComponent(s || ''); } catch (e) { return s || ''; } };
    if (State.config) trackVisit('#/' + parts.join('/')); // 页面访问统计
    // 强制登录: 未登录只允许登录页与后台
    if (loginRequired() && !['login', 'admin'].includes(parts[0])) {
      markNav('');
      if (location.hash && location.hash !== '#/login') store.set('afterLogin', location.hash); // 记住来路, 登录/注册后送回
      return viewLogin(alive, true);
    }
    try {
      if (parts[0] === 'browse') await viewBrowse(dec(parts[1]) || '电影', query, alive);
      else if (parts[0] === 'search') await viewSearch(query.q ? dec(query.q) : '', alive);
      else if (parts[0] === 'detail') await viewDetail(parts[1], dec(parts[2]), alive);
      else if (parts[0] === 'play') await viewPlay(parts[1], dec(parts[2]), query, alive);
      else if (parts[0] === 'sources') await viewSources(dec(parts[1]) || '', query, alive);
      else if (parts[0] === 'source') await viewSources(dec(parts[1]), query, alive); // 兼容旧链接
      else if (parts[0] === 'login') await viewLogin(alive, false);
      else if (parts[0] === 'user') await viewUser(alive);
      else if (parts[0] === 'live') await viewLive(query);
      else if (parts[0] === 'download') await viewDownload(alive);
      else if (parts[0] === 'admin') await viewAdmin(query, parts[0]);
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
     视图：首页(网格布局 · 每类固定 14 个 · 数据不足自动补充)
     ============================================================ */
  const HOME_ROW_COUNT = 14;
  let heroTimer = null;
  async function viewHome(alive) {
    clearInterval(heroTimer);
    if (!alive()) return;
    const v = $('#view');
    v.innerHTML = `
      <div class="container page-wrap">
        <div class="hero"><div class="hero-bg" id="heroBg"></div>
          <div class="hero-content" id="heroContent"></div>
          <div class="hero-dots" id="heroDots"></div>
        </div>
        <div id="rows"></div>
      </div>`;

    // 分类行骨架(网格, 不再横向滚动)
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

    // 并行拉取精选源前 3 页, 统一归类去重入池
    const pool = { 电影: [], 剧集: [], 综艺: [], 动漫: [], general: [] };
    const seen = new Set();
    const sources = featuredSources(6);
    const jobs = [];
    for (const s of sources) {
      for (let pg = 1; pg <= 3; pg++) jobs.push(API.list(s, pg).then((r) => ({ s, r })).catch(() => null));
    }
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
        if (!matched) pool.general.push(item); // 未匹配分类的影片, 用于补足 14 个
      }
    };

    const filledCats = new Set();
    const fillRows = (finalPass) => {
      if (!alive()) return;
      const grids = $$('#rows .row .grid.row-grid');
      cats.forEach(([cat], i) => {
        if (filledCats.has(cat)) return;
        const list = pool[cat];
        if (list.length >= HOME_ROW_COUNT || (finalPass && list.length)) {
          // 数量不足时用通用池/其他分类补充
          const usedKeys = new Set(list.map((it) => it.title + '|' + it.year));
          const extras = [];
          const donors = pool.general.concat(...cats.map(([c]) => pool[c])); // concat 展开替代 .flat()(老WebView兼容)
          for (const it of donors) {
            if (list.length + extras.length >= HOME_ROW_COUNT) break;
            const kk = it.title + '|' + it.year;
            if (usedKeys.has(kk)) continue;
            usedKeys.add(kk);
            extras.push(it);
          }
          const full = list.concat(extras).slice(0, HOME_ROW_COUNT);
          setHtml(grids[i], full.map(cardHtml).join(''));
          filledCats.add(cat);
          if (cat === '电影') setupHero(full.filter((it) => it.pic).slice(0, 5), alive);
        } else if (finalPass && !list.length) {
          setHtml(grids[i], '<div class="empty" style="grid-column:1/-1;padding:26px;font-size:13px">该分类暂时没有数据</div>');
          filledCats.add(cat);
        }
      });
    };

    let settled = 0;
    for (const p of jobs) {
      p.then((j) => { consume(j); settled++; if (settled % 3 === 0) fillRows(false); });
    }
    await Promise.allSettled(jobs);
    fillRows(true);
    loadHero(alive);
  }

  /* ---- Hero ---- */
  let heroItems = [], heroIdx = 0;
  function setupHero(items, alive) {
    if (!items.length || !alive()) return;
    heroItems = items; heroIdx = 0;
    const dots = $('#heroDots');
    if (!dots) return;
    dots.innerHTML = items.map((_, i) => `<i class="${i === 0 ? 'on' : ''}"></i>`).join('');
    $$('#heroDots i').forEach((d, i) => d.addEventListener('click', () => showHero(i)));
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
      if (!bg.isConnected) return; // 页面已切换
      bg.style.backgroundImage = `url("${it.pic}")`; bg.classList.add('show');
    };
    img.onerror = () => {};
    img.referrerPolicy = 'no-referrer';
    img.src = it.pic;
    ct.innerHTML = `
      <div class="hero-meta">
        <span class="tag">${esc(it.typeName || '影视')}</span>
        ${it.year ? `<span class="tag plain">${esc(it.year)}</span>` : ''}
        ${it.remarks ? `<span class="tag plain">${esc(it.remarks)}</span>` : ''}
      </div>
      <div class="hero-title">${esc(it.title)}</div>
      <p class="hero-desc">${esc(stripTags(it.desc || ''))}</p>
      <button class="btn primary" id="heroPlay">▶ 立即播放</button>`;
    const playBtn = $('#heroPlay');
    playBtn && playBtn.addEventListener('click', () => {
      location.hash = `#/detail/${it.sourceKey}/${encodeURIComponent(it.id)}`;
    });
    $$('#heroDots i').forEach((d, di) => d.classList.toggle('on', di === i));
  }
  async function loadHero(alive) {
    // 轮询等待 Hero 就绪后, 拉取详情补充简介(尽力而为)
    const wait = setInterval(async () => {
      if (!alive() || !document.getElementById('heroBg')) { clearInterval(wait); return; }
      if (heroItems.length) {
        clearInterval(wait);
        try {
          const it = heroItems[heroIdx];
          const src = State.config.sources.find((s) => s.key === it.sourceKey);
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

    $$('#yearChips .chip').forEach((c) => c.addEventListener('click', () => {
      location.hash = `#/browse/${encodeURIComponent(cat)}?year=${encodeURIComponent(c.dataset.y)}`;
    }));

    const statEl = $('#browseStat');
    const setStat = (t) => { if (alive() && statEl) statEl.textContent = t; };

    /** 并发执行一批任务(每源一页), 单个返回立即上屏 */
    async function runWave(tasks) {
      let added = 0, done = 0;
      let idx = 0;
      const CONC = 5;
      const worker = async () => {
        while (idx < tasks.length) {
          if (!alive()) return added;
          const { s, pg } = tasks[idx++];
          try {
            const r = await API.list(s, pg);
            const grid = $('#browseGrid');
            if (!grid || !alive()) return added;
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
      if (waving || exhausted || !alive()) return;
      waving = true;
      setStat('⏳ 正在加载更多…');
      const added = await runWave(nextTasks(2));
      if (!alive()) return;
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
    if (!alive()) return;
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
      }, { rootMargin: '500px' });
      io.observe(sentinel);
    }
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
    // 🔤 纯字母关键词 → 本地首字母快搜(浏览/收藏过的片名, 秒出结果)
    if (/^[a-zA-Z]{1,8}$/.test(q)) {
      try {
        store.get('favs', []).forEach((f) => indexTitle({ title: f.title, pic: f.pic, remarks: f.remarks, sourceKey: f.key, id: f.id }));
      } catch (e) { /* ignore */ }
      const want = q.toUpperCase();
      const hits = [...TitleIdx.values()]
        .filter((it) => { const ini = titleInitials(it.title); return ini === want || ini.startsWith(want); })
        .slice(0, 24);
      const localBox = $('#srLocal');
      if (localBox) localBox.innerHTML = hits.length ? `
        <div style="margin:2px 0 14px">
          <div style="font-size:15px;font-weight:700;margin-bottom:10px">🔤 首字母「${esc(want)}」本地匹配 <small style="color:var(--dim);font-weight:400;font-size:12px">· 来自你浏览/收藏过的内容</small></div>
          <div class="grid">${hits.map(cardHtml).join('')}</div>
        </div>` : '';
    }
    if (!alive()) return;
    logSearch(q); // 搜索记录上报(登录用户)

    const sources = visibleSources();
    const merged = new Map(); // normTitle|year -> item
    let done = 0, renderTimer = null, reveal = 48;

    const applyProgress = () => {
      const finished = done >= sources.length;
      const bar = $('#progBar'), stat = $('#srcStat'), prog = $('.search-progress', v);
      if (bar) {
        bar.style.width = Math.round((done / Math.max(sources.length, 1)) * 100) + '%';
        bar.classList.toggle('done', finished);
      }
      if (stat) {
        stat.innerHTML = finished
          ? `<span class="search-done">✅ 搜索完成</span> · ${sources.length} 个源 · 共 ${merged.size} 条结果`
          : `<span class="spin"></span> 正在搜索 <b>${done}</b>/${sources.length} 个源 · 已找到 ${merged.size} 条…`;
      }
      if (prog && finished) prog.remove();
    };
    const renderGrid = () => {
      if (!alive()) return;
      const grid = $('#srGrid');
      if (!grid) return;
      grid.innerHTML = [...merged.values()]
        .sort((a, b) => b.srcCount - a.srcCount)
        .slice(0, reveal).map(cardHtml).join('');
      const sen = $('#srSentinel');
      if (sen) sen.classList.toggle('hidden', merged.size <= reveal);
    };
    // 滚动分批展示更多结果
    const srSen = $('#srSentinel');
    if (srSen && 'IntersectionObserver' in window) {
      const io = new IntersectionObserver((es) => {
        es.forEach((en) => {
          if (en.isIntersecting && reveal < merged.size) { reveal += 48; renderGrid(); }
        });
      }, { rootMargin: '400px' });
      io.observe(srSen);
    }
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
        else merged.set(key, { ...hit, srcCount: 1, sources: [hit], showSource: true });
      }
      scheduleRender();
    };

    // 固定并发池: 始终保持 12 个源在搜, 单个完成立即计数/渲染
    let idx = 0;
    const CONCURRENCY = Math.min(12, sources.length);
    const worker = async () => {
      while (idx < sources.length) {
        if (!alive()) return;
        const i = idx++;
        try { handle(sources[i], await API.search(sources[i], q)); } catch (e) { /* 该源失败 */ }
        done++;
        applyProgress();
      }
    };
    await Promise.allSettled(Array.from({ length: CONCURRENCY }, worker));
    if (!alive()) return;
    if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
    applyProgress();
    renderGrid();
    if (!merged.size) setHtml('#srEmpty', '<div class="big">🙈</div><p>没有找到相关内容</p>');
    const emptyEl = $('#srEmpty');
    if (emptyEl && !merged.size) emptyEl.classList.remove('hidden');
  }

  /* ============================================================
     视图：详情
     ============================================================ */
  async function viewDetail(key, id, alive) {
    const v = $('#view');
    const src = State.config.sources.find((s) => s.key === key);
    if (!src) { v.innerHTML = '<div class="container empty">数据源不存在或已被后台关闭</div>'; return; }
    v.innerHTML = `<div class="container page-wrap"><div class="grid"></div><div class="empty"><div class="big">📡</div>正在加载详情…</div></div>`;

    let r;
    try { r = await API.detail(src, id); }
    catch (e) { throw new Error('该源暂时无法访问（' + e.message + '），可点「换源」找其他播放源'); }
    if (!alive()) return;
    const vod = r.list && r.list[0];
    if (!vod) throw new Error('影片不存在或接口失效');

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
                <span class="tag plain">来源：${esc(src.name)}</span>
              </div>
              <div class="meta-row" style="font-size:13px;color:var(--dim)">
                ${vod.vod_director ? `<span>导演：${esc(stripTags(vod.vod_director))}</span>` : ''}
                ${vod.vod_actor ? `<span>主演：${esc(stripTags(vod.vod_actor).slice(0, 60))}</span>` : ''}
              </div>
              <div class="detail-actions">
                <button class="btn primary" id="btnPlay">▶ 立即播放</button>
                <button class="btn ghost" id="btnFav">${isFav ? '★ 已收藏' : '☆ 收藏'}</button>
                <button class="btn ghost" id="btnSrc">⇄ 换源</button>
              </div>
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
        location.hash = `#/play/${key}/${encodeURIComponent(id)}?ep=${b.dataset.ei}&group=${gi}`;
      }));
      $$('#epTabs .chip').forEach((c) => c.classList.toggle('on', Number(c.dataset.gi) === gi));
    }
    $$('#epTabs .chip').forEach((c) => c.addEventListener('click', () => { gi = Number(c.dataset.gi); renderEps(); }));
    renderEps();

    $('#btnPlay').addEventListener('click', () => {
      location.hash = `#/play/${key}/${encodeURIComponent(id)}?ep=${hist.ep != null ? hist.ep : 0}&group=${gi}`;
    });
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
    const src = State.config.sources.find((s) => s.key === key);
    if (!src) { v.innerHTML = '<div class="container empty">数据源不存在</div>'; return; }
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

    const progKey = `prog:${key}:${vod.vod_id}`;
    const allProg = store.get(progKey, {});

    const isFav = store.get('favs', []).some((f) => f.key === key && f.id === String(vod.vod_id));
    v.innerHTML = `
      <div class="container page-wrap play-head">
        <div class="pb-title">${esc(vod.vod_name)}<span id="curEpName">${esc(groups[gi].eps[ei].name)}</span></div>
      </div>
      <div class="play-stage">
        <div class="video-wrap" id="videoWrap"><video id="videoEl" controls playsinline autoplay></video>
          <button class="fs-exit-btn" id="fsExit" type="button">✕ 退出全屏</button>
          <div class="src-badge" id="srcBadge" title="当前播放源">${srcIconHtml(src)}<span>${esc(cleanSrcName(src))}</span></div>
          <div class="video-tip hidden" id="videoTip"></div>
          <div class="gest-hud" id="gestHud"></div>
        </div>
      </div>
      <div class="container page-wrap play-below">
        <div class="play-actions">
          <a class="btn ghost small" href="#/detail/${key}/${encodeURIComponent(id)}">← 详情</a>
          <button class="chip ${store.get('autoNext', true) ? 'on' : ''}" id="autoNext">连播: ${store.get('autoNext', true) ? '开' : '关'}</button>
          <button class="chip play-fav ${isFav ? 'on' : ''}" id="playFav">${isFav ? '★ 已收藏' : '☆ 收藏'}</button>
          <button class="chip" id="fsBtn" title="全屏播放">⛶ 全屏</button>
        </div>
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
    function stopSaveTimer() { if (saveTimer) { clearInterval(saveTimer); saveTimer = null; } }

    function playCurrent(resume) {
      const ep = groups[gi].eps[ei];
      Player.play(video, ep.url, tip);
      tip.classList.remove('hidden');
      tip.textContent = '正在加载…';
      const clear = () => { tip.classList.add('hidden'); };
      video.addEventListener('playing', clear, { once: true });
      video.addEventListener('error', () => { tip.classList.remove('hidden'); tip.textContent = '播放失败，请尝试换集或在右上角「快速换源」换一个源'; }, { once: true });

      if (resume && allProg[gi + ':' + ei] && allProg[gi + ':' + ei].t > 20) {
        const onceSeek = () => { try { video.currentTime = allProg[gi + ':' + ei].t; } catch (e) {} };
        video.addEventListener('loadedmetadata', onceSeek, { once: true });
      }
      // 进度保存 + 观看心跳(每30秒向服务器累计观看时长)
      stopSaveTimer();
      let beat = 0;
      saveTimer = setInterval(() => {
        if (!alive() || !video.isConnected) return stopSaveTimer(); // 已切页: 自动停止
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
      if (nextGi != null) gi = nextGi;
      ei = nextEi;
      epsPg = Math.floor(ei / EPP);
      history.replaceState(null, '', `#/play/${key}/${encodeURIComponent(id)}?ep=${ei}&group=${gi}`);
      renderSideEps();
      playCurrent(true);
      const t = $('#curEpName');
      if (t) t.textContent = groups[gi].eps[ei].name;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    $('#autoNext').addEventListener('click', (e) => {
      const nv = !store.get('autoNext', true);
      store.set('autoNext', nv);
      e.target.textContent = '连播: ' + (nv ? '开' : '关');
      e.target.classList.toggle('on', nv);
    });

    // ⛶ 全屏: 优先「容器级」元素全屏 —— 亮度滤镜/手势/进度滑动在全屏内依然生效;
    // 浏览器不支持元素全屏(旧 iPhone Safari)时启用自绘假全屏兜底, 手势照常可用
    $('#fsBtn').addEventListener('click', () => {
      const wrap = $('#videoWrap');
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      if (fsEl) { (document.exitFullscreen || document.webkitExitFullscreen || (() => {})).call(document); return; }
      if (wrap.classList.contains('fake-fs')) { exitFakeFs(); return; }
      const legacyFs = () => {
        if (video.webkitEnterFullscreen) { try { video.webkitEnterFullscreen(); return; } catch (e) {} }
        if (wrap.requestFullscreen) wrap.requestFullscreen().catch(() => enterFakeFs());
        else if (wrap.webkitRequestFullscreen) wrap.webkitRequestFullscreen();
        else enterFakeFs();
      };
      if (wrap.requestFullscreen) wrap.requestFullscreen().catch(legacyFs);
      else if (wrap.webkitRequestFullscreen) { try { wrap.webkitRequestFullscreen(); } catch (e) { legacyFs(); } }
      else legacyFs();
    });
    function enterFakeFs() {
      const wrap = $('#videoWrap');
      wrap.classList.add('fake-fs');
      document.body.style.overflow = 'hidden';
      screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {});
    }
    function exitFakeFs() {
      const wrap = $('#videoWrap');
      wrap.classList.remove('fake-fs');
      document.body.style.overflow = '';
      try { screen.orientation && screen.orientation.unlock && screen.orientation.unlock(); } catch (e) {}
    }
    $('#fsExit').addEventListener('click', exitFakeFs);
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        // 从系统全屏退出后恢复滚动锁与假全屏状态
        const wrap = $('#videoWrap');
        if (wrap && !wrap.classList.contains('fake-fs')) document.body.style.overflow = '';
      }
    });

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

    // ---- 触屏手势: 绑定在整个播放器容器(含全屏状态), preventDefault 阻止页面滚动 ----
    // 左半边上下滑=亮度(滤镜作用于容器, 全屏不丢) | 右半边上下滑=音量 | 左右横滑=快进快退
    if (('ontouchstart' in window) || (navigator.maxTouchPoints > 0)) {
      const wrap = $('#videoWrap');
      const hud = $('#gestHud');
      const fmtT = (sec) => {
        sec = Math.max(0, Math.floor(sec || 0));
        const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s2 = sec % 60;
        return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s2).padStart(2, '0');
      };
      let bright = Number(store.get('vidBright', 1)) || 1;
      // 亮度作用于容器: 进入容器级/假全屏后依旧生效, 与手机屏幕外亮度互不影响
      try { wrap.style.filter = `brightness(${bright})`; } catch (e) {}
      let sx = 0, sy = 0, mode = '', startVal = 0, halfW = 200;
      let seekBase = 0, seekTarget = -1, lastSeekApply = 0, hudTimer = null;
      // 竖向手势: 图标 + 竖形进度条(左=亮度 / 右=音量), 一眼可见滑动生效
      const showBarHud = (icon, pct, side) => {
        const p = Math.max(0, Math.min(100, Math.round(pct)));
        hud.innerHTML = `<div class="gh-ico">${icon}</div><div class="gh-bar"><i style="height:${p}%"></i></div><div class="gh-val">${p}%</div>`;
        hud.style.left = side === 'b' ? '24%' : '76%';
        hud.classList.add('bar');
        hud.classList.add('show');
        clearTimeout(hudTimer);
        hudTimer = setTimeout(() => hud.classList.remove('show'), 550);
      };
      const showTextHud = (t) => {
        hud.textContent = t;
        hud.style.left = '50%';
        hud.classList.remove('bar');
        hud.classList.add('show');
        clearTimeout(hudTimer);
        hudTimer = setTimeout(() => hud.classList.remove('show'), 550);
      };

      wrap.addEventListener('touchstart', (e) => {
        const t = e.touches[0];
        sx = t.clientX; sy = t.clientY; mode = ''; seekTarget = -1;
        halfW = wrap.getBoundingClientRect().width / 2 || 200;
      }, { passive: true });

      wrap.addEventListener('touchmove', (e) => {
        const t = e.touches[0];
        const dx = t.clientX - sx, dyUp = sy - t.clientY;
        if (!mode) {
          if (Math.abs(dx) < 14 && Math.abs(dyUp) < 14) return;
          // 主轴判定: 横向=进度; 纵向按触点左/右半区=亮度/音量
          mode = Math.abs(dx) > Math.abs(dyUp)
            ? 'seek'
            : (sx - (wrap.getBoundingClientRect().left || 0) < halfW ? 'b' : 'v');
          startVal = mode === 'b' ? bright : mode === 'v' ? video.volume : (video.currentTime || 0);
          if (mode === 'seek') seekBase = video.currentTime || 0;
        }
        e.preventDefault(); // 手势期间锁定页面滚动(全屏内同样有效)

        if (mode === 'b') {
          bright = Math.min(2.2, Math.max(0.25, startVal + dyUp / 180));
          try { wrap.style.filter = `brightness(${bright})`; } catch (err) {}
          store.set('vidBright', Number(bright.toFixed(2)));
          showBarHud('☀️', ((bright - 0.25) / (2.2 - 0.25)) * 100, 'b');
        } else if (mode === 'v') {
          const nv = Math.min(1, Math.max(0, startVal + dyUp / 180));
          try { video.volume = nv; video.muted = false; } catch (err) { /* iOS 系统限制 */ }
          showBarHud(nv <= 0 ? '🔇' : '🔊', nv * 100, 'v');
        } else if (mode === 'seek' && video.duration) {
          // 整屏宽度 ≈ 快进/快退 90 秒
          seekTarget = Math.min(video.duration - 0.5, Math.max(0, seekBase + dx * (90 / halfW)));
          const fwd = seekTarget >= seekBase;
          showTextHud(`${fwd ? '⏩' : '⏪'} ${fmtT(seekTarget)} / ${fmtT(video.duration)}`);
          const now = Date.now();
          if (now - lastSeekApply > 300 && video.readyState >= 2) {
            try { video.currentTime = seekTarget; lastSeekApply = now; } catch (err) {}
          }
        }
      }, { passive: false }); // 必须 false 才能 preventDefault 阻止页面滚动

      wrap.addEventListener('touchend', () => {
        // 结束时把最终目标时间精确落位(节流期间可能未应用到最后值)
        if (mode === 'seek' && seekTarget >= 0 && video.duration) {
          try { video.currentTime = seekTarget; } catch (e) {}
          showTextHud('⏱ 已跳到 ' + fmtT(video.currentTime));
        }
        mode = ''; seekTarget = -1;
      });
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
        // 点击任意可选源: 导航的同时自动关闭弹窗
        box.addEventListener('click', (ev) => {
          if (ev.target === box || ev.target.closest('a.src-item')) box.remove();
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
            if (hit && hit.vod_id) {
              hits.push({ s, ms, spdCls, id: hit.vod_id });
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
            misses.push({ s, ms: 0, spdCls: '', why: '超时/失效' });
            if (swapMiss) swapMiss.insertAdjacentHTML('beforeend',
              `<span class="src-item miss" title="${esc(s.name)} · 请求超时或源已失效">
                 ${srcIconHtml(s)}<span>${esc(s.name)}</span><small class="fail">超时/失效</small></span>`);
            updMissToggle();
          }
          updStat();
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
    const curSrc = State.config.sources.find((s) => s.key === curKey) || null;
    const others = visibleSources().filter((s) => s.key !== curKey);
    for (let i = others.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [others[i], others[j]] = [others[j], others[i]];
    }

    const seenR = new Set([String(vod.vod_name || '').replace(/\s/g, '')]);
    let relItems = [];
    let renderTimer = null;
    const renderGrid = () => {
      if (!alive()) return;
      const g = gridEl();
      if (g) g.innerHTML = relItems.slice(0, REL_COUNT).map(cardHtml).join('');
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

      if (!alive()) return;
      if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
      relItems = relItems.slice(0, REL_COUNT);
      if (!relItems.length) { sec.innerHTML = ''; return; }
      sec.innerHTML = `
        <div class="row-head"><div class="row-title">相关推荐</div>
          <div style="color:var(--dim);font-size:12.5px">${relItems.length} 部相关影片</div></div>
        <div class="grid rel-grid">${relItems.map(cardHtml).join('')}</div>`;
    } catch (e) { /* 相关推荐失败不影响播放 */ }
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
              <svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="21" fill="none" stroke="var(--acc)" stroke-width="3"/><path d="M19 15.5v17l14-8.5z" fill="var(--acc)"/></svg>
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
      const username = $('#authUser').value.trim();
      const pwd = $('#authPwd').value;
      if (!USERNAME_OK(username)) return toast('用户名需 2-20 位中文/字母/数字/下划线', 'err');
      if (pwd.length < 6) return toast('密码至少 6 位', 'err');
      try {
        if (mode === 'login') await API.userLogin(username, pwd);
        else {
          if (pwd !== $('#authPwd2').value) return toast('两次输入的密码不一致', 'err');
          await API.userRegister(username, pwd);
        }
        State.me = username;
        updateUserBox();
        try { const mm = await API.userMe(); if (mm && mm.me) State.meCreated = Number(mm.me.createdAt || 0); } catch (e) {}
        pullFavsMerge(); // 登录/注册成功: 拉取云端收藏并合并
        toast((mode === 'login' ? '欢迎回来，' : '注册成功，') + username, 'ok');
        // 关键: 若当前哈希已等于目标(如一直停在 #/home), 赋值不会触发路由, 必须手动调用
        const target = store.get('afterLogin', '') || '#/home';
        store.set('afterLogin', '');
        if ((location.hash || '') === target) route();
        else location.hash = target;
      } catch (e) {
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
    } catch (e) { /* 探测失败不阻塞浏览 */ }
  }
  function showTrialModal(expired, remainSec) {
    if (State.me || trialModalShown) return;
    trialModalShown = true;
    const box = document.createElement('div');
    box.className = 'modal-mask';
    const mins = Math.max(1, Math.round((remainSec != null ? remainSec : (State.guest && State.guest.remain) || 0) / 60));
    box.innerHTML = `
      <div class="modal-box" style="width:min(92vw,400px);text-align:center">
        <button class="trial-x" type="button" title="稍后再说">×</button>
        <div style="font-size:40px;line-height:1">${expired ? '⏰' : '🎁'}</div>
        <h3 style="margin:10px 0 6px">${expired ? '试看时间已到' : `游客可免费试看 ${mins} 分钟`}</h3>
        <p class="hint">注册账号后继续观看，还可解锁：<br>☁️ 收藏云同步 · 📺 观看进度续播 · 📲 APP 下载引导</p>
        <div class="chips" style="justify-content:center;margin:12px 0 4px">
          <button class="chip on" data-m="reg" type="button">注 册</button>
          <button class="chip" data-m="login" type="button">登 录</button>
        </div>
        <input class="field-input t-user" placeholder="用户名（2-20位中文/字母/数字）">
        <input class="field-input t-pwd" type="password" placeholder="密码（至少6位）" style="margin-top:10px">
        <input class="field-input t-pwd2" type="password" placeholder="确认密码" style="margin-top:10px">
        <button class="btn primary t-go" style="width:100%;justify-content:center;margin-top:14px">注册并继续观影</button>
      </div>`;
    document.body.appendChild(box);
    let mode = 'reg';
    const syncMode = () => {
      $$('.chip', box).forEach((c) => c.classList.toggle('on', c.dataset.m === mode));
      $('.t-go', box).textContent = mode === 'reg' ? '注册并继续观影' : '登录并继续观影';
      $('.t-pwd2', box).style.display = mode === 'reg' ? '' : 'none';
    };
    $$('.chip', box).forEach((c) => c.addEventListener('click', () => { mode = c.dataset.m; syncMode(); }));
    const close = () => { trialModalShown = false; box.remove(); };
    $('.trial-x', box).addEventListener('click', close);
    box.addEventListener('click', (e) => { if (e.target === box) close(); });
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
        updateUserBox();
        try { const mm = await API.userMe(); if (mm && mm.me) State.meCreated = Number(mm.me.createdAt || 0); } catch (e) {}
        pullFavsMerge();
        toast((mode === 'reg' ? '注册成功，' : '欢迎回来，') + username + '，继续观影吧', 'ok');
        close();
      } catch (e) { toast(e.message || '操作失败', 'err'); }
    };
    $('.t-go', box).addEventListener('click', submit);
    $('.t-pwd2', box).addEventListener('keydown', (e) => e.key === 'Enter' && submit());
    setTimeout(() => { const i = $('.t-user', box); i && i.focus(); }, 80);
  }

  /* ============================================================
     视图：个人中心(观看记录 / 我的收藏)
     ============================================================ */
  async function viewUser(alive) {
    const v = $('#view');
    if (!State.me) { location.hash = '#/login'; return; }

    let data = null;
    try { data = await API.userHistory(); } catch (e) { /* 未登录/KV异常 */ }
    if (!alive()) return;

    const favs = store.get('favs', []);
    const watchItems = data ? data.items.filter((it) => it.kind === 'watch') : [];
    const searchItems = data ? data.items.filter((it) => it.kind === 'search') : [];
    let tab = 'watch';

    v.innerHTML = `
      <div class="container page-wrap">
        <div class="page-head">
          <div class="page-title">👤 ${esc(State.me)}</div>
          <button class="btn ghost small" id="uLogout">退出登录</button>
        </div>
        <div class="user-stats">
          <span>⏱ 累计观看 <b>${fmtWatchSec(data ? data.watchSec : 0)}</b></span>
          <span>🎬 观看记录 <b>${watchItems.length}</b> 条</span>
          <span>🔍 搜索记录 <b>${searchItems.length}</b> 条</span>
          <span>★ 收藏 <b>${favs.length}</b> 部</span>
        </div>
        <p class="hint" style="color:var(--dim);font-size:12px;margin:-8px 0 14px">删除记录仅对自己隐藏，管理员仍可在后台查看；彻底删除请联系管理员。</p>
        <div class="chips" id="uTabs">
          <button class="chip on" data-t="watch">🎬 观看记录</button>
          <button class="chip" data-t="fav">★ 我的收藏</button>
          <button class="chip" data-t="search">🔍 搜索记录</button>
        </div>
        <div id="uBody"></div>
      </div>`;

    const body = $('#uBody');
    function renderBody() {
      $$('#uTabs .chip').forEach((c) => c.classList.toggle('on', c.dataset.t === tab));
      if (tab === 'fav') {
        body.innerHTML = favs.length
          ? `<div class="grid">${favs.map((f, i) => `
              <div class="hist-card">
                ${cardHtml({ sourceKey: f.key, sourceName: '', id: f.id, title: f.title, pic: f.pic, remarks: f.remarks || '' })}
                <button class="hist-del" data-fi="${i}" title="取消收藏">×</button>
              </div>`).join('')}</div>`
          : '<div class="empty"><div class="big">☆</div>还没有收藏，去首页逛逛吧</div>';
        $$('#uBody .hist-del').forEach((b) => b.addEventListener('click', () => {
          favs.splice(Number(b.dataset.fi), 1);
          store.set('favs', favs);
          pushFavsToServer();
          renderBody();
          toast('已取消收藏');
        }));
      } else if (tab === 'watch') {
        body.innerHTML = watchItems.length
          ? `<div class="u-clear-row"><span></span><button class="btn ghost small" id="clearWatch">🗑 清空我的观看记录</button></div>
             <div class="grid">${watchItems.map((it) => `
              <div class="hist-card">
                ${cardHtml({ sourceKey: it.srcKey, sourceName: it.srcName, id: it.vidId, title: it.title, pic: it.pic, remarks: it.ep ? '看到 ' + it.ep : '', year: '' , typeName: ''})}
                <button class="hist-del" data-id="${esc(it.id)}" title="删除该条">×</button>
              </div>`).join('')}</div>`
          : '<div class="empty"><div class="big">🎬</div>暂无观看记录</div>';
        bindHistDel();
        $('#clearWatch') && $('#clearWatch').addEventListener('click', async () => {
          if (!confirm('确定清空自己的观看记录？（管理员后台仍保留）')) return;
          await API.userClearHistory('watch');
          watchItems.length = 0;
          renderBody();
          toast('已清空观看记录');
        });
      } else {
        body.innerHTML = searchItems.length
          ? `<div class="u-clear-row"><span></span><button class="btn ghost small" id="clearSearch">🗑 清空我的搜索记录</button></div>
             <div class="search-hist-list">${searchItems.map((it) => `
              <div class="search-hist-row">
                <span class="sh-q">🔍 ${esc(it.title)}</span>
                <time>${fmtDateTime(it.ts)}</time>
                <a class="btn ghost small" href="#/search?q=${encodeURIComponent(it.title)}">再搜一次</a>
                <button class="hist-del row-del" data-id="${esc(it.id)}">×</button>
              </div>`).join('')}</div>`
          : '<div class="empty"><div class="big">🔍</div>暂无搜索记录</div>';
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
      $$('#uBody .hist-del[data-id]').forEach((b) => b.addEventListener('click', async () => {
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

    $$('#uTabs .chip').forEach((c) => c.addEventListener('click', () => { tab = c.dataset.t; renderBody(); }));
    $('#uLogout').addEventListener('click', async () => {
      try { await API.userLogout(); } catch (e) {}
      State.me = null;
      updateUserBox();
      toast('已退出登录');
      location.hash = '#/home';
    });

    renderBody();
  }

  /* ============================================================
     视图：影视源(左侧文字源列表常驻 · 右侧该源分类/搜索/影片)
     ============================================================ */
  const cleanSrcName = (s) => String(s.name || s.key).replace(/🔞/g, '').trim() || s.key;
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
      v.innerHTML = '<div class="container empty"><div class="big">📭</div>没有可用影视源，请检查后台设置<br><br><a class="btn ghost small" href="#/' + esc(store.get('adminPathLive', 'admin')) + '">前往后台</a></div>';
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
        <button class="btn ghost small src-switch-m" id="srcPickBtn">🔀 切换播放源：当前「${esc(cleanSrcName(cur))}」 ${speedBadge(cur.key)}</button>
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

    $('#sortSpeed').addEventListener('click', () => {
      store.set('srcSortBySpeed', !store.get('srcSortBySpeed', false));
      route();
    });

    // 手机端: 弹窗选择播放源(替代左右滑动列表, 防误碰)
    $('#srcPickBtn').addEventListener('click', () => {
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
      // 点击任意源: 跳转的同时自动关闭弹窗, 让用户继续选片
      box.addEventListener('click', (ev) => {
        if (ev.target === box || ev.target.closest('a.src-row')) box.remove();
      });
      const closeBtn = document.createElement('button');
      closeBtn.className = 'modal-close';
      closeBtn.textContent = '×';
      closeBtn.addEventListener('click', () => box.remove());
      const mbox1918 = box.querySelector('.modal-box');
      if (mbox1918) mbox1918.appendChild(closeBtn);
      document.body.appendChild(box);
    });

    mountSourcePanel(cur, q, cat, alive);
    startSpeedTests(alive);
  }

  async function mountSourcePanel(src, q, cat, alive) {
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
    const grid = $('#srcGrid'), statusEl = $('#srcStatus');

    const setStatus = (t) => { if (alive() && statusEl) statusEl.textContent = t; };
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
      if (busy || exhausted || !alive()) return;
      busy = true;
      setStatus('⏳ 正在加载…');
      try {
        // 每波并发抓2页: 谁先回来谁先显示; 失败的页自动跳过不挡路
        const batch = [page, page + 1];
        const results = await Promise.allSettled(batch.map((p) => fetchPage(p, 12000)));
        if (!alive()) return;
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
        if (addedAny && shown < HOME_ROW_COUNT * 3 && !exhausted && alive()) {
          // 第一屏还没填满就继续补(递归受 busy 守护)
          await loadPage();
        }
      } catch (err) {
        // 任何意外异常都不能卡死 busy 标志(iPad 老 WebKit 实测会因此永久停在骨架屏)
        console.warn('[sources] loadPage error:', err);
        if (alive()) showLoadError('加载出错：' + (err && err.message ? err.message : '未知错误'));
      } finally {
        busy = false; // 关键: 无论成功失败/提前return, 必须解锁
      }
    }

    // 分类节点(异步加载, 不阻塞首屏)
    loadSourceCats(src, alive).then((cats) => {
      if (!alive() || !cats.length) return;
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
    if (!alive()) return;
    // 无限滚动: 滚到底自动加载下一页
    const sen = $('#srcSentinel');
    const chain = () => {
      if (exhausted || !alive()) return;
      const r = sen.getBoundingClientRect();
      if (r.top < window.innerHeight + 500) loadPage().then(chain);
    };
    if (sen && 'IntersectionObserver' in window) {
      const io = new IntersectionObserver((es) => {
        es.forEach((en) => { if (en.isIntersecting && !exhausted) loadPage(); });
      }, { rootMargin: '500px' });
      io.observe(sen);
    }
    chain();
    $('#srcPageSearch').addEventListener('submit', (e) => {
      e.preventDefault();
      const nq = $('#srcPageQ').value.trim();
      if (nq && nq !== q) location.hash = `#/sources/${encodeURIComponent(src.key)}?q=` + encodeURIComponent(nq);
    });
  }

  /* ============================================================
     视图：电视直播
     ============================================================ */
  /* ============================================================
     视图：下载 APP(安卓 APK / 电视 / iOS PWA 教程)
     ============================================================ */
  async function viewDownload(alive) {
    const v = $('#view');
    const dlUrl = (State.settings && State.settings.downloadUrl) || '';
    const isAndroid = /Android/i.test(navigator.userAgent);
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (inApp()) {
      // 已安装用户(安卓壳/PWA): 自动识别, 显示确认信息而非推广
      v.innerHTML = `
        <div class="container page-wrap" style="max-width:680px">
          <div class="side-card" style="text-align:center;padding:40px 20px">
            <div style="font-size:52px">✅</div>
            <h3 style="margin:12px 0 8px">你已在官方 App 中</h3>
            <p class="hint">系统自动识别：当前正通过 晓林影院 App 访问，无需重复安装。<br>下载入口与引导弹窗已为你自动隐藏。</p>
            <a class="btn primary" style="margin-top:14px" href="#/home">回到首页观影</a>
          </div>
        </div>`;
      return;
    }
    const apkBtn = dlUrl
      ? `<a class="btn primary" href="${esc(dlUrl)}" target="_blank" rel="noopener">📥 ${isAndroid ? '立即安装到本机' : '下载安卓 APK'}</a>`
      : `<span class="dl-soon">安装包整备中 · 可先看下方教程</span>`;
    const tvBtn = dlUrl
      ? `<a class="btn ghost" href="${esc(dlUrl).replace('xiaolintv-phone-', 'xiaolintv-tv-')}" target="_blank" rel="noopener">获取 TV 版</a>`
      : '';
    const siteName = esc((State.settings && State.settings.siteName) || '晓林影院');
    v.innerHTML = `
      <div class="container page-wrap dl-wrap">

        <!-- Hero -->
        <section class="dl-hero">
          <i class="dl-blob b1"></i><i class="dl-blob b2"></i><i class="dl-blob b3"></i>
          <img class="dl-icon" src="./icons/icon-192.png" alt="app">
          <h2 class="dl-name">${siteName} <em>App</em></h2>
          <p class="dl-slogan">装进口袋的私人影院 —— 全屏沉浸 · 收藏云同步 · 大屏同享</p>
          <div class="dl-hero-cta">${apkBtn}${isIOS ? '<a class="btn ghost" href="#dl-ios">🍎 我用 iPhone</a>' : ''}</div>
        </section>

        <!-- 特性条 -->
        <section class="dl-strip">
          <span>🎬 全屏沉浸</span><span>☁️ 双向云同步</span><span>⚡ 聚合秒搜</span><span>📶 电视直播</span><span>🌗 护眼暗色</span>
        </section>

        <!-- 三端卡片 -->
        <section class="dl-grid">
          <div class="dl-card ${isAndroid ? 'hot' : ''}">
            ${isAndroid ? '<i class="dl-ribbon">当前设备</i>' : ''}
            <div class="dl-badge" style="--bd1:#3ddc84;--bd2:#0f9d58">🤖</div>
            <h4>安卓手机 / 平板</h4>
            <p>独立客户端 · 站点更新免重装<br>覆盖安装不丢收藏与进度</p>
            ${apkBtn}
          </div>
          <div class="dl-card">
            <div class="dl-badge" style="--bd1:#8ab4ff;--bd2:#5b7fff">📺</div>
            <h4>电视 / 机顶盒</h4>
            <p>内置 TV 启动器 · 遥控器直用<br>大屏观影最佳选择</p>
            ${tvBtn || '<span class="dl-soon">TV 包见 Release 列表</span>'}
          </div>
          <div class="dl-card ${isIOS ? 'hot' : ''}" id="dl-ios">
            ${isIOS ? '<i class="dl-ribbon">当前设备</i>' : ''}
            <div class="dl-badge iosb">🍎</div>
            <h4>iPhone / iPad</h4>
            <ol class="dl-timeline">
              <li><b>Safari</b> 打开本站<span>微信内请点 ⋯ 选「在浏览器打开」</span></li>
              <li>点底部<b>分享</b>按钮 ⎋<span>方框加向上箭头</span></li>
              <li>选择<b>添加到主屏幕</b></li>
              <li>点右上角<b>添加</b> ✅<span>获得独立图标 · 全屏运行</span></li>
            </ol>
          </div>
        </section>

        <!-- FAQ -->
        <section class="side-card dl-faq">
          <h4>🛠️ 安装小贴士</h4>
          <ul class="dl-steps">
            <li>安卓提示「未知来源」：设置中允许，或选「仅本次允许」</li>
            <li>华为 / 鸿蒙拦截时选择「继续安装」即可</li>
            <li>覆盖升级无需卸载：登录账号后收藏与观看进度云端同步</li>
            <li>iOS 卸载主屏图标即等于卸载，随时可重新添加</li>
          </ul>
        </section>
      </div>`;
  }

  /* ---- APP 下载引导弹窗: 首次访问弹出; 永久关闭 or 10天后再弹; 后台可整体关闭 ---- */
  // 已在官方 App 内? (安卓壳 WebView 专属UA / iOS PWA standalone 模式)
  function inApp() {
    return /XIAOLIN-TV-APP/i.test(navigator.userAgent || '') || isStandalone();
  }
  function isMobileUA() { return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || ''); }
  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  }
  function openAppPromoModal() {
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
        <a class="btn primary promo-go" href="#/download">📥 免费安装</a>
        <button class="promo-skip" id="promoForever">已安装，不再提示</button>
      </div>`;
    box.addEventListener('click', (ev) => {
      if (ev.target === box) box.remove();
      if (ev.target.closest('a.promo-go')) setTimeout(() => box.remove(), 0);
    });
    $('.promo-x', box).addEventListener('click', () => box.remove()); // × 关闭 = 10 天后再弹
    $('#promoForever', box).addEventListener('click', () => {
      store.set('appPromoState', { ...store.get('appPromoState', {}), forever: true });
      box.remove();
      toast('好的，不再打扰');
    });
    document.body.appendChild(box);
  }
  function maybeAppPromo() {
    try {
      if (!State.settings || State.settings.appPromoEnabled === false) return; // 后台总开关
      if (inApp()) return;                                                    // 已安装: 安卓壳/PWA 一律不弹
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
      store.set('appPromoState', { ...st, lastShown: Date.now() });
      setTimeout(openAppPromoModal, 1500);                                     // 等首屏渲染完再弹
    } catch (e) { /* ignore */ }
  }

  async function viewLive(query) {    const v = $('#view');
    v.innerHTML = `<div class="container page-wrap">
      <div class="video-wrap" style="aspect-ratio:auto;height:min(52vh,430px)">
        <video id="videoEl" controls playsinline autoplay muted></video>
        <div class="video-tip hidden" id="videoTip"></div>
      </div>
      <div class="live-now" id="nowName">📺 正在加载频道列表…</div>
      <div class="live-layout" style="margin-top:14px">
        <div class="live-groups" id="liveGroups"></div>
        <div class="live-channels" id="liveChs"><div class="empty" style="grid-column:1/-1;padding:40px">频道加载中，若较慢请稍候…</div></div>
      </div></div>`;

    let data;
    try {
      data = State.liveCache || (State.liveCache = await API.getLive());
    } catch (e) {
      $('#liveChs').innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="big">📡</div>直播源加载失败：${esc(e.message)}<br><small>可在后台配置其他直播源地址</small></div>`;
      return;
    }
    if (!data.groups || !data.groups.length) {
      $('#liveChs').innerHTML = '<div class="empty" style="grid-column:1/-1"><div class="big">📭</div>直播源为空，请在后台添加直播源地址</div>';
      $('#nowName').textContent = '';
      return;
    }

    const favs = store.get('favChs', []);
    const favGroup = { name: '⭐ 我的收藏', channels: favs };
    const groups = [favGroup, ...data.groups];

    let curG = 0;
    function renderGroups() {
      $('#liveGroups').innerHTML = groups.map((g, i) =>
        `<button class="live-group-btn ${i === curG ? 'on' : ''}" data-i="${i}">
           <span>${esc(g.name)}</span><i>${g.channels.length}</i></button>`).join('');
      $$('#liveGroups .live-group-btn').forEach((b) => b.addEventListener('click', () => { curG = Number(b.dataset.i); renderGroups(); renderChs(); }));
    }
    function renderChs() {
      const g = groups[curG];
      if (!g.channels.length) { $('#liveChs').innerHTML = '<div class="empty" style="grid-column:1/-1;padding:36px;font-size:13px">暂无收藏，点击频道右侧 ☆ 添加</div>'; return; }
      $('#liveChs').innerHTML = g.channels.map((ch, i) => `
        <div class="live-ch" data-u="${esc(ch.url)}" data-n="${esc(ch.name)}" data-l="${esc(ch.logo || '')}">
          ${ch.logo ? `<img loading="lazy" referrerpolicy="no-referrer" src="${esc(ch.logo)}" onerror="this.style.display='none'">` : '<span style="width:30px;text-align:center">📺</span>'}
          <span>${esc(ch.name)}</span>
          <button class="live-fav ${favs.some((f) => f.url === ch.url) ? 'on' : ''}" data-fav="${esc(ch.url)}">☆</button>
        </div>`).join('');
      $$('#liveChs .live-ch').forEach((el) => {
        el.addEventListener('click', (ev) => {
          if (ev.target.closest('.live-fav')) return;
          playCh(el.dataset.u, el.dataset.n);
        });
      });
      $$('#liveChs .live-fav').forEach((b) => b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const host = b.closest('.live-ch');
        const list = store.get('favChs', []);
        const idx = list.findIndex((f) => f.url === b.dataset.fav);
        if (idx >= 0) { list.splice(idx, 1); b.classList.remove('on'); b.textContent = '☆'; }
        else {
          list.push({ name: host.dataset.n, url: host.dataset.u, logo: host.dataset.l, group: '收藏' });
          b.classList.add('on'); b.textContent = '★'; toast('已收藏频道', 'ok');
        }
        store.set('favChs', list);
        groups[0].channels = list;
        renderGroups();
      }));
    }

    function playCh(url, name) {
      $('#nowName').textContent = '📺 正在播放：' + name;
      Player.play($('#videoEl'), url, $('#videoTip'));
      $$('#liveChs .live-ch').forEach((el) => el.classList.toggle('on', el.dataset.u === url));
      const last = { url, name };
      store.set('lastCh', last);
    }

    renderGroups(); renderChs();
    const last = store.get('lastCh', null);
    if (last && !query.noResume) playCh(last.url, last.name);
    else {
      // 默认播 CCTV 类第一个可点频道
      const cctv = data.groups.find((g) => /央视|CCTV/i.test(g.name));
      const ch = cctv && cctv.channels.find((c) => /CCTV-?1\b|CCTV1 综合/.test(c.name));
      if (ch) playCh(ch.url, ch.name);
    }
  }

  /* ============================================================
     视图：后台管理
     ============================================================ */
  async function viewAdmin(query, seg) {
    const v = $('#view');
    const usedSeg = seg || (parseHash().parts[0] || 'admin');

    /* ---- 入口守卫: 已有会话任意入口直达; 未登录时路径必须与服务端配置一致 ---- */
    let hasSession = false;
    try { await API.adminSession(); hasSession = true; } catch (e) { /* 未登录 */ }
    if (!hasSession) {
      const okPath = await API.checkAdminPath(usedSeg).then((r) => !!r.ok).catch(() => usedSeg === 'admin');
      if (!okPath) {
        v.innerHTML = `<div class="container empty"><div class="big">🕳️</div>页面不存在或已迁移<br>
          <small class="hint" style="margin-top:6px">后台入口可能已被管理员自定义，请使用正确入口地址</small></div>`;
        return;
      }
    }

    /* 未登录 → 登录卡片 */
    if (!hasSession) {
      v.innerHTML = `<div class="login-box admin-card"><div class="login-logo">
        <svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="21" fill="none" stroke="var(--acc)" stroke-width="3"/><path d="M19 15.5v17l14-8.5z" fill="var(--acc)"/></svg>
      </div><h3 style="text-align:center;margin-bottom:18px">管理员登录</h3>
      <input class="field-input" id="pwdInput" type="password" placeholder="请输入管理密码">
      <button class="btn primary" id="loginBtn" style="width:100%;justify-content:center;margin-top:14px">登 录</button>
      <p class="hint" style="text-align:center">初始密码 admin123 · 部署时通过环境变量 ADMIN_PASSWORD 修改</p></div>`;
      const doLogin = async () => {
        const pwd = $('#pwdInput').value;
        if (!pwd) return toast('请输入密码', 'err');
        try {
          await API.adminLogin(pwd);
          store.set('adminPathLive', usedSeg); // 记住可用入口, 站内「前往后台」链接跟随
          toast('登录成功', 'ok');
          renderPanel();
        } catch (e) {
          if (/Failed to fetch|NetworkError|Load failed/i.test(e.message)) {
            toast('无法连接后端：本地请先运行 npm run dev 并访问 http://127.0.0.1:8787', 'err');
          } else {
            toast(e.message === 'unauthorized' ? '密码错误' : e.message, 'err');
          }
        }
      };
      $('#loginBtn').addEventListener('click', doLogin);
      $('#pwdInput').addEventListener('keydown', (e) => e.key === 'Enter' && doLogin());
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
      ['sources', '🧩 影视源管理'],
      ['site', '⚙️ 站点设置'],
      ['app', '📲 APP推广'],
      ['backup', '🗄️ 数据备份'],
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
          <div class="page-head" style="margin:0">
            <div class="page-title">⚙️ 后台管理</div>
            <div style="display:flex;gap:10px;align-items:center">
              <span class="status-pill ${s.storage === 'kv' ? 'ok' : 'warn'}">${s.storage === 'kv' ? 'KV 持久存储' : '内存临时存储'}</span>
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

    function renderAdmTab(s) {
      const main = $('#admMain');
      if (!main || !s) return;
      main.scrollTop = 0;

      /* ---------------- 📊 流量统计 ---------------- */
      if (admTab === 'stats') {
        main.innerHTML = `
          <div class="admin-card">
            <h3>📊 流量统计</h3>
            <div class="stat-chips">
              <span class="stat-chip">今日访问 <b id="stPvToday">—</b></span>
              <span class="stat-chip">总访问 <b id="stPvTotal">—</b></span>
              <span class="stat-chip">独立IP <b id="stUniq">—</b></span>
              <span class="stat-chip">搜索次数 <b id="stSearch">—</b></span>
            </div>
            <div class="stat-paths" id="statPaths"></div>
            <div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap">
              <button class="btn ghost small" id="refreshStatsBtn">🔄 刷新</button>
              <button class="btn danger small" id="clearStatsBtn">🗑 清空统计数据</button>
            </div>
            <div id="statRecent" class="table-scroll" style="margin-top:14px"></div>
          </div>`;
        let statRows = [], statPg = 0;
        const STAT_PER = 10;
        function renderStatPage() {
          const box = $('#statRecent');
          if (!box) return;
          const pages = Math.max(1, Math.ceil(statRows.length / STAT_PER));
          if (statPg > pages - 1) statPg = pages - 1;
          const rowsHtml = statRows.slice(statPg * STAT_PER, (statPg + 1) * STAT_PER).map((it) => `
            <tr>
              <td>${fmtDateTime(it.ts)}</td>
              <td>${it.kind === 'search' ? '🔍' : '📄'}</td>
              <td class="ulog-title" title="${esc(it.kind === 'search' ? it.q : it.path)}">${esc(it.kind === 'search' ? it.q : it.path)}</td>
              <td>${esc(it.u || '—')}</td>
              <td>${esc(it.ip)}${it.geo ? '<br><small style="color:var(--dim)">' + esc(it.geo) + '</small>' : ''}</td>
            </tr>`).join('');
          box.innerHTML = rowsHtml
            ? `<table class="adm-table"><thead><tr><th>时间</th><th>类型</th><th>内容</th><th>用户</th><th>IP / 归属地</th></tr></thead><tbody>${rowsHtml}</tbody></table>
               ${statRows.length > STAT_PER ? `
                 <div class="pager" style="display:flex;gap:10px;align-items:center;justify-content:center;margin-top:12px">
                   <button class="btn ghost small" id="stPrev" ${statPg <= 0 ? 'disabled' : ''}>‹ 上一页</button>
                   <span style="color:var(--dim);font-size:12px">第 ${statPg + 1} / ${pages} 页 · 共 ${statRows.length} 条</span>
                   <button class="btn ghost small" id="stNext" ${statPg >= pages - 1 ? 'disabled' : ''}>下一页 ›</button>
                 </div>` : ''}`
            : '<p class="hint" style="margin-top:8px">暂无明细（访客进入站点后开始累计）</p>';
          $('#stPrev') && $('#stPrev').addEventListener('click', () => { statPg--; renderStatPage(); });
          $('#stNext') && $('#stNext').addEventListener('click', () => { statPg++; renderStatPage(); });
        }
        async function loadStats() {
          try {
            const d = await API.adminStats();
            $('#stPvToday').textContent = d.pvToday;
            $('#stPvTotal').textContent = d.pvTotal;
            $('#stUniq').textContent = d.uniqIp;
            $('#stSearch').textContent = d.searches;
            const maxN = Math.max(1, ...(d.byPath || []).map((x) => x.n));
            $('#statPaths').innerHTML = (d.byPath || []).map((p) => `
              <div class="stat-path-row">
                <span class="sp-k" title="${esc(p.k)}">${esc(p.k)}</span>
                <div class="sp-bar"><i style="width:${Math.round((p.n / maxN) * 100)}%"></i></div>
                <b>${p.n}</b>
              </div>`).join('') || '<p class="hint" style="margin-top:8px">暂无页面访问数据</p>';
            statRows = d.recent || [];
            renderStatPage();
          } catch (e) { /* ignore */ }
        }
        $('#refreshStatsBtn').addEventListener('click', loadStats);
        $('#clearStatsBtn').addEventListener('click', async () => {
          if (!confirm('确定清空全部统计数据？不可恢复。')) return;
          await API.adminClearStats();
          toast('统计数据已清空', 'ok');
          loadStats();
        });
        loadStats();
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
          </div>`;
        $('#requireLoginSwitch').addEventListener('change', async (e) => {
          const on = e.target.checked;
          try {
            await API.adminSaveSettings({ requireLogin: on });
            State.settings = { ...State.settings, requireLogin: on };
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
            State.settings = { ...State.settings, allowRegister: on };
            toast(on ? '已开放注册' : '已关闭注册', 'ok');
          } catch (err) { e.target.checked = !on; toast('保存失败：' + err.message, 'err'); }
        });
        $('#saveTrialBtn').addEventListener('click', async () => {
          const n = Math.round(Number($('#trialMinInput').value));
          if (!isFinite(n) || n < 0 || n > 2880) return toast('试看时长需为 0-2880 的整数分钟', 'err');
          try {
            await API.adminSaveSettings({ trialMinutes: n });
            const hint = $('#trialHintMin');
            if (hint) hint.textContent = n;
            State.settings = { ...State.settings, trialMinutes: n };
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
                <thead><tr><th>用户</th><th>注册时间</th><th>最近登录</th><th>登录IP / 归属地</th><th style="text-align:center">成人源</th><th>累计观看</th><th>有效/总记录</th><th style="text-align:right">操作</th></tr></thead>
                <tbody>${r.users.map((u) => `
                  <tr>
                    <td>${esc(u.username)}</td>
                    <td>${fmtDateTime(u.createdAt)}</td>
                    <td>${fmtDateTime(u.lastLoginAt)}</td>
                    <td>${esc(u.lastLoginIp || '—')}${u.lastLoginIpGeo ? '<br><small style="color:var(--dim)">' + esc(u.lastLoginIpGeo) + '</small>' : ''}</td>
                    <td title="需全局「成人内容」开关开启后生效；绿色=允许观看，灰色=已隐藏"><button type="button" class="u-adult-tag ${u.adultAllowed ? 'on' : 'off'}" data-u="${esc(u.username)}">${u.adultAllowed ? '开' : '关'}</button></td>
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
                el.textContent = to ? '开' : '关';
                toast(to ? `已允许「${el.dataset.u}」观看成人源` : `已对「${el.dataset.u}」隐藏成人源`, 'ok');
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
          </div>`;
        const customRows = (s.customSources || []).map((x) => ({ ...x }));
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
      }

      /* ---------------- ⚙️ 站点设置 ---------------- */
      else if (admTab === 'site') {
        main.innerHTML = `
          <div class="admin-card adult-toggle-card ${s.adultEnabled ? 'on' : ''}" id="adultCard">
            <div class="admin-row">
              <div class="admin-label">🔞 成人内容
                <small>关闭后，服务器将在源头剔除所有成人采集源（🔞），全站不可见、接口不可达。当前状态：
                  <b id="adultState" style="color:${s.adultEnabled ? 'var(--danger)' : 'var(--ok)'}">${s.adultEnabled ? '已开启' : '已关闭'}</b></small>
              </div>
              <label class="switch red"><input type="checkbox" id="adultSwitch" ${s.adultEnabled ? 'checked' : ''}><span class="track"></span></label>
            </div>
            <p class="hint">⚠️ 本站不生产任何内容。请遵守所在地区法律法规；未满 18 岁请勿开启。</p>
          </div>
          <div class="admin-card">
            <h3>🎨 站点设置</h3>
            <label class="field-label">站点名称</label>
            <input class="field-input" id="siteNameInput" value="${esc(s.siteName)}" maxlength="40">
            <label class="field-label">默认配色主题（新访客首次进入时生效）</label>
            <select class="field-input" id="themeSelect">
              ${THEME_META.map((t) => `<option value="${t.id}" ${s.defaultTheme === t.id ? 'selected' : ''}>${t.name}</option>`).join('')}
            </select>
            <label class="field-label">全站公告（留空则不显示）</label>
            <textarea class="field-area" id="annInput" maxlength="300">${esc(s.announcement)}</textarea>
            <label class="field-label" style="margin-top:14px">🏠 首页默认加载的影视源（每行一个 key，按顺序，最多12个；留空 = 默认精选）<br>
              <small style="font-weight:400;color:var(--dim)">建议填测速最快的源。可用 key 如：${esc((State.config ? State.config.sources : []).slice(0, 8).map((x) => x.key).join('、'))} …</small></label>
            <textarea class="field-area" id="homeSrcInput" style="min-height:96px;font-family:monospace;font-size:12px">${esc((s.homeSources || []).join('\n'))}</textarea>
            <button class="btn primary" id="saveSiteBtn" style="margin-top:14px">保存站点设置</button>
          </div>
          <div class="admin-card">
            <h3>📺 电视直播源</h3>
            <p class="hint">每行一个 m3u 直播源地址，保存后全站生效（缓存约 30 分钟）。推荐：<br>
              <code>https://iptv-org.github.io/iptv/countries/cn.m3u</code><br>
              <code>https://live.fanmingming.com/tv/m3u/ipv6.m3u</code></p>
            <textarea class="field-area" id="liveInput" style="min-height:110px;font-family:monospace;font-size:12px">${esc((s.liveSources || []).join('\n'))}</textarea>
            <button class="btn primary" id="saveLiveBtn" style="margin-top:14px">保存直播源</button>
          </div>`;
        $('#adultSwitch').addEventListener('change', async (e) => {
          const on = e.target.checked;
          try {
            const res = await API.adminSaveSettings({ adultEnabled: on });
            State.config = await API.getConfig();
            $('#adultState').textContent = on ? '已开启' : '已关闭';
            $('#adultState').style.color = on ? 'var(--danger)' : 'var(--ok)';
            $('#adultCard').classList.toggle('on', on);
            toast(on ? '⚠️ 成人内容已全站开启' : '✅ 成人内容已全站关闭', on ? 'err' : 'ok');
          } catch (err) { e.target.checked = !on; toast('保存失败：' + err.message, 'err'); }
        });
        $('#saveSiteBtn').addEventListener('click', async () => {
          try {
            const homeLines = $('#homeSrcInput').value.split('\n').map((x) => x.trim()).filter(Boolean);
            const res = await API.adminSaveSettings({
              siteName: $('#siteNameInput').value,
              defaultTheme: $('#themeSelect').value,
              announcement: $('#annInput').value,
              homeSources: homeLines,
            });
            State.settings = { ...State.settings, siteName: res.settings.siteName, announcement: res.settings.announcement, homeSources: res.settings.homeSources || [] };
            $('#brandName').textContent = res.settings.siteName;
            document.title = res.settings.siteName;
            applyAnnouncement(res.settings.announcement);
            toast(`站点设置已保存（首页源 ${homeLines.length} 个）`, 'ok');
          } catch (err) { toast('保存失败：' + err.message, 'err'); }
        });
        $('#saveLiveBtn').addEventListener('click', async () => {
          try {
            const urls = $('#liveInput').value.split('\n').map((x) => x.trim()).filter(Boolean);
            await API.adminSaveSettings({ liveSources: urls, liveSourcesAllowEmpty: false });
            State.liveCache = null;
            toast('直播源已保存，缓存将在约30分钟后刷新（重新部署可立即生效）', 'ok');
          } catch (err) { toast('保存失败：' + err.message, 'err'); }
        });
      }

      /* ---------------- 📲 APP推广 ---------------- */
      else if (admTab === 'app') {
        main.innerHTML = `
          <div class="admin-card">
            <h3>📲 APP下载弹窗</h3>
            <p class="hint">手机端<b>已注册且注册满 2 小时</b>的用户会弹出下载引导（游客不弹）；点 × 后 <b>10 天内不再打扰</b>，「不再提示」永久关闭。已在 App 内的用户自动隐藏全部入口。</p>
            <label style="display:flex;align-items:center;gap:10px;margin:10px 0;cursor:pointer">
              <span class="switch"><input type="checkbox" id="promoSw" ${s.appPromoEnabled !== false ? 'checked' : ''}><span class="track"></span></span>
              <b>启用下载引导弹窗</b>
            </label>
            <label class="field-label">APK 下载地址（GitHub Releases 直链或页面，留空则弹窗/下载页仅显示教程）</label>
            <input class="field-input" id="dlUrlInput" value="${esc(s.downloadUrl || '')}" placeholder="https://github.com/你的用户名/仓库名/releases/latest/download/xiaolintv-phone-latest.apk">
            <button class="btn primary" id="savePromoBtn" style="margin-top:12px">保存弹窗设置</button>
          </div>`;
        $('#savePromoBtn').addEventListener('click', async () => {
          const url = $('#dlUrlInput').value.trim();
          if (url && !/^https?:\/\//i.test(url)) return toast('下载地址需为 http(s) 链接', 'err');
          try {
            await API.adminSaveSettings({ appPromoEnabled: $('#promoSw').checked, downloadUrl: url });
            State.settings = { ...State.settings, appPromoEnabled: $('#promoSw').checked, downloadUrl: url };
            toast('弹窗设置已保存', 'ok');
          } catch (err) { toast('保存失败：' + err.message, 'err'); }
        });
      }

      /* ---------------- 🗄️ 数据备份 ---------------- */
      else if (admTab === 'backup') {
        main.innerHTML = `
          <div class="admin-card">
            <h3>🗄️ 数据备份 / 迁移 <small style="color:var(--dim);font-weight:400;font-size:12px">（Cloudflare ↔ VPS/Docker 互通）</small></h3>
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
            <p class="hint">自定义后台访问地址：<b>留空/填 admin</b> 使用默认 <code>#/admin</code>；例如填 <code>my-panel</code> 后，只有 <code>#/my-panel</code> 能进入后台，旧地址对外显示「页面不存在」。<br>当前完整入口：<code>${esc(location.origin + '/#/' + (s.adminPath || 'admin'))}</code>（建议收藏到书签）</p>
            <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:10px">
              <input class="field-input" id="admPathInput" style="max-width:260px" value="${esc(s.adminPath || '')}" placeholder="admin（留空=默认）" maxlength="40">
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
            const eff = (res.settings && res.settings.adminPath) || 'admin';
            store.set('adminPathLive', eff);
            toast(`入口路径已保存：今后请从 #/${eff} 进入后台`, 'ok');
            setTimeout(() => { location.hash = '#/' + eff; }, 900);
          } catch (err) { toast('保存失败：' + err.message, 'err'); }
        });
      }

      /* ---------------- ℹ️ 系统信息 ---------------- */
      else if (admTab === 'sys') {
        main.innerHTML = `
          <div class="admin-card">
            <h3>🧾 系统信息</h3>
            <div class="admin-row"><div class="admin-label">设置存储<small>${s.storage === 'kv' ? '已绑定 Cloudflare KV(CONFIG_KV)，重启不丢失' : '未绑定 KV，当前保存在实例内存，重部署后恢复默认。绑定方法见 README'}</small></div>
              <span class="status-pill ${s.storage === 'kv' ? 'ok' : 'warn'}">${s.storage === 'kv' ? 'KV' : 'Memory'}</span></div>
            <div class="admin-row"><div class="admin-label">管理密码<small>${s.hasCustomPassword ? '后台已自定义 ✔（修改请用「安全中心」）' : s.passwordFromEnv ? '来自环境变量 ADMIN_PASSWORD ✔' : '使用默认密码 admin123，建议尽快修改'}</small></div>
              <span class="status-pill ${s.hasCustomPassword || s.passwordFromEnv ? 'ok' : 'warn'}">${s.hasCustomPassword ? '后台自定义' : s.passwordFromEnv ? '环境变量' : '默认'}</span></div>
            <div class="admin-row"><div class="admin-label">影视源配置<small>${(s.customSources || []).length} 个自定义源 · ${(s.disabledSources || []).length} 个停用中 · 内置源每日同步自 LunaTV-config</small></div>
              <span class="status-pill ok">${State.config.count}/${State.config.total} 源可用</span></div>
            <div class="admin-row"><div class="admin-label">后台入口<small>${s.adminPath ? `已自定义：#/${esc(s.adminPath)}` : '默认：#/admin（可在安全中心自定义）'}</small></div>
              <span class="status-pill ${s.adminPath ? 'ok' : 'warn'}">${s.adminPath ? '自定义' : '默认'}</span></div>
          </div>`;
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
    // 电视/盒子(无触摸屏): 启用 10-foot 大屏遥控器 UI
    if (isTvDevice()) document.body.classList.add('tv');
    // 静态事件
    $('#themeBtn').addEventListener('click', (e) => { e.stopPropagation(); $('#themePop').classList.toggle('hidden'); });
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
    window.addEventListener('hashchange', route);

    buildThemePop();
    buildNav();
    applyTheme(store.get('theme', null) || 'midnight');

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

    try {
      const [settings, config] = await Promise.all([API.getSettings(), API.getConfig()]);
      State.settings = settings;
      State.config = config;
    } catch (err) {
      $('#view').innerHTML = `<div class="container empty" style="padding-top:120px">
        <div class="big">🛠️</div><p style="font-weight:700">后端服务连接失败：${esc(err.message)}</p>
        <p style="margin-top:10px;color:var(--dim);font-size:13px;line-height:2">
          · 本地预览：项目文件夹运行 <code style="background:var(--card);padding:2px 8px;border-radius:6px">npm run dev</code>，再访问 http://127.0.0.1:8787<br>
          · 线上部署：确认 _worker.js 与静态资源已一起部署（Workers 或 Pages 高级模式），详见 部署指南.md</p>
        <p style="margin-top:14px"><button class="btn primary" onclick="location.reload()">重试</button></p></div>`;
      return;
    }

    // 登录态(用户优先; 管理员会话也可浏览前台)
    try {
      const m = await API.userMe();
      State.me = m.me ? m.me.username : null;
      if (m.me) { State.meCreated = Number(m.me.createdAt || 0); pullFavsMerge(); }
    }
    catch (e) { State.me = null; }
    if (!State.me) {
      try { await API.adminSession(); State.me = '管理员'; } catch (e2) { /* 未登录管理员 */ }
    }
    updateUserBox();

    // 应用服务端默认主题（用户本地无偏好时）
    if (!store.get('theme', null) && State.settings.defaultTheme) applyTheme(State.settings.defaultTheme);
    $('#brandName').textContent = State.settings.siteName || '晓林影视';
    document.title = State.settings.siteName || '晓林影视';
    applyAnnouncement(State.settings.announcement);
    route();
    maybeAppPromo(); // 首屏就绪后判断是否弹下载引导
    // 游客试看: 拉取剩余时长; 试看到期由接口 401 事件触发注册框
    initGuest();
    window.addEventListener('xl:need-login', () => showTrialModal(true));
  }

  boot();
})();
