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
    settings: null,   // 公开设置 { siteName, defaultTheme, announcement }
    config: null,     // { adultEnabled, total, count, sources }
    liveCache: null,
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
    try {
      if (parts[0] === 'browse') await viewBrowse(dec(parts[1]) || '电影', query, alive);
      else if (parts[0] === 'search') await viewSearch(query.q ? dec(query.q) : '', alive);
      else if (parts[0] === 'detail') await viewDetail(parts[1], dec(parts[2]), alive);
      else if (parts[0] === 'play') await viewPlay(parts[1], dec(parts[2]), query, alive);
      else if (parts[0] === 'sources') await viewSources(alive);
      else if (parts[0] === 'source') await viewSource(dec(parts[1]), query, alive);
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

    const sources = visibleSources();
    const merged = new Map(); // normTitle|year -> item
    let done = 0, renderTimer = null;

    const applyProgress = () => {
      const bar = $('#progBar'), stat = $('#srcStat'), prog = $('.search-progress', v);
      if (bar) bar.style.width = Math.round((done / Math.max(sources.length, 1)) * 100) + '%';
      if (stat) stat.textContent = `已搜索 ${done}/${sources.length} 个源 · ${merged.size} 条结果`;
      if (prog && done >= sources.length) prog.remove();
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
      // 进度保存
      const saveTick = setInterval(() => {
        if (video.currentTime > 5) {
          allProg[gi + ':' + ei] = { t: Math.floor(video.currentTime), d: Math.floor(video.duration || 0) };
          store.set(progKey, allProg);
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

    // 相关推荐: 用清洗后的片名关键词跨源搜索, 展示最多 28 个
    (async () => {
      try {
        const kwRaw = String(vod.vod_name || '');
        const kw = kwRaw
          .replace(/[【\[（(].*?[】\]）)]/g, '')   // 去括号内容
          .replace(/\d{4}$/, '')                  // 去末尾年份
          .trim().slice(0, 10) || kwRaw.trim();
        const others = visibleSources().filter((s) => s.key !== key).slice(0, 8);
        const curNorm = kwRaw.replace(/\s/g, '');
        const seenR = new Set([curNorm]);
        const relItems = [];
        await Promise.allSettled(others.map(async (s) => {
          if (!alive()) return;
          try {
            const r2 = await API.search(s, kw);
            for (const v2 of (r2.list || [])) {
              const t = String(v2.vod_name || '').trim();
              if (!t || !v2.vod_pic) continue;
              const kk = t.replace(/\s/g, '') + '|' + (v2.vod_year || '');
              if (seenR.has(kk)) continue;
              seenR.add(kk);
              relItems.push({
                sourceKey: s.key, sourceName: s.name, id: v2.vod_id, title: t,
                pic: v2.vod_pic, remarks: v2.vod_remarks, year: v2.vod_year, typeName: v2.type_name,
              });
              if (relItems.length >= 28) return;
            }
          } catch (e) {}
        }));
        if (!alive()) return;
        const sec = document.getElementById('relSec');
        if (sec && relItems.length) {
          sec.innerHTML = `
            <div class="row-head"><div class="row-title">相关推荐</div>
              <div style="color:var(--dim);font-size:12.5px">关键词「${esc(kw)}」· ${Math.min(relItems.length, 28)} 部</div></div>
            <div class="grid">${relItems.slice(0, 28).map(cardHtml).join('')}</div>`;
        }
      } catch (e) { /* 相关推荐失败不影响播放 */ }
    })();

    renderSideEps();
    playCurrent(true);
  }

  /* ============================================================
     视图：影视源导航(全部源一览, 单源搜索/浏览)
     ============================================================ */
  const cleanSrcName = (s) => String(s.name || s.key).replace(/🔞/g, '').trim() || s.key;

  async function viewSources(alive) {
    const v = $('#view');
    const list = visibleSources();
    v.innerHTML = `
      <div class="container page-wrap">
        <div class="page-head"><div class="page-title">🎬 全部影视源</div>
          <div style="color:var(--dim);font-size:13px">共 ${list.length} 个源可用 · 后台可增删</div></div>
        <p style="color:var(--dim);font-size:13px;margin:-6px 0 18px">在任意源卡片中输入关键词即可只搜该源；或点「浏览最新」看该源的最新影片。</p>
        <div class="grid src-nav-grid">
          ${list.map((s) => `
            <div class="src-card" data-key="${esc(s.key)}">
              <div class="src-card-head">
                <span class="src-card-name" title="${esc(cleanSrcName(s))}">${esc(cleanSrcName(s))}</span>
                ${s.custom ? '<span class="tag plain" style="font-size:10.5px;flex-shrink:0">自定义</span>' : ''}
              </div>
              <form class="src-card-search">
                <input type="search" placeholder="在此源内搜索片名…" autocomplete="off">
                <button class="btn primary small" type="submit">搜索</button>
              </form>
              <a class="src-card-browse" href="#/source/${encodeURIComponent(s.key)}">浏览最新影片 ›</a>
            </div>`).join('')}
        </div>
        ${list.length ? '' : '<div class="empty"><div class="big">📭</div>没有可用影视源，请检查后台设置</div>'}
      </div>`;
    if (!alive()) return;
    $$('.src-card', v).forEach((card) => {
      const form = $('.src-card-search', card);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const q = $('input', form).value.trim();
        location.hash = `#/source/${encodeURIComponent(card.dataset.key)}${q ? '?q=' + encodeURIComponent(q) : ''}`;
      });
    });
  }

  async function viewSource(key, query, alive) {
    const src = visibleSources().find((s) => s.key === key);
    const v = $('#view');
    if (!src) { v.innerHTML = '<div class="container empty"><div class="big">📭</div>影视源不存在或已被停用<br><br><a class="btn ghost small" href="#/sources">← 返回源列表</a></div>'; return; }
    const q = query.q || '';
    v.innerHTML = `
      <div class="container page-wrap">
        <div class="page-head">
          <div class="page-title" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            🎬 ${esc(cleanSrcName(src))}
            <span style="font-size:13.5px;color:var(--dim);font-weight:400">${q ? '· 搜索「' + esc(q) + '」' : '· 最新影片'}</span>
          </div>
          <form class="src-page-search" id="srcPageSearch">
            <input type="search" id="srcPageQ" placeholder="在该源内搜索…" value="${esc(q)}" autocomplete="off">
            <button class="btn primary small" type="submit">搜索</button>
            ${q ? `<a class="btn ghost small" href="#/source/${encodeURIComponent(key)}">看最新</a>` : ''}
          </form>
        </div>
        <div class="grid" id="srcGrid">${skeletons(HOME_ROW_COUNT)}</div>
        <button class="load-more hidden" id="srcMore">加载更多</button>
      </div>`;
    if (!alive()) return;

    let page = 1, busy = false, exhausted = false;
    const grid = $('#srcGrid'), moreBtn = $('#srcMore');

    async function loadPage() {
      if (busy || exhausted || !alive()) return;
      busy = true;
      moreBtn.textContent = '加载中…'; moreBtn.classList.remove('hidden');
      try {
        const r = q ? await API.search(src, q, page) : await API.list(src, page);
        if (!alive()) return;
        const items = (r.list || []).filter((vod) => String(vod.vod_name || '').trim());
        if (!items.length && page === 1) {
          setHtml(grid, '<div class="empty" style="grid-column:1/-1"><div class="big">🙈</div>没有找到内容，换个关键词试试</div>');
          exhausted = true;
          moreBtn.classList.add('hidden');
        } else if (!items.length) {
          exhausted = true;
          moreBtn.textContent = '没有更多了';
        } else {
          grid.insertAdjacentHTML('beforeend', items.map((vod) => cardHtml({
            sourceKey: src.key, sourceName: src.name, id: vod.vod_id,
            title: String(vod.vod_name).trim(), pic: vod.vod_pic,
            remarks: vod.vod_remarks, year: vod.vod_year, typeName: vod.type_name,
          })).join(''));
          page++;
          moreBtn.textContent = '加载更多';
          if (items.length < 20) { exhausted = true; moreBtn.textContent = '没有更多了'; }
        }
      } catch (e) {
        if (alive()) {
          grid.insertAdjacentHTML('beforeend', `<div class="empty" style="grid-column:1/-1;font-size:13px;color:var(--dim)">该源请求失败：${esc(e.message)}</div>`);
          exhausted = true;
          moreBtn.classList.add('hidden');
        }
      }
      busy = false;
    }

    await loadPage();
    if (!alive()) return;
    moreBtn.addEventListener('click', loadPage);
    $('#srcPageSearch').addEventListener('submit', (e) => {
      e.preventDefault();
      const nq = $('#srcPageQ').value.trim();
      if (nq && nq !== q) location.hash = `#/source/${encodeURIComponent(key)}?q=` + encodeURIComponent(nq);
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

    // 应用服务端默认主题（用户本地无偏好时）
    if (!store.get('theme', null) && State.settings.defaultTheme) applyTheme(State.settings.defaultTheme);
    $('#brandName').textContent = State.settings.siteName || '星河影视';
    document.title = State.settings.siteName || '星河影视';
    applyAnnouncement(State.settings.announcement);
    route();
  }

  boot();
})();
