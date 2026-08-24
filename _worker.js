/**
 * 星河影视 NebulaTV — Cloudflare Worker / Pages 后端
 * ------------------------------------------------
 * 同一份代码可部署到:
 *   - Cloudflare Workers (wrangler.toml 中 [assets] directory = "./public")
 *   - Cloudflare Pages   (高级模式: _worker.js 与静态文件同目录, env.ASSETS 兜底)
 *
 * 可选绑定 / 环境变量:
 *   KV  CONFIG_KV        持久化后台设置(未绑定时退化为内存, 重启丢失)
 *   VAR ADMIN_PASSWORD   后台密码(默认 admin123, 请务必修改)
 *   VAR ADULT_ENABLED    初始成人内容开关 "true"/"false"(默认 false)
 *   VAR CONFIG_URL       LunaTV-config 源配置地址(默认官方 main 分支完整版)
 */

const DEFAULT_CONFIG_URL =
  'https://raw.githubusercontent.com/hafrey1/LunaTV-config/main/LunaTV-config.json';

/** GitHub 拉取失败时的内置兜底源(均来自 LunaTV-config, 🔞=成人) */
const FALLBACK_SOURCES = [
  { key: 'dbzy.tv', name: '🎬豆瓣资源', api: 'https://caiji.dbzy5.com/api.php/provide/vod', detail: 'https://dbzy.tv' },
  { key: 'mtzy.me', name: '🎬茅台资源', api: 'https://caiji.maotaizy.cc/api.php/provide/vod', detail: 'https://mtzy.me' },
  { key: 'iqiyizyapi.com', name: '🎬-爱奇艺-', api: 'https://iqiyizyapi.com/api.php/provide/vod', detail: 'https://iqiyizyapi.com' },
  { key: 'ruyizy.cn', name: '🎬如意资源', api: 'https://cj.ruyizy.cn/api.php/provide/vod', detail: 'https://ruyizy.cn' },
  { key: 'tyyszy.com', name: '🎬天涯资源', api: 'https://caiji.tyyszy.com/api.php/provide/vod', detail: 'https://tyyszy.com' },
  { key: 'bfzy.tv', name: '🎬暴风资源', api: 'https://bfzy.tv/api.php/provide/vod', detail: 'https://bfzy.tv' },
  { key: 'wolongzyw.com', name: '🎬卧龙资源', api: 'https://wolongzyw.com/api.php/provide/vod', detail: 'https://wolongzyw.com' },
  { key: 'ckzy.me', name: '🔞 CK-资源', api: 'https://ckzy.me/api.php/provide/vod', detail: 'https://ckzy.me' },
];

const DEFAULT_LIVE_SOURCES = [
  'https://iptv-org.github.io/iptv/countries/cn.m3u',
  'https://live.fanmingming.com/tv/m3u/ipv6.m3u',
];

const DEFAULT_SETTINGS = {
  siteName: '星河影视',
  adultEnabled: false,
  defaultTheme: 'midnight',
  announcement: '',
  liveSources: DEFAULT_LIVE_SOURCES,
  customSources: [],    // 后台手动添加的影视源 [{key,name,api,detail}]
  disabledSources: [],  // 被后台停用的内置源 key 列表
  passwordHash: '',     // 后台改密的 SHA-256(salt+password) 十六进制, 空则用环境变量/默认密码
  salt: '',
  configUrl: '',        // 后台自定义采集源配置地址(http), 空则用 CONFIG_URL/默认 LunaTV-config
  configJson: '',       // 后台直接粘贴的 JSON 配置内容(优先于 configUrl)
};

const THEMES = ['midnight', 'emerald', 'sunset', 'sakura', 'ocean', 'royal'];
const COOKIE_NAME = 'ntv_auth';
const SESSION_TTL = 60 * 60 * 12; // 12h

/* ------------------------- 内存兜底存储(无 KV 时) ------------------------- */
const MEM = { settings: null, loginHits: new Map() };

/* ------------------------------- 小工具 ---------------------------------- */
const enc = (s) => new TextEncoder().encode(s);
const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      ...extra,
    },
  });

async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', enc(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 校验登录密码: 优先后台改密哈希, 否则环境变量/默认密码 */
async function verifyAdminPassword(env, settings, pass) {
  if (settings.passwordHash) return safeEqual(await sha256Hex((settings.salt || '') + pass), settings.passwordHash);
  const expected = env.ADMIN_PASSWORD || 'admin123';
  return typeof pass === 'string' && safeEqual(pass, expected);
}

