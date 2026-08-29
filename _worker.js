/**
 * 晓林影视 XIAOLIN-TV — Cloudflare Worker / Pages 后端
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
  siteName: '晓林影视 XIAOLIN-TV',
  adultEnabled: false,
  defaultTheme: 'midnight',
  announcement: '',
  liveSources: DEFAULT_LIVE_SOURCES,
  customSources: [],    // 后台手动添加的影视源 [{key,name,api,detail}]
  disabledSources: [],  // 被后台停用的内置源 key 列表
  passwordHash: '',     // 后台改密的 SHA-256(salt+password) 十六进制, 空则用环境变量/默认密码
  salt: '',
  configUrl: '',        // (兼容保留) 单个采集源地址
  configUrls: [],       // 多个采集源配置地址, 顺序即优先级(前面的 key 不被后面覆盖)
  configJson: '',       // 后台直接粘贴的 JSON 配置内容(优先于所有 URL)
  requireLogin: true,   // 登录观看: 开启=游客可试看 trialMinutes 分钟, 到期需注册; 关闭=完全免登录
  trialMinutes: 20,     // 游客试看时长(分钟), 后台可自定义; 0=立即要求登录
  allowRegister: true,  // 开放前台注册
  homeSources: [],      // 首页默认加载的影视源 key 顺序列表(空=内置精选)
  appPromoEnabled: true, // 手机访问弹「下载APP」引导弹窗(后台可关)
  downloadUrlMode: 'fixed', // fixed=站内最新包 | custom=自定义 downloadUrl
  downloadUrl: '',      // 自定义手机 APK 地址(仅 custom 模式生效)
  downloadUrlTvMode: 'off', // off=不提供 | fixed=站内最新 | custom=自定义
  downloadUrlTv: '',    // 自定义 TV APK 地址(仅 custom 模式生效)
  appVersionCode: 0,     // 手动模式下的 versionCode; 0=不检查(自动模式则以 manifest 为准)
  appVersionName: '',    // 手动模式版本名
  appForceUpdate: false, // 强制更新: App 内不可关闭弹窗
  appChangelog: '',      // 手动模式更新说明
  appVersionAuto: true,  // true=从 /APP/manifest.json 自动识别版本(推荐)
  adminPath: '',        // 后台入口自定义路径段(#/<adminPath>), 空则默认 'admin'
  playerOptimize: false, // 播放加载优化: false=保持现状, true=更快起播的 HLS 参数
  wmEnabled: false,      // 播放器 PNG 水印开关
  wmMode: 'corner',      // corner=右下角常显(播放中) | center=正中短暂显示
  wmUrl: '',             // 水印图片 URL(建议 png)
  wmOpacity: 0.55,       // 水印透明度 0.15-1
  wmDuration: 2,         // 正中模式显示秒数(1-60)
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
      if (raw) {
        const s = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
        // 一次性迁移: 旧默认站名自动改为新站名(管理员改过的自定义名不受影响)
        if (s.siteName === '星河影视') s.siteName = DEFAULT_SETTINGS.siteName;
        return s;
      }
    }
  } catch (e) { /* fallthrough */ }
  if (MEM.settings) {
    const s = { ...DEFAULT_SETTINGS, ...MEM.settings };
    if (s.siteName === '星河影视') s.siteName = DEFAULT_SETTINGS.siteName;
    return s;
  }
  const s = { ...DEFAULT_SETTINGS };
  if ((env.ADULT_ENABLED || '').toLowerCase() === 'true') s.adultEnabled = true;
  return s;
}

/** 站内固定最新包路径(CI 覆盖同名文件, 链接永不变) */
const FIXED_PHONE_APK = '/APP/xiaolintv-phone-latest.apk';
const FIXED_TV_APK = '/APP/xiaolintv-tv-latest.apk';

function phoneDlMode(s) {
  return s && s.downloadUrlMode === 'custom' ? 'custom' : 'fixed';
}
function tvDlMode(s) {
  const m = s && s.downloadUrlTvMode;
  if (m === 'fixed' || m === 'custom') return m;
  return 'off';
}
/** 对外生效的下载地址(固定模式忽略自定义字段) */
function effectiveDownloadUrls(s) {
  const phone = phoneDlMode(s) === 'custom'
    ? String(s.downloadUrl || '').trim()
    : FIXED_PHONE_APK;
  let tv = '';
  const tm = tvDlMode(s);
  if (tm === 'fixed') tv = FIXED_TV_APK;
  else if (tm === 'custom') tv = String(s.downloadUrlTv || '').trim();
  return { downloadUrl: phone, downloadUrlTv: tv };
}

/** 读取 CI 写入的 public/APP/manifest.json */
async function loadAppManifest(env, request) {
  if (env && typeof env.getAppManifest === 'function') {
    try {
      const m = await env.getAppManifest();
      if (m && typeof m === 'object') return m;
    } catch (e) { /* ignore */ }
  }
  try {
    if (env && env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      const assetUrl = new URL('/APP/manifest.json', (request && request.url) || 'https://assets.local/');
      const r = await env.ASSETS.fetch(assetUrl);
      if (r.ok) return await r.json();
    }
  } catch (e) { /* ignore */ }
  try {
    const base = request && request.url ? new URL(request.url) : null;
    if (base && base.hostname && base.hostname !== 'internal') {
      const r = await fetch(new URL('/APP/manifest.json', base), { signal: AbortSignal.timeout(4000) });
      if (r.ok) return await r.json();
    }
  } catch (e) { /* ignore */ }
  return null;
}

function parseManifestVersion(manifest) {
  if (!manifest || typeof manifest !== 'object') return null;
  const code = Math.max(0, Math.round(Number(manifest.versionCode == null ? 0 : manifest.versionCode)) || 0);
  if (!code) return null;
  return {
    appVersionCode: code,
    appVersionName: String(manifest.versionName || ('1.0.' + code)).slice(0, 40),
    appChangelog: String(manifest.changelog || '').slice(0, 2000),
    publishedAt: manifest.publishedAt || '',
  };
}

