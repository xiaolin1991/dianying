/* 晓林影视 XIAOLIN-TV — 后端 API 封装(同源 /api/* · 内置内存+会话双层极速缓存与并发去重) */
(function () {
  'use strict';

  const ADMIN_TOKEN_KEY = 'ntv:adminToken';
  function getAdminToken() {
    try { return sessionStorage.getItem(ADMIN_TOKEN_KEY) || ''; } catch (e) { return ''; }
  }
  function setAdminToken(tok) {
    try {
      if (tok) sessionStorage.setItem(ADMIN_TOKEN_KEY, tok);
      else sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    } catch (e) { /* ignore */ }
  }

  /* ---------------- 极速双层缓存引擎 (Memory LRU + sessionStorage + In-Flight 合并) ---------------- */
  const MEM_CACHE = new Map(); // key -> { ts, ttl, data }
  const IN_FLIGHT = new Map(); // key -> Promise
  const MAX_MEM_ITEMS = 320;

  function getCached(key) {
    const now = Date.now();
    const hit = MEM_CACHE.get(key);
    if (hit) {
      if (now - hit.ts <= hit.ttl) return hit.data;
      MEM_CACHE.delete(key);
    }
    try {
      const raw = sessionStorage.getItem('xlc:' + key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && now - parsed.ts <= parsed.ttl && parsed.data) {
          MEM_CACHE.set(key, parsed);
          return parsed.data;
        }
        sessionStorage.removeItem('xlc:' + key);
      }
    } catch (e) {}
    return null;
  }

  function setCached(key, data, ttlMs, persistSession) {
    if (!data || ttlMs <= 0) return;
    const entry = { ts: Date.now(), ttl: ttlMs, data };
    if (MEM_CACHE.size >= MAX_MEM_ITEMS) {
      const firstKey = MEM_CACHE.keys().next().value;
      if (firstKey) MEM_CACHE.delete(firstKey);
    }
    MEM_CACHE.set(key, entry);
    if (persistSession) {
      try {
        sessionStorage.setItem('xlc:' + key, JSON.stringify(entry));
      } catch (e) {}
    }
  }

  async function jfetch(url, opt = {}, timeout = 20000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const headers = Object.assign({}, opt.headers || {});
      // 后台接口: Cookie 失败时用登录下发的 Bearer token 兜底(解决部分环境 Secure Cookie 不落地)
      if (/^\/api\/admin\//.test(url) && url !== '/api/admin/login') {
        const tok = getAdminToken();
        if (tok && !headers.Authorization) headers.Authorization = 'Bearer ' + tok;
      }
      const res = await fetch(url, { ...opt, headers, credentials: 'same-origin', signal: ctrl.signal });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 游客试看到期: 全局广播, 由应用层弹出注册框
        if (res.status === 401 && data.code === 'login_required') {
          try { window.dispatchEvent(new CustomEvent('xl:need-login')); } catch (e) {}
        }
        if (res.status === 401 && /^\/api\/admin\//.test(url) && url !== '/api/admin/login') {
          setAdminToken('');
        }
        const err = new Error(data.error || ('HTTP ' + res.status));
        err.code = data.code;
        throw err;
      }
      return data;
    } finally { clearTimeout(timer); }
  }

  /** 通过后端代理请求苹果CMS接口。source={api}, params={ac,ids,wd,pg,...} */
  async function proxyMacs(source, params, timeout = 16000, cacheTtl = 180000, persistSession = false) {
    if (!source || !source.api) throw new Error('invalid source');
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');
    const sep = source.api.includes('?') ? '&' : '?';
    const target = source.api + sep + qs;
    const proxyUrl = '/api/proxy?url=' + encodeURIComponent(target);

    if (cacheTtl > 0) {
      const cached = getCached(proxyUrl);
      if (cached) return cached;
    }
    if (IN_FLIGHT.has(proxyUrl)) {
      return IN_FLIGHT.get(proxyUrl);
    }

    const reqPromise = jfetch(proxyUrl, {}, timeout).then((data) => {
      if (cacheTtl > 0 && data && Array.isArray(data.list) && data.list.length > 0) {
        setCached(proxyUrl, data, cacheTtl, persistSession);
      }
      return data;
    }).finally(() => {
      IN_FLIGHT.delete(proxyUrl);
    });

    IN_FLIGHT.set(proxyUrl, reqPromise);
    return reqPromise;
  }

  window.API = {
    getSettings: () => jfetch('/api/settings', {}, 8000),
    getConfig: () => jfetch('/api/config', {}, 12000),
    getLive: () => jfetch('/api/live', {}, 25000),

    search: (source, wd, pg = 1, timeout = 15000) => proxyMacs(source, { ac: 'videolist', wd, pg }, timeout, 120000, false),
    list: (source, pg = 1, t = '', timeout = 15000) => proxyMacs(source, { ac: 'videolist', pg, t: t || undefined }, timeout, 240000, pg === 1),
    categories: (source, timeout = 15000) => proxyMacs(source, { ac: 'list' }, timeout, 300000, false),
    detail: (source, ids, timeout = 15000) => proxyMacs(source, { ac: 'videolist', ids }, timeout, 300000, true),
    prefetchDetail: (source, ids) => {
      if (!source || !ids) return;
      proxyMacs(source, { ac: 'videolist', ids }, 10000, 300000, true).catch(() => {});
    },

    adminLogin: async (password) => {
      const data = await jfetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (data && data.token) setAdminToken(data.token);
      return data;
    },
    adminLogout: async () => {
      try { await jfetch('/api/admin/logout', { method: 'POST' }, 8000); }
      finally { setAdminToken(''); }
      return { ok: true };
    },
    adminSession: () => jfetch('/api/admin/session', {}, 6000),
    adminGetSettings: () => jfetch('/api/admin/settings', {}, 8000),
    adminSaveSettings: (patch) =>
      jfetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }),
    adminSyncApp: () =>
      jfetch('/api/admin/sync-app', { method: 'POST' }, 120000),
    adminFetchAppRelease: () =>
      jfetch('/api/admin/fetch-app-release', { method: 'POST' }, 20000),
    adminSyncRelease: () =>
      jfetch('/api/admin/sync-release', { method: 'POST' }, 60000),
    adminTriggerBuild: () =>
      jfetch('/api/admin/trigger-build', { method: 'POST' }, 30000),
    adminGithubTest: (params) =>
      jfetch('/api/admin/github-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params || {}),
      }, 25000),
    adminGithubPush: () =>
      jfetch('/api/admin/github-sync-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }, 40000),
    adminGithubPull: () =>
      jfetch('/api/admin/github-sync-pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }, 40000),
    adminChangePassword: (oldPassword, newPassword) =>
      jfetch('/api/admin/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPassword, newPassword }),
      }, 10000),
    adminSaveSources: (customSources, disabledSources) =>
      jfetch('/api/admin/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customSources, disabledSources }),
      }, 15000),
    adminTvboxCheck: () => jfetch('/api/admin/tvbox-check', {}, 20000),
    adminStorageCheck: () => jfetch('/api/admin/storage-check', { method: 'POST' }, 15000),

    /* ---- 用户体系 ---- */
    userRegister: (username, password) =>
      jfetch('/api/user/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      }, 10000),
    userLogin: (username, password) =>
      jfetch('/api/user/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      }, 10000),
    userLogout: () => jfetch('/api/user/logout', { method: 'POST' }, 8000),
    userMe: () => jfetch('/api/user/me', {}, 6000),
    userFavs: () => jfetch('/api/user/favs', {}, 12000),
    userSaveFavs: (favs) =>
      jfetch('/api/user/favs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ favs }),
      }, 12000).catch(() => {}),
    userHistory: () => jfetch('/api/user/history', {}, 12000),
    userClearHistory: (kind) =>
      jfetch('/api/user/history/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: kind || 'all' }),
      }, 10000),
    userDeleteHistory: (ids) =>
      jfetch('/api/user/history/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      }, 10000),
    userLogSearch: (q) =>
      jfetch('/api/user/log-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q }),
      }, 8000).catch(() => {}),
    userProgress: (payload) =>
      jfetch('/api/user/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }, 8000).catch(() => {}),
    userUnlockAdult: (code) =>
      jfetch('/api/user/unlock-adult', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      }, 10000),
    userMessages: () => jfetch('/api/user/messages', {}, 10000),
    userReadMessage: (id) =>
      jfetch('/api/user/messages/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id || '' }),
      }, 8000),
    userDeleteMessage: (id) =>
      jfetch('/api/user/messages/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id || '' }),
      }, 8000),

    adminUsers: () => jfetch('/api/admin/users', {}, 15000),
    checkAdminPath: (p) => jfetch('/api/admin-path?p=' + encodeURIComponent(p || ''), {}, 8000),
    guestStatus: () => jfetch('/api/guest/status', {}, 8000),
    adminBackup: () => jfetch('/api/admin/backup', {}, 30000),
    adminRestore: (mode, kvData) =>
      jfetch('/api/admin/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, kv: kvData }),
      }, 60000),
    adminUserAdult: (u, allowed) =>
      jfetch('/api/admin/user-adult', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ u, allowed }),
      }, 10000),
    adminStats: (hours) => jfetch('/api/admin/stats' + (hours !== undefined && hours !== null && hours !== '' ? ('?hours=' + encodeURIComponent(hours)) : ''), {}, 15000),
    adminClearStats: () => jfetch('/api/admin/stats/clear', { method: 'POST' }, 10000),
    adminUserLog: (u) => jfetch('/api/admin/user-log?u=' + encodeURIComponent(u), {}, 15000),
    adminDeleteUser: (u) =>
      jfetch('/api/admin/user-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ u }),
      }, 10000),
    adminDeleteUserLog: (u, ids, all) =>
      jfetch('/api/admin/user-log-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ u, ids, all: Boolean(all) }),
      }, 10000),
    adminBroadcastMessage: (title, content, actionText, actionUrl) =>
      jfetch('/api/admin/messages/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, actionText, actionUrl }),
      }, 30000),
    adminBroadcastHistory: () => jfetch('/api/admin/messages/broadcast-history', {}, 10000),
  };
})();
