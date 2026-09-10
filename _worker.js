/**
 * 晓林影视 XIAOLIN-TV — Cloudflare Worker / Pages 后端
 * ------------------------------------------------
 * 同一份代码可部署到:
 *   - Cloudflare Workers (wrangler.toml 中 [assets] directory = "./public")
 *   - Cloudflare Pages   (高级模式: _worker.js 与静态文件同目录, env.ASSETS 兜底)
 *
 * 可选绑定 / 环境变量:
 *   D1  dianying / DB           持久化关系型数据库(优先使用, 高性能 SQL 存储)
 *   KV  dianying_KV / CONFIG_KV 持久化后台设置与双写容灾备份
 *   VAR ADMIN_PASSWORD          后台密码(默认 admin123, 请务必修改)
 *   VAR ADULT_ENABLED           初始成人内容开关 "true"/"false"(默认 false)
 *   VAR CONFIG_URL              LunaTV-config 源配置地址(默认官方 main 分支完整版)
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
  siteSlogan: '海量高清 · 聚合秒播 · 极简私人影院',
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
  mobileWebLimitMinutes: 10, // 手机网页端试看限制(分钟); 0=完全禁止手机网页播放须用App; -1=不限制
  allowRegister: true,  // 开放前台注册
  homeSources: [],      // 首页默认加载的影视源 key 顺序列表(空=内置精选)
  appPromoEnabled: true, // 手机访问弹「下载APP」引导弹窗(后台可关)
  downloadUrlMode: 'fixed', // fixed=站内最新包 | custom=自定义 downloadUrl
  downloadUrl: '',      // 自定义手机 APK 地址(仅 custom 模式生效)
  downloadUrlTvMode: 'off', // off=不提供 | fixed=站内最新 | custom=自定义
  downloadUrlTv: '',    // 自定义 TV APK 地址(仅 custom 模式生效)
  // App 版本发布控制 (必须管理员点击【确认正式发布】后才向客户端下发弹窗)
  appVersionActive: false, // 线上客户端是否激活推送
  appPublishedCode: 0,     // 正式向客户端下发的最新 versionCode
  appPublishedName: '',    // 正式向客户端下发的版本名
  appPublishedChangelog: '', // 正式向客户端下发的更新说明
  appPublishedForce: false, // 是否强制更新 (App 内不可关闭弹窗)
  appPublishedAt: '',      // 正式发布时间
  // 待发布草稿区 (支持自动提取或手动填写，可自由编辑)
  appDraftCode: 0,
  appDraftName: '',
  appDraftChangelog: '',
  appDraftForce: false,
  // 历史兼容字段
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
  adultUnlockCode: 'VIP888', // 私密福利激活码/卡密(默认 VIP888, 后台可改, 支持逗号分隔多个)
  adultPayDesc: '私密福利影片为会员专属特权内容。如需开通，可联系管理员获取激活卡密，或输入卡密立即解锁。', // 解锁说明
  adultPayQr: '',            // 收款码或客服二维码图片链接
  // GitHub 数据中心与双向持久化同步配置 (支持后台直接填 Token 免去 Cloudflare 环境变量)
  githubToken: '',       // Personal Access Token (ghp_... 或 github_pat_...)
  githubOwner: 'xiaolin1991', // GitHub 用户名或组织名
  githubRepo: 'dianying',     // 仓库名称
  githubBranch: 'main',       // 分支名称
  githubPrefix: 'data',       // 存储文件夹目录前缀
  githubSyncEnabled: false,   // 是否激活 GitHub 仓库同步驱动
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

/* ------------------------------ 持久化存储抽象层 (D1 + KV 双轨引擎) --------------------------------- */
let d1TableReady = false;

/** 获取 Cloudflare D1 数据库句柄 (兼容绑定名 dianying 或 DB) */
function d1(env) {
  const db = env && (env.dianying || env.DB);
  return db && typeof db.prepare === 'function' ? db : null;
}

/** 获取 Cloudflare KV 命名空间句柄 (兼容绑定名 dianying_KV 或 CONFIG_KV) */
function kv(env) {
  const k = env && (env.dianying_KV || env.CONFIG_KV);
  return k && typeof k.get === 'function' ? k : null;
}

/** 是否配置了任一持久化存储 (D1 或 KV) */
function hasStorage(env) {
  return Boolean(d1(env) || kv(env));
}

/** 获取当前存储架构类型: d1+kv (双轨) | d1 (纯D1) | kv (纯KV) | memory (内存临时) */
function getStorageType(env) {
  const hasD1 = Boolean(d1(env));
  const hasKv = Boolean(kv(env));
  if (hasD1 && hasKv) return 'd1+kv';
  if (hasD1) return 'd1';
  if (hasKv) return 'kv';
  return 'memory';
}

/** 确保 D1 数据库的 kv_store 数据表已就绪 (Zero-Config 自动建表) */
async function ensureD1Table(db) {
  if (d1TableReady) return;
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS kv_store (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`).run();
    d1TableReady = true;
  } catch (e) {
    console.warn('D1 auto-init table notice:', (e && e.message) || e);
  }
}

/**
 * 统一读取键值:
 * 1. 优先从 D1 数据库查询
 * 2. 若 D1 中无此键但 KV 中存在，则自动执行热迁移写入 D1 并返回
 * 3. 若未绑定 D1 则直接从 KV 读取
 */
async function storageGet(env, key) {
  const db = d1(env);
  const k = kv(env);

  if (db) {
    try {
      await ensureD1Table(db);
      const row = await db.prepare('SELECT value FROM kv_store WHERE key = ?').bind(key).first('value');
      if (row != null && typeof row === 'string') {
        return row;
      }
      // D1 未命中时，若 KV 存在，执行平滑热迁移
      if (k) {
        try {
          const kvVal = await k.get(key);
          if (kvVal != null && typeof kvVal === 'string') {
            try {
              await db.prepare(
                'INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at'
              ).bind(key, kvVal, Date.now()).run();
            } catch (migErr) { /* ignore */ }
            return kvVal;
          }
        } catch (e) { /* ignore */ }
      }
      return null;
    } catch (e) {
      // D1 异常时降级读取 KV
      if (k) {
        try { return await k.get(key); } catch (ke) { return null; }
      }
      return null;
    }
  }

  if (k) {
    try { return await k.get(key); } catch (e) { return null; }
  }

  return null;
}

/**
 * 统一写入键值:
 * 1. 若配置了 D1，写入 D1 (UPSERT)
 * 2. 若配置了 KV，同步双写写入 KV 进行灾备备份
 */
async function storagePut(env, key, value) {
  const strVal = typeof value === 'string' ? value : JSON.stringify(value);
  const db = d1(env);
  const k = kv(env);

  if (db) {
    try {
      await ensureD1Table(db);
      await db.prepare(
        'INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at'
      ).bind(key, strVal, Date.now()).run();
    } catch (e) {
      console.warn('storagePut D1 error:', (e && e.message) || e);
    }
  }

  if (k) {
    try {
      await k.put(key, strVal);
    } catch (e) {
      console.warn('storagePut KV error:', (e && e.message) || e);
    }
  }
}

/**
 * 统一删除键值:
 * 同步删除 D1 与 KV 对应键
 */
async function storageDelete(env, key) {
  const db = d1(env);
  const k = kv(env);

  if (db) {
    try {
      await ensureD1Table(db);
      await db.prepare('DELETE FROM kv_store WHERE key = ?').bind(key).run();
    } catch (e) {
      console.warn('storageDelete D1 error:', (e && e.message) || e);
    }
  }

  if (k) {
    try {
      await k.delete(key);
    } catch (e) {
      console.warn('storageDelete KV error:', (e && e.message) || e);
    }
  }
}

async function getSettings(env) {
  try {
    if (hasStorage(env)) {
      const raw = await storageGet(env, 'settings');
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

const APP_MANIFEST_KEY = 'app_manifest';

function maskToken(token) {
  if (!token || typeof token !== 'string') return '';
  const s = token.trim();
  if (s.length <= 8) return '****';
  return s.slice(0, 4) + '****' + s.slice(-4);
}

function getGithubConfig(env, s) {
  const cur = s || MEM.settings || {};
  const token = String(cur.githubToken || (env && (env.GITHUB_TOKEN || env.GH_TOKEN || env.GH_PAT)) || '').trim();
  const owner = String(cur.githubOwner || '').trim() || 'xiaolin1991';
  const repoName = String(cur.githubRepo || '').trim() || 'dianying';
  const branch = String(cur.githubBranch || '').trim() || 'main';
  const prefix = String(cur.githubPrefix || 'data').trim().replace(/^\/+|\/+$/g, '') || 'data';
  const envRepo = String((env && (env.GITHUB_REPO || env.GH_REPO)) || '').trim().replace(/^\/+|\/+$/g, '');
  const repo = envRepo || `${owner}/${repoName}`;
  return {
    token,
    owner,
    repoName,
    branch,
    prefix,
    repo,
    syncEnabled: Boolean(cur.githubSyncEnabled),
    fromAdmin: Boolean(cur.githubToken),
    fromEnv: Boolean(!cur.githubToken && env && (env.GITHUB_TOKEN || env.GH_TOKEN || env.GH_PAT)),
  };
}

function githubRepo(env, s) {
  return getGithubConfig(env, s).repo;
}

function githubToken(env, s) {
  return getGithubConfig(env, s).token;
}

/** 从 GitHub Contents API 读取仓库文件（私有仓需配置 GITHUB_TOKEN） */
async function githubReadFile(env, filePath, ref, s) {
  const cfg = getGithubConfig(env, s);
  const repo = cfg.repo;
  const token = cfg.token;
  if (!repo || !token) return null;
  const url = `https://api.github.com/repos/${repo}/contents/${String(filePath).replace(/^\/+/, '')}?ref=${encodeURIComponent(ref || cfg.branch || 'main')}`;
  const r = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'xiaolin-tv-worker',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) return null;
  const data = await r.json();
  if (!data || data.type !== 'file' || typeof data.content !== 'string') return null;
  const b64 = data.content.replace(/\n/g, '');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, sha: data.sha || '', name: data.name || '' };
}

