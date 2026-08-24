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

  const userAdultOn = () => store.get('showAdult', true);
  function visibleSources() {
    if (!State.config) return [];
    let list = State.config.sources;
    if (!State.config.adultEnabled || !userAdultOn()) list = list.filter((s) => !s.adult);
    return list;
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
  function cardHtml(item) {
    const adultBadge = item.adult ? '<span class="card-adult">🔞</span>' : '';
    return `
      <div class="card" data-key="${esc(item.sourceKey)}" data-id="${esc(item.id)}">
        <div class="card-poster">
          ${adultBadge}
          <img loading="lazy" referrerpolicy="no-referrer" src="${esc(item.pic)}" alt=""
               onerror="this.style.visibility='hidden'">
          <span class="card-badge">${esc(item.remarks || item.year || '')}</span>
          <span class="card-play-ico"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>
        </div>
        <div class="card-name" title="${esc(item.title)}">${esc(item.title)}</div>
        <div class="card-sub">${esc(item.year || '')}${item.typeName ? ' · ' + esc(item.typeName) : ''}</div>
        ${item.showSource ? `<div class="card-src">${esc(item.sourceName)}${item.srcCount > 1 ? ' 等' + item.srcCount + '源' : ''}</div>` : ''}
      </div>`;
  }
  function bindCards(root) {
    $$('.card', root).forEach((c) => c.addEventListener('click', () => {
      location.hash = `#/detail/${c.dataset.key}/${encodeURIComponent(c.dataset.id)}`;
    }));
  }
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
    ['#/browse/综艺', '综艺'], ['#/browse/动漫', '动漫'], ['#/live', '电视直播'],
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
    try {
      if (parts[0] === 'browse') await viewBrowse(parts[1] || '电影', query);
      else if (parts[0] === 'search') await viewSearch(query.q || '');
      else if (parts[0] === 'detail') await viewDetail(parts[1], decodeURIComponent(parts[2] || ''));
      else if (parts[0] === 'play') await viewPlay(parts[1], decodeURIComponent(parts[2] || ''), query);
      else if (parts[0] === 'live') await viewLive(query);
      else if (parts[0] === 'admin') await viewAdmin(query);
      else await viewHome();
    } catch (err) {
      view.innerHTML = `<div class="container empty"><div class="big">😵</div>
        <p>加载失败：${esc(err.message)}</p>
        <p style="margin-top:14px"><a class="btn ghost" href="#/home">返回首页</a></p></div>`;
    }
  }

  /* ============================================================
     视图：首页
     ============================================================ */
  let heroTimer = null;
  async function viewHome() {
    clearInterval(heroTimer);
    const v = $('#view');
    const adultChip = State.config.adultEnabled
      ? `<label class="chip ${userAdultOn() ? 'on' : ''}" id="adultChip" style="cursor:pointer">🔞 成人内容${userAdultOn() ? '开' : '关'}</label>` : '';
    v.innerHTML = `
      <div class="container page-wrap">
        <div class="hero"><div class="hero-bg" id="heroBg"></div>
          <div class="hero-content" id="heroContent"></div>
          <div class="hero-dots" id="heroDots"></div>
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:14px">${adultChip}</div>
        <div id="rows"></div>
      </div>`;
    if (adultChip) {
      $('#adultChip').addEventListener('click', () => {
        store.set('showAdult', !userAdultOn());
        toast(userAdultOn() ? '已显示成人内容' : '已隐藏成人内容');
        route();
      });
    }

    // 并行加载各分类行
    const cats = [['电影', '热门电影'], ['剧集', '热播剧集'], ['综艺', '综艺精选'], ['动漫', '动漫天地']];
    const rowsEl = $('#rows');
    cats.forEach(([cat, label]) => {
      const sec = document.createElement('section');
      sec.className = 'row';
      sec.innerHTML = `
        <div class="row-head"><div class="row-title">${label}</div>
          <a class="row-more" href="#/browse/${cat}">更多 ›</a></div>
        <div class="row-scroller">
          <button class="row-arrow prev">‹</button>
          <div class="row-list">${skeletons(8)}</div>
          <button class="row-arrow next">›</button>
        </div>`;
      rowsEl.appendChild(sec);
      $('.prev', sec).addEventListener('click', () => $('.row-list', sec).scrollBy({ left: -640, behavior: 'smooth' }));
      $('.next', sec).addEventListener('click', () => $('.row-list', sec).scrollBy({ left: 640, behavior: 'smooth' }));
      loadCatRow(sec, cat);
    });

    loadHero();
  }

  async function loadCatRow(sec, cat) {
    const listEl = $('.row-list', sec);
    const sources = featuredSources(4);
    const re = CAT_REGEX[cat];
    const seen2 = new Set();
    const results = await Promise.allSettled(
      sources.map((s) => API.list(s, 1 + Math.floor(Math.random() * 3)).catch(() => null))
    );

    // 逐源归类去重
    const finalItems = [];
    results.forEach((r, si) => {
      if (r.status !== 'fulfilled' || !r.value || !Array.isArray(r.value.list)) return;
      const s = sources[si];
      for (const vod of r.value.list) {
        const tn = String(vod.type_name || '');
        if (!re.test(tn)) continue;
        const k = vod.vod_name + '|' + (vod.vod_year || '');
        if (seen2.has(k)) continue;
        seen2.add(k);
        finalItems.push({
          sourceKey: s.key, sourceName: s.name, id: vod.vod_id, title: vod.vod_name,
          pic: vod.vod_pic, remarks: vod.vod_remarks, year: vod.vod_year, typeName: tn,
        });
      }
    });

    if (!finalItems.length) {
      listEl.innerHTML = '<div class="empty" style="padding:26px 0;font-size:13px">该分类暂时没有数据</div>';
      return;
    }
    listEl.innerHTML = finalItems.slice(0, 24).map(cardHtml).join('');
    bindCards(listEl);

    // 首个成功分类的前几部作为 Hero 候选
    if (cat === '电影') setupHero(finalItems.filter((i) => i.pic).slice(0, 5));
  }

  /* ---- Hero ---- */
  let heroItems = [], heroIdx = 0;
  function setupHero(items) {
    if (!items.length) return;
    heroItems = items; heroIdx = 0;
    const dots = $('#heroDots');
    dots.innerHTML = items.map((_, i) => `<i class="${i === 0 ? 'on' : ''}"></i>`).join('');
    $$('#heroDots i').forEach((d, i) => d.addEventListener('click', () => showHero(i)));
    showHero(0);
    clearInterval(heroTimer);
    heroTimer = setInterval(() => showHero((heroIdx + 1) % heroItems.length), 6000);
  }
  function showHero(i) {
    heroIdx = i;
    const it = heroItems[i];
    if (!it) return;
    const bg = $('#heroBg'), ct = $('#heroContent');
    if (!bg || !ct) return;
    bg.classList.remove('show');
    const img = new Image();
    img.onload = () => { bg.style.backgroundImage = `url("${it.pic}")`; bg.classList.add('show'); };
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
    $('#heroPlay').addEventListener('click', () => {
      location.hash = `#/detail/${it.sourceKey}/${encodeURIComponent(it.id)}`;
    });
    $$('#heroDots i').forEach((d, di) => d.classList.toggle('on', di === i));
  }
  async function loadHero() {
    // 取第一个精选源的详情补充简介（尽力而为）
    const wait = setInterval(() => {
      if (heroItems.length) { clearInterval(wait); enrichHeroDesc(); }
    }, 400);
    setTimeout(() => clearInterval(wait), 8000);
  }
  async function enrichHeroDesc() {
    try {
      const it = heroItems[heroIdx];
      const src = State.config.sources.find((s) => s.key === it.sourceKey);
      const r = await API.detail(src, it.id);
      const vod = r.list && r.list[0];
      if (vod && $('#heroContent')) {
        it.desc = stripTags(vod.vod_content || '').slice(0, 120);
        showHero(heroIdx);
      }
    } catch (e) { /* ignore */ }
  }

  /* ============================================================
     视图：分类浏览
     ============================================================ */
  const browseCursors = new Map(); // cat -> { pool, idx, pageBy:Map, seen:Set, year }
  async function viewBrowse(cat, query) {
    if (!CAT_REGEX[cat]) cat = '电影';
    const v = $('#view');
    v.innerHTML = `
      <div class="container page-wrap">
        <div class="page-head"><div class="page-title">${esc(cat)}</div>
          ${State.config.adultEnabled ? `<label class="chip ${userAdultOn() ? 'on' : ''}" id="adultChip" style="cursor:pointer">🔞 成人内容${userAdultOn() ? '开' : '关'}</label>` : ''}
        </div>
        <div class="chips" id="yearChips">${YEARS.map((y) => `<button class="chip ${(query.year || '全部') === y ? 'on' : ''}" data-y="${y}">${y === '全部' ? '全部年份' : y}</button>`).join('')}</div>
        <div class="grid" id="browseGrid">${skeletons(18)}</div>
        <button class="load-more" id="loadMore">加载更多</button>
      </div>`;

    const cur = { pool: featuredSources(6), idx: 0, pageBy: new Map(), seen: new Set(), year: query.year || '全部' };
    browseCursors.set(cat, cur);

    $('#adultChip') && $('#adultChip').addEventListener('click', () => { store.set('showAdult', !userAdultOn()); route(); });
    $$('#yearChips .chip').forEach((c) => c.addEventListener('click', () => {
      location.hash = `#/browse/${encodeURIComponent(cat)}?year=${encodeURIComponent(c.dataset.y)}`;
    }));

    async function loadBatch() {
      let added = 0;
      for (let round = 0; round < cur.pool.length && added < 24; round++) {
        const s = cur.pool[cur.idx % cur.pool.length];
        cur.idx++;
        const pg = (cur.pageBy.get(s.key) || 0) + 1;
        cur.pageBy.set(s.key, pg);
        try {
          const r = await API.list(s, pg);
          const grid = $('#browseGrid');
          if (!grid) return false;
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
        } catch (e) { /* 该源失败，换下一个 */ }
      }
      return added > 0;
    }

    bindCards($('#view'));
    const ok = await loadBatch();
    if (!ok) $('#browseGrid').innerHTML = '<div class="empty" style="grid-column:1/-1"><div class="big">🎬</div>暂无内容，试试其他筛选</div>';
    $('#loadMore').addEventListener('click', async (e) => {
      e.target.textContent = '加载中…';
      await loadBatch();
      bindCards($('#view'));
      e.target.textContent = '加载更多';
    });
  }

  /* ============================================================
     视图：聚合搜索
     ============================================================ */
  async function viewSearch(q) {
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

    const sources = visibleSources();
    const merged = new Map(); // normTitle|year -> item
    let done = 0;

    const applyProgress = () => {
      const pct = Math.round((done / sources.length) * 100);
      $('#progBar').style.width = pct + '%';
      $('#srcStat').textContent = `已搜索 ${done}/${sources.length} 个源 · ${merged.size} 条结果`;
      if (done >= sources.length) $('.search-progress', v).remove();
    };
    applyProgress();

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
    };

    const BATCH = 12;
    for (let i = 0; i < sources.length; i += BATCH) {
      const batch = sources.slice(i, i + BATCH);
      await Promise.allSettled(batch.map((s) =>
        API.search(s, q).then((r) => handle(s, r)).catch(() => {})
      ));
      done += batch.length;
      applyProgress();
      const grid = $('#srGrid');
      if (grid) {
        grid.innerHTML = [...merged.values()]
          .sort((a, b) => b.srcCount - a.srcCount)
          .slice(0, 96).map(cardHtml).join('');
        bindCards(grid);
      }
    }
    if (!merged.size) $('#srEmpty').classList.remove('hidden');
  }

  /* ============================================================
     视图：详情
     ============================================================ */
  async function viewDetail(key, id) {
    const v = $('#view');
    const src = State.config.sources.find((s) => s.key === key);
    if (!src) { v.innerHTML = '<div class="container empty">数据源不存在或已被后台关闭</div>'; return; }
    v.innerHTML = `<div class="container page-wrap"><div class="grid">${''}</div><div class="empty"><div class="big">📡</div>正在加载详情…</div></div>`;

    const r = await API.detail(src, id);
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

    // 换源：并行搜同名片
    $('#btnSrc').addEventListener('click', async () => {
      toast('正在寻找其他播放源…');
      const sources = visibleSources().filter((s) => s.key !== key).slice(0, 16);
      const found = [];
      await Promise.allSettled(sources.map(async (s) => {
        try {
          const r2 = await API.search(s, vod.vod_name);
          for (const v2 of (r2.list || [])) {
            if (String(v2.vod_name).replace(/\s/g, '') === String(vod.vod_name).replace(/\s/g, '')) {
              found.push({ key: s.key, name: s.name, id: v2.vod_id, remarks: v2.vod_remarks });
            }
          }
        } catch (e) {}
      }));
      if (!found.length) { toast('没有找到其他播放源'); return; }
      const box = document.createElement('div');
      box.className = 'modal-mask';
      box.innerHTML = `<div class="modal-box"><h3 style="margin-bottom:14px">切换播放源（找到 ${found.length} 个）</h3>
        <div style="display:grid;gap:8px">${found.map((f) =>
        `<div class="src-item" data-k="${esc(f.key)}" data-i="${esc(f.id)}"><span>${esc(f.name)}</span><small style="color:var(--dim)">${esc(f.remarks || '')}</small></div>`).join('')}
        </div></div>`;
      box.addEventListener('click', (e) => {
        if (e.target === box || e.target.classList.contains('modal-close')) { box.remove(); return; }
        const it = e.target.closest('.src-item');
        if (it) { box.remove(); location.hash = `#/detail/${it.dataset.k}/${encodeURIComponent(it.dataset.i)}`; }
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
  async function viewPlay(key, id, query) {
    const v = $('#view');
    const src = State.config.sources.find((s) => s.key === key);
    if (!src) { v.innerHTML = '<div class="container empty">数据源不存在</div>'; return; }
    v.innerHTML = `<div class="container page-wrap"><div class="video-wrap"><video id="videoEl" controls playsinline></video>
      <div class="video-tip" id="videoTip">正在加载视频…</div></div>
      <div class="empty" style="padding:20px 0">正在获取剧集信息…</div></div>`;

    const r = await API.detail(src, id);
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

    // 换源候选
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
        const sw = $('#srcSwitch');
        if (sw && found.length) {
          sw.insertAdjacentHTML('beforeend', found.map((f) =>
            `<div class="src-item" data-k="${esc(f.key)}" data-i="${esc(f.id)}"><span>${esc(f.name)}</span><small>切换</small></div>`).join(''));
          $$('#srcSwitch .src-item[data-k]').forEach((el) => el.addEventListener('click', () => {
            location.hash = `#/play/${el.dataset.k}/${encodeURIComponent(el.dataset.i)}?ep=${ei}`;
          }));
        }
      } catch (e) {}
    })();

    renderSideEps();
    playCurrent(true);
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
            <h3>🧩 系统信息</h3>
            <div class="admin-row"><div class="admin-label">设置存储<small>${s.storage === 'kv' ? '已绑定 Cloudflare KV(CONFIG_KV)，重启不丢失' : '未绑定 KV，当前保存在实例内存，重部署后恢复默认。绑定方法见 README'}</small></div>
              <span class="status-pill ${s.storage === 'kv' ? 'ok' : 'warn'}">${s.storage === 'kv' ? 'KV' : 'Memory'}</span></div>
            <div class="admin-row"><div class="admin-label">管理密码<small>${s.passwordFromEnv ? '来自环境变量 ADMIN_PASSWORD ✔' : '使用默认密码 admin123，请尽快在 Worker 环境变量配置 ADMIN_PASSWORD'}</small></div>
              <span class="status-pill ${s.passwordFromEnv ? 'ok' : 'warn'}">${s.passwordFromEnv ? '自定义' : '默认'}</span></div>
            <div class="admin-row"><div class="admin-label">影视源配置<small>每日同步自 LunaTV-config 项目</small></div>
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
