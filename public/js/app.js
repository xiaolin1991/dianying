/* ============================================================
   星河影视 NebulaTV — 前端应用(原生 JS, 无构建)
   视图: 首页 / 分类 / 搜索 / 详情 / 播放 / 电视直播 / 后台
   ============================================================ */
(function () {
  'use strict';

  /* ------------------------------ 工具 ------------------------------ */
  const $ = (s, p = document) => p.querySelector(s);
  const $$ = (s, p = document) => [...p.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const stripTags = (s) => String(s || '').replace(/<[^>]*>/g, '').trim();

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
      ? `<a class="user-chip" href="#/user" title="个人中心"><span class="u-ava">${esc(State.me.slice(0, 1).toUpperCase())}</span>${esc(State.me)}</a>`
      : `<a class="btn ghost small" href="#/login">登录 / 注册</a>`;
  }
  function logSearch(q) {
    if (State.me && q) API.userLogSearch(q);
  }
  function featuredSources(max = 6) {
    const vis = visibleSources();
    const picked = [];
    for (const key of FEATURED_ORDER) {
      const s = vis.find((x) => x.key === key);
      if (s) picked.push(s);
    }
    for (const s of vis) {
      if (picked.length >= max) break;
      if (!picked.includes(s)) picked.push(s);
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
    const href = `#/detail/${esc(item.sourceKey)}/${encodeURIComponent(item.id)}`;
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
  ];
  function buildNav() {
    $('#mainNav').innerHTML = NAVS.map(([href, label]) =>
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
    const alive = makeAlive(); // 页面切换后旧异步任务自动失效
    const dec = (s) => { try { return decodeURIComponent(s || ''); } catch (e) { return s || ''; } };
    // 强制登录: 未登录只允许登录页与后台
    if (loginRequired() && !['login', 'admin'].includes(parts[0])) {
      markNav('');
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
      else if (parts[0] === 'admin') await viewAdmin(query);
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
          const donors = pool.general.concat(cats.map(([c]) => pool[c]).flat());
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
        <div class="grid" id="browseGrid">${skeletons(18)}</div>
        <button class="load-more" id="loadMore">加载更多</button>
      </div>`;

    const cur = { pool: featuredSources(6), idx: 0, pageBy: new Map(), seen: new Set(), year: query.year || '全部' };
    browseCursors.set(cat, cur);

    $$('#yearChips .chip').forEach((c) => c.addEventListener('click', () => {
      location.hash = `#/browse/${encodeURIComponent(cat)}?year=${encodeURIComponent(c.dataset.y)}`;
    }));

    async function loadBatch() {
      let added = 0;
      for (let round = 0; round < cur.pool.length && added < 24; round++) {
        if (!alive()) return false;
        const s = cur.pool[cur.idx % cur.pool.length];
        cur.idx++;
        const pg = (cur.pageBy.get(s.key) || 0) + 1;
        cur.pageBy.set(s.key, pg);
        try {
          const r = await API.list(s, pg);
          const grid = $('#browseGrid');
          if (!grid || !alive()) return false;
          const frag = document.createElement('div');
          for (const vod of (r.list || [])) {
            const tn = String(vod.type_name || '');
            if (!CAT_REGEX[cat].test(tn)) continue;
            if (cur.year !== '全部' && String(vod.vod_year || '') !== cur.year) continue;
            const k = s.key + ':' + vod.vod_id;
            if (cur.seen.has(k)) continue;
            cur.seen.add(k);
            frag.insertAdjacentHTML('beforeend', cardHtml({
              sourceKey: s.key, sourceName: s.name, id: vod.vod_id, title: vod.vod_name,
              pic: vod.vod_pic, remarks: vod.vod_remarks, year: vod.vod_year, typeName: tn, showSource: true,
            }));
            added++;
          }
          [...frag.children].forEach((n) => grid.appendChild(n));
          if (added >= 24) break;
        } catch (e) { /* 该源失败，换下一个 */ }
      }
      return added > 0;
    }

    const ok = await loadBatch();
    if (!alive()) return;
    if (!ok) setHtml('#browseGrid', '<div class="empty" style="grid-column:1/-1"><div class="big">🎬</div>暂无内容，试试其他筛选</div>');
    $('#loadMore').addEventListener('click', async (e) => {
      e.target.textContent = '加载中…';
      await loadBatch();
      e.target.textContent = '加载更多';
    });
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
        <div class="grid" id="srGrid"></div>
        <div class="empty hidden" id="srEmpty"><div class="big">🙈</div><p>没有找到相关内容</p></div>
      </div>`;
    if (!alive()) return;
    logSearch(q); // 搜索记录上报(登录用户)

    const sources = visibleSources();
    const merged = new Map(); // normTitle|year -> item
    let done = 0, renderTimer = null;

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
        .slice(0, 96).map(cardHtml).join('');
    };
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
      box.firstChild.appendChild(closeBtn);
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

    const r = await API.detail(src, id);
    if (!alive()) return;
    const vod = r.list && r.list[0];
    if (!vod) throw new Error('影片不存在');
    const groups = parsePlayGroups(vod);
    if (!groups.length) throw new Error('没有可播放的剧集');

    let gi = Number(query.group || 0);
    if (!groups[gi]) gi = 0;
    let ei = Math.min(Number(query.ep || 0), groups[gi].eps.length - 1);

    const progKey = `prog:${key}:${vod.vod_id}`;
    const allProg = store.get(progKey, {});

    v.innerHTML = `
      <div class="container page-wrap">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap">
          <a class="btn ghost small" href="#/detail/${key}/${encodeURIComponent(id)}">← 详情</a>
          <h2 style="font-size:17px">${esc(vod.vod_name)} <span style="color:var(--acc);font-size:13px">${esc(groups[gi].eps[ei].name)}</span></h2>
        </div>
        <div class="play-page-grid">
          <div class="video-wrap"><video id="videoEl" controls playsinline autoplay></video>
            <div class="video-tip hidden" id="videoTip"></div></div>
          <aside>
            <div class="side-card">
              <h4>换播放源</h4>
              <div class="src-switch" id="srcSwitch">
                <div class="src-item cur"><span>${esc(src.name)}</span><small>当前</small></div>
              </div>
            </div>
            <div class="side-card" style="margin-top:14px">
              <h4>选集<button class="chip" style="padding:4px 12px;font-size:12px" id="autoNext">自动连播: ${store.get('autoNext', true) ? '开' : '关'}</button></h4>
              <div class="side-eps" id="sideEps"></div>
            </div>
          </aside>
        </div>
        <section class="row" id="relSec" style="margin-top:34px"></section>
      </div>`;

    const video = $('#videoEl');
    const tip = $('#videoTip');

    function renderSideEps() {
      $('#sideEps').innerHTML = groups[gi].eps.map((e, i) => {
        const watchedArr = store.get('watched:' + key + ':' + vod.vod_id, []);
        return `<button class="ep-btn ${i === ei ? 'current' : ''} ${watchedArr.includes(i) ? 'watched' : ''}"
          data-i="${i}" title="${esc(e.name)}">${esc(e.name)}</button>`;
      }).join('');
      $$('#sideEps .ep-btn').forEach((b) => b.addEventListener('click', () => gotoEp(Number(b.dataset.i))));
      const curBtn = $('#sideEps .ep-btn.current');
      curBtn && curBtn.scrollIntoView({ block: 'nearest' });
    }

    function playCurrent(resume) {
      const ep = groups[gi].eps[ei];
      Player.play(video, ep.url, tip);
      tip.classList.remove('hidden');
      tip.textContent = '正在加载…';
      const clear = () => { tip.classList.add('hidden'); };
      video.addEventListener('playing', clear, { once: true });
      video.addEventListener('error', () => { tip.classList.remove('hidden'); tip.textContent = '播放失败，请尝试换集或换源'; }, { once: true });

      if (resume && allProg[gi + ':' + ei] && allProg[gi + ':' + ei].t > 20) {
        const onceSeek = () => { try { video.currentTime = allProg[gi + ':' + ei].t; } catch (e) {} };
        video.addEventListener('loadedmetadata', onceSeek, { once: true });
      }
      // 进度保存 + 观看心跳(每30秒向服务器累计观看时长)
      let beat = 0;
      const saveTick = setInterval(() => {
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
      window.addEventListener('hashchange', () => clearInterval(saveTick), { once: true });
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
      history.replaceState(null, '', `#/play/${key}/${encodeURIComponent(id)}?ep=${ei}&group=${gi}`);
      renderSideEps();
      playCurrent(true);
      const t = $('#view h2 span');
      if (t) t.textContent = groups[gi].eps[ei].name;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    $('#autoNext').addEventListener('click', (e) => {
      const nv = !store.get('autoNext', true);
      store.set('autoNext', nv);
      e.target.textContent = '自动连播: ' + (nv ? '开' : '关');
    });

    // 换源候选(新标签页打开, 不打断当前播放)
    (async () => {
      try {
        const others = visibleSources().filter((s) => s.key !== key).slice(0, 14);
        const found = [];
        await Promise.allSettled(others.map(async (s) => {
          try {
            const r2 = await API.search(s, vod.vod_name);
            for (const v2 of (r2.list || [])) {
              if (String(v2.vod_name).replace(/\s/g, '') === String(vod.vod_name).replace(/\s/g, '')) {
                found.push({ key: s.key, name: s.name, id: v2.vod_id });
                return;
              }
            }
          } catch (e) {}
        }));
        if (!alive()) return;
        const sw = $('#srcSwitch');
        if (sw && found.length) {
          sw.insertAdjacentHTML('beforeend', found.map((f) =>
            `<a class="src-item" target="_blank" rel="noopener" href="#/play/${esc(f.key)}/${encodeURIComponent(f.id)}?ep=${ei}"><span>${esc(f.name)}</span><small>切换</small></a>`).join(''));
        }
      } catch (e) {}
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
        toast((mode === 'login' ? '欢迎回来，' : '注册成功，') + username, 'ok');
        location.hash = '#/home';
      } catch (e) {
        toast(e.message || '操作失败', 'err');
      }
    }
    render();
    if (!alive()) return;
  }
  function USERNAME_OK(u) { return /^[\w\u4e00-\u9fa5]{2,20}$/.test(u); }

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
  async function startSpeedTests(alive) {
    const saved = store.get('srcSpeed', {});
    for (const [k, c] of Object.entries(saved)) speedCache.set(k, c);
    refreshSpeedBadges();
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
    const list = visibleSources();
    if (!list.length) {
      v.innerHTML = '<div class="container empty"><div class="big">📭</div>没有可用影视源，请检查后台设置<br><br><a class="btn ghost small" href="#/admin">前往后台</a></div>';
      return;
    }
    if (!selKey || !list.some((s) => s.key === selKey)) {
      const last = store.get('lastSrc', '');
      selKey = list.some((s) => s.key === last) ? last : list[0].key;
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
        <div class="src-layout">
          <aside class="src-list" id="srcList">
            ${ordered.map((s) => `
              <a class="src-row ${s.key === cur.key ? 'on' : ''}" href="#/sources/${encodeURIComponent(s.key)}">
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

    mountSourcePanel(cur, q, cat, alive);
    startSpeedTests(alive);
  }

  async function mountSourcePanel(src, q, cat, alive) {
    const main = $('#srcMain');
    if (!main) return;
    main.innerHTML = `
      <div class="src-panel-head">
        <div class="src-panel-title">
          🎬 ${esc(cleanSrcName(src))}
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
      <button class="load-more hidden" id="srcMore">加载更多</button>`;

    let page = 1, busy = false, exhausted = false;
    const grid = $('#srcGrid'), moreBtn = $('#srcMore'), statusEl = $('#srcStatus');

    const setStatus = (t) => { if (alive() && statusEl) statusEl.textContent = t; };

    async function loadPage() {
      if (busy || exhausted || !alive()) return;
      busy = true;
      moreBtn.textContent = '加载中…'; moreBtn.classList.remove('hidden');
      setStatus('⏳ 正在加载…');
      try {
        const r = q ? await API.search(src, q, page) : await API.list(src, page, cat);
        if (!alive()) return;
        const items = (r.list || []).filter((vod) => String(vod.vod_name || '').trim());
        if (!items.length && page === 1) {
          setHtml(grid, '<div class="empty" style="grid-column:1/-1"><div class="big">🙈</div>没有找到内容，换个关键词或分类试试</div>');
          exhausted = true;
          moreBtn.classList.add('hidden');
          setStatus('❌ 没有找到内容');
        } else if (!items.length) {
          exhausted = true;
          moreBtn.textContent = '✅ 已加载全部';
          setStatus('');
        } else {
          grid.insertAdjacentHTML('beforeend', items.map((vod) => cardHtml({
            sourceKey: src.key, sourceName: src.name, id: vod.vod_id,
            title: String(vod.vod_name).trim(), pic: vod.vod_pic,
            remarks: vod.vod_remarks, year: vod.vod_year, typeName: vod.type_name,
          })).join(''));
          setStatus(`已显示 ${page * 20 - 20 + items.length} 部`);
          page++;
          if (items.length < 20) { exhausted = true; moreBtn.textContent = '✅ 已加载全部'; }
          else moreBtn.textContent = '加载更多';
        }
      } catch (e) {
        if (alive()) {
          grid.insertAdjacentHTML('beforeend', `<div class="empty" style="grid-column:1/-1;font-size:13px;color:var(--dim)">该源请求失败：${esc(e.message)}</div>`);
          setStatus('❌ 该源请求失败');
          exhausted = true;
          moreBtn.classList.add('hidden');
        }
      }
      busy = false;
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
    moreBtn.addEventListener('click', loadPage);
    $('#srcPageSearch').addEventListener('submit', (e) => {
      e.preventDefault();
      const nq = $('#srcPageQ').value.trim();
      if (nq && nq !== q) location.hash = `#/sources/${encodeURIComponent(src.key)}?q=` + encodeURIComponent(nq);
    });
  }

  /* ============================================================
     视图：电视直播
     ============================================================ */
  async function viewLive(query) {
    const v = $('#view');
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
  async function viewAdmin() {
    const v = $('#view');
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

    // 若已有会话直接进面板
    try { await API.adminSession(); renderPanel(); } catch (e) { /* 未登录 */ }

    async function renderPanel() {
      let s;
      try { s = await API.adminGetSettings(); } catch (e) { toast('会话过期，请重新登录', 'err'); return; }
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
            <h3>📡 采集源配置</h3>
            <p class="hint">默认每日同步 LunaTV-config。你可以改成自己的配置地址（JSON 格式：<code>{"api_site":{"key":{"name":"..","api":".."}}}</code>），也可以直接把 JSON 内容粘贴进来。保存后立即生效。</p>
            <label class="field-label">当前生效：${s.configFrom === 'inline-json' ? '后台内联 JSON' : s.configFrom === 'custom-url' ? '自定义地址' : '默认 LunaTV-config'}</label>
            <input class="field-input" id="cfgUrlInput" value="${esc(s.effectiveConfigUrl)}" placeholder="https://.../xxx.json 或直接粘贴 { 开头的 JSON">
            <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">
              <button class="btn primary" id="saveCfgBtn">保存采集源配置</button>
              <button class="btn ghost" id="resetCfgBtn">恢复默认(LunaTV-config)</button>
            </div>
          </div>

          <div class="admin-card">
            <h3>🧩 影视源管理</h3>
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
            <button class="btn primary" id="saveSiteBtn" style="margin-top:14px">保存站点设置</button>
          </div>

          <div class="admin-card">
            <h3>📺 电视直播源</h3>
            <p class="hint">每行一个 m3u 直播源地址，保存后全站生效（缓存约 30 分钟）。推荐：<br>
              <code>https://iptv-org.github.io/iptv/countries/cn.m3u</code><br>
              <code>https://live.fanmingming.com/tv/m3u/ipv6.m3u</code></p>
            <textarea class="field-area" id="liveInput" style="min-height:110px;font-family:monospace;font-size:12px">${esc((s.liveSources || []).join('\n'))}</textarea>
            <button class="btn primary" id="saveLiveBtn" style="margin-top:14px">保存直播源</button>
          </div>

          <div class="admin-card">
            <h3>👥 用户管理</h3>
            <p class="hint">查看每个用户的注册时间、最近登录 IP、搜索与观看记录（<b>包含用户已删除的记录</b>，灰色标记）。用户只能对自己隐藏记录；彻底删除只有这里可以。</p>
            <div class="admin-row">
              <div class="admin-label">强制登录观看<small>开启后未登录用户无法获取影片数据（接口层拦截）</small></div>
              <label class="switch"><input type="checkbox" id="requireLoginSwitch" ${s.requireLogin !== false ? 'checked' : ''}><span class="track"></span></label>
            </div>
            <div class="admin-row">
              <div class="admin-label">开放前台注册<small>关闭后新用户无法自行注册</small></div>
              <label class="switch"><input type="checkbox" id="allowRegisterSwitch" ${s.allowRegister !== false ? 'checked' : ''}><span class="track"></span></label>
            </div>
            <div style="margin-top:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
              <button class="btn primary small" id="loadUsersBtn">🔄 刷新用户列表</button>
              <span style="color:var(--dim);font-size:12px" id="usersStat"></span>
            </div>
            <div id="usersTable" style="margin-top:10px;overflow-x:auto"></div>
            <div id="userLogDetail" style="margin-top:14px"></div>
          </div>

          <div class="admin-card">
            <h3>🔑 修改管理密码</h3>
            <p class="hint">修改后立即生效，旧会话全部失效，需用新密码重新登录。无需进 Cloudflare 改环境变量。</p>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:10px">
              <input class="field-input" id="oldPwd" type="password" placeholder="当前密码">
              <input class="field-input" id="newPwd" type="password" placeholder="新密码(至少6位)">
              <input class="field-input" id="newPwd2" type="password" placeholder="确认新密码">
            </div>
            <button class="btn primary" id="savePwdBtn" style="margin-top:14px">确认修改密码</button>
          </div>

          <div class="admin-card">
            <h3>🧾 系统信息</h3>
            <div class="admin-row"><div class="admin-label">设置存储<small>${s.storage === 'kv' ? '已绑定 Cloudflare KV(CONFIG_KV)，重启不丢失' : '未绑定 KV，当前保存在实例内存，重部署后恢复默认。绑定方法见 README'}</small></div>
              <span class="status-pill ${s.storage === 'kv' ? 'ok' : 'warn'}">${s.storage === 'kv' ? 'KV' : 'Memory'}</span></div>
            <div class="admin-row"><div class="admin-label">管理密码<small>${s.hasCustomPassword ? '后台已自定义 ✔（修改请用上方「修改管理密码」）' : s.passwordFromEnv ? '来自环境变量 ADMIN_PASSWORD ✔' : '使用默认密码 admin123，建议在上方直接修改'}</small></div>
              <span class="status-pill ${s.hasCustomPassword || s.passwordFromEnv ? 'ok' : 'warn'}">${s.hasCustomPassword ? '后台自定义' : s.passwordFromEnv ? '环境变量' : '默认'}</span></div>
            <div class="admin-row"><div class="admin-label">影视源配置<small>${(s.customSources || []).length} 个自定义源 · ${(s.disabledSources || []).length} 个停用中 · 内置源每日同步自 LunaTV-config</small></div>
              <span class="status-pill ok">${State.config.count}/${State.config.total} 源可用</span></div>
          </div>
        </div>`;

      $('#logoutBtn').addEventListener('click', async () => { try { await API.adminLogout(); } catch (e) {} toast('已退出'); viewAdmin(); });

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
          const res = await API.adminSaveSettings({
            siteName: $('#siteNameInput').value,
            defaultTheme: $('#themeSelect').value,
            announcement: $('#annInput').value,
          });
          State.settings = { ...State.settings, siteName: res.settings.siteName, announcement: res.settings.announcement };
          $('#brandName').textContent = res.settings.siteName;
          document.title = res.settings.siteName;
          applyAnnouncement(res.settings.announcement);
          toast('站点设置已保存', 'ok');
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

      /* ---- 影视源管理 ---- */
      const customRows = (s.customSources || []).map((x) => ({ ...x }));
      const disabledSet = new Set(s.disabledSources || []);
      const builtins = (s.allSources || []).filter((x) => !x.custom);
      const editor = $('#srcEditor');

      function updateCountInfo() {
        const info = $('#srcCountInfo');
        if (info) info.textContent = `内置 ${builtins.length} 个（停用 ${[...disabledSet].filter((k) => !customRows.some((c) => c.key === k)).length}） · 自定义 ${customRows.length} 个`;
      }

      function renderEditor() {
        const rowHtml = [];
        for (const b of builtins) {
          const off = disabledSet.has(b.key);
          rowHtml.push(`
            <div class="src-edit-row builtin" data-bk="${esc(b.key)}">
              <input type="checkbox" class="src-en" ${off ? '' : 'checked'} title="启用/停用">
              <span class="ro" title="${esc(cleanSrcName(b))}">${esc(cleanSrcName(b))}</span>
              <span class="ro" title="${esc(b.api)}">${esc(b.api)}</span>
              <span class="ro src-edit-col-detail">—</span>
              <span style="font-size:11px;color:var(--dim)">内置</span>
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
        // 收集自定义行
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
          cleaned.push({
            key: host,
            name: name || host,
            api,
            detail,
            _enabled,
          });
        }
        // 去重 key
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

      /* ---- 修改密码 ---- */
      $('#savePwdBtn').addEventListener('click', async () => {
        const o = $('#oldPwd').value, n1 = $('#newPwd').value, n2 = $('#newPwd2').value;
        if (!o) return toast('请输入当前密码', 'err');
        if (n1.length < 6) return toast('新密码至少 6 位', 'err');
        if (n1 !== n2) return toast('两次输入的新密码不一致', 'err');
        try {
          await API.adminChangePassword(o, n1);
          toast('密码已修改，请用新密码重新登录', 'ok');
          try { await API.adminLogout(); } catch (e) {}
          viewAdmin();
        } catch (err) { toast('修改失败：' + err.message, 'err'); }
      });

      /* ---- 用户管理 ---- */
      $('#requireLoginSwitch').addEventListener('change', async (e) => {
        const on = e.target.checked;
        try {
          await API.adminSaveSettings({ requireLogin: on });
          State.settings = { ...State.settings, requireLogin: on };
          toast(on ? '已开启：未登录用户无法观看' : '已关闭：游客可直接观看', on ? 'ok' : 'err');
        } catch (err) { e.target.checked = !on; toast('保存失败：' + err.message, 'err'); }
      });
      $('#allowRegisterSwitch').addEventListener('change', async (e) => {
        const on = e.target.checked;
        try {
          await API.adminSaveSettings({ allowRegister: on });
          State.settings = { ...State.settings, allowRegister: on };
          toast(on ? '已开放注册' : '已关闭注册', 'ok');
        } catch (err) { e.target.checked = !on; toast('保存失败：' + err.message, 'err'); }
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
              <span class="ulog-meta">${esc(it.ip || '—')}</span>
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
              <p class="hint">注册 ${fmtDateTime(d.createdAt)} · 最近登录 ${fmtDateTime(d.lastLoginAt)} · IP ${esc(d.lastLoginIp || '—')} · 灰色行 = 用户已自行删除</p>
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
            <table class="adm-table">
              <thead><tr><th>用户</th><th>注册时间</th><th>最近登录</th><th>登录IP</th><th>累计观看</th><th>有效/总记录</th><th></th></tr></thead>
              <tbody>${r.users.map((u) => `
                <tr>
                  <td>${esc(u.username)}</td>
                  <td>${fmtDateTime(u.createdAt)}</td>
                  <td>${fmtDateTime(u.lastLoginAt)}</td>
                  <td>${esc(u.lastLoginIp || '—')}</td>
                  <td>${fmtWatchSec(u.watchSec)}</td>
                  <td>${u.activeItems}/${u.totalItems}</td>
                  <td style="white-space:nowrap;display:flex;gap:6px">
                    <button class="btn ghost small u-log" data-u="${esc(u.username)}">记录</button>
                    <button class="btn danger small u-del" data-u="${esc(u.username)}">删户</button>
                  </td>
                </tr>`).join('')}</tbody>
            </table>` : '<p class="hint">暂无注册用户（开放注册后，前台 #/login 可注册）</p>';
          $$('#usersTable .u-log').forEach((b) => b.addEventListener('click', () => showUserLog(b.dataset.u)));
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

      /* ---- 采集源配置 ---- */
      $('#saveCfgBtn').addEventListener('click', async () => {
        const val = $('#cfgUrlInput').value.trim();
        if (val && !/^https?:\/\//i.test(val) && !val.startsWith('{')) {
          return toast('请填写 http(s) 地址，或粘贴 { 开头的 JSON 内容', 'err');
        }
        try {
          await API.adminSaveSettings({ configUrl: val });
          State.config = await API.getConfig();
          toast(`采集源配置已保存：当前 ${State.config.count} 个源可用`, 'ok');
          renderPanel();
        } catch (err) { toast('保存失败：' + err.message, 'err'); }
      });
      $('#resetCfgBtn').addEventListener('click', async () => {
        try {
          await API.adminSaveSettings({ configUrl: '' });
          State.config = await API.getConfig();
          toast('已恢复默认采集源配置', 'ok');
          renderPanel();
        } catch (err) { toast('操作失败：' + err.message, 'err'); }
      });

      /* 初始渲染源编辑器 */
      renderEditor();
      updateCountInfo();
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
    // 静态事件
    $('#themeBtn').addEventListener('click', (e) => { e.stopPropagation(); $('#themePop').classList.toggle('hidden'); });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#themePop') && !e.target.closest('#themeBtn')) $('#themePop').classList.add('hidden');
    });
    $('#announceClose').addEventListener('click', () => {
      store.set('annDismissed', $('#announceText').textContent);
      $('#announceBar').classList.add('hidden');
    });
    const doSearch = () => {
      const q = $('#searchInput').value.trim();
      if (q) location.hash = '#/search?q=' + encodeURIComponent(q);
    };
    $('#searchInput').addEventListener('keydown', (e) => e.key === 'Enter' && doSearch());
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
    try { const m = await API.userMe(); State.me = m.me ? m.me.username : null; }
    catch (e) { State.me = null; }
    if (!State.me) {
      try { await API.adminSession(); State.me = '管理员'; } catch (e2) { /* 未登录管理员 */ }
    }
    updateUserBox();

    // 应用服务端默认主题（用户本地无偏好时）
    if (!store.get('theme', null) && State.settings.defaultTheme) applyTheme(State.settings.defaultTheme);
    $('#brandName').textContent = State.settings.siteName || '星河影视';
    document.title = State.settings.siteName || '星河影视';
    applyAnnouncement(State.settings.announcement);
    route();
  }

  boot();
})();