/** 向 GitHub 仓库写入或更新文件 (Contents API, 自动处理已存在文件的 SHA) */
async function githubWriteFile(env, filePath, contentBytesOrStr, commitMsg, branch, s) {
  const cfg = getGithubConfig(env, s);
  const repo = cfg.repo;
  const token = cfg.token;
  if (!repo || !token) throw new Error('未配置 GITHUB_TOKEN 或仓库信息');
  const targetBranch = branch || cfg.branch || 'main';
  const cleanPath = String(filePath).replace(/^\/+/, '');

  let existingSha = null;
  try {
    const existing = await githubReadFile(env, cleanPath, targetBranch, s);
    if (existing && existing.sha) existingSha = existing.sha;
  } catch (e) { /* ignore */ }

  let b64 = '';
  if (typeof contentBytesOrStr === 'string') {
    const bytes = new TextEncoder().encode(contentBytesOrStr);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    b64 = btoa(bin);
  } else {
    let bin = '';
    for (let i = 0; i < contentBytesOrStr.length; i++) bin += String.fromCharCode(contentBytesOrStr[i]);
    b64 = btoa(bin);
  }

  const url = `https://api.github.com/repos/${repo}/contents/${cleanPath}`;
  const body = {
    message: commitMsg || `Update ${cleanPath} via XiaolinTV admin`,
    content: b64,
    branch: targetBranch,
  };
  if (existingSha) body.sha = existingSha;

  const r = await fetch(url, {
    method: 'PUT',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'xiaolin-tv-worker',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });

  if (!r.ok) {
    const errText = await r.text();
    throw new Error(`GitHub 写入失败 (${r.status}): ${errText}`);
  }
  return await r.json();
}

async function readKvAppManifest(env) {
  if (!hasStorage(env)) return null;
  try {
    const raw = await storageGet(env, APP_MANIFEST_KEY);
    if (!raw) return null;
    const m = JSON.parse(raw);
    return m && typeof m === 'object' ? m : null;
  } catch (e) {
    return null;
  }
}

async function writeKvAppManifest(env, manifest) {
  if (!hasStorage(env) || !manifest || typeof manifest !== 'object') return;
  const code = Math.max(0, Math.round(Number(manifest.versionCode == null ? 0 : manifest.versionCode)) || 0);
  if (!code) return;
  const clean = {
    versionCode: code,
    versionName: String(manifest.versionName || ('1.0.' + code)).slice(0, 40),
    changelog: String(manifest.changelog || '').slice(0, 2000),
    publishedAt: String(manifest.publishedAt || new Date().toISOString()),
    phone: manifest.phone && typeof manifest.phone === 'object' ? manifest.phone : undefined,
    tv: manifest.tv && typeof manifest.tv === 'object' ? manifest.tv : undefined,
  };
  await storagePut(env, APP_MANIFEST_KEY, JSON.stringify(clean));
}

/** Cloudflare：从 GitHub main / publish/app 拉取 manifest 写入 KV（不依赖 git） */
async function syncAppManifestFromGithub(env) {
  const repo = githubRepo(env);
  const token = githubToken(env);
  if (!repo || !token) {
    throw new Error(
      'Cloudflare 环境请在 Worker 密钥中配置 GITHUB_TOKEN，并在变量中设置 GITHUB_REPO=owner/repo；或配置 Actions Secret CF_DEPLOY_HOOK 让 CI 触发重新部署。'
    );
  }
  let lastErr = '';
  for (const ref of ['publish/app', 'main']) {
    try {
      const file = await githubReadFile(env, 'public/APP/manifest.json', ref);
      if (!file) {
        lastErr = `ref ${ref} 无 manifest`;
        continue;
      }
      const text = new TextDecoder().decode(file.bytes);
      const m = JSON.parse(text);
      if (!m || !m.versionCode) {
        lastErr = `ref ${ref} manifest 无效`;
        continue;
      }
      await writeKvAppManifest(env, m);
      return { ...m, _syncedFrom: ref };
    } catch (e) {
      lastErr = (e && e.message) || String(e);
    }
  }
  throw new Error('从 GitHub 同步失败：' + (lastErr || '未知错误'));
}

function manifestCode(m) {
  return Math.max(0, Math.round(Number(m && m.versionCode != null ? m.versionCode : 0)) || 0);
}

/** 读取 CI 写入的 public/APP/manifest.json（磁盘 / KV / 静态资源，取 versionCode 最新者） */
async function loadAppManifest(env, request) {
  const cands = [];
  if (env && typeof env.getAppManifest === 'function') {
    try {
      const m = await env.getAppManifest();
      if (m && typeof m === 'object') cands.push(m);
    } catch (e) { /* ignore */ }
  }
  try {
    const m = await readKvAppManifest(env);
    if (m) cands.push(m);
  } catch (e) { /* ignore */ }
  try {
    if (env && env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      const assetUrl = new URL('/APP/manifest.json', (request && request.url) || 'https://assets.local/');
      const r = await env.ASSETS.fetch(assetUrl);
      if (r.ok) cands.push(await r.json());
    }
  } catch (e) { /* ignore */ }
  try {
    const base = request && request.url ? new URL(request.url) : null;
    if (base && base.hostname && base.hostname !== 'internal') {
      const r = await fetch(new URL('/APP/manifest.json', base), { signal: AbortSignal.timeout(4000) });
      if (r.ok) cands.push(await r.json());
    }
  } catch (e) { /* ignore */ }
  let best = null;
  for (const m of cands) {
    if (!m || typeof m !== 'object') continue;
    if (!best || manifestCode(m) > manifestCode(best)) best = m;
  }
  return best;
}

