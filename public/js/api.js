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
  async function proxyMacs(source, params) {
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');
    const sep = source.api.includes('?') ? '&' : '?';
    const target = source.api + sep + qs;
    return jfetch('/api/proxy?url=' + encodeURIComponent(target), {}, 22000);
  }

  window.API = {
    getSettings: () => jfetch('/api/settings', {}, 8000),
    getConfig: () => jfetch('/api/config'),
    getLive: () => jfetch('/api/live', {}, 30000),

    search: (source, wd, pg = 1) => proxyMacs(source, { ac: 'videolist', wd, pg }),
    list: (source, pg = 1) => proxyMacs(source, { ac: 'videolist', pg }),
    detail: (source, ids) => proxyMacs(source, { ac: 'videolist', ids }),

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
  };
})();
