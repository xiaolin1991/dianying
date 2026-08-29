/**
 * 晓林影视 XIAOLIN-TV — Node 自托管服务器(VPS / Docker)
 * - 复用 Cloudflare Worker 业务代码(_worker.js), 零改动运行
 * - CONFIG_KV 以 JSON 文件持久化(默认 /data/kv.json, Docker 挂载卷即永久保存)
 * - 静态文件来自 ./public, 其余全部走 Worker 的 app.fetch
 *
 * 环境变量:
 *   PORT            监听端口(默认 8788)
 *   DATA_DIR        数据目录(kv.json 所在), 默认 ./data
 *   ADMIN_PASSWORD  初始管理密码
 *   ADULT_ENABLED   "true" 开启成人内容初始开关
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8788);
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');

fs.mkdirSync(DATA_DIR, { recursive: true });

const PUBLIC_DIR = path.join(ROOT, 'public');

/* ---------------- 文件版 KV(CONFIG_KV 垫片) ---------------- */
const kvFile = path.join(DATA_DIR, 'kv.json');
let kvData = {};
try { kvData = JSON.parse(fs.readFileSync(kvFile, 'utf8')) || {}; } catch (e) { kvData = {}; }
let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const tmp = kvFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(kvData));
      fs.renameSync(tmp, kvFile); // 原子写入, 断电不怕损坏
    } catch (e) { console.error('[kv] persist failed:', e.message); }
  }, 150);
}
const env = {
  CONFIG_KV: {
    async get(k) { return Object.prototype.hasOwnProperty.call(kvData, k) ? kvData[k] : null; },
    async put(k, v) { kvData[String(k)] = String(v); persist(); },
    async delete(k) { delete kvData[String(k)]; persist(); },
  },
  ADULT_ENABLED: process.env.ADULT_ENABLED || '',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || '',
  async getAppManifest() {
    try {
      const fp = path.join(PUBLIC_DIR, 'APP', 'manifest.json');
      return JSON.parse(fs.readFileSync(fp, 'utf8'));
    } catch (e) {
      return null;
    }
  },
};

/* ---------------- 载入 Worker(ESM 语法 → 临时 .mjs 动态导入) ---------------- */
const tmpWorker = path.join(os.tmpdir(), `xiaolintv-worker-${process.pid}.mjs`);
fs.copyFileSync(path.join(ROOT, '_worker.js'), tmpWorker);
const mod = await import(pathToFileURL(tmpWorker).href);
const app = mod.default;
if (!app || typeof app.fetch !== 'function') throw new Error('_worker.js 未导出 fetch');

/* ---------------- 静态资源 ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.apk': 'application/vnd.android.package-archive',
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://internal');

    /* API → Worker 业务逻辑 */
    if (url.pathname.startsWith('/api/')) {
      let bodyBuf = null;
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        bodyBuf = await new Promise((ok) => {
          const chunks = [];
          req.on('data', (c) => chunks.push(c));
          req.on('end', () => ok(Buffer.concat(chunks)));
          req.on('error', () => ok(null));
        });
      }
      const init = { method: req.method, headers: req.headers };
      if (bodyBuf) init.body = bodyBuf;
      // 必须构造真正的 Request(worker 内部会读取 request.url/method/headers)
      const workerReq = new Request('http://internal' + url.pathname + url.search, init);
      const resp = await app.fetch(workerReq, env, { waitUntil: () => {} })
        .then((r) => r)
        .catch((err) => new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
      const headers = {};
      resp.headers.forEach((v, k) => { headers[k] = v; });
      res.writeHead(resp.status, headers);
      res.end(Buffer.from(await resp.arrayBuffer()));
      return;
    }

    /* 其余 → 静态文件(SPA 回退 index.html) */
    let p = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[\/\\])+/, '');
    if (p === '/' || p === '\\') p = '/index.html';
    let fp = path.join(PUBLIC_DIR, p);
    if (!fp.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
    try { if (fs.statSync(fp).isDirectory()) fp = path.join(fp, 'index.html'); } catch (e) { /* not exist */ }
    if (!fs.existsSync(fp)) fp = path.join(PUBLIC_DIR, 'index.html');
    const ext = path.extname(fp).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    });
    fs.createReadStream(fp).pipe(res);
  } catch (err) {
    try { res.writeHead(500, { 'Content-Type': 'application/json' }); } catch (e) {}
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('==============================================');
  console.log('  晓林影视 XIAOLIN-TV 自托管服务已启动');
  console.log(`  本机:     http://localhost:${PORT}`);
  console.log(`  局域网:   http://<你的IP>:${PORT}`);
  console.log(`  数据目录: ${DATA_DIR} (kv.json)`);
  console.log('==============================================');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    try { fs.writeFileSync(kvFile, JSON.stringify(kvData)); } catch (e) {}
    process.exit(0);
  });
}
