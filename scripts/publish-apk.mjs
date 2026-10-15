/**
 * 将打好的 APK 发布到 public/APP（固定 latest + 带版本号），删除旧包，
 * 可选：调用站点后台 API 同步 downloadUrl / appVersionCode。
 *
 * 用法:
 *   node scripts/publish-apk.mjs --apk path/to/phone.apk [--tv-apk path/to/tv.apk] --code 62 --name 1.0.62
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const APP_DIR = path.join(ROOT, 'public', 'APP');

function parseArgs(argv) {
  const out = { apk: '', tvApk: '', code: 0, name: '', changelog: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] || '';
    if (a === '--apk') out.apk = next();
    else if (a === '--tv-apk') out.tvApk = next();
    else if (a === '--code') out.code = Math.round(Number(next())) || 0;
    else if (a === '--name') out.name = String(next()).trim();
    else if (a === '--changelog') out.changelog = String(next());
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function normalizeSiteUrl(raw) {
  let u = String(raw || '').trim().replace(/\/+$/, '');
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u;
}

function listApkFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.apk'));
}

/** 删除旧的带版本号包，保留本次 phone/tv 版本号文件与 *-latest.apk */
function cleanOldVersioned(keepNames) {
  const keep = new Set(keepNames);
  for (const f of listApkFiles(APP_DIR)) {
    if (keep.has(f)) continue;
    if (/^xiaolintv-(phone|tv)-v.+\.apk$/i.test(f) || /^xiaolintv-(phone|tv)-latest\.apk$/i.test(f)) {
      fs.unlinkSync(path.join(APP_DIR, f));
      console.log('[publish-apk] removed', f);
    }
  }
}

async function syncAdminSettings({ siteUrl, password, code, name, changelog }) {
  const base = normalizeSiteUrl(siteUrl);
  if (!base || !password) {
    console.log('[publish-apk] skip admin sync (SITE_URL / ADMIN_PASSWORD 未设置)');
    return;
  }
  const loginRes = await fetch(base + '/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ password }),
  });
  const loginData = await loginRes.json().catch(() => ({}));
  if (!loginRes.ok || !loginData.token) {
    throw new Error('admin login failed: ' + (loginData.error || loginRes.status));
  }
  const token = loginData.token;
  const patch = {
    appVersionAuto: true,
    appVersionCode: code,
    appVersionName: name,
    appChangelog: changelog || '',
    appManifest: {
      versionCode: code,
      versionName: name,
      changelog: changelog || '',
      publishedAt: new Date().toISOString(),
      phone: { path: '/APP/xiaolintv-phone-latest.apk' },
      tv: { path: '/APP/xiaolintv-tv-latest.apk' },
    },
  };
  const saveRes = await fetch(base + '/api/admin/settings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: 'Bearer ' + token,
    },
    body: JSON.stringify(patch),
  });
  const saveData = await saveRes.json().catch(() => ({}));
  if (!saveRes.ok) {
    throw new Error('admin settings failed: ' + (saveData.error || saveRes.status));
  }
  console.log('[publish-apk] admin version synced:', {
    appVersionCode: code,
    appVersionName: name,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/publish-apk.mjs --apk <phone.apk> [--tv-apk <tv.apk>] --code <n> --name <verName> [--changelog "..."]');
    process.exit(0);
  }
  if (!args.apk || !fs.existsSync(args.apk)) {
    console.error('[publish-apk] missing --apk or file not found:', args.apk);
    process.exit(1);
  }
  if (!args.code || args.code < 1) {
    console.error('[publish-apk] --code must be a positive integer (versionCode)');
    process.exit(1);
  }
  const verName = args.name || String(args.code);
  const safeName = verName.replace(/[\\/:*?"<>|\s]+/g, '.');

  fs.mkdirSync(APP_DIR, { recursive: true });

  const phoneLatest = 'xiaolintv-phone-latest.apk';
  const tvLatest = 'xiaolintv-tv-latest.apk';
  const phoneVer = `xiaolintv-phone-v${safeName}.apk`;
  const tvVer = `xiaolintv-tv-v${safeName}.apk`;
  const keep = [phoneLatest, tvLatest, phoneVer, tvVer];

  const phoneSrc = path.resolve(args.apk);
  const tvSrc = (args.tvApk && fs.existsSync(args.tvApk)) ? path.resolve(args.tvApk) : phoneSrc;

  for (const name of [phoneLatest, phoneVer]) {
    fs.copyFileSync(phoneSrc, path.join(APP_DIR, name));
    console.log('[publish-apk] wrote phone:', name);
  }
  for (const name of [tvLatest, tvVer]) {
    fs.copyFileSync(tvSrc, path.join(APP_DIR, name));
    console.log('[publish-apk] wrote tv:', name);
  }

  cleanOldVersioned(keep);

  const siteUrl = normalizeSiteUrl(process.env.SITE_URL || '');
  const phonePath = '/APP/' + phoneLatest;
  const tvPath = '/APP/' + tvLatest;

  const manifest = {
    versionCode: args.code,
    versionName: verName,
    changelog: String(args.changelog || '').slice(0, 2000),
    publishedAt: new Date().toISOString(),
    phone: { path: phonePath, versioned: '/APP/' + phoneVer },
    tv: { path: tvPath, versioned: '/APP/' + tvVer },
  };
  fs.writeFileSync(path.join(APP_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log('[publish-apk] wrote manifest.json');

  await syncAdminSettings({
    siteUrl,
    password: process.env.ADMIN_PASSWORD || '',
    code: args.code,
    name: verName,
    changelog: args.changelog || '',
  });

  console.log('[publish-apk] done. Download paths:', phonePath, tvPath);
}

main().catch((err) => {
  console.error('[publish-apk]', err.message || err);
  process.exit(1);
});