function randomSalt() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/* ------------------------------ 设置存取 --------------------------------- */
function kv(env) {
  const k = env && env.CONFIG_KV;
  return k && typeof k.get === 'function' ? k : null;
}
async function getSettings(env) {
  try {
    if (kv(env)) {
      const raw = await env.CONFIG_KV.get('settings');
      if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    }
  } catch (e) { /* fallthrough */ }
  if (MEM.settings) return { ...DEFAULT_SETTINGS, ...MEM.settings };
  const s = { ...DEFAULT_SETTINGS };
  if ((env.ADULT_ENABLED || '').toLowerCase() === 'true') s.adultEnabled = true;
  return s;
}
async function saveSettings(env, patch) {
  const cur = await getSettings(env);
  const next = { ...cur };
  if (typeof patch.siteName === 'string' && patch.siteName.trim()) next.siteName = patch.siteName.trim().slice(0, 40);
  if (typeof patch.adultEnabled === 'boolean') next.adultEnabled = patch.adultEnabled;
  if (typeof patch.defaultTheme === 'string' && THEMES.includes(patch.defaultTheme)) next.defaultTheme = patch.defaultTheme;
  if (typeof patch.announcement === 'string') next.announcement = patch.announcement.slice(0, 300);
  if (Array.isArray(patch.liveSources)) {
    const urls = patch.liveSources.filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u.trim())).map((u) => u.trim());
    if (urls.length || patch.liveSourcesAllowEmpty) next.liveSources = urls.slice(0, 10);
  }
  if (Array.isArray(patch.customSources)) next.customSources = normalizeSourceList(patch.customSources);
  if (Array.isArray(patch.disabledSources)) {
    next.disabledSources = [...new Set(patch.disabledSources.filter((k) => typeof k === 'string' && k))].slice(0, 100);
  }
  if (typeof patch.passwordHash === 'string' && /^[0-9a-f]{64}$/.test(patch.passwordHash)) next.passwordHash = patch.passwordHash;
  if (typeof patch.salt === 'string' && /^[0-9a-f]{32}$/.test(patch.salt)) next.salt = patch.salt;
  if (typeof patch.configUrl === 'string') {
    const cu = patch.configUrl.trim();
    if (!cu) { next.configUrl = ''; next.configJson = ''; }
    else if (/^https?:\/\//i.test(cu)) { next.configUrl = cu.slice(0, 600); next.configJson = ''; }
    else if (cu.startsWith('{')) {
      try { JSON.parse(cu); next.configJson = cu.slice(0, 500000); next.configUrl = ''; }
      catch (e) { /* 非法 JSON, 忽略 */ }
    }
  }
  MEM.settings = next;
  if (kv(env)) await env.CONFIG_KV.put('settings', JSON.stringify(next));
  return next;
}

