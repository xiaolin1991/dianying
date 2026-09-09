/* 晓林影视 XIAOLIN-TV — 后端 API 封装(同源 /api/*) */
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
  async function proxyMacs(source, params, timeout = 22000) {
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');
    const sep = source.api.includes('?') ? '&' : '?';
    const target = source.api + sep + qs;
    return jfetch('/api/proxy?url=' + encodeURIComponent(target), {}, timeout);
  }

  window.API = {
    getSettings: () => jfetch('/api/settings', {}, 8000),
    getConfig: () => jfetch('/api/config'),
    getLive: () => jfetch('/api/live', {}, 30000),

    search: (source, wd, pg = 1, timeout = 22000) => proxyMacs(source, { ac: 'videolist', wd, pg }, timeout),
    list: (source, pg = 1, t = '', timeout = 22000) => proxyMacs(source, { ac: 'videolist', pg, t: t || undefined }, timeout),
    categories: (source, timeout = 22000) => proxyMacs(source, { ac: 'list' }, timeout),
    detail: (source, ids, timeout = 22000) => proxyMacs(source, { ac: 'videolist', ids }, timeout),

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
    adminSession: () => jfetch('/api/admin/session', {}, 8000),
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
    adminDispatchBuildApk: (changelog) =>
      jfetch('/api/admin/dispatch-build-apk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changelog: changelog || '' }),
      }, 20000),
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
    userMe: () => jfetch('/api/user/me', {}, 8000),
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
    adminStats: () => jfetch('/api/admin/stats', {}, 15000),
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
  };
})();
