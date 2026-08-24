/**
 * 构建 Cloudflare Pages 直接上传目录 dist/
 * 结构: dist/_worker.js + public 内所有静态文件(平铺到根目录)
 * Pages 高级模式要求 _worker.js 与静态资源位于同一层。
 */
import { cpSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url)) + '/..';
const dist = join(root, 'dist');

if (existsSync(dist)) rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

cpSync(join(root, '_worker.js'), join(dist, '_worker.js'));
cpSync(join(root, 'public'), dist, { recursive: true });

console.log('[build-pages] done -> dist/ (含 _worker.js + 静态资源)');
