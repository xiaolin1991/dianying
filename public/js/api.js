/* 晓林影视 XIAOLIN-TV — 后端 API 封装(同源 /api/* · 全面兼容老旧电视机顶盒 WebView · 双层极速缓存) */
(function () {
  'use strict';

  /* ---------------- 机顶盒老旧 Android System WebView 兼容垫片 ---------------- */
  if (typeof Object.assign !== 'function') {
    Object.assign = function (target) {
      var to = Object(target);
      for (var index = 1; index < arguments.length; index++) {
        var nextSource = arguments[index];
        if (nextSource != null) {
          for (var nextKey in nextSource) {
            if (Object.prototype.hasOwnProperty.call(nextSource, nextKey)) {
              to[nextKey] = nextSource[nextKey];
            }
          }
        }
      }
      return to;
    };
  }
  if (typeof Object.entries !== 'function') {
    Object.entries = function (obj) {
      var ownProps = Object.keys(obj || {}), i = ownProps.length, resArray = new Array(i);
      while (i--) resArray[i] = [ownProps[i], obj[ownProps[i]]];
      return resArray;
    };
  }
  if (typeof Object.values !== 'function') {
    Object.values = function (obj) {
      var ownProps = Object.keys(obj || {}), i = ownProps.length, resArray = new Array(i);
      while (i--) resArray[i] = obj[ownProps[i]];
      return resArray;
    };
  }
  if (typeof Object.fromEntries !== 'function') {
    Object.fromEntries = function (entries) {
      var o = {};
      if (!entries) return o;
      var arr = Array.isArray(entries) ? entries : Array.from(entries);
      for (var i = 0; i < arr.length; i++) {
        if (arr[i]) o[arr[i][0]] = arr[i][1];
      }
      return o;
    };
  }
  if (typeof Promise !== 'undefined' && !Promise.allSettled) {
    Promise.allSettled = function (list) {
      var arr = Array.isArray(list) ? list : Array.from(list);
      return Promise.all(arr.map(function (p) {
        return Promise.resolve(p).then(
          function (v) { return { status: 'fulfilled', value: v }; },
          function (e) { return { status: 'rejected', reason: e }; }
        );
      }));
    };
  }
  if (typeof Promise !== 'undefined' && !Promise.prototype.finally) {
    Promise.prototype.finally = function (cb) {
      var P = this.constructor;
      return this.then(
        function (value) { return P.resolve(cb()).then(function () { return value; }); },
        function (reason) { return P.resolve(cb()).then(function () { throw reason; }); }
      );
    };
  }

  var ADMIN_TOKEN_KEY = 'ntv:adminToken';
  var USER_TOKEN_KEY = 'ntv:userToken';

  function getAdminToken() {
    try { return sessionStorage.getItem(ADMIN_TOKEN_KEY) || ''; } catch (e) { return ''; }
  }
  function setAdminToken(tok) {
    try {
      if (tok) sessionStorage.setItem(ADMIN_TOKEN_KEY, tok);
      else sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    } catch (e) {}
  }

  function getUserToken() {
    try { return localStorage.getItem(USER_TOKEN_KEY) || ''; } catch (e) { return ''; }
  }
  function setUserToken(tok) {
    try {
      if (tok) localStorage.setItem(USER_TOKEN_KEY, tok);
      else localStorage.removeItem(USER_TOKEN_KEY);
    } catch (e) {}
  }

  /* ---------------- 极速双层缓存引擎 (Memory LRU + sessionStorage + In-Flight 合并) ---------------- */
  var MEM_CACHE = new Map();
  var IN_FLIGHT = new Map();
  var MAX_MEM_ITEMS = 320;

  function getCached(key) {
    var now = Date.now();
    var hit = MEM_CACHE.get(key);
    if (hit) {
      if (now - hit.ts <= hit.ttl) return hit.data;
      MEM_CACHE.delete(key);
    }
    try {
      var raw = sessionStorage.getItem('xlc:' + key);
      if (raw) {
        var parsed = JSON.parse(raw);
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
    var entry = { ts: Date.now(), ttl: ttlMs, data: data };
    if (MEM_CACHE.size >= MAX_MEM_ITEMS) {
      var firstKey = MEM_CACHE.keys().next().value;
      if (firstKey) MEM_CACHE.delete(firstKey);
    }
    MEM_CACHE.set(key, entry);
    if (persistSession) {
      try {
        sessionStorage.setItem('xlc:' + key, JSON.stringify(entry));
      } catch (e) {}
    }
  }

  function jfetch(url, opt, timeout) {
    opt = opt || {};
    timeout = timeout || 20000;
    var hasAbort = typeof AbortController !== 'undefined';
    var ctrl = hasAbort ? new AbortController() : null;
    var timer = null;

    var fetchPromise = new Promise(function (resolve, reject) {
      timer = setTimeout(function () {
        if (ctrl) {
          try { ctrl.abort(); } catch (e) {}
        }
        reject(new Error('请求超时'));
      }, timeout);

      var headers = Object.assign({}, opt.headers || {});
      if (/^\/api\/admin\//.test(url) && url !== '/api/admin/login') {
        var admTok = getAdminToken();
        if (admTok && !headers.Authorization) headers.Authorization = 'Bearer ' + admTok;
      }
      // 携带用户令牌兜底: 彻底解决机顶盒 WebView 或 HTTP 环境丢 Cookie 导致无法保持登录态的问题
      var usrTok = getUserToken();
      if (usrTok && !headers['X-User-Token']) {
        headers['X-User-Token'] = usrTok;
      }

      var fetchOpt = Object.assign({}, opt, {
        headers: headers,
        credentials: 'same-origin'
      });
      if (ctrl) fetchOpt.signal = ctrl.signal;

      fetch(url, fetchOpt).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) {
            if (res.status === 401 && data.code === 'login_required') {
              try { window.dispatchEvent(new CustomEvent('xl:need-login')); } catch (e) {}
            }
            if (res.status === 401 && /^\/api\/admin\//.test(url) && url !== '/api/admin/login') {
              setAdminToken('');
            }
            var err = new Error(data.error || ('HTTP ' + res.status));
            err.code = data.code;
            throw err;
          }
          return data;
        });
      }).then(resolve, reject);
    });

    return fetchPromise.then(
      function (res) { clearTimeout(timer); return res; },
      function (err) { clearTimeout(timer); throw err; }
    );
  }

  function proxyMacs(source, params, timeout, cacheTtl, persistSession) {
    if (!source || !source.api) return Promise.reject(new Error('invalid source'));
    timeout = timeout || 15000;
    cacheTtl = cacheTtl === undefined ? 180000 : cacheTtl;

    var entries = Object.entries(params || {});
    var parts = [];
    for (var i = 0; i < entries.length; i++) {
      var k = entries[i][0], v = entries[i][1];
      if (v !== undefined && v !== null && v !== '') {
        parts.push(k + '=' + encodeURIComponent(v));
      }
    }
    var qs = parts.join('&');
    var sep = source.api.indexOf('?') >= 0 ? '&' : '?';
    var target = source.api + sep + qs;
    var proxyUrl = '/api/proxy?url=' + encodeURIComponent(target);

    if (cacheTtl > 0) {
      var cached = getCached(proxyUrl);
      if (cached) return Promise.resolve(cached);
    }
    if (IN_FLIGHT.has(proxyUrl)) {
      return IN_FLIGHT.get(proxyUrl);
    }

    var reqPromise = jfetch(proxyUrl, {}, timeout).then(function (data) {
      if (cacheTtl > 0 && data && Array.isArray(data.list) && data.list.length > 0) {
        setCached(proxyUrl, data, cacheTtl, persistSession);
      }
      IN_FLIGHT.delete(proxyUrl);
      return data;
    }, function (err) {
      IN_FLIGHT.delete(proxyUrl);
      throw err;
    });

    IN_FLIGHT.set(proxyUrl, reqPromise);
    return reqPromise;
  }

  window.API = {
    getSettings: function () { return jfetch('/api/settings', {}, 8000); },
    getConfig: function () { return jfetch('/api/config', {}, 10000); },
    getLive: function () { return jfetch('/api/live', {}, 25000); },

    search: function (source, wd, pg, timeout) {
      return proxyMacs(source, { ac: 'videolist', wd: wd, pg: pg || 1 }, timeout || 14000, 120000, false);
    },
    list: function (source, pg, t, timeout) {
      pg = pg || 1;
      return proxyMacs(source, { ac: 'videolist', pg: pg, t: t || undefined }, timeout || 14000, 240000, pg === 1);
    },
    categories: function (source, timeout) {
      return proxyMacs(source, { ac: 'list' }, timeout || 14000, 300000, false);
    },
    detail: function (source, ids, timeout) {
      return proxyMacs(source, { ac: 'videolist', ids: ids }, timeout || 14000, 300000, true);
    },
    prefetchDetail: function (source, ids) {
      if (!source || !ids) return;
      proxyMacs(source, { ac: 'videolist', ids: ids }, 10000, 300000, true).catch(function () {});
    },

    /* 拼音首字母云端智能联想 (如 JM -> 九门 / 老九门) */
    pySuggest: function (q) {
      var clean = String(q || '').trim();
      if (!clean) return Promise.resolve({ words: [], hits: [] });
      var key = 'pysug:' + clean.toUpperCase();
      var cached = getCached(key);
      if (cached) return Promise.resolve(cached);
      return jfetch('/api/py-suggest?q=' + encodeURIComponent(clean), {}, 4500).then(function (data) {
        if (data && (Array.isArray(data.words) || Array.isArray(data.hits))) {
          setCached(key, data, 300000, false);
        }
        return data || { words: [], hits: [] };
      }).catch(function () { return { words: [], hits: [] }; });
    },

    /* 手机扫码遥控输入同步到电视端 */
    tvSyncPush: function (sid, q) {
      return jfetch('/api/tv-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sid: String(sid || ''), q: String(q || '') })
      }, 6000);
    },
    tvSyncPoll: function (sid) {
      return jfetch('/api/tv-sync?sid=' + encodeURIComponent(sid || '') + '&_t=' + Date.now(), {}, 4500);
    },

    adminLogin: function (password) {
      return jfetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: password })
      }).then(function (data) {
        if (data && data.token) setAdminToken(data.token);
        return data;
      });
    },
    adminLogout: function () {
      return jfetch('/api/admin/logout', { method: 'POST' }, 8000).then(
        function () { setAdminToken(''); return { ok: true }; },
        function () { setAdminToken(''); return { ok: true }; }
      );
    },
    adminSession: function () { return jfetch('/api/admin/session', {}, 6000); },
    adminGetSettings: function () { return jfetch('/api/admin/settings', {}, 8000); },
    adminSaveSettings: function (patch) {
      return jfetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });
    },
    adminSyncApp: function () { return jfetch('/api/admin/sync-app', { method: 'POST' }, 120000); },
    adminFetchAppRelease: function () { return jfetch('/api/admin/fetch-app-release', { method: 'POST' }, 20000); },
    adminSyncRelease: function () { return jfetch('/api/admin/sync-release', { method: 'POST' }, 60000); },
    adminTriggerBuild: function () { return jfetch('/api/admin/trigger-build', { method: 'POST' }, 30000); },
    adminGithubTest: function (params) {
      return jfetch('/api/admin/github-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params || {})
      }, 25000);
    },
    adminGithubPush: function () {
      return jfetch('/api/admin/github-sync-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, 40000);
    },
    adminGithubPull: function () {
      return jfetch('/api/admin/github-sync-pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, 40000);
    },
    adminChangePassword: function (oldPassword, newPassword) {
      return jfetch('/api/admin/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPassword: oldPassword, newPassword: newPassword })
      }, 10000);
    },
    adminSaveSources: function (customSources, disabledSources) {
      return jfetch('/api/admin/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customSources: customSources, disabledSources: disabledSources })
      }, 15000);
    },
    adminTvboxCheck: function () { return jfetch('/api/admin/tvbox-check', {}, 20000); },
    adminStorageCheck: function () { return jfetch('/api/admin/storage-check', { method: 'POST' }, 15000); },

    /* ---- 用户体系 ---- */
    userRegister: function (username, password) {
      return jfetch('/api/user/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username, password: password })
      }, 10000).then(function (data) {
        if (data && data.token) setUserToken(data.token);
        return data;
      });
    },
    userLogin: function (username, password) {
      return jfetch('/api/user/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username, password: password })
      }, 10000).then(function (data) {
        if (data && data.token) setUserToken(data.token);
        return data;
      });
    },
    userLogout: function () {
      setUserToken('');
      return jfetch('/api/user/logout', { method: 'POST' }, 8000).catch(function () { return { ok: true }; });
    },
    userMe: function () { return jfetch('/api/user/me', {}, 6000); },
    userFavs: function () { return jfetch('/api/user/favs', {}, 10000); },
    userSaveFavs: function (favs) {
      return jfetch('/api/user/favs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ favs: favs })
      }, 10000).catch(function () {});
    },
    userHistory: function () { return jfetch('/api/user/history', {}, 8000); },
    userClearHistory: function (kind) {
      return jfetch('/api/user/history/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: kind || 'all' })
      }, 10000);
    },
    userDeleteHistory: function (ids) {
      return jfetch('/api/user/history/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ids })
      }, 10000);
    },
    userLogSearch: function (q) {
      return jfetch('/api/user/log-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: q })
      }, 8000).catch(function () {});
    },
    userProgress: function (payload) {
      return jfetch('/api/user/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }, 8000).catch(function () {});
    },
    userUnlockAdult: function (code) {
      return jfetch('/api/user/unlock-adult', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code })
      }, 10000);
    },
    userMessages: function () { return jfetch('/api/user/messages', {}, 8000); },
    userReadMessage: function (id) {
      return jfetch('/api/user/messages/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id || '' })
      }, 8000);
    },
    userDeleteMessage: function (id) {
      return jfetch('/api/user/messages/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id || '' })
      }, 8000);
    },

    adminUsers: function () { return jfetch('/api/admin/users', {}, 15000); },
    checkAdminPath: function (p) { return jfetch('/api/admin-path?p=' + encodeURIComponent(p || ''), {}, 8000); },
    guestStatus: function () { return jfetch('/api/guest/status', {}, 8000); },
    adminBackup: function () { return jfetch('/api/admin/backup', {}, 30000); },
    adminRestore: function (mode, kvData) {
      return jfetch('/api/admin/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: mode, kv: kvData })
      }, 60000);
    },
    adminUserAdult: function (u, allowed) {
      return jfetch('/api/admin/user-adult', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ u: u, allowed: allowed })
      }, 10000);
    },
    adminStats: function (hours) {
      return jfetch('/api/admin/stats' + (hours !== undefined && hours !== null && hours !== '' ? ('?hours=' + encodeURIComponent(hours)) : ''), {}, 15000);
    },
    adminClearStats: function () { return jfetch('/api/admin/stats/clear', { method: 'POST' }, 10000); },
    adminUserLog: function (u) { return jfetch('/api/admin/user-log?u=' + encodeURIComponent(u), {}, 15000); },
    adminDeleteUser: function (u) {
      return jfetch('/api/admin/user-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ u: u })
      }, 10000);
    },
    adminDeleteUserLog: function (u, ids, all) {
      return jfetch('/api/admin/user-log-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ u: u, ids: ids, all: Boolean(all) })
      }, 10000);
    },
    adminBroadcastMessage: function (title, content, actionText, actionUrl) {
      return jfetch('/api/admin/messages/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title, content: content, actionText: actionText, actionUrl: actionUrl })
      }, 30000);
    },
    adminBroadcastHistory: function () { return jfetch('/api/admin/messages/broadcast-history', {}, 10000); }
  };
})();