/* --------------------------- 源配置加载/缓存 ------------------------------ */
function parseConfig(raw) {
  const sites = raw && raw.api_site ? raw.api_site : {};
  const sources = Object.entries(sites).map(([key, v]) => ({
    key,
    name: String(v.name || key).trim(),
    api: String(v.api || ''),
    detail: String(v.detail || ''),
    adult: String(v.name || '').includes('🔞'),
  })).filter((s) => /^https?:\/\//i.test(s.api));
  return sources;
}

/** 校验/规范化后台提交的自定义源列表 */
function normalizeSourceList(list) {
  const out = [];
  const usedKeys = new Set();
  for (const s of list) {
    if (!s || typeof s !== 'object') continue;
    const api = String(s.api || '').trim();
    if (!/^https?:\/\//i.test(api)) continue;
    let host = '';
    try { host = new URL(api).hostname.toLowerCase(); } catch (e) { continue; }
    let key = String(s.key || '').trim() || host;
    while (usedKeys.has(key)) key += '-x';
    usedKeys.add(key);
    out.push({
      key,
      name: (String(s.name || '').trim() || host).slice(0, 40),
      api,
      detail: /^https?:\/\//i.test(String(s.detail || '').trim()) ? String(s.detail).trim() : '',
      custom: true,
    });
    if (out.length >= 50) break;
  }
  return out;
}

/** 合并 远程源 + 后台自定义源, 应用停用/成人开关 */
function mergeSources(remoteSources, settings) {
  const custom = Array.isArray(settings.customSources) ? settings.customSources : [];
  const disabled = new Set(Array.isArray(settings.disabledSources) ? settings.disabledSources : []);
  const byKey = new Map();
  for (const s of remoteSources) byKey.set(s.key, { ...s });
  for (const s of custom) byKey.set(s.key, { ...s, adult: false });
  const all = [...byKey.values()].map((s) => ({ ...s, disabled: disabled.has(s.key) }));
  const enabled = settings.adultEnabled ? all.filter((s) => !s.disabled) : all.filter((s) => !s.disabled && !s.adult);
  return { all, enabled };
}

async function loadSources(env, ctx, settingsArg) {
  const settings = settingsArg || (await getSettings(env));
  const inline = typeof settings.configJson === 'string' ? settings.configJson.trim() : '';
  const url = (!inline && settings.configUrl) || env.CONFIG_URL || DEFAULT_CONFIG_URL;
  // 缓存键随配置来源变化, 换配置后立即生效
  const tag = inline ? 'inline-' + inline.length + '-' + (inline.length % 97) : String(url);
  const cacheKey = new Request('https://cache.internal/nebulatv/sources/v1?u=' + encodeURIComponent(tag));
  try {
    const hit = await caches.default.match(cacheKey);
    if (hit) return await hit.json();
  } catch (e) { /* ignore */ }

  let sources = [];
  let from = 'network';
  try {
    let rawText;
    if (inline) { rawText = inline; from = 'inline-json'; }
    else {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 NebulaTV/1.0' },
        cf: { cacheTtl: 7200, cacheEverything: true },
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      rawText = await res.text();
    }
    sources = parseConfig(JSON.parse(rawText));
    if (!sources.length) throw new Error('empty config');
  } catch (e) {
    sources = FALLBACK_SOURCES.map((s) => ({ ...s, adult: s.name.includes('🔞') }));
    from = 'fallback:' + e.message;
  }
  const payload = { sources, fetchedAt: Date.now(), from };
  try {
    const r = new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } });
    ctx.waitUntil(caches.default.put(cacheKey, r.clone()));
  } catch (e) { /* ignore */ }
  return payload;
}

/* ------------------------------ 鉴权 ------------------------------------- */
async function makeToken(env) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL;
  const payload = String(exp);
  const sig = await hmacHex(await adminSecret(env), payload);
  return `${payload}.${sig}`;
}
async function verifyToken(env, token) {
  if (!token || !token.includes('.')) return false;
  const [payload, sig] = token.split('.');
  if (!/^\d+$/.test(payload)) return false;
  if (Number(payload) < Math.floor(Date.now() / 1000)) return false;
  const expect = await hmacHex(await adminSecret(env), payload);
  return safeEqual(sig, expect);
}
/** 会话签名密钥: 后台改密后(存哈希)以哈希为基准, 旧会话自动失效 */
async function adminSecret(env) {
  const s = await getSettings(env);
  const base = s.passwordHash || env.ADMIN_PASSWORD || 'admin123';
  return base + '::nebulatv-hmac';
}
function readToken(req, url) {
  const authz = req.headers.get('Authorization') || '';
  if (authz.startsWith('Bearer ')) return authz.slice(7).trim();
  const cookie = req.headers.get('Cookie') || '';
  const m = cookie.match(new RegExp('(?:^|;\\s*)' + COOKIE_NAME + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : '';
}
async function requireAuth(req, env, url) {
  if (await verifyToken(env, readToken(req, url))) return true;
  return false;
}
function rateLimited(ip) {
  const now = Date.now();
  const arr = (MEM.loginHits.get(ip) || []).filter((t) => now - t < 60000);
  if (arr.length >= 10) { MEM.loginHits.set(ip, arr); return true; }
  arr.push(now); MEM.loginHits.set(ip, arr); return false;
}

/* --------------------------- 直播 m3u 解析 ------------------------------- */
function parseM3U(text, tag) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let cur = null;
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith('#EXTINF')) {
      const commaIdx = t.indexOf(',');
      const attrs = t.slice(0, commaIdx);
      const title = (commaIdx >= 0 ? t.slice(commaIdx + 1) : '').trim();
      const group = (attrs.match(/group-title="([^"]*)"/) || [])[1] || '其他';
      const logo = (attrs.match(/tvg-logo="([^"]*)"/) || [])[1] || '';
      cur = { name: title || '未命名频道', group: group.trim() || '其他', logo, url: '', tag };
    } else if (!t.startsWith('#')) {
      if (cur && !cur.url) { cur.url = t; out.push(cur); cur = null; }
    }
  }
  return out;
}
async function loadLive(env, ctx) {
  const settings = await getSettings(env);
  const list = (settings.liveSources && settings.liveSources.length ? settings.liveSources : DEFAULT_LIVE_SOURCES);
  const cacheKey = new Request('https://cache.internal/nebulatv/live/v1');
  try {
    const hit = await caches.default.match(cacheKey);
    if (hit) return await hit.json();
  } catch (e) { /* ignore */ }

  const seen = new Set();
  const channels = [];
  for (const url of list.slice(0, 4)) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000) });
      if (!res.ok) continue;
      const parsed = parseM3U(await res.text(), url);
      for (const ch of parsed) {
        if (!/^https?:\/\//i.test(ch.url) || seen.has(ch.url)) continue;
        seen.add(ch.url);
        channels.push(ch);
      }
    } catch (e) { /* 下一个源 */ }
    if (channels.length > 3000) break;
  }
  const groups = [];
  const gmap = new Map();
  for (const ch of channels) {
    if (!gmap.has(ch.group)) { const g = { name: ch.group, channels: [] }; gmap.set(ch.group, g); groups.push(g); }
    gmap.get(ch.group).channels.push(ch);
  }
  const payload = { groups, total: channels.length, fetchedAt: Date.now() };
  try {
    const r = new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } });
    ctx.waitUntil(caches.default.put(cacheKey, r.clone()));
  } catch (e) { /* ignore */ }
  return payload;
}