/** 当 KV 版本新于静态资源时，从 GitHub 拉 APK/manifest（私有仓 + token） */
async function tryServeAppFromGithub(env, fileName, ctx) {
  const token = githubToken(env);
  const repo = githubRepo(env);
  if (!token || !repo || !fileName || fileName.includes('..') || fileName.includes('/')) return null;
  const kvMan = await readKvAppManifest(env);
  // 无 KV 版本时也可强制走 GitHub（变量 APP_FROM_GITHUB=1）
  const force = String((env && env.APP_FROM_GITHUB) || '') === '1';
  if (!force && !kvMan) return null;

  const cacheKey = new Request(`https://app-github-cache.local/APP/${fileName}?v=${manifestCode(kvMan)}`);
  try {
    const hit = await caches.default.match(cacheKey);
    if (hit) return hit;
  } catch (e) { /* ignore */ }

  let file = null;
  for (const ref of ['publish/app', 'main']) {
    file = await githubReadFile(env, 'public/APP/' + fileName, ref);
    if (file) break;
  }
  if (!file) return null;
  const isApk = /\.apk$/i.test(fileName);
  const isJson = /\.json$/i.test(fileName);
  const headers = {
    'Cache-Control': 'public, max-age=300',
    'Content-Type': isApk
      ? 'application/vnd.android.package-archive'
      : (isJson ? 'application/json; charset=utf-8' : 'application/octet-stream'),
  };
  const res = new Response(file.bytes, { status: 200, headers });
  try {
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(caches.default.put(cacheKey, res.clone()));
    }
  } catch (e) { /* ignore */ }
  return res;
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
  const fromFile = parseManifestVersion(manifest);
  const auto = !s || s.appVersionAuto !== false;
  const publishedCode = s && s.appPublishedCode ? Math.max(0, Math.round(Number(s.appPublishedCode)) || 0) : 0;
  const legacyCode = s && s.appVersionCode ? Math.max(0, Math.round(Number(s.appVersionCode)) || 0) : 0;

  // 若已正式发布
  if (publishedCode > 0) {
    return {
      appVersionAuto: auto,
      appVersionCode: publishedCode,
      appVersionName: s.appPublishedName || ('1.0.' + publishedCode),
      appChangelog: s.appPublishedChangelog || '',
      appForceUpdate: Boolean(s.appPublishedForce !== undefined ? s.appPublishedForce : s.appForceUpdate),
      appVersionSource: 'published',
      appManifestAt: s.appPublishedAt || (fromFile ? fromFile.publishedAt : ''),
    };
  }

  // 默认自动读 manifest / 兼容旧手动
  if (auto && fromFile) {
    return {
      appVersionAuto: true,
      appVersionCode: fromFile.appVersionCode,
      appVersionName: fromFile.appVersionName,
      appChangelog: fromFile.appChangelog,
      appForceUpdate: Boolean(s && s.appForceUpdate),
      appVersionSource: 'manifest',
      appManifestAt: fromFile.publishedAt || '',
    };
  }
  return {
    appVersionAuto: auto,
    appVersionCode: legacyCode,
    appVersionName: (s && s.appVersionName) || '',
    appChangelog: (s && s.appChangelog) || '',
    appForceUpdate: Boolean(s && s.appForceUpdate),
    appVersionSource: 'manual',
    appManifestAt: fromFile ? (fromFile.publishedAt || '') : '',
  };
}

/** 供后台一键提取最新版本信息 (GitHub Releases + 站内 Manifest) */
async function fetchAppRelease(env, request) {
  const s = await getSettings(env);
  const cfg = getGithubConfig(env, s);
  const repo = cfg.repo || 'xiaolin1991/dianying';
  const token = cfg.token;
  let ghData = null;
  let ghErr = '';

  // 1. 尝试从 GitHub Releases 获取最新发布
  try {
    const headers = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'xiaolin-tv-worker',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers,
      signal: AbortSignal.timeout(10000),
    });
    if (r.ok) {
      ghData = await r.json();
    } else {
      ghErr = `GitHub API HTTP ${r.status}`;
    }
  } catch (e) {
    ghErr = e.message || String(e);
  }

  // 2. 读取站内 manifest.json (优先 KV / 磁盘 / 静态)
  const manifest = await loadAppManifest(env, request);

  // 3. 解析版本号与更新说明
  let code = 0;
  let name = '';
  let changelog = '';
  let publishedAt = '';
  let source = '';
  let downloadUrl = '/APP/xiaolintv-phone-latest.apk';

  if (ghData && ghData.tag_name) {
    source = 'github_release';
    name = String(ghData.tag_name).replace(/^v/i, '');
    const m = ghData.tag_name.match(/v?(\d+)\.(\d+)\.(\d+)/i) || ghData.tag_name.match(/v?(\d+)/i);
    if (m) {
      if (m[3] !== undefined) {
        if (m[1] === '1' && m[2] === '0') code = parseInt(m[3], 10) || 0;
        else code = (parseInt(m[1], 10) * 10000) + (parseInt(m[2], 10) * 100) + (parseInt(m[3], 10) || 0);
      } else {
        code = parseInt(m[1], 10) || 0;
      }
    }
    changelog = String(ghData.body || '').trim();
    publishedAt = ghData.published_at || '';
    if (Array.isArray(ghData.assets)) {
      const apkAsset = ghData.assets.find((a) => a.name && a.name.endsWith('.apk'));
      if (apkAsset && apkAsset.browser_download_url) {
        downloadUrl = apkAsset.browser_download_url;
      }
    }
  }

  // 如果 manifest 存在且版本比 GitHub 提取的更高或 GitHub 获取失败，以 manifest 为准补充
  if (manifest && manifest.versionCode) {
    const mCode = Math.max(0, Math.round(Number(manifest.versionCode)) || 0);
    if (mCode >= code || !code) {
      code = mCode;
      name = String(manifest.versionName || ('1.0.' + mCode));
      if (!changelog || changelog.length < 5) {
        changelog = String(manifest.changelog || '');
      }
      publishedAt = manifest.publishedAt || publishedAt || '';
      source = ghData ? 'github_release+manifest' : 'manifest';
    }
  }

  return {
    ok: true,
    source: source || 'fallback',
    versionCode: code,
    versionName: name || (code ? `1.0.${code}` : ''),
    changelog: changelog || '优化体验与播放稳定性',
    publishedAt: publishedAt || new Date().toISOString(),
    downloadUrl,
    ghErr: ghData ? undefined : ghErr,
  };
}

