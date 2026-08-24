var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// _worker.js
var DEFAULT_CONFIG_URL = "https://raw.githubusercontent.com/hafrey1/LunaTV-config/main/LunaTV-config.json";
var FALLBACK_SOURCES = [
  { key: "dbzy.tv", name: "\u{1F3AC}\u8C46\u74E3\u8D44\u6E90", api: "https://caiji.dbzy5.com/api.php/provide/vod", detail: "https://dbzy.tv" },
  { key: "mtzy.me", name: "\u{1F3AC}\u8305\u53F0\u8D44\u6E90", api: "https://caiji.maotaizy.cc/api.php/provide/vod", detail: "https://mtzy.me" },
  { key: "iqiyizyapi.com", name: "\u{1F3AC}-\u7231\u5947\u827A-", api: "https://iqiyizyapi.com/api.php/provide/vod", detail: "https://iqiyizyapi.com" },
  { key: "ruyizy.cn", name: "\u{1F3AC}\u5982\u610F\u8D44\u6E90", api: "https://cj.ruyizy.cn/api.php/provide/vod", detail: "https://ruyizy.cn" },
  { key: "tyyszy.com", name: "\u{1F3AC}\u5929\u6DAF\u8D44\u6E90", api: "https://caiji.tyyszy.com/api.php/provide/vod", detail: "https://tyyszy.com" },
  { key: "bfzy.tv", name: "\u{1F3AC}\u66B4\u98CE\u8D44\u6E90", api: "https://bfzy.tv/api.php/provide/vod", detail: "https://bfzy.tv" },
  { key: "wolongzyw.com", name: "\u{1F3AC}\u5367\u9F99\u8D44\u6E90", api: "https://wolongzyw.com/api.php/provide/vod", detail: "https://wolongzyw.com" },
  { key: "ckzy.me", name: "\u{1F51E} CK-\u8D44\u6E90", api: "https://ckzy.me/api.php/provide/vod", detail: "https://ckzy.me" }
];
var DEFAULT_LIVE_SOURCES = [
  "https://iptv-org.github.io/iptv/countries/cn.m3u",
  "https://live.fanmingming.com/tv/m3u/ipv6.m3u"
];
var DEFAULT_SETTINGS = {
  siteName: "\u661F\u6CB3\u5F71\u89C6",
  adultEnabled: false,
  defaultTheme: "midnight",
  announcement: "",
  liveSources: DEFAULT_LIVE_SOURCES
};
var THEMES = ["midnight", "emerald", "sunset", "sakura", "ocean", "royal"];
var COOKIE_NAME = "ntv_auth";
var SESSION_TTL = 60 * 60 * 12;
var MEM = { settings: null, loginHits: /* @__PURE__ */ new Map() };
var enc = /* @__PURE__ */ __name((s) => new TextEncoder().encode(s), "enc");
var json = /* @__PURE__ */ __name((data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    ...extra
  }
}), "json");
async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(hmacHex, "hmacHex");
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
__name(safeEqual, "safeEqual");
function kv(env) {
  const k = env && env.CONFIG_KV;
  return k && typeof k.get === "function" ? k : null;
}
__name(kv, "kv");
async function getSettings(env) {
  try {
    if (kv(env)) {
      const raw = await env.CONFIG_KV.get("settings");
      if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    }
  } catch (e) {
  }
  if (MEM.settings) return { ...DEFAULT_SETTINGS, ...MEM.settings };
  const s = { ...DEFAULT_SETTINGS };
  if ((env.ADULT_ENABLED || "").toLowerCase() === "true") s.adultEnabled = true;
  return s;
}
__name(getSettings, "getSettings");
async function saveSettings(env, patch) {
  const cur = await getSettings(env);
  const next = { ...cur };
  if (typeof patch.siteName === "string" && patch.siteName.trim()) next.siteName = patch.siteName.trim().slice(0, 40);
  if (typeof patch.adultEnabled === "boolean") next.adultEnabled = patch.adultEnabled;
  if (typeof patch.defaultTheme === "string" && THEMES.includes(patch.defaultTheme)) next.defaultTheme = patch.defaultTheme;
  if (typeof patch.announcement === "string") next.announcement = patch.announcement.slice(0, 300);
  if (Array.isArray(patch.liveSources)) {
    const urls = patch.liveSources.filter((u) => typeof u === "string" && /^https?:\/\//i.test(u.trim())).map((u) => u.trim());
    if (urls.length || patch.liveSourcesAllowEmpty) next.liveSources = urls.slice(0, 10);
  }
  MEM.settings = next;
  if (kv(env)) await env.CONFIG_KV.put("settings", JSON.stringify(next));
  return next;
}
__name(saveSettings, "saveSettings");
function parseConfig(raw) {
  const sites = raw && raw.api_site ? raw.api_site : {};
  const sources = Object.entries(sites).map(([key, v]) => ({
    key,
    name: String(v.name || key).trim(),
    api: String(v.api || ""),
    detail: String(v.detail || ""),
    adult: String(v.name || "").includes("\u{1F51E}")
  })).filter((s) => /^https?:\/\//i.test(s.api));
  return sources;
}
__name(parseConfig, "parseConfig");
async function loadSources(env, ctx) {
  const url = env.CONFIG_URL || DEFAULT_CONFIG_URL;
  const cacheKey = new Request("https://cache.internal/nebulatv/sources/v1");
  try {
    const hit = await caches.default.match(cacheKey);
    if (hit) return await hit.json();
  } catch (e) {
  }
  let sources = [];
  let from = "network";
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 NebulaTV/1.0" },
      cf: { cacheTtl: 7200, cacheEverything: true }
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    sources = parseConfig(await res.json());
    if (!sources.length) throw new Error("empty config");
  } catch (e) {
    sources = FALLBACK_SOURCES.map((s) => ({ ...s }));
    from = "fallback:" + e.message;
  }
  const payload = { sources, fetchedAt: Date.now(), from };
  try {
    const r = new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } });
    ctx.waitUntil(caches.default.put(cacheKey, r.clone()));
  } catch (e) {
  }
  return payload;
}
__name(loadSources, "loadSources");
async function makeToken(env) {
  const exp = Math.floor(Date.now() / 1e3) + SESSION_TTL;
  const payload = String(exp);
  const sig = await hmacHex(adminSecret(env), payload);
  return `${payload}.${sig}`;
}
__name(makeToken, "makeToken");
async function verifyToken(env, token) {
  if (!token || !token.includes(".")) return false;
  const [payload, sig] = token.split(".");
  if (!/^\d+$/.test(payload)) return false;
  if (Number(payload) < Math.floor(Date.now() / 1e3)) return false;
  const expect = await hmacHex(adminSecret(env), payload);
  return safeEqual(sig, expect);
}
__name(verifyToken, "verifyToken");
function adminSecret(env) {
  return (env.ADMIN_PASSWORD || "admin123") + "::nebulatv-hmac";
}
__name(adminSecret, "adminSecret");
function readToken(req, url) {
  const authz = req.headers.get("Authorization") || "";
  if (authz.startsWith("Bearer ")) return authz.slice(7).trim();
  const cookie = req.headers.get("Cookie") || "";
  const m = cookie.match(new RegExp("(?:^|;\\s*)" + COOKIE_NAME + "=([^;]+)"));
  return m ? decodeURIComponent(m[1]) : "";
}
__name(readToken, "readToken");
async function requireAuth(req, env, url) {
  if (await verifyToken(env, readToken(req, url))) return true;
  return false;
}
__name(requireAuth, "requireAuth");
function rateLimited(ip) {
  const now = Date.now();
  const arr = (MEM.loginHits.get(ip) || []).filter((t) => now - t < 6e4);
  if (arr.length >= 10) {
    MEM.loginHits.set(ip, arr);
    return true;
  }
  arr.push(now);
  MEM.loginHits.set(ip, arr);
  return false;
}
__name(rateLimited, "rateLimited");
function parseM3U(text, tag) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let cur = null;
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith("#EXTINF")) {
      const commaIdx = t.indexOf(",");
      const attrs = t.slice(0, commaIdx);
      const title = (commaIdx >= 0 ? t.slice(commaIdx + 1) : "").trim();
      const group = (attrs.match(/group-title="([^"]*)"/) || [])[1] || "\u5176\u4ED6";
      const logo = (attrs.match(/tvg-logo="([^"]*)"/) || [])[1] || "";
      cur = { name: title || "\u672A\u547D\u540D\u9891\u9053", group: group.trim() || "\u5176\u4ED6", logo, url: "", tag };
    } else if (!t.startsWith("#")) {
      if (cur && !cur.url) {
        cur.url = t;
        out.push(cur);
        cur = null;
      }
    }
  }
  return out;
}
__name(parseM3U, "parseM3U");
async function loadLive(env, ctx) {
  const settings = await getSettings(env);
  const list = settings.liveSources && settings.liveSources.length ? settings.liveSources : DEFAULT_LIVE_SOURCES;
  const cacheKey = new Request("https://cache.internal/nebulatv/live/v1");
  try {
    const hit = await caches.default.match(cacheKey);
    if (hit) return await hit.json();
  } catch (e) {
  }
  const seen = /* @__PURE__ */ new Set();
  const channels = [];
  for (const url of list.slice(0, 4)) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(15e3) });
      if (!res.ok) continue;
      const parsed = parseM3U(await res.text(), url);
      for (const ch of parsed) {
        if (!/^https?:\/\//i.test(ch.url) || seen.has(ch.url)) continue;
        seen.add(ch.url);
        channels.push(ch);
      }
    } catch (e) {
    }
    if (channels.length > 3e3) break;
  }
  const groups = [];
  const gmap = /* @__PURE__ */ new Map();
  for (const ch of channels) {
    if (!gmap.has(ch.group)) {
      const g = { name: ch.group, channels: [] };
      gmap.set(ch.group, g);
      groups.push(g);
    }
    gmap.get(ch.group).channels.push(ch);
  }
  const payload = { groups, total: channels.length, fetchedAt: Date.now() };
  try {
    const r = new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } });
    ctx.waitUntil(caches.default.put(cacheKey, r.clone()));
  } catch (e) {
  }
  return payload;
}
__name(loadLive, "loadLive");
var worker_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type,Authorization",
          "Access-Control-Max-Age": "86400"
        }
      });
    }
    try {
      if (path === "/api/health") return json({ ok: true, time: Date.now() });
      if (path === "/api/settings" && request.method === "GET") {
        const s = await getSettings(env);
        return json({ siteName: s.siteName, defaultTheme: s.defaultTheme, announcement: s.announcement });
      }
      if (path === "/api/config" && request.method === "GET") {
        const [{ sources }, settings] = await Promise.all([loadSources(env, ctx), getSettings(env)]);
        const visible = settings.adultEnabled ? sources : sources.filter((s) => !s.adult);
        return json({ adultEnabled: settings.adultEnabled, total: sources.length, count: visible.length, sources: visible });
      }
      if (path === "/api/proxy" && request.method === "GET") {
        const target = url.searchParams.get("url") || "";
        let tu;
        try {
          tu = new URL(target);
        } catch (e) {
          return json({ error: "bad url" }, 400);
        }
        if (!/^https?:$/.test(tu.protocol)) return json({ error: "bad protocol" }, 400);
        const { sources } = await loadSources(env, ctx);
        const allow = /* @__PURE__ */ new Set();
        for (const s of sources) {
          for (const u of [s.api, s.detail]) {
            try {
              if (u) allow.add(new URL(u).hostname.toLowerCase());
            } catch (e) {
            }
          }
        }
        const host = tu.hostname.toLowerCase();
        const ok = allow.has(host) || [...allow].some((h) => host.endsWith("." + h));
        if (!ok) return json({ error: "host not allowed" }, 403);
        const upstream = await fetch(tu.toString(), {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) NebulaTV/1.0", Accept: "*/*" },
          signal: AbortSignal.timeout(2e4),
          cf: { cacheTtl: 120, cacheEverything: true }
        });
        const headers = new Headers();
        headers.set("Content-Type", upstream.headers.get("Content-Type") || "application/json; charset=utf-8");
        headers.set("Access-Control-Allow-Origin", "*");
        headers.set("Cache-Control", "public, max-age=120");
        return new Response(upstream.body, { status: upstream.status, headers });
      }
      if (path === "/api/live" && request.method === "GET") {
        return json(await loadLive(env, ctx));
      }
      if (path === "/api/admin/login" && request.method === "POST") {
        const ip = request.headers.get("CF-Connecting-IP") || "local";
        if (rateLimited(ip)) return json({ error: "\u5C1D\u8BD5\u8FC7\u4E8E\u9891\u7E41\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5" }, 429);
        let body = {};
        try {
          body = await request.json();
        } catch (e) {
        }
        const pass = env.ADMIN_PASSWORD || "admin123";
        if (typeof body.password !== "string" || body.password !== pass) return json({ error: "\u5BC6\u7801\u9519\u8BEF" }, 401);
        const token = await makeToken(env);
        return json({ token }, 200, {
          "Set-Cookie": `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL}`
        });
      }
      if (path.startsWith("/api/admin/")) {
        if (!await requireAuth(request, env, url)) return json({ error: "unauthorized" }, 401);
        if (path === "/api/admin/session" && request.method === "GET") return json({ ok: true });
        if (path === "/api/admin/logout" && request.method === "POST") {
          return json({ ok: true }, 200, { "Set-Cookie": `${COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0` });
        }
        if (path === "/api/admin/settings" && request.method === "GET") {
          const s = await getSettings(env);
          return json({
            ...s,
            storage: kv(env) ? "kv" : "memory",
            passwordFromEnv: Boolean(env.ADMIN_PASSWORD),
            configUrl: env.CONFIG_URL || DEFAULT_CONFIG_URL
          });
        }
        if (path === "/api/admin/settings" && request.method === "POST") {
          let body = {};
          try {
            body = await request.json();
          } catch (e) {
          }
          const saved = await saveSettings(env, body);
          return json({ ok: true, settings: saved, storage: kv(env) ? "kv" : "memory" });
        }
        return json({ error: "not found" }, 404);
      }
      if (env.ASSETS) {
        const assetRes = await env.ASSETS.fetch(request);
        if (assetRes.status !== 404) return assetRes;
        if (!path.includes(".")) {
          return env.ASSETS.fetch(new Request(new URL("/", request.url)));
        }
      }
      return new Response("Not Found", { status: 404 });
    } catch (err) {
      return json({ error: err.message || "internal error" }, 500);
    }
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-ytcchS/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-ytcchS/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=_worker.js.map