/** 对外生效的 App 版本(默认自动读 manifest; 手动模式用后台字段) */
function effectiveAppVersion(s, manifest) {
  const auto = !s || s.appVersionAuto !== false;
  const fromFile = parseManifestVersion(manifest);
  if (auto && fromFile) {
    return {
      appVersionAuto: true,
      appVersionCode: fromFile.appVersionCode,
      appVersionName: fromFile.appVersionName,
      appChangelog: fromFile.appChangelog,
      appVersionSource: 'manifest',
      appManifestAt: fromFile.publishedAt || '',
    };
  }
  return {
    appVersionAuto: auto,
    appVersionCode: Math.max(0, Math.round(Number(s && s.appVersionCode != null ? s.appVersionCode : 0)) || 0),
    appVersionName: (s && s.appVersionName) || '',
    appChangelog: (s && s.appChangelog) || '',
    appVersionSource: 'manual',
    appManifestAt: fromFile ? (fromFile.publishedAt || '') : '',
  };
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
  if (typeof patch.requireLogin === 'boolean') next.requireLogin = patch.requireLogin;
  if (patch.trialMinutes !== undefined) {
    const n = Math.round(Number(patch.trialMinutes));
    if (!isFinite(n) || n < 0 || n > 2880) throw new Error('试看时长需为 0-2880 分钟');
    next.trialMinutes = n;
  }
  if (typeof patch.allowRegister === 'boolean') next.allowRegister = patch.allowRegister;
  if (typeof patch.appPromoEnabled === 'boolean') next.appPromoEnabled = patch.appPromoEnabled;
  if (typeof patch.downloadUrlMode === 'string') {
    next.downloadUrlMode = patch.downloadUrlMode === 'custom' ? 'custom' : 'fixed';
  }
  if (typeof patch.downloadUrl === 'string') next.downloadUrl = patch.downloadUrl.trim().slice(0, 300);
  if (typeof patch.downloadUrlTvMode === 'string') {
    const m = String(patch.downloadUrlTvMode);
    next.downloadUrlTvMode = (m === 'fixed' || m === 'custom') ? m : 'off';
  }
  if (typeof patch.downloadUrlTv === 'string') next.downloadUrlTv = patch.downloadUrlTv.trim().slice(0, 300);
  if (patch.appVersionCode !== undefined) {
    const c = Math.round(Number(patch.appVersionCode));
    if (!isFinite(c) || c < 0 || c > 999999999) throw new Error('App versionCode 需为 0-999999999 的整数');
    next.appVersionCode = c;
  }
  if (typeof patch.appVersionName === 'string') next.appVersionName = patch.appVersionName.trim().slice(0, 40);
  if (typeof patch.appForceUpdate === 'boolean') next.appForceUpdate = patch.appForceUpdate;
  if (typeof patch.appChangelog === 'string') next.appChangelog = patch.appChangelog.trim().slice(0, 2000);
  if (typeof patch.appVersionAuto === 'boolean') next.appVersionAuto = patch.appVersionAuto;
  if (typeof patch.adminPath === 'string') {
    const ap = patch.adminPath.trim().toLowerCase();
    if (ap && !/^[a-z0-9][a-z0-9-_]{1,39}$/.test(ap)) {
      throw new Error('后台入口路径仅支持 2-40 位小写字母/数字/短横线');
    }
    if (['api','assets','icons','js','css'].includes(ap)) throw new Error('该路径为系统保留，请换一个');
    next.adminPath = ap;
  }
  if (Array.isArray(patch.homeSources)) {
    next.homeSources = [...new Set(patch.homeSources.filter((k) => typeof k === 'string' && k.trim()).map((k) => k.trim()))].slice(0, 12);
  }
  if (typeof patch.playerOptimize === 'boolean') next.playerOptimize = patch.playerOptimize;
  if (typeof patch.wmEnabled === 'boolean') next.wmEnabled = patch.wmEnabled;
  if (typeof patch.wmMode === 'string') {
    next.wmMode = patch.wmMode === 'center' ? 'center' : 'corner';
  }
  if (typeof patch.wmUrl === 'string') {
    const u = patch.wmUrl.trim().slice(0, 500);
    if (u && !/^https?:\/\//i.test(u) && !u.startsWith('data:image/')) {
      throw new Error('水印图片需为 http(s) 或 data:image 地址');
    }
    next.wmUrl = u;
  }
  if (patch.wmOpacity !== undefined) {
    const o = Number(patch.wmOpacity);
    if (!isFinite(o) || o < 0.15 || o > 1) throw new Error('水印透明度需为 0.15-1');
    next.wmOpacity = Math.round(o * 100) / 100;
  }
  if (patch.wmDuration !== undefined) {
    const d = Math.round(Number(patch.wmDuration));
    if (!isFinite(d) || d < 1 || d > 60) throw new Error('水印显示时长需为 1-60 秒');
    next.wmDuration = d;
  }
  if (Array.isArray(patch.configUrls)) {
    // 多采集源: 去空/去重/校验 http(s), 最多 10 条; 空数组 = 清空恢复默认
    const list = [...new Set(patch.configUrls
      .filter((k) => typeof k === 'string' && /^https?:\/\//i.test(k.trim()))
      .map((k) => k.trim().slice(0, 600)))].slice(0, 10);
    next.configUrls = list;
    next.configUrl = list[0] || '';
    if (!list.length) next.configJson = '';
  }
  if (typeof patch.configUrl === 'string') {
    const cu = patch.configUrl.trim();
    if (!cu) { next.configUrl = ''; next.configUrls = []; next.configJson = ''; }
    else if (/^https?:\/\//i.test(cu)) { next.configUrl = cu.slice(0, 600); next.configUrls = [cu.slice(0, 600)]; next.configJson = ''; }
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

/** 导出用: 已启用影视源(跟随后台成人开关, 不含已停用) */
async function getExportSources(env, ctx, settings) {
  const { sources: remote } = await loadSources(env, ctx, settings);
  const { all } = mergeSources(remote, settings);
  return settings.adultEnabled ? all.filter((s) => !s.disabled) : all.filter((s) => !s.disabled && !s.adult);
}

/** TVBox / 影视仓 标准 sites[] 配置(type=1 苹果CMS) */
function buildTvboxConfig(settings, sources, origin) {
  const siteName = String(settings.siteName || '晓林影视').trim();
  const sites = sources.map((s) => ({
    key: s.key,
    name: String(s.name || s.key).trim(),
    type: 1,
    api: s.api,
    searchable: 1,
    quickSearch: 1,
    filterable: 1,
    changeable: 0,
  }));
  const lives = (Array.isArray(settings.liveSources) ? settings.liveSources : DEFAULT_LIVE_SOURCES)
    .filter((u) => /^https?:\/\//i.test(String(u || '').trim()))
    .slice(0, 8)
    .map((u, i) => ({
      name: i === 0 ? '电视直播' : `直播源${i + 1}`,
      type: 0,
      url: String(u).trim(),
      playerType: 1,
    }));
  return {
    _comment: `${siteName} · 苹果CMS采集 · 由后台影视源自动生成`,
    spider: '',
    wallpaper: '',
    sites,
    lives,
    parses: [],
    flags: ['qq', 'qiyi', 'iqiyi', 'youku', 'mgtv', 'bilibili', 'sohu', 'letv', 'pptv', 'fun'],
    doh: [],
    meta: {
      name: siteName,
      origin: origin || '',
      generatedAt: new Date().toISOString(),
      siteCount: sites.length,
      liveCount: lives.length,
    },
  };
}

/** LunaTV / 部分 TVBox 分支使用的 api_site 格式 */
function buildLunatvConfig(settings, sources, origin) {
  const api_site = {};
  for (const s of sources) {
    api_site[s.key] = {
      name: String(s.name || s.key).trim(),
      api: s.api,
      detail: s.detail || '',
    };
  }
  return {
    _comment: `${String(settings.siteName || '晓林影视').trim()} · LunaTV api_site 格式`,
    api_site,
    meta: {
      origin: origin || '',
      generatedAt: new Date().toISOString(),
      siteCount: sources.length,
    },
  };
}

async function loadSources(env, ctx, settingsArg) {
  const settings = settingsArg || (await getSettings(env));
  const inline = typeof settings.configJson === 'string' ? settings.configJson.trim() : '';
  // 多采集源: configUrls 数组优先, 兼容旧单 configUrl; 都空则用部署默认
  let urls = [];
  if (!inline) {
    const cfgList = Array.isArray(settings.configUrls) && settings.configUrls.length
      ? settings.configUrls
      : (settings.configUrl ? [settings.configUrl] : []);
    urls = cfgList.slice(0, 10);
    if (!urls.length) urls = [env.CONFIG_URL || DEFAULT_CONFIG_URL];
  }
  // 缓存键随配置来源变化, 换配置后立即生效
  const tag = inline ? 'inline-' + inline.length + '-' + (inline.length % 97) : 'm-' + urls.join('|');
  const cacheKey = new Request('https://cache.internal/xiaolintv/sources/v2?u=' + encodeURIComponent(tag));
  try {
    const hit = await caches.default.match(cacheKey);
    if (hit) return await hit.json();
  } catch (e) { /* ignore */ }

  let sources = [];
  let from = 'network';
  try {
    if (inline) {
      sources = parseConfig(JSON.parse(inline));
      from = 'inline-json';
    } else {
      // 并发抓取全部采集源, 按 key 合并: 排在前面的配置优先, 后面的只补缺
      const results = await Promise.allSettled(urls.map((u) => fetch(u, {
        headers: { 'User-Agent': 'Mozilla/5.0 XIAOLIN-TV/1.0' },
        cf: { cacheTtl: 7200, cacheEverything: true },
      })));
      const byKey = new Map();
      for (const r of results) {
        if (r.status !== 'fulfilled' || !r.value.ok) continue;
        try {
          for (const s of parseConfig(JSON.parse(await r.value.text()))) {
            if (!byKey.has(s.key)) byKey.set(s.key, s);
          }
        } catch (e) { /* 单个配置失败不影响其他 */ }
      }
      sources = [...byKey.values()];
      if (!sources.length) throw new Error('all configs failed');
      from = 'multi:' + urls.length + 'cfg/' + sources.length + 'src';
    }
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
  return base + '::XIAOLIN-TV-hmac';
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

/* ---- 游客试看: 匿名设备签名 Cookie(ntv_guest=首次时间戳.签名) ----
   新 IP / 新设备 / 新用户首次进入自动发放; 试用期内正常观看, 到期接口返回 login_required */
const GUEST_COOKIE = 'ntv_guest';
const GUEST_COOKIE_MAXAGE = 400 * 24 * 3600;
async function guestStamp(env, ts) {
  return ts + '.' + (await hmacHex(await adminSecret(env), 'guest:' + ts)).slice(0, 20);
}
function readGuest(req) {
  const m = (req.headers.get('Cookie') || '').match(/(?:^|;\s*)ntv_guest=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}
/** { ok: 是否放行, remainSec: 剩余秒, newCookie?: 需要种下的Cookie } */
async function guestState(req, env, url) {
  const s = await getSettings(env);
  if (s.requireLogin === false) return { ok: true, remainSec: null };          // 完全开放
  if (await anyValidSession(req, env, url)) return { ok: true, remainSec: null }; // 已登录/管理员
  const trialMin = Number(s.trialMinutes === undefined ? 20 : s.trialMinutes);
  if (!(trialMin > 0)) return { ok: false, remainSec: 0 };                     // 立即要求登录
  let start = null;
  const raw = readGuest(req);
  if (raw && raw.includes('.')) {
    const i = raw.lastIndexOf('.');
    const v = raw.slice(0, i), sig = raw.slice(i + 1);
    if (/^\d+$/.test(v) && safeEqual(sig, (await hmacHex(await adminSecret(env), 'guest:' + v)).slice(0, 20))) {
      start = Number(v);
    }
  }
  if (start === null) {
    const now = Date.now();
    return { ok: true, remainSec: trialMin * 60, newCookie: await guestStamp(env, String(now)) };
  }
  const remainSec = Math.max(0, Math.round(trialMin * 60 - (Date.now() - start) / 1000));
  return { ok: remainSec > 0, remainSec };
}
const guestSetCookie = (v) => `${GUEST_COOKIE}=${v}; Max-Age=${GUEST_COOKIE_MAXAGE}; Path=/; SameSite=Lax`;
function rateLimited(ip) {
  const now = Date.now();
  const arr = (MEM.loginHits.get(ip) || []).filter((t) => now - t < 60000);
  if (arr.length >= 10) { MEM.loginHits.set(ip, arr); return true; }
  arr.push(now); MEM.loginHits.set(ip, arr); return false;
}

/* ========================= 用户体系(KV) =========================
   user:<name>      -> { u, hash, salt, createdAt, lastLoginAt, lastLoginIp }
   users:index      -> [username,...]
   uhist:<name>     -> { watchSec, items:[{id,kind,title,srcKey,srcName,vidId,pic,ep,t,ts,ip,delUser}] }
   用户删除 = delUser 标记(前台不可见, 管理端可见可硬删)
================================================================== */
const USER_COOKIE = 'ntv_usr';
const USER_SESSION_TTL = 60 * 60 * 24 * 7; // 7 天

const USERNAME_RE = /^[\w\u4e00-\u9fa5]{2,20}$/;

async function userSecret(env) {
  return (await adminSecret(env)) + ':user';
}
async function makeUserToken(env, username) {
  const exp = Math.floor(Date.now() / 1000) + USER_SESSION_TTL;
  const payload = exp + '|' + Buffer_safeEncode(username);
  const sig = await hmacHex(await userSecret(env), payload);
  return `${payload}.${sig}`;
}
function Buffer_safeEncode(s) { return encodeURIComponent(s); }
function Buffer_safeDecode(s) { try { return decodeURIComponent(s); } catch (e) { return ''; } }
async function verifyUserToken(env, token) {
  if (!token || !token.includes('.')) return false;
  const dot = token.lastIndexOf('.');
  const payload = token.slice(0, dot), sig = token.slice(dot + 1);
  const bar = payload.indexOf('|');
  if (bar < 0) return false;
  const exp = payload.slice(0, bar);
  if (!/^\d+$/.test(exp) || Number(exp) < Math.floor(Date.now() / 1000)) return false;
  const expect = await hmacHex(await userSecret(env), payload);
  return safeEqual(sig, expect) ? Buffer_safeDecode(payload.slice(bar + 1)) : null;
}
function readSession(req, cookieName) {
  const authz = req.headers.get('Authorization') || '';
  if (authz.startsWith('Bearer ')) return authz.slice(7).trim();
  const cookie = req.headers.get('Cookie') || '';
  const m = cookie.match(new RegExp('(?:^|;\\s*)' + cookieName + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : '';
}
/** 当前登录用户名(未登录 null) */
async function currentUser(req, env, url) {
  return verifyUserToken(env, readSession(req, USER_COOKIE));
}
/** 任意有效会话(管理员或用户) */
async function anyValidSession(req, env, url) {
  if (await verifyToken(env, readSession(req, COOKIE_NAME))) return true;
  return Boolean(await currentUser(req, env, url));
}
function clientIp(req) {
  return req.headers.get('CF-Connecting-IP') || req.headers.get('X-Forwarded-For') || 'local';
}

/** Cloudflare 边缘地理信息(精确到市级), 本地开发无该数据返回空 */
const COUNTRY_NAMES = {
  CN: '中国', HK: '香港', MO: '澳门', TW: '台湾', SG: '新加坡', MY: '马来西亚',
  TH: '泰国', VN: '越南', JP: '日本', KR: '韩国', US: '美国', GB: '英国',
  DE: '德国', FR: '法国', CA: '加拿大', AU: '澳大利亚', RU: '俄罗斯', IN: '印度',
};
function geoOf(req) {
  try {
    const cf = req.cf;
    if (!cf || !cf.country) return '';
    const country = COUNTRY_NAMES[cf.country] || cf.country;
    return [country, cf.region || cf.province || '', cf.city || ''].filter(Boolean).join(' ');
  } catch (e) { return ''; }
}

async function getUserRecord(env, username) {
  if (!kv(env)) return null;
  try {
    const raw = await env.CONFIG_KV.get('user:' + username);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
async function putUserRecord(env, rec) {
  if (!kv(env)) return;
  await env.CONFIG_KV.put('user:' + rec.u, JSON.stringify(rec));
  const indexRaw = (await env.CONFIG_KV.get('users:index')) || '[]';
  let list;
  try { list = JSON.parse(indexRaw); } catch (e) { list = []; }
  if (!Array.isArray(list)) list = [];
  if (!list.includes(rec.u)) { list.push(rec.u); await env.CONFIG_KV.put('users:index', JSON.stringify(list.slice(-500))); }
}
async function loadUhist(env, username) {
  if (!kv(env)) return { watchSec: 0, items: [] };
  try {
    const raw = await env.CONFIG_KV.get('uhist:' + username);
    if (raw) { const p = JSON.parse(raw); return { watchSec: p.watchSec || 0, items: Array.isArray(p.items) ? p.items : [] }; }
  } catch (e) { /* ignore */ }
  return { watchSec: 0, items: [] };
}
async function saveUhist(env, username, hist) {
  if (!kv(env)) return;
  hist.items = hist.items.slice(0, 800);
  await env.CONFIG_KV.put('uhist:' + username, JSON.stringify(hist));
}
/* ---- 收藏服务端同步(KV): 换设备登录不丢 ---- */
async function loadFavs(env, username) {
  if (!kv(env)) return [];
  try {
    const raw = await env.CONFIG_KV.get('favs:' + username);
    const p = raw ? JSON.parse(raw) : [];
    return Array.isArray(p) ? p : [];
  } catch (e) { return []; }
}
async function saveFavs(env, username, list) {
  if (!kv(env)) return;
  // 只保留白名单字段, 上限 200 条
  const clean = list.slice(0, 200).map((f) => ({
    key: String(f.key || '').slice(0, 60),
    id: String(f.id || '').slice(0, 60),
    title: String(f.title || '').slice(0, 120),
    pic: String(f.pic || '').slice(0, 600),
    remarks: String(f.remarks || '').slice(0, 120),
  })).filter((f) => f.key && f.id);
  await env.CONFIG_KV.put('favs:' + username, JSON.stringify(clean));
}
let entrySeq = 0;
function newEntryId() { return Date.now().toString(36) + '-' + (++entrySeq % 1296).toString(36); }
/** 用户侧历史条目脱敏输出 */
function publicHistItem(it) {
  return {
    id: it.id, kind: it.kind, title: it.title,
    srcKey: it.srcKey || '', srcName: it.srcName || '', vidId: it.vidId || '',
    pic: it.pic || '', ep: it.ep || '', t: it.t || 0, ts: it.ts,
  };
}
async function appendUhist(env, username, entry) {
  const hist = await loadUhist(env, username);
  entry.id = newEntryId();
  entry.ts = Date.now();
  hist.items.unshift(entry);
  await saveUhist(env, username, hist);
  return entry.id;
}

/* ========================= 访问统计(KV 轻量) =========================
   stats:log -> 最近明细(≤600条) {kind:'page'|'search', path/q, ts, ip, geo, u}
   stats:agg -> { pvTotal, days:{yyyy-mm-dd:n}, searches:n, paths:{k:n}, ips:{ip:{c,ts}} }
====================================================================== */
const STATS_LOG_KEY = 'stats:log';
const STATS_AGG_KEY = 'stats:agg';
async function statRecord(env, entry) {
  if (!kv(env)) return;
  entry.ts = Date.now();
  entry.geo = entry.geo || '';
  entry.u = entry.u || '';
  try {
    const raw = await env.CONFIG_KV.get(STATS_LOG_KEY);
    let arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) arr = [];
    arr.unshift(entry);
    await env.CONFIG_KV.put(STATS_LOG_KEY, JSON.stringify(arr.slice(0, 600)));
  } catch (e) { /* ignore */ }
  try {
    const raw = await env.CONFIG_KV.get(STATS_AGG_KEY);
    const agg = raw ? JSON.parse(raw) : {};
    agg.pvTotal = (agg.pvTotal || 0) + 1;
    const day = new Date().toISOString().slice(0, 10);
    agg.days = agg.days || {};
    agg.days[day] = (agg.days[day] || 0) + 1;
    const dks = Object.keys(agg.days).sort();
    while (dks.length > 30) delete agg.days[dks.shift()];
    if (entry.kind === 'search') agg.searches = (agg.searches || 0) + 1;
    const pKey = entry.kind === 'search' ? '🔍 ' + String(entry.q || '').slice(0, 30) : String(entry.path || '/').slice(0, 40);
    agg.paths = agg.paths || {};
    agg.paths[pKey] = (agg.paths[pKey] || 0) + 1;
    agg.ips = agg.ips || {};
    const curIp = agg.ips[entry.ip] || { c: 0, ts: 0 };
    agg.ips[entry.ip] = { c: curIp.c + 1, ts: Date.now() };
    const ipKeys = Object.keys(agg.ips);
    if (ipKeys.length > 800) {
      ipKeys.sort((a, b) => agg.ips[a].ts - agg.ips[b].ts);
      while (ipKeys.length > 400) delete agg.ips[ipKeys.shift()];
    }
    await env.CONFIG_KV.put(STATS_AGG_KEY, JSON.stringify(agg));
  } catch (e) { /* ignore */ }
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
  const cacheKey = new Request('https://cache.internal/XIAOLIN-TV/live/v1');
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
        const dl = effectiveDownloadUrls(s);
        const ver = effectiveAppVersion(s, await loadAppManifest(env, request));
        return json({
          siteName: s.siteName,
          defaultTheme: s.defaultTheme,
          announcement: s.announcement,
          requireLogin: s.requireLogin !== false,
          trialMinutes: Number(s.trialMinutes === undefined ? 20 : s.trialMinutes),
          allowRegister: s.allowRegister !== false,
          homeSources: Array.isArray(s.homeSources) ? s.homeSources : [],
          appPromoEnabled: s.appPromoEnabled !== false,
          downloadUrl: dl.downloadUrl,
          downloadUrlTv: dl.downloadUrlTv,
          downloadUrlMode: phoneDlMode(s),
          downloadUrlTvMode: tvDlMode(s),
          appVersionAuto: ver.appVersionAuto,
          appVersionCode: ver.appVersionCode,
          appVersionName: ver.appVersionName,
          appForceUpdate: !!s.appForceUpdate,
          appChangelog: ver.appChangelog,
          appVersionSource: ver.appVersionSource,
          playerOptimize: !!s.playerOptimize,
          wmEnabled: !!s.wmEnabled,
          wmMode: s.wmMode === 'center' ? 'center' : 'corner',
          wmUrl: s.wmUrl || '',
          wmOpacity: Number(s.wmOpacity == null ? 0.55 : s.wmOpacity),
          wmDuration: Math.min(60, Math.max(1, Number(s.wmDuration == null ? 2 : s.wmDuration) || 2)),
        });
      }
      /* ---- 后台入口路径探测(只返回 是/否, 不泄露配置值; 用于自定义入口路由) ---- */
      if (path === '/api/admin-path' && request.method === 'GET') {
        const p = String(url.searchParams.get('p') || '').trim().toLowerCase();
        const s = await getSettings(env);
        return json({ ok: p === (s.adminPath || 'admin') });
      }

      /* ---- 源列表(远程源 + 后台自定义源, 按停用/成人开关 + 观看者成人权限过滤) ---- */
      if (path === '/api/config' && request.method === 'GET') {
        const settings = await getSettings(env);
        const { sources: remote } = await loadSources(env, ctx, settings);
        const { all } = mergeSources(remote, settings);
        // 成人源可见性: 全局开关开 → 默认人人可见(含游客/试看中);
        // 已登录用户仍可被后台单独关闭(adultAllowed=false 时隐藏)
        let allowAdult = false;
        if (settings.adultEnabled) {
          if (await verifyToken(env, readToken(request, url))) allowAdult = true; // 管理员
          else {
            const uname = await currentUser(request, env, url);
            if (!uname) {
              allowAdult = true; // 游客(含试看期): 跟随全局开关
            } else {
              const rec = await getUserRecord(env, uname);
              // 默认开通: 仅当明确存了 false 才关闭(旧用户无字段视为开通)
              allowAdult = Boolean(rec && rec.adultAllowed !== false);
            }
          }
        }
        const enabled = allowAdult ? all.filter((s) => !s.disabled) : all.filter((s) => !s.disabled && !s.adult);
        return json({
          adultEnabled: settings.adultEnabled,
          adultForYou: allowAdult,
          total: all.length,
          count: enabled.length,
          sources: enabled.map(({ key, name, api, detail, adult }) => ({ key, name, api, detail, adult })),
        });
      }

      /* ---- TVBox / 影视仓 配置(JSON) ---- */
      if ((path === '/api/tvbox.json' || path === '/api/tvbox/lunatv.json') && request.method === 'GET') {
        const settings = await getSettings(env);
        const sources = await getExportSources(env, ctx, settings);
        const origin = url.origin;
        const payload = path.endsWith('/lunatv.json')
          ? buildLunatvConfig(settings, sources, origin)
          : buildTvboxConfig(settings, sources, origin);
        return json(payload, 200, { 'Cache-Control': 'public, max-age=300' });
      }

      /* ---- 苹果CMS API 代理(白名单) ---- */
      if (path === '/api/proxy' && request.method === 'GET') {
        const target = url.searchParams.get('url') || '';
        let tu;
        try { tu = new URL(target); } catch (e) { return json({ error: 'bad url' }, 400); }
        if (!/^https?:$/.test(tu.protocol)) return json({ error: 'bad protocol' }, 400);

        const settings2 = await getSettings(env);
        const g1 = await guestState(request, env, url);
        if (!g1.ok) return json({ error: '试看时间已到，注册/登录后继续观看', code: 'login_required' }, 401);
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
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) XIAOLIN-TV/1.0', Accept: '*/*' },
          signal: AbortSignal.timeout(20000),
          cf: { cacheTtl: 120, cacheEverything: true },
        });
        const headers = new Headers();
        headers.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json; charset=utf-8');
        headers.set('Access-Control-Allow-Origin', '*');
        headers.set('Cache-Control', 'public, max-age=120');
        if (g1.newCookie) headers.set('Set-Cookie', guestSetCookie(g1.newCookie));
        return new Response(upstream.body, { status: upstream.status, headers });
      }

      /* ---- 电视直播频道 ---- */
      if (path === '/api/live' && request.method === 'GET') {
        const g2 = await guestState(request, env, url);
        if (!g2.ok) return json({ error: '试看时间已到，注册/登录后继续观看', code: 'login_required' }, 401);
        const live = await loadLive(env, ctx);
        return g2.newCookie
          ? json(live, 200, { 'Set-Cookie': guestSetCookie(g2.newCookie) })
          : json(live);
      }

      /* ---- 游客试看状态(公开): 前端据此决定是否弹注册框 ---- */
      if (path === '/api/guest/status' && request.method === 'GET') {
        const s = await getSettings(env);
        const g = await guestState(request, env, url);
        const extra = g.newCookie ? { 'Set-Cookie': guestSetCookie(g.newCookie) } : {};
        return json({
          required: s.requireLogin !== false,
          ok: !!g.ok,
          remainSec: g.remainSec,
          trialMinutes: Number(s.trialMinutes === undefined ? 20 : s.trialMinutes),
        }, 200, extra);
      }

      /* ---- 访问统计埋点(公开, 不需要登录) ---- */
      if (path === '/api/stats/visit' && request.method === 'POST') {
        let body = {};
        try { body = await request.json(); } catch (e) { /* ignore */ }
        const u = await currentUser(request, env, url);
        await statRecord(env, {
          kind: 'page',
          path: String(body.path || '/').slice(0, 60),
          ip: clientIp(request),
          geo: geoOf(request),
          u,
        });
        return json({ ok: true });
      }
      if (path === '/api/stats/search' && request.method === 'POST') {
        let body = {};
        try { body = await request.json(); } catch (e) { /* ignore */ }
        const q = String(body.q || '').trim().slice(0, 60);
        if (q) {
          const u = await currentUser(request, env, url);
          await statRecord(env, { kind: 'search', q, ip: clientIp(request), geo: geoOf(request), u });
        }
        return json({ ok: true });
      }

      /* ========================= 用户接口 ========================= */
      if (path === '/api/user/register' && request.method === 'POST') {
        const settings = await getSettings(env);
        if (settings.allowRegister === false) return json({ error: '当前未开放注册，请联系管理员' }, 403);
        if (!kv(env)) return json({ error: '未绑定 KV 存储，无法注册用户（见 README 绑定 CONFIG_KV）' }, 500);
        if (rateLimited('reg:' + clientIp(request))) return json({ error: '尝试过于频繁，请稍后再试' }, 429);
        let body = {};
        try { body = await request.json(); } catch (e) { /* ignore */ }
        const username = String(body.username || '').trim();
        const password = String(body.password || '');
        if (!USERNAME_RE.test(username)) return json({ error: '用户名需 2-20 位中文/字母/数字/下划线' }, 400);
        if (password.length < 6) return json({ error: '密码至少 6 位' }, 400);
        if (await getUserRecord(env, username)) return json({ error: '该用户名已被注册' }, 409);
        const salt = randomSalt();
        await putUserRecord(env, {
          u: username,
          hash: await sha256Hex(salt + password),
          salt,
          createdAt: Date.now(),
          lastLoginAt: Date.now(),
          lastLoginIp: clientIp(request),
          lastLoginIpGeo: geoOf(request),
          adultAllowed: true, // 新注册用户默认开通成人内容, 管理员可按用户关闭
        });
        const token = await makeUserToken(env, username);
        return json({ ok: true, username }, 200, {
          'Set-Cookie': `${USER_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${USER_SESSION_TTL}`,
        });
      }
      if (path === '/api/user/login' && request.method === 'POST') {
        if (!kv(env)) return json({ error: '未绑定 KV 存储，无法登录（见 README）' }, 500);
        if (rateLimited('usr:' + clientIp(request))) return json({ error: '尝试过于频繁，请稍后再试' }, 429);
        let body = {};
        try { body = await request.json(); } catch (e) { /* ignore */ }
        const username = String(body.username || '').trim();
        const password = String(body.password || '');
        const rec = await getUserRecord(env, username);
        if (!rec || !safeEqual(await sha256Hex((rec.salt || '') + password), rec.hash)) {
          return json({ error: '用户名或密码错误' }, 401);
        }
        rec.lastLoginAt = Date.now();
        rec.lastLoginIp = clientIp(request);
        rec.lastLoginIpGeo = geoOf(request);
        await putUserRecord(env, rec);
        const token = await makeUserToken(env, username);
        return json({ ok: true, username }, 200, {
          'Set-Cookie': `${USER_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${USER_SESSION_TTL}`,
        });
      }
      if (path === '/api/user/logout' && request.method === 'POST') {
        return json({ ok: true }, 200, { 'Set-Cookie': `${USER_COOKIE}=; Path=/; HttpOnly; Max-Age=0` });
      }
      /* ---- 收藏同步: 拉取 / 整体覆盖保存(前端负责合并) ---- */
      if (path === '/api/user/favs' && request.method === 'GET') {
        const username = await currentUser(request, env, url);
        if (!username) return json({ error: '请先登录' }, 401);
        if (!kv(env)) return json({ favs: [] });
        return json({ favs: await loadFavs(env, username) });
      }
      if (path === '/api/user/favs' && request.method === 'POST') {
        const username = await currentUser(request, env, url);
        if (!username) return json({ error: '请先登录' }, 401);
        if (!kv(env)) return json({ error: '未绑定 KV 存储' }, 500);
        let body = {};
        try { body = await request.json(); } catch (e) { /* ignore */ }
        const list = Array.isArray(body.favs) ? body.favs : [];
        await saveFavs(env, username, list);
        return json({ ok: true, count: Math.min(list.length, 200) });
      }
      if (path === '/api/user/me' && request.method === 'GET') {
        const username = await currentUser(request, env, url);
        if (!username) return json({ me: null });
        const rec = await getUserRecord(env, username);
        return json({
          me: {
            username,
            createdAt: rec ? rec.createdAt : null,
            lastLoginAt: rec ? rec.lastLoginAt : null,
            lastLoginIp: rec ? rec.lastLoginIp : '',
          },
        });
      }
      if (path.startsWith('/api/user/')) {
        const username = await currentUser(request, env, url);
        if (!username) return json({ error: 'unauthorized' }, 401);
        /* 自己的历史(不含已自删标记的条目) */
        if (path === '/api/user/history' && request.method === 'GET') {
          const hist = await loadUhist(env, username);
          const rec = await getUserRecord(env, username);
          return json({
            watchSec: hist.watchSec,
            items: hist.items.filter((it) => !it.delUser).slice(0, 300).map(publicHistItem),
            profile: rec ? { createdAt: rec.createdAt, lastLoginAt: rec.lastLoginAt } : null,
          });
        }
        /* 清空自己的记录(软删, 管理端仍可查) */
        if (path === '/api/user/history/clear' && request.method === 'POST') {
          let body = {};
          try { body = await request.json(); } catch (e) { /* ignore */ }
          const kind = body.kind === 'watch' || body.kind === 'search' ? body.kind : 'all';
          const hist = await loadUhist(env, username);
          for (const it of hist.items) {
            if (kind === 'all' || it.kind === kind) it.delUser = true;
          }
          await saveUhist(env, username, hist);
          return json({ ok: true });
        }
        /* 删除单条/多条(软删) */
        if (path === '/api/user/history/delete' && request.method === 'POST') {
          let body = {};
          try { body = await request.json(); } catch (e) { /* ignore */ }
          const ids = new Set(Array.isArray(body.ids) ? body.ids : []);
          if (!ids.size) return json({ error: 'no ids' }, 400);
          const hist = await loadUhist(env, username);
          for (const it of hist.items) { if (ids.has(it.id)) it.delUser = true; }
          await saveUhist(env, username, hist);
          return json({ ok: true });
        }
        /* 搜索记录上报 */
        if (path === '/api/user/log-search' && request.method === 'POST') {
          let body = {};
          try { body = await request.json(); } catch (e) { /* ignore */ }
          const q = String(body.q || '').trim().slice(0, 60);
          if (q) await appendUhist(env, username, { kind: 'search', title: q, ip: clientIp(request), geo: geoOf(request) });
          return json({ ok: true });
        }
        /* 观看心跳上报(累计观看时长 + 更新观看记录) */
        if (path === '/api/user/progress' && request.method === 'POST') {
          let body = {};
          try { body = await request.json(); } catch (e) { /* ignore */ }
          const deltaSec = Math.max(0, Math.min(Number(body.deltaSec) || 30, 120));
          const srcKey = String(body.srcKey || '').slice(0, 60);
          const vidId = String(body.vidId || '').slice(0, 60);
          const title = String(body.title || '').trim().slice(0, 80);
          if (!srcKey || !vidId || !title) return json({ error: 'bad payload' }, 400);
          const hist = await loadUhist(env, username);
          hist.watchSec += deltaSec;
          const ep = String(body.ep == null ? '' : body.ep).slice(0, 20);
          const pos = Math.max(0, Number(body.t) || 0);
          const exist = hist.items.find((it) => it.kind === 'watch' && it.srcKey === srcKey && it.vidId === vidId && !it.delUser);
          if (exist) { exist.t = pos; exist.ep = ep || exist.ep; exist.ts = Date.now(); }
          else {
            hist.items.unshift({
              id: newEntryId(), kind: 'watch', title,
              srcKey, srcName: String(body.srcName || '').slice(0, 40), vidId,
              pic: /^https?:\/\//.test(String(body.pic || '')) ? String(body.pic) : '',
              ep, t: pos, ts: Date.now(), ip: clientIp(request), geo: geoOf(request), delUser: false,
            });
          }
          await saveUhist(env, username, hist);
          return json({ ok: true, watchSec: hist.watchSec });
        }
        return json({ error: 'not found' }, 404);
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
        const secure = url.protocol === 'https:' ? '; Secure' : '';
        return json({ token }, 200, {
          'Set-Cookie': `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=${SESSION_TTL}`,
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
          const dl = effectiveDownloadUrls(s);
          const ver = effectiveAppVersion(s, await loadAppManifest(env, request));
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
            configUrls: Array.isArray(s.configUrls) ? s.configUrls : [],
            effectiveConfigUrls: (Array.isArray(s.configUrls) && s.configUrls.length)
              ? s.configUrls
              : [env.CONFIG_URL || DEFAULT_CONFIG_URL],
            configFrom: s.configJson ? 'inline-json' : ((Array.isArray(s.configUrls) && s.configUrls.length) ? 'multi-url' : 'default'),
            requireLogin: s.requireLogin !== false,
            trialMinutes: Number(s.trialMinutes === undefined ? 20 : s.trialMinutes),
            allowRegister: s.allowRegister !== false,
            appPromoEnabled: s.appPromoEnabled !== false,
            downloadUrlMode: phoneDlMode(s),
            downloadUrl: s.downloadUrl || '',
            downloadUrlEffective: dl.downloadUrl,
            downloadUrlTvMode: tvDlMode(s),
            downloadUrlTv: s.downloadUrlTv || '',
            downloadUrlTvEffective: dl.downloadUrlTv,
            appVersionAuto: ver.appVersionAuto,
            appVersionSource: ver.appVersionSource,
            appVersionCode: ver.appVersionCode,
            appVersionName: ver.appVersionName,
            appChangelog: ver.appChangelog,
            appVersionCodeManual: Math.max(0, Math.round(Number(s.appVersionCode == null ? 0 : s.appVersionCode)) || 0),
            appVersionNameManual: s.appVersionName || '',
            appChangelogManual: s.appChangelog || '',
            appManifestAt: ver.appManifestAt || '',
            appForceUpdate: !!s.appForceUpdate,
            adminPath: s.adminPath || '',
            homeSources: Array.isArray(s.homeSources) ? s.homeSources : [],
            playerOptimize: !!s.playerOptimize,
            wmEnabled: !!s.wmEnabled,
            wmMode: s.wmMode === 'center' ? 'center' : 'corner',
            wmUrl: s.wmUrl || '',
            wmOpacity: Number(s.wmOpacity == null ? 0.55 : s.wmOpacity),
            wmDuration: Math.min(60, Math.max(1, Number(s.wmDuration == null ? 2 : s.wmDuration) || 2)),
            allSources: all.map(({ key, name, api, detail, adult, custom }) => ({ key, name, api, detail, adult, custom: Boolean(custom) })),
          });
        }
        if (path === '/api/admin/tvbox-check' && request.method === 'GET') {
          const s = await getSettings(env);
          const sources = await getExportSources(env, ctx, s);
          const bad = sources.filter((x) => !x.api || !/^https?:\/\//i.test(x.api));
          let probe = null;
          const sample = sources[0];
          if (sample && sample.api) {
            try {
              const testUrl = sample.api + (sample.api.includes('?') ? '&' : '?') + 'ac=list';
              const r = await fetch(testUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 XIAOLIN-TV/1.0', Accept: '*/*' },
                signal: AbortSignal.timeout(12000),
              });
              const d = await r.json().catch(() => ({}));
              probe = {
                name: sample.name,
                api: sample.api,
                ok: r.ok && Boolean(d.class || d.list || d.code === 1),
                status: r.status,
                msg: d.msg || d.error || '',
              };
            } catch (e) {
              probe = { name: sample.name, api: sample.api, ok: false, msg: e.message || String(e) };
            }
          }
          return json({
            ok: sources.length > 0 && !bad.length,
            siteCount: sources.length,
            liveCount: (Array.isArray(s.liveSources) ? s.liveSources : DEFAULT_LIVE_SOURCES).filter((u) => /^https?:\/\//i.test(String(u || ''))).length,
            badCount: bad.length,
            probe,
            tvboxUrl: url.origin + '/api/tvbox.json',
            lunatvUrl: url.origin + '/api/tvbox/lunatv.json',
            sample: sources.slice(0, 3).map(({ key, name, api }) => ({ key, name, type: 1, api })),
          });
        }
        if (path === '/api/admin/settings' && request.method === 'POST') {
          let body = {};
          try { body = await request.json(); } catch (e) { /* ignore */ }
          const saved = await saveSettings(env, body);
          const { passwordHash, salt, ...safeSettings } = saved;
          return json({ ok: true, settings: safeSettings, storage: kv(env) ? 'kv' : 'memory' });
        }
        /* ---- 从 publish/app 同步 APK 到本机 public/APP（自托管 Node 可用） ---- */
        if (path === '/api/admin/sync-app' && request.method === 'POST') {
          if (typeof env.syncAppFromPublishBranch !== 'function') {
            return json({
              ok: false,
              error: '当前托管环境不支持 git 同步。请等 CI 把 APK 同步进 main 后，重新部署/拉取网站代码。',
            }, 400);
          }
          try {
            await env.syncAppFromPublishBranch();
            const m = await loadAppManifest(env, request);
            const ver = effectiveAppVersion(await getSettings(env), m);
            return json({ ok: true, manifest: m, ...ver });
          } catch (e) {
            return json({ ok: false, error: e.message || String(e) }, 500);
          }
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
        /* ---- 数据备份: 导出全部业务 KV(settings/用户/历史/收藏/统计) ---- */
        if (path === '/api/admin/backup' && request.method === 'GET') {
          if (!kv(env)) return json({ error: '未绑定 KV 存储，无可备份数据' }, 500);
          const out = { version: 1, exportedAt: new Date().toISOString(), kv: {} };
          const grab = async (k) => { const v = await env.CONFIG_KV.get(k); if (v != null) out.kv[k] = v; };
          await grab('settings');
          await grab('users:index');
          let idx = [];
          try { idx = JSON.parse(out.kv['users:index'] || '[]'); } catch (e) { idx = []; }
          for (const u of idx) {
            await grab('user:' + u);
            await grab('uhist:' + u);
            await grab('favs:' + u);
          }
          await grab(STATS_LOG_KEY);
          await grab(STATS_AGG_KEY);
          return json(out);
        }
        /* ---- 数据恢复: mode=merge(跳过空值,推荐) | replace(逐键覆盖) ---- */
        if (path === '/api/admin/restore' && request.method === 'POST') {
          if (!kv(env)) return json({ error: '未绑定 KV 存储' }, 500);
          let body = {};
          try { body = await request.json(); } catch (e) { /* ignore */ }
          const data = body && body.kv && typeof body.kv === 'object' ? body.kv : null;
          if (!data || !Object.keys(data).length) return json({ error: '备份文件无效：缺少 kv 字段' }, 400);
          const merge = body.mode !== 'replace';
          let n = 0;
          for (const [k, v] of Object.entries(data)) {
            if (typeof v !== 'string') continue;
            if (merge && v === '') continue;
            await env.CONFIG_KV.put(String(k).slice(0, 120), String(v).slice(0, 900000));
            n++;
          }
          return json({ ok: true, restored: n, mode: merge ? 'merge' : 'replace' });
        }
        /* ---- 流量统计 ---- */
        if (path === '/api/admin/stats' && request.method === 'GET') {
          let log = [];
          let agg = {};
          try { log = JSON.parse((await env.CONFIG_KV.get(STATS_LOG_KEY)) || '[]'); } catch (e) { /* ignore */ }
          try { agg = JSON.parse((await env.CONFIG_KV.get(STATS_AGG_KEY)) || '{}'); } catch (e) { /* ignore */ }
          if (!Array.isArray(log)) log = [];
          const today = new Date().toISOString().slice(0, 10);
          const byPath = Object.entries(agg.paths || {})
            .map(([k, n]) => ({ k, n }))
            .sort((a, b) => b.n - a.n)
            .slice(0, 10);
          return json({
            pvToday: (agg.days || {})[today] || 0,
            pvTotal: agg.pvTotal || 0,
            uniqIp: Object.keys(agg.ips || {}).length,
            searches: agg.searches || 0,
            days: agg.days || {},
            byPath,
            recent: log.slice(0, 80).map((it) => ({
              kind: it.kind, path: it.path || '', q: it.q || '',
              ts: it.ts, ip: it.ip || '', geo: it.geo || '', u: it.u || '',
            })),
          });
        }
        if (path === '/api/admin/stats/clear' && request.method === 'POST') {
          if (kv(env)) {
            await env.CONFIG_KV.delete(STATS_LOG_KEY);
            await env.CONFIG_KV.delete(STATS_AGG_KEY);
          }
          return json({ ok: true });
        }
        /* ---- 用户管理: 列表 ---- */
        if (path === '/api/admin/users' && request.method === 'GET') {
          let list = [];
          try { list = JSON.parse((await env.CONFIG_KV.get('users:index')) || '[]'); } catch (e) { /* ignore */ }
          if (!Array.isArray(list)) list = [];
          const users = [];
          for (const u of list) {
            const rec = await getUserRecord(env, u);
            const hist = await loadUhist(env, u);
            users.push({
              username: u,
              createdAt: rec ? rec.createdAt : null,
              lastLoginAt: rec ? rec.lastLoginAt : null,
              lastLoginIp: rec ? rec.lastLoginIp : '',
              lastLoginIpGeo: rec ? (rec.lastLoginIpGeo || '') : '',
              adultAllowed: rec ? rec.adultAllowed !== false : false,
              watchSec: hist.watchSec || 0,
              totalItems: hist.items.length,
              activeItems: hist.items.filter((it) => !it.delUser).length,
            });
          }
          users.sort((a, b) => (b.lastLoginAt || 0) - (a.lastLoginAt || 0));
          return json({ users });
        }
        /* ---- 用户管理: 单用户成人源授权开关 ---- */
        if (path === '/api/admin/user-adult' && request.method === 'POST') {
          let body = {};
          try { body = await request.json(); } catch (e) { /* ignore */ }
          const u = String(body.u || '');
          const rec = await getUserRecord(env, u);
          if (!rec) return json({ error: '用户不存在' }, 404);
          rec.adultAllowed = Boolean(body.allowed);
          await putUserRecord(env, rec);
          return json({ ok: true, u, adultAllowed: rec.adultAllowed });
        }
        /* ---- 用户管理: 单用户完整记录(含用户已删) ---- */
        if (path === '/api/admin/user-log' && request.method === 'GET') {
          const u = url.searchParams.get('u') || '';
          if (!u) return json({ error: 'no user' }, 400);
          const rec = await getUserRecord(env, u);
          if (!rec) return json({ error: 'user not found' }, 404);
          const hist = await loadUhist(env, u);
          return json({
            username: u,
            createdAt: rec.createdAt,
            lastLoginAt: rec.lastLoginAt,
            lastLoginIp: rec.lastLoginIp,
            lastLoginIpGeo: rec.lastLoginIpGeo || '',
            watchSec: hist.watchSec || 0,
            items: hist.items.slice(0, 800).map((it) => ({ ...publicHistItem(it), ip: it.ip || '', geo: it.geo || '', delUser: Boolean(it.delUser) })),
          });
        }
        /* ---- 用户管理: 硬删记录(仅管理员) ---- */
        if (path === '/api/admin/user-log-delete' && request.method === 'POST') {
          let body = {};
          try { body = await request.json(); } catch (e) { /* ignore */ }
          const u = String(body.u || '');
          if (!u || !(await getUserRecord(env, u))) return json({ error: 'user not found' }, 404);
          const hist = await loadUhist(env, u);
          if (body.all) { hist.items = []; hist.watchSec = 0; }
          else {
            const ids = new Set(Array.isArray(body.ids) ? body.ids : []);
            hist.items = hist.items.filter((it) => !ids.has(it.id));
          }
          await saveUhist(env, u, hist);
          return json({ ok: true });
        }
        /* ---- 用户管理: 删除用户及其全部数据 ---- */
        if (path === '/api/admin/user-delete' && request.method === 'POST') {
          let body = {};
          try { body = await request.json(); } catch (e) { /* ignore */ }
          const u = String(body.u || '');
          if (!u) return json({ error: 'no user' }, 400);
          if (!kv(env)) return json({ error: 'no kv' }, 500);
          await env.CONFIG_KV.delete('user:' + u);
          await env.CONFIG_KV.delete('uhist:' + u);
          let list = [];
          try { list = JSON.parse((await env.CONFIG_KV.get('users:index')) || '[]'); } catch (e) { /* ignore */ }
          list = list.filter((x) => x !== u);
          await env.CONFIG_KV.put('users:index', JSON.stringify(list));
          return json({ ok: true });
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