async function saveSettings(env, patch) {
  const cur = await getSettings(env);
  const next = { ...cur };
  if (typeof patch.siteName === 'string' && patch.siteName.trim()) next.siteName = patch.siteName.trim().slice(0, 40);
  if (typeof patch.siteSlogan === 'string') next.siteSlogan = patch.siteSlogan.trim().slice(0, 100);
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
  if (patch.mobileWebLimitMinutes !== undefined) {
    const m = Math.round(Number(patch.mobileWebLimitMinutes));
    if (!isFinite(m) || m < -1 || m > 2880) throw new Error('手机网页端观看时限需为 -1 到 2880 分钟');
    next.mobileWebLimitMinutes = m;
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

  // App 版本发布控制 (发布 vs 草稿)
  if (typeof patch.appVersionActive === 'boolean') next.appVersionActive = patch.appVersionActive;
  if (patch.appPublishedCode !== undefined) {
    const pc = Math.max(0, Math.round(Number(patch.appPublishedCode)) || 0);
    next.appPublishedCode = pc;
    next.appVersionCode = pc; // 兼容历史字段
  }
  if (typeof patch.appPublishedName === 'string') {
    const pn = patch.appPublishedName.trim().slice(0, 40);
    next.appPublishedName = pn;
    next.appVersionName = pn;
  }
  if (typeof patch.appPublishedChangelog === 'string') {
    const pcl = patch.appPublishedChangelog.trim().slice(0, 2000);
    next.appPublishedChangelog = pcl;
    next.appChangelog = pcl;
  }
  if (typeof patch.appPublishedForce === 'boolean') {
    next.appPublishedForce = patch.appPublishedForce;
    next.appForceUpdate = patch.appPublishedForce;
  }
  if (typeof patch.appPublishedAt === 'string') next.appPublishedAt = patch.appPublishedAt.trim().slice(0, 40);

  // 待发布草稿字段
  if (patch.appDraftCode !== undefined) next.appDraftCode = Math.max(0, Math.round(Number(patch.appDraftCode)) || 0);
  if (typeof patch.appDraftName === 'string') next.appDraftName = patch.appDraftName.trim().slice(0, 40);
  if (typeof patch.appDraftChangelog === 'string') next.appDraftChangelog = patch.appDraftChangelog.trim().slice(0, 2000);
  if (typeof patch.appDraftForce === 'boolean') next.appDraftForce = patch.appDraftForce;

  // 兼容直接提交旧版字段
  if (patch.appVersionCode !== undefined && patch.appPublishedCode === undefined) {
    const c = Math.round(Number(patch.appVersionCode));
    if (!isFinite(c) || c < 0 || c > 999999999) throw new Error('App versionCode 需为 0-999999999 的整数');
    next.appVersionCode = c;
    next.appDraftCode = c;
  }
  if (typeof patch.appVersionName === 'string' && patch.appPublishedName === undefined) {
    next.appVersionName = patch.appVersionName.trim().slice(0, 40);
    next.appDraftName = next.appVersionName;
  }
  if (typeof patch.appForceUpdate === 'boolean' && patch.appPublishedForce === undefined) {
    next.appForceUpdate = patch.appForceUpdate;
    next.appDraftForce = patch.appForceUpdate;
  }
  if (typeof patch.appChangelog === 'string' && patch.appPublishedChangelog === undefined) {
    next.appChangelog = patch.appChangelog.trim().slice(0, 2000);
    next.appDraftChangelog = next.appChangelog;
  }
  if (typeof patch.appVersionAuto === 'boolean') next.appVersionAuto = patch.appVersionAuto;
  if (patch.appManifest && typeof patch.appManifest === 'object') {
    try { await writeKvAppManifest(env, patch.appManifest); } catch (e) { /* ignore */ }
  } else if (patch.appVersionCode !== undefined && Number(patch.appVersionCode) > 0) {
    // CI 同步版本号时同步写入 KV manifest，Cloudflare 静态资源未重建也能识别新版本
    try {
      await writeKvAppManifest(env, {
        versionCode: next.appVersionCode,
        versionName: next.appVersionName || ('1.0.' + next.appVersionCode),
        changelog: next.appChangelog || '',
        publishedAt: new Date().toISOString(),
        phone: { path: '/APP/xiaolintv-phone-latest.apk' },
        tv: { path: '/APP/xiaolintv-tv-latest.apk' },
      });
    } catch (e) { /* ignore */ }
  }
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
  if (typeof patch.adultUnlockCode === 'string') {
    next.adultUnlockCode = patch.adultUnlockCode.trim().slice(0, 100);
  }
  if (typeof patch.adultPayDesc === 'string') {
    next.adultPayDesc = patch.adultPayDesc.trim().slice(0, 500);
  }
  if (typeof patch.adultPayQr === 'string') {
    next.adultPayQr = patch.adultPayQr.trim().slice(0, 500);
  }
  // GitHub 数据中心与双向持久化同步配置
  if (typeof patch.githubToken === 'string') {
    const t = patch.githubToken.trim();
    if (t && !t.includes('****') && !t.startsWith('[UNCHANGED]')) {
      next.githubToken = t;
    } else if (t === '') {
      next.githubToken = '';
    }
  }
  if (typeof patch.githubOwner === 'string') next.githubOwner = patch.githubOwner.trim().slice(0, 50);
  if (typeof patch.githubRepo === 'string') next.githubRepo = patch.githubRepo.trim().slice(0, 100);
  if (typeof patch.githubBranch === 'string') next.githubBranch = patch.githubBranch.trim().slice(0, 50);
  if (typeof patch.githubPrefix === 'string') next.githubPrefix = patch.githubPrefix.trim().replace(/^\/+|\/+$/g, '').slice(0, 50);
  if (typeof patch.githubSyncEnabled === 'boolean') next.githubSyncEnabled = patch.githubSyncEnabled;
  MEM.settings = next;
  if (hasStorage(env)) await storagePut(env, 'settings', JSON.stringify(next));
  return next;
}

/* --------------------------- 源配置加载/缓存 ------------------------------ */
function parseConfig(raw) {
  const sites = raw && raw.api_site ? raw.api_site : {};
  const KNOWN_DEAD_HOSTS = new Set(['m3u8.apiyhzy.com', 'p2100.net', 'yhzy.cc']);
  const sources = Object.entries(sites).map(([key, v]) => {
    let api = String(v.api || '').trim();
    // 自动清洗失效第三方代理前缀 (例如 https://pz.v88.qzz.io/?url=https://...)
    const proxyMatch = api.match(/[?&]url=(https?:\/\/[^&]+)/i);
    if (proxyMatch && proxyMatch[1]) {
      try { api = decodeURIComponent(proxyMatch[1]); } catch (e) { api = proxyMatch[1]; }
    }
    let host = '';
    try { host = new URL(api).hostname.toLowerCase(); } catch (e) {}
    let detailHost = '';
    try { detailHost = new URL(String(v.detail || '')).hostname.toLowerCase(); } catch (e) {}
    const isDead = KNOWN_DEAD_HOSTS.has(host) || KNOWN_DEAD_HOSTS.has(detailHost);
    return {
      key,
      name: String(v.name || key).trim(),
      api,
      detail: String(v.detail || ''),
      adult: String(v.name || '').includes('🔞'),
      _isDead: isDead,
    };
  }).filter((s) => /^https?:\/\//i.test(s.api) && !s._isDead);
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
  if (!hasStorage(env)) return null;
  try {
    const raw = await storageGet(env, 'user:' + username);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
async function putUserRecord(env, rec) {
  if (!hasStorage(env)) return;
  await storagePut(env, 'user:' + rec.u, JSON.stringify(rec));
  const indexRaw = (await storageGet(env, 'users:index')) || '[]';
  let list;
  try { list = JSON.parse(indexRaw); } catch (e) { list = []; }
  if (!Array.isArray(list)) list = [];
  if (!list.includes(rec.u)) { list.push(rec.u); await storagePut(env, 'users:index', JSON.stringify(list.slice(-500))); }
}
async function loadUhist(env, username) {
  if (!hasStorage(env)) return { watchSec: 0, items: [] };
  try {
    const raw = await storageGet(env, 'uhist:' + username);
    if (raw) { const p = JSON.parse(raw); return { watchSec: p.watchSec || 0, items: Array.isArray(p.items) ? p.items : [] }; }
  } catch (e) { /* ignore */ }
  return { watchSec: 0, items: [] };
}
async function saveUhist(env, username, hist) {
  if (!hasStorage(env)) return;
  hist.items = hist.items.slice(0, 800);
  await storagePut(env, 'uhist:' + username, JSON.stringify(hist));
}
/* ---- 收藏服务端同步(D1/KV): 换设备登录不丢 ---- */
async function loadFavs(env, username) {
  if (!hasStorage(env)) return [];
  try {
    const raw = await storageGet(env, 'favs:' + username);
    const p = raw ? JSON.parse(raw) : [];
    return Array.isArray(p) ? p : [];
  } catch (e) { return []; }
}
async function saveFavs(env, username, list) {
  if (!hasStorage(env)) return;
  // 只保留白名单字段, 上限 200 条
  const clean = list.slice(0, 200).map((f) => ({
    key: String(f.key || '').slice(0, 60),
    id: String(f.id || '').slice(0, 60),
    title: String(f.title || '').slice(0, 120),
    pic: String(f.pic || '').slice(0, 600),
    remarks: String(f.remarks || '').slice(0, 120),
  })).filter((f) => f.key && f.id);
  await storagePut(env, 'favs:' + username, JSON.stringify(clean));
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

/* ========================= 访问统计(D1/KV 轻量) =========================
   stats:log -> 最近明细(≤600条) {kind:'page'|'search', path/q, ts, ip, geo, u}
   stats:agg -> { pvTotal, days:{yyyy-mm-dd:n}, searches:n, paths:{k:n}, ips:{ip:{c,ts}} }
====================================================================== */
const STATS_LOG_KEY = 'stats:log';
const STATS_AGG_KEY = 'stats:agg';
async function statRecord(env, entry) {
  if (!hasStorage(env)) return;
  entry.ts = Date.now();
  entry.geo = entry.geo || '';
  entry.u = entry.u || '';
  try {
    const raw = await storageGet(env, STATS_LOG_KEY);
    let arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) arr = [];
    arr.unshift(entry);
    await storagePut(env, STATS_LOG_KEY, JSON.stringify(arr.slice(0, 600)));
  } catch (e) { /* ignore */ }
  try {
    const raw = await storageGet(env, STATS_AGG_KEY);
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
    await storagePut(env, STATS_AGG_KEY, JSON.stringify(agg));
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
        // 核心：若 appVersionActive 未开启，对外下发 versionCode 为 0，避免未确认就向客户端弹窗
        const isPushing = s.appVersionActive !== false;
        const outVerCode = isPushing ? ver.appVersionCode : 0;
        return json({
          siteName: s.siteName,
          siteSlogan: s.siteSlogan || '海量高清 · 聚合秒播 · 极简私人影院',
          defaultTheme: s.defaultTheme,
          announcement: s.announcement,
          requireLogin: s.requireLogin !== false,
          trialMinutes: Number(s.trialMinutes === undefined ? 20 : s.trialMinutes),
          mobileWebLimitMinutes: Number(s.mobileWebLimitMinutes === undefined ? 10 : s.mobileWebLimitMinutes),
          allowRegister: s.allowRegister !== false,
          homeSources: Array.isArray(s.homeSources) ? s.homeSources : [],
          appPromoEnabled: s.appPromoEnabled !== false,
          downloadUrl: dl.downloadUrl,
          downloadUrlTv: dl.downloadUrlTv,
          downloadUrlMode: phoneDlMode(s),
          downloadUrlTvMode: tvDlMode(s),
          appVersionActive: !!s.appVersionActive,
          appVersionAuto: ver.appVersionAuto,
          appVersionCode: outVerCode,
          appVersionName: ver.appVersionName,
          appForceUpdate: !!ver.appForceUpdate,
          appChangelog: ver.appChangelog,
          appVersionSource: ver.appVersionSource,
          playerOptimize: !!s.playerOptimize,
          wmEnabled: !!s.wmEnabled,
          wmMode: s.wmMode === 'center' ? 'center' : 'corner',
          wmUrl: s.wmUrl || '',
          wmOpacity: Number(s.wmOpacity == null ? 0.55 : s.wmOpacity),
          wmDuration: Math.min(60, Math.max(1, Number(s.wmDuration == null ? 2 : s.wmDuration) || 2)),
          adultPayDesc: s.adultPayDesc || '',
          adultPayQr: s.adultPayQr || '',
        });
      }
      /* ---- 后台入口路径探测(只返回 是/否, 不泄露配置值; 用于自定义入口路由) ---- */
      if (path === '/api/admin-path' && request.method === 'GET') {
        const p = String(url.searchParams.get('p') || '').trim().toLowerCase();
        const s = await getSettings(env);
        return json({ ok: p === (s.adminPath || 'admin') });
      }

      /* ---- 源列表(网站常规页面仅保留正常源；成人源独立归入 adultSources 仅登录会员可见) ---- */
      if (path === '/api/config' && request.method === 'GET') {
        const settings = await getSettings(env);
        const { sources: remote } = await loadSources(env, ctx, settings);
        const { all } = mergeSources(remote, settings);

        let adultUnlocked = false;
        let adultForYou = false;
        let adultSources = [];

        if (settings.adultEnabled) {
          const isAdmin = await verifyToken(env, readToken(request, url));
          const uname = await currentUser(request, env, url);
          if (isAdmin) {
            adultUnlocked = true;
            adultForYou = true;
          } else if (uname) {
            adultForYou = true;
            const rec = await getUserRecord(env, uname);
            // 需明确付费/激活码解锁或管理员开通(adultAllowed === true)
            adultUnlocked = Boolean(rec && rec.adultAllowed === true);
          }
          // 仅已登录用户或管理员可获取私密福利源元数据(游客完全不可见)
          if (adultForYou) {
            adultSources = all.filter((s) => !s.disabled && s.adult).map(({ key, name, api, detail, adult }) => ({
              key, name, api, detail, adult: true,
            }));
          }
        }

        // 常规源：剔除所有成人源，确保主站首页、分类、搜索完全纯净
        const normalSources = all.filter((s) => !s.disabled && !s.adult);
        return json({
          adultEnabled: Boolean(settings.adultEnabled),
          adultForYou,
          adultUnlocked,
          total: all.length,
          count: normalSources.length,
          sources: normalSources.map(({ key, name, api, detail }) => ({ key, name, api, detail, adult: false })),
          adultSources,
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

      /* ---- 苹果CMS API 代理(白名单 + 权限隔离 + 视频流安全脱敏) ---- */
      if (path === '/api/proxy' && request.method === 'GET') {
        const target = url.searchParams.get('url') || '';
        let tu;
        try { tu = new URL(target); } catch (e) { return json({ error: 'bad url' }, 400); }
        if (!/^https?:$/.test(tu.protocol)) return json({ error: 'bad protocol' }, 400);

        const settings2 = await getSettings(env);
        const { sources: remote } = await loadSources(env, ctx, settings2);
        const { all } = mergeSources(remote, settings2);

        const allow = new Set();
        let matchedSrc = null;
        const host = tu.hostname.toLowerCase();
        for (const s of all) {
          for (const u of [s.api, s.detail]) {
            try {
              if (u) {
                const shost = new URL(u).hostname.toLowerCase();
                allow.add(shost);
                if (host === shost || host.endsWith('.' + shost)) {
                  if (!matchedSrc) matchedSrc = s;
                }
              }
            } catch (e) { /* ignore */ }
          }
        }
        const ok = allow.has(host) || [...allow].some((h) => host.endsWith('.' + h) || h.endsWith('.' + host));
        if (!ok) return json({ code: 1, msg: 'host not allowed', page: 1, pagecount: 0, total: 0, list: [] }, 200);

        const isAdultSrc = Boolean(matchedSrc && matchedSrc.adult);
        const uname = await currentUser(request, env, url);
        const isAdmin = await verifyToken(env, readToken(request, url));

        let g1 = { ok: true };
        if (isAdultSrc) {
          // 策略 1: 私密福利(18+)内容严禁游客试看, 必须已登录会员访问
          if (!settings2.adultEnabled) return json({ error: '私密福利内容已关闭' }, 403);
          if (!uname && !isAdmin) {
            return json({ error: '私密福利影片仅限会员访问，游客试看仅限正常影视', code: 'adult_login_required' }, 401);
          }
        } else {
          // 正常影片: 走正常游客试看逻辑
          g1 = await guestState(request, env, url);
          if (!g1.ok) return json({ error: '试看时间已到，注册/登录后继续观看', code: 'login_required' }, 401);
        }

        // 判断私密福利是否解锁播放
        let adultUnlocked = false;
        if (isAdultSrc) {
          if (isAdmin) adultUnlocked = true;
          else if (uname) {
            const rec = await getUserRecord(env, uname);
            adultUnlocked = Boolean(rec && rec.adultAllowed === true);
          }
        }

        let upstream;
        try {
          upstream = await fetch(tu.toString(), {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
              Accept: 'application/json, text/plain, */*',
              'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            },
            signal: AbortSignal.timeout(15000),
            cf: { cacheTtl: 120, cacheEverything: true },
          });
        } catch (e) {
          return json({ code: 1, msg: 'upstream unavailable: ' + e.message, page: 1, pagecount: 0, total: 0, list: [] }, 200);
        }

        const headers = new Headers();
        const contentType = upstream.headers.get('Content-Type') || 'application/json; charset=utf-8';
        headers.set('Content-Type', contentType);
        headers.set('Access-Control-Allow-Origin', '*');
        headers.set('Cache-Control', 'public, max-age=120');
        if (g1.newCookie) headers.set('Set-Cookie', guestSetCookie(g1.newCookie));

        if (!upstream.ok) {
          return json({ code: 1, msg: `upstream error ${upstream.status}`, page: 1, pagecount: 0, total: 0, list: [] }, 200, {
            headers,
          });
        }

        // 策略 2: 若访问成人源但未付费解锁(只能预览图片, 不能播放)
        // 从源头剥离播放地址 vod_play_url, 仅保留图片、片名、简介等元数据供图片预览
        if (isAdultSrc && !adultUnlocked) {
          try {
            const raw = await upstream.text();
            const data = JSON.parse(raw);
            if (data && Array.isArray(data.list)) {
              for (const it of data.list) {
                it.vod_play_url = ''; // 剥离播放串，彻底禁止未解锁播放
                it.vod_play_from = '需解锁播放';
                it.vod_play_note = '未付费解锁，仅提供图片预览';
                it.locked = true;
              }
            }
            return json(data, upstream.status, headers);
          } catch (e) {
            return json({ error: '未解锁私密福利播放权限，仅支持图片预览', code: 'adult_locked' }, 403);
          }
        }

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
        if (!hasStorage(env)) return json({ error: '未配置 D1 或 KV 存储，无法注册用户（见部署指南绑定 D1 或 KV）' }, 500);
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
          adultAllowed: false, // 新注册用户默认未解锁私密福利, 需付费/卡密解锁或管理员开通
        });
        const token = await makeUserToken(env, username);
        return json({ ok: true, username }, 200, {
          'Set-Cookie': `${USER_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${USER_SESSION_TTL}`,
        });
      }
      if (path === '/api/user/login' && request.method === 'POST') {
        if (!hasStorage(env)) return json({ error: '未配置 D1 或 KV 存储，无法登录（见部署指南）' }, 500);
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
      /* ---- 私密福利: 卡密/激活码解锁 ---- */
      if (path === '/api/user/unlock-adult' && request.method === 'POST') {
        const username = await currentUser(request, env, url);
        if (!username) return json({ error: '请先登录' }, 401);
        if (!hasStorage(env)) return json({ error: '未配置持久化存储' }, 500);
        const settings = await getSettings(env);
        if (!settings.adultEnabled) return json({ error: '私密福利内容暂未开放' }, 400);

        let body = {};
        try { body = await request.json(); } catch (e) {}
        const code = String(body.code || '').trim().toUpperCase();
        if (!code) return json({ error: '请输入激活卡密' }, 400);

        const rawCodes = String(settings.adultUnlockCode || 'VIP888');
        const validCodes = rawCodes.split(/[,，\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
        const matched = validCodes.includes(code);
        if (!matched) {
          return json({ error: '激活码/卡密无效或已过期，请核对后再试' }, 400);
        }

        const rec = await getUserRecord(env, username);
        if (!rec) return json({ error: '用户不存在' }, 404);
        rec.adultAllowed = true;
        rec.adultUnlockedAt = Date.now();
        await putUserRecord(env, rec);
        return json({ ok: true, message: '🎉 私密福利VIP特权已成功激活解锁！可畅享专区全部影片在线播放。' });
      }
      /* ---- 收藏同步: 拉取 / 整体覆盖保存(前端负责合并) ---- */
      if (path === '/api/user/favs' && request.method === 'GET') {
        const username = await currentUser(request, env, url);
        if (!username) return json({ error: '请先登录' }, 401);
        if (!hasStorage(env)) return json({ favs: [] });
        return json({ favs: await loadFavs(env, username) });
      }
      if (path === '/api/user/favs' && request.method === 'POST') {
        const username = await currentUser(request, env, url);
        if (!username) return json({ error: '请先登录' }, 401);
        if (!hasStorage(env)) return json({ error: '未配置持久化存储' }, 500);
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
            adultAllowed: Boolean(rec && rec.adultAllowed === true),
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
        /* ---- 数据库与存储连通性深度检测 (D1 + KV) ---- */
        if (path === '/api/admin/storage-check' && (request.method === 'GET' || request.method === 'POST')) {
          const result = {
            ok: false,
            storage: getStorageType(env),
            d1: { ok: false, binding: '', name: 'dianying', latencyMs: 0, msg: '' },
            kv: { ok: false, binding: '', name: 'dianying_KV', latencyMs: 0, msg: '' },
            checkedAt: new Date().toISOString(),
          };

          // 1. 检测 D1 数据库
          const db = d1(env);
          if (db) {
            result.d1.binding = env.dianying ? 'dianying' : (env.DB ? 'DB' : 'active');
            const t0 = Date.now();
            try {
              await ensureD1Table(db);
              const probeKey = '__sys_probe_d1__';
              const probeVal = 'probe_' + Date.now();
              await db.prepare(
                'INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at'
              ).bind(probeKey, probeVal, Date.now()).run();
              const readRow = await db.prepare('SELECT value FROM kv_store WHERE key = ?').bind(probeKey).first('value');
              if (readRow !== probeVal) throw new Error('D1 读写校验不匹配');
              await db.prepare('DELETE FROM kv_store WHERE key = ?').bind(probeKey).run();
              result.d1.latencyMs = Math.max(1, Date.now() - t0);
              result.d1.ok = true;
              result.d1.msg = `D1 数据库连接正常，读写与数据表检测 100% 通过（响应耗时 ${result.d1.latencyMs}ms）`;
            } catch (e) {
              result.d1.latencyMs = Math.max(1, Date.now() - t0);
              result.d1.ok = false;
              result.d1.error = e.message || String(e);
              result.d1.msg = `D1 数据库已绑定但执行失败：${e.message || String(e)}`;
            }
          } else {
            result.d1.ok = false;
            result.d1.missing = true;
            result.d1.msg = '未检测到 D1 绑定（请在 wrangler.toml 或 Cloudflare 仪表板添加 dianying 数据库绑定）';
          }

          // 2. 检测 KV 命名空间
          const k = kv(env);
          if (k) {
            result.kv.binding = env.dianying_KV ? 'dianying_KV' : (env.CONFIG_KV ? 'CONFIG_KV' : 'active');
            const t0 = Date.now();
            try {
              const probeKey = '__sys_probe_kv__';
              const probeVal = 'probe_' + Date.now();
              await k.put(probeKey, probeVal);
              const readVal = await k.get(probeKey);
              if (readVal !== probeVal) throw new Error('KV 读写校验不匹配');
              await k.delete(probeKey);
              result.kv.latencyMs = Math.max(1, Date.now() - t0);
              result.kv.ok = true;
              result.kv.msg = `KV 命名空间连接正常，读写与双写灾备检测 100% 通过（响应耗时 ${result.kv.latencyMs}ms）`;
            } catch (e) {
              result.kv.latencyMs = Math.max(1, Date.now() - t0);
              result.kv.ok = false;
              result.kv.error = e.message || String(e);
              result.kv.msg = `KV 已绑定但读写失败：${e.message || String(e)}`;
            }
          } else {
            result.kv.ok = false;
            result.kv.missing = true;
            result.kv.msg = '未检测到 KV 绑定（请在 wrangler.toml 或 Cloudflare 仪表板添加 dianying_KV 命名空间绑定）';
          }

          result.ok = Boolean(result.d1.ok || result.kv.ok);
          return json(result);
        }
        if (path === '/api/admin/settings' && request.method === 'GET') {
          const s = await getSettings(env);
          const { sources: remote } = await loadSources(env, ctx, s);
          const { all } = mergeSources(remote, s);
          const dl = effectiveDownloadUrls(s);
          const ver = effectiveAppVersion(s, await loadAppManifest(env, request));
          return json({
            siteName: s.siteName,
            siteSlogan: s.siteSlogan || '海量高清 · 聚合秒播 · 极简私人影院',
            adultEnabled: s.adultEnabled,
            defaultTheme: s.defaultTheme,
            announcement: s.announcement,
            liveSources: s.liveSources,
            customSources: s.customSources || [],
            disabledSources: s.disabledSources || [],
            storage: getStorageType(env),
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
            mobileWebLimitMinutes: Number(s.mobileWebLimitMinutes === undefined ? 10 : s.mobileWebLimitMinutes),
            allowRegister: s.allowRegister !== false,
            appPromoEnabled: s.appPromoEnabled !== false,
            downloadUrlMode: phoneDlMode(s),
            downloadUrl: s.downloadUrl || '',
            downloadUrlEffective: dl.downloadUrl,
            downloadUrlTvMode: tvDlMode(s),
            downloadUrlTv: s.downloadUrlTv || '',
            downloadUrlTvEffective: dl.downloadUrlTv,
            // App 版本发布控制 (线上发布状态 vs 待发布草稿)
            appVersionActive: !!s.appVersionActive,
            appPublishedCode: Math.max(0, Math.round(Number(s.appPublishedCode || 0))),
            appPublishedName: s.appPublishedName || '',
            appPublishedChangelog: s.appPublishedChangelog || '',
            appPublishedForce: !!s.appPublishedForce,
            appPublishedAt: s.appPublishedAt || '',
            appDraftCode: Math.max(0, Math.round(Number(s.appDraftCode || 0))),
            appDraftName: s.appDraftName || '',
            appDraftChangelog: s.appDraftChangelog || '',
            appDraftForce: !!s.appDraftForce,
            appVersionAuto: ver.appVersionAuto,
            appVersionSource: ver.appVersionSource,
            appVersionCode: ver.appVersionCode,
            appVersionName: ver.appVersionName,
            appChangelog: ver.appChangelog,
            appVersionCodeManual: Math.max(0, Math.round(Number(s.appVersionCode == null ? 0 : s.appVersionCode)) || 0),
            appVersionNameManual: s.appVersionName || '',
            appChangelogManual: s.appChangelog || '',
            appManifestAt: ver.appManifestAt || '',
            appForceUpdate: !!ver.appForceUpdate,
            adminPath: s.adminPath || '',
            homeSources: Array.isArray(s.homeSources) ? s.homeSources : [],
            playerOptimize: !!s.playerOptimize,
            wmEnabled: !!s.wmEnabled,
            wmMode: s.wmMode === 'center' ? 'center' : 'corner',
            wmUrl: s.wmUrl || '',
            wmOpacity: Number(s.wmOpacity == null ? 0.55 : s.wmOpacity),
            wmDuration: Math.min(60, Math.max(1, Number(s.wmDuration == null ? 2 : s.wmDuration) || 2)),
            adultUnlockCode: s.adultUnlockCode || 'VIP888',
            adultPayDesc: s.adultPayDesc || '',
            adultPayQr: s.adultPayQr || '',
            // GitHub 数据中心与双向持久化配置
            hasGithubToken: Boolean(getGithubConfig(env, s).token),
            githubTokenMasked: maskToken(getGithubConfig(env, s).token),
            githubTokenSource: getGithubConfig(env, s).fromAdmin ? 'admin' : (getGithubConfig(env, s).fromEnv ? 'env' : 'none'),
            githubOwner: getGithubConfig(env, s).owner,
            githubRepo: getGithubConfig(env, s).repoName,
            githubBranch: getGithubConfig(env, s).branch,
            githubPrefix: getGithubConfig(env, s).prefix,
            githubSyncEnabled: getGithubConfig(env, s).syncEnabled,
            githubRepoFull: getGithubConfig(env, s).repo,
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
          return json({ ok: true, settings: safeSettings, storage: getStorageType(env) });
        }
        /* ---- 同步 APK 版本：Node=git checkout；Cloudflare=GitHub API → KV ---- */
        if (path === '/api/admin/sync-app' && request.method === 'POST') {
          try {
            let mode = 'github';
            if (typeof env.syncAppFromPublishBranch === 'function') {
              await env.syncAppFromPublishBranch();
              mode = 'git';
              // Node 同步磁盘后，把 manifest 也写入 KV（若有）
              try {
                const disk = typeof env.getAppManifest === 'function' ? await env.getAppManifest() : null;
                if (disk) await writeKvAppManifest(env, disk);
              } catch (e) { /* ignore */ }
            } else {
              await syncAppManifestFromGithub(env);
            }
            const m = await loadAppManifest(env, request);
            const ver = effectiveAppVersion(await getSettings(env), m);
            return json({ ok: true, mode, manifest: m, ...ver });
          } catch (e) {
            return json({ ok: false, error: e.message || String(e) }, 500);
          }
        }
        /* ---- 自动提取最新版本信息 (GitHub Releases + manifest) 供后台编辑草稿 ---- */
        if (path === '/api/admin/fetch-app-release' && (request.method === 'GET' || request.method === 'POST')) {
          try {
            const rel = await fetchAppRelease(env, request);
            return json(rel);
          } catch (e) {
            return json({ ok: false, error: e.message || String(e) }, 500);
          }
        }
        /* ---- 辅助: 统一采集全量备份数据(D1/KV或内存) ---- */
        const collectBackupData = async () => {
          const out = { version: 1, exportedAt: new Date().toISOString(), kv: {} };
          if (hasStorage(env)) {
            const db = d1(env);
            if (db) {
              try {
                await ensureD1Table(db);
                const allRows = await db.prepare('SELECT key, value FROM kv_store').all();
                if (allRows && Array.isArray(allRows.results)) {
                  for (const row of allRows.results) {
                    if (row && row.key) out.kv[row.key] = row.value;
                  }
                }
              } catch (e) { /* fallback to grab */ }
            }
            // 确保核心必要键完整抓取 (在纯 KV 或补齐时)
            const grab = async (k) => {
              if (out.kv[k] != null) return;
              const v = await storageGet(env, k);
              if (v != null) out.kv[k] = v;
            };
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
          } else {
            out.kv['settings'] = JSON.stringify(MEM.settings || {});
          }
          return out;
        };

        /* ---- 辅助: 统一恢复备份数据 ---- */
        const restoreBackupData = async (body, mode) => {
          const data = body && body.kv && typeof body.kv === 'object' ? body.kv : (body && typeof body === 'object' && body.settings ? { settings: JSON.stringify(body.settings) } : null);
          if (!data || !Object.keys(data).length) throw new Error('备份数据无效：缺少 kv 字段');
          const merge = mode !== 'replace';
          let n = 0;
          if (hasStorage(env)) {
            for (const [k, v] of Object.entries(data)) {
              if (typeof v !== 'string') continue;
              if (merge && v === '') continue;
              await storagePut(env, String(k).slice(0, 120), String(v).slice(0, 900000));
              n++;
            }
            try {
              const freshSettings = await storageGet(env, 'settings');
              if (freshSettings) MEM.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(freshSettings) };
            } catch (e) { /* ignore */ }
          } else {
            if (data['settings']) {
              try {
                const parsed = JSON.parse(data['settings']);
                MEM.settings = { ...(MEM.settings || DEFAULT_SETTINGS), ...parsed };
                n++;
              } catch (e) { /* ignore */ }
            }
          }
          return { ok: true, restored: n, mode: merge ? 'merge' : 'replace' };
        };

        /* ---- 测试 GitHub Token 与仓库连通性 ---- */
        if (path === '/api/admin/github-test' && request.method === 'POST') {
          let body = {};
          try { body = await request.json(); } catch (e) { /* ignore */ }
          const s = await getSettings(env);
          const ghCfg = getGithubConfig(env, s);
          let token = String(body.token || '').trim();
          if (!token || token.includes('****') || token.startsWith('[UNCHANGED]')) {
            token = ghCfg.token;
          }
          const owner = String(body.owner || ghCfg.owner).trim() || 'xiaolin1991';
          const repoName = String(body.repo || ghCfg.repoName).trim() || 'dianying';
          const repo = `${owner}/${repoName}`;

          if (!token) {
            return json({ ok: false, error: '请先输入 GitHub Personal Access Token (PAT)' }, 400);
          }

          try {
            // 1. 验证用户和 Token 权限 scopes
            const userRes = await fetch('https://api.github.com/user', {
              headers: {
                Accept: 'application/vnd.github+json',
                Authorization: `Bearer ${token}`,
                'User-Agent': 'xiaolin-tv-worker',
                'X-GitHub-Api-Version': '2022-11-28',
              },
              signal: AbortSignal.timeout(12000),
            });
            if (userRes.status === 401) {
              return json({ ok: false, error: 'Token 校验失败 (HTTP 401 Unauthorized)：Token 无效、已过期或格式不正确' }, 400);
            }
            const scopes = userRes.headers.get('x-oauth-scopes') || '';
            const userData = await userRes.json();
            const userLogin = userData.login || '';

            // 2. 验证仓库访问与读写权限
            const repoRes = await fetch(`https://api.github.com/repos/${repo}`, {
              headers: {
                Accept: 'application/vnd.github+json',
                Authorization: `Bearer ${token}`,
                'User-Agent': 'xiaolin-tv-worker',
                'X-GitHub-Api-Version': '2022-11-28',
              },
              signal: AbortSignal.timeout(12000),
            });
            if (repoRes.status === 404) {
              return json({
                ok: false,
                user: userLogin,
                scopes,
                error: `仓库 ${repo} 无法访问 (HTTP 404)。请核对仓库名是否正确；若是私有仓库，需确保 Token 勾选了 repo 权限。`,
              }, 400);
            }
            const repoData = await repoRes.json();
            const permissions = repoData.permissions || {};
            const canPush = Boolean(permissions.push || permissions.admin);
            const hasWorkflow = scopes.includes('workflow') || scopes.includes('repo');

            return json({
              ok: true,
              user: userLogin,
              repo: repoData.full_name,
              isPrivate: Boolean(repoData.private),
              scopes,
              canPush,
              hasWorkflow,
              defaultBranch: repoData.default_branch,
              msg: `✅ 仓库连通正常！用户: ${userLogin} · 仓库: ${repoData.full_name} (${repoData.private ? '私有' : '公开'}) · 写入权限: ${canPush ? '正常' : '只读'} · Actions调度: ${hasWorkflow ? '正常' : '⚠️未检测到workflow权限'}`,
            });
          } catch (err) {
            return json({ ok: false, error: '连接 GitHub API 失败：' + (err.message || String(err)) }, 500);
          }
        }

        /* ---- GitHub 双向同步: 一键备份数据至 GitHub (Push) ---- */
        if (path === '/api/admin/github-sync-push' && request.method === 'POST') {
          try {
            const s = await getSettings(env);
            const cfg = getGithubConfig(env, s);
            if (!cfg.token) {
              return json({ ok: false, error: '未配置 GitHub Token，无法向 GitHub 推送备份。请先保存 Token。' }, 400);
            }
            const backup = await collectBackupData();
            const targetPath = `${cfg.prefix}/backup.json`;
            const text = JSON.stringify(backup, null, 2);
            const res = await githubWriteFile(
              env,
              targetPath,
              text,
              `Backup XiaolinTV data at ${new Date().toISOString()}`,
              cfg.branch,
              s
            );
            return json({
              ok: true,
              msg: `🎉 成功备份全站数据至 GitHub (${cfg.repo} @ ${cfg.branch}/${targetPath})！`,
              commitSha: res.commit ? res.commit.sha : '',
              keyCount: Object.keys(backup.kv).length,
              time: backup.exportedAt,
            });
          } catch (e) {
            return json({ ok: false, error: e.message || String(e) }, 500);
          }
        }

        /* ---- GitHub 双向同步: 从 GitHub 拉取数据恢复 (Pull) ---- */
        if (path === '/api/admin/github-sync-pull' && request.method === 'POST') {
          try {
            const s = await getSettings(env);
            const cfg = getGithubConfig(env, s);
            if (!cfg.token) {
              return json({ ok: false, error: '未配置 GitHub Token，无法从 GitHub 拉取数据。' }, 400);
            }
            const targetPath = `${cfg.prefix}/backup.json`;
            const file = await githubReadFile(env, targetPath, cfg.branch, s);
            if (!file) {
              return json({ ok: false, error: `在远程仓库 ${cfg.repo} (${cfg.branch} 分支) 未找到 ${targetPath} 文件，请先执行一次备份或确认目录。` }, 404);
            }
            const text = new TextDecoder().decode(file.bytes);
            let data = null;
            try { data = JSON.parse(text); } catch (err) {
              return json({ ok: false, error: '远程 backup.json 解析失败，不是有效的 JSON 文件' }, 400);
            }
            const r = await restoreBackupData(data, 'merge');
            return json({
              ok: true,
              msg: `🎉 成功从 GitHub 恢复 ${r.restored} 项数据！`,
              restored: r.restored,
              mode: r.mode,
              exportedAt: data.exportedAt,
            });
          } catch (e) {
            return json({ ok: false, error: e.message || String(e) }, 500);
          }
        }

        /* ---- 后台手动确认触发 GitHub Actions 构建 APK + Docker ---- */
        if (path === '/api/admin/dispatch-build-apk' && request.method === 'POST') {
          try {
            const s = await getSettings(env);
            const ghCfg = getGithubConfig(env, s);
            const token = ghCfg.token;
            const repo = ghCfg.repo || 'xiaolin1991/dianying';
            if (!token) {
              return json({
                ok: false,
                needToken: true,
                repo,
                error: '未检测到 GITHUB_TOKEN。您可直接在后台「数据与 GitHub 同步」或当前卡片中填写 Personal Access Token (PAT)，无需前往 Cloudflare 控制台添加环境变量。'
              }, 400);
            }
            let body = {};
            try { body = await request.json(); } catch (e) { /* ignore */ }
            const changelog = String(body.changelog || '').trim();
            const branch = ghCfg.branch || 'main';
            const url = `https://api.github.com/repos/${repo}/actions/workflows/android.yml/dispatches`;
            const r = await fetch(url, {
              method: 'POST',
              headers: {
                Accept: 'application/vnd.github+json',
                Authorization: `Bearer ${token}`,
                'User-Agent': 'xiaolin-tv-worker',
                'X-GitHub-Api-Version': '2022-11-28',
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                ref: branch,
                inputs: {
                  confirm: 'yes',
                  changelog: changelog,
                },
              }),
              signal: AbortSignal.timeout(15000),
            });
            if (r.status === 204 || r.ok) {
              return json({ ok: true, msg: `🎉 已成功向 GitHub (${repo} @ ${branch}) 触发 Actions 构建任务（同时打包 APK 与推送 Docker 镜像）！请稍后前往 GitHub Actions 查看构建进度。` });
            }
            const errText = await r.text();
            return json({ ok: false, error: `GitHub API 返回错误(${r.status}): ${errText}` }, 500);
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
            storage: getStorageType(env),
          });
        }
        /* ---- 数据备份: 导出全部业务 KV(settings/用户/历史/收藏/统计) ---- */
        if (path === '/api/admin/backup' && request.method === 'GET') {
          const out = await collectBackupData();
          return json(out);
        }
        /* ---- 数据恢复: mode=merge(跳过空值,推荐) | replace(逐键覆盖) ---- */
        if (path === '/api/admin/restore' && request.method === 'POST') {
          let body = {};
          try { body = await request.json(); } catch (e) { /* ignore */ }
          try {
            const r = await restoreBackupData(body, body.mode);
            return json(r);
          } catch (e) {
            return json({ error: e.message || String(e) }, 400);
          }
        }
        /* ---- 流量统计 ---- */
        if (path === '/api/admin/stats' && request.method === 'GET') {
          let log = [];
          let agg = {};
          try { log = JSON.parse((await storageGet(env, STATS_LOG_KEY)) || '[]'); } catch (e) { /* ignore */ }
          try { agg = JSON.parse((await storageGet(env, STATS_AGG_KEY)) || '{}'); } catch (e) { /* ignore */ }
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
          if (hasStorage(env)) {
            await storageDelete(env, STATS_LOG_KEY);
            await storageDelete(env, STATS_AGG_KEY);
          }
          return json({ ok: true });
        }
        /* ---- 用户管理: 列表 ---- */
        if (path === '/api/admin/users' && request.method === 'GET') {
          let list = [];
          try { list = JSON.parse((await storageGet(env, 'users:index')) || '[]'); } catch (e) { /* ignore */ }
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
              adultAllowed: rec ? rec.adultAllowed === true : false,
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
          if (!hasStorage(env)) return json({ error: 'no storage' }, 500);
          await storageDelete(env, 'user:' + u);
          await storageDelete(env, 'uhist:' + u);
          await storageDelete(env, 'favs:' + u);
          let list = [];
          try { list = JSON.parse((await storageGet(env, 'users:index')) || '[]'); } catch (e) { /* ignore */ }
          list = list.filter((x) => x !== u);
          await storagePut(env, 'users:index', JSON.stringify(list));
          return json({ ok: true });
        }
        return json({ error: 'not found' }, 404);
      }

      /* ---- 静态资源兜底(Pages 高级模式走这里; Workers 模式一般到不了) ---- */
      /* APP 目录：KV 版本新于静态资源时，从 GitHub 拉最新包（解决 CF 未重建仍显示旧版） */
      if (request.method === 'GET' && path.startsWith('/APP/') && path.length > 5) {
        const fileName = decodeURIComponent(path.slice(5)).replace(/^\/+/, '');
        if (fileName && !fileName.includes('..') && !fileName.includes('/')) {
          let assetVer = 0;
          try {
            if (env.ASSETS) {
              const mr = await env.ASSETS.fetch(new URL('/APP/manifest.json', request.url));
              if (mr.ok) assetVer = manifestCode(await mr.json());
            }
          } catch (e) { /* ignore */ }
          const kvVer = manifestCode(await readKvAppManifest(env));
          const forceGh = String(env.APP_FROM_GITHUB || '') === '1';
          if (forceGh || kvVer > assetVer) {
            const ghRes = await tryServeAppFromGithub(env, fileName, ctx);
            if (ghRes) return ghRes;
          }
        }
      }

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