/* ------------------------------- 路由 ------------------------------------ */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    try {
      if (path === '/api/health') return json({ ok: true, time: Date.now() });

      /* ---- 公开设置 ---- */
      if (path === '/api/settings' && request.method === 'GET') {
        const s = await getSettings(env);
        return json({ siteName: s.siteName, defaultTheme: s.defaultTheme, announcement: s.announcement });
      }

      /* ---- 源列表(远程源 + 后台自定义源, 按停用/成人开关过滤) ---- */
      if (path === '/api/config' && request.method === 'GET') {
        const settings = await getSettings(env);
        const { sources: remote } = await loadSources(env, ctx, settings);
        const { all, enabled } = mergeSources(remote, settings);
        return json({
          adultEnabled: settings.adultEnabled,
          total: all.length,
          count: enabled.length,
          sources: enabled.map(({ key, name, api, detail, adult }) => ({ key, name, api, detail, adult })),
        });
      }

      /* ---- 苹果CMS API 代理(白名单) ---- */
      if (path === '/api/proxy' && request.method === 'GET') {
        const target = url.searchParams.get('url') || '';
        let tu;
        try { tu = new URL(target); } catch (e) { return json({ error: 'bad url' }, 400); }
        if (!/^https?:$/.test(tu.protocol)) return json({ error: 'bad protocol' }, 400);

        const settings2 = await getSettings(env);
        const { sources: remote } = await loadSources(env, ctx, settings2);
        const { all } = mergeSources(remote, settings2);
        const allow = new Set();
        for (const s of all) {
          for (const u of [s.api, s.detail]) {
            try { if (u) allow.add(new URL(u).hostname.toLowerCase()); } catch (e) { /* ignore */ }
          }
        }
        const host = tu.hostname.toLowerCase();
        const ok = allow.has(host) || [...allow].some((h) => host.endsWith('.' + h));
        if (!ok) return json({ error: 'host not allowed' }, 403);

        const upstream = await fetch(tu.toString(), {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) NebulaTV/1.0', Accept: '*/*' },
          signal: AbortSignal.timeout(20000),
          cf: { cacheTtl: 120, cacheEverything: true },
        });
        const headers = new Headers();
        headers.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json; charset=utf-8');
        headers.set('Access-Control-Allow-Origin', '*');
        headers.set('Cache-Control', 'public, max-age=120');
        return new Response(upstream.body, { status: upstream.status, headers });
      }

      /* ---- 电视直播频道 ---- */
      if (path === '/api/live' && request.method === 'GET') {
        return json(await loadLive(env, ctx));
      }

      /* ---- 管理员 ---- */
      if (path === '/api/admin/login' && request.method === 'POST') {
        const ip = request.headers.get('CF-Connecting-IP') || 'local';
        if (rateLimited(ip)) return json({ error: '尝试过于频繁，请稍后再试' }, 429);
        let body = {};
        try { body = await request.json(); } catch (e) { /* ignore */ }
        const settings = await getSettings(env);
        if (!(await verifyAdminPassword(env, settings, body.password))) return json({ error: '密码错误' }, 401);
        const token = await makeToken(env);
        return json({ token }, 200, {
          'Set-Cookie': `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL}`,
        });
      }
      if (path.startsWith('/api/admin/')) {
        if (!(await requireAuth(request, env, url))) return json({ error: 'unauthorized' }, 401);
        if (path === '/api/admin/session' && request.method === 'GET') return json({ ok: true });
        if (path === '/api/admin/logout' && request.method === 'POST') {
          return json({ ok: true }, 200, { 'Set-Cookie': `${COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0` });
        }
        if (path === '/api/admin/settings' && request.method === 'GET') {
          const s = await getSettings(env);
          const { sources: remote } = await loadSources(env, ctx, s);
          const { all } = mergeSources(remote, s);
          return json({
            siteName: s.siteName,
            adultEnabled: s.adultEnabled,
            defaultTheme: s.defaultTheme,
            announcement: s.announcement,
            liveSources: s.liveSources,
            customSources: s.customSources || [],
            disabledSources: s.disabledSources || [],
            storage: kv(env) ? 'kv' : 'memory',
            passwordFromEnv: Boolean(env.ADMIN_PASSWORD),
            hasCustomPassword: Boolean(s.passwordHash),
            effectiveConfigUrl: s.configUrl || env.CONFIG_URL || DEFAULT_CONFIG_URL,
            configFrom: s.configJson ? 'inline-json' : (s.configUrl ? 'custom-url' : 'default'),
            allSources: all.map(({ key, name, api, detail, adult, custom }) => ({ key, name, api, detail, adult, custom: Boolean(custom) })),
          });
        }
        if (path === '/api/admin/settings' && request.method === 'POST') {
          let body = {};
          try { body = await request.json(); } catch (e) { /* ignore */ }
          const saved = await saveSettings(env, body);
          const { passwordHash, salt, ...safeSettings } = saved;
          return json({ ok: true, settings: safeSettings, storage: kv(env) ? 'kv' : 'memory' });
        }
        /* ---- 后台修改管理密码 ---- */
        if (path === '/api/admin/password' && request.method === 'POST') {
          let body = {};
          try { body = await request.json(); } catch (e) { /* ignore */ }
          const oldPwd = String(body.oldPassword || '');
          const newPwd = String(body.newPassword || '');
          const cur = await getSettings(env);
          if (!(await verifyAdminPassword(env, cur, oldPwd))) return json({ error: '旧密码不正确' }, 400);
          if (newPwd.length < 6) return json({ error: '新密码至少 6 位' }, 400);
          if (newPwd.length > 64) return json({ error: '新密码过长' }, 400);
          const salt = randomSalt();
          const passwordHash = await sha256Hex(salt + newPwd);
          await saveSettings(env, { passwordHash, salt });
          return json({ ok: true });
        }
        /* ---- 后台影视源批量保存(自定义源增删改 + 内置源停用) ---- */
        if (path === '/api/admin/sources' && request.method === 'POST') {
          let body = {};
          try { body = await request.json(); } catch (e) { /* ignore */ }
          const saved = await saveSettings(env, {
            customSources: Array.isArray(body.customSources) ? body.customSources : undefined,
            disabledSources: Array.isArray(body.disabledSources) ? body.disabledSources : undefined,
          });
          return json({
            ok: true,
            customSources: saved.customSources,
            disabledSources: saved.disabledSources,
            storage: kv(env) ? 'kv' : 'memory',
          });
        }
        return json({ error: 'not found' }, 404);
      }

      /* ---- 静态资源兜底(Pages 高级模式走这里; Workers 模式一般到不了) ---- */
      if (env.ASSETS) {
        const assetRes = await env.ASSETS.fetch(request);
        if (assetRes.status !== 404) return assetRes;
        if (!path.includes('.')) {
          return env.ASSETS.fetch(new Request(new URL('/', request.url)));
        }
      }
      return new Response('Not Found', { status: 404 });
    } catch (err) {
      return json({ error: err.message || 'internal error' }, 500);
    }
  },
};
