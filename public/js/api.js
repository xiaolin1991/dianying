/* 星河影视 NebulaTV — 后端 API 封装(同源 /api/*) */
(function () {
  'use strict';

  async function jfetch(url, opt = {}, timeout = 20000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, { ...opt, signal: ctrl.signal });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
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
    list: (source, pg = 1, t = '') => proxyMacs(source, { ac: 'videolist', pg, t: t || undefined }),
    categories: (source) => proxyMacs(source, { ac: 'list' }),
    detail: (source, ids, timeout = 22000) => proxyMacs(source, { ac: 'videolist', ids }, timeout),

    adminLogin: (password) =>
      jfetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      }),
    adminLogout: () => jfetch('/api/admin/logout', { method: 'POST' }, 8000),
    adminSession: () => jfetch('/api/admin/session', {}, 8000),
    adminGetSettings: () => jfetch('/api/admin/settings', {}, 8000),
    adminSaveSettings: (patch) =>
      jfetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }),
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

    adminUsers: () => jfetch('/api/admin/users', {}, 15000),
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
