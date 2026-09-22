/**
 * 生成 iPhone/iPad 免签名安装描述文件（WebClip）
 * - 安装后主屏幕出现「晓林影视」图标，点击即以全屏方式打开站点
 * - 无需签名、无需越狱，锁屏状态下播放器仍可横屏铺满
 *
 * 用法:
 *   START_URL=https://你的域名 node scripts/gen-mobileconfig.mjs
 * 产物:
 *   public/APP/xiaolintv-ios-latest.mobileconfig  (站内固定地址, 每次构建覆盖)
 *   out/晓林影视-描述文件.mobileconfig              (可选, 供 Release 附件)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const APP_DIR = path.join(ROOT, 'public', 'APP');

const siteRaw = String(process.env.START_URL || '').trim()
  || String(process.env.SITE_URL || '').trim();
const site = siteRaw.replace(/\/+$/, '');
if (!site) {
  console.log('[mobileconfig] 未配置 START_URL / SITE_URL，跳过生成描述文件');
  process.exit(0);
}

const iconPath = path.join(ROOT, 'public', 'icons', 'icon-512.png');
let iconB64 = '';
try {
  iconB64 = fs.readFileSync(iconPath).toString('base64');
} catch (e) {
  console.log('[mobileconfig] 未找到图标 public/icons/icon-512.png，将不带图标生成');
}

const uuid1 = crypto.randomUUID().toUpperCase();
const uuid2 = crypto.randomUUID().toUpperCase();
const displayName = '晓林影视';
const url = site + '/';

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>PayloadContent</key>
	<array>
		<dict>
			<key>FullScreen</key>
			<true/>
			${iconB64 ? `<key>Icon</key>\n\t\t\t<data>${iconB64}</data>\n\t\t\t` : ''}<key>IsRemovable</key>
			<true/>
			<key>Label</key>
			<string>${displayName}</string>
			<key>PayloadDescription</key>
			<string>在主屏幕创建「${displayName}」全屏图标</string>
			<key>PayloadDisplayName</key>
			<string>${displayName}</string>
			<key>PayloadIdentifier</key>
			<string>com.xiaolintv.webclip.${uuid1}</string>
			<key>PayloadOrganization</key>
			<string>${displayName}</string>
			<key>PayloadType</key>
			<string>com.apple.webClip.managed</string>
			<key>PayloadUUID</key>
			<string>${uuid1}</string>
			<key>PayloadVersion</key>
			<integer>1</integer>
			<key>Precomposed</key>
			<true/>
			<key>URL</key>
			<string>${url}</string>
		</dict>
	</array>
	<key>PayloadDescription</key>
	<string>安装后在主屏幕生成「${displayName}」图标，全屏打开官方站点，无需签名</string>
	<key>PayloadDisplayName</key>
	<string>${displayName} 免签安装描述文件</string>
	<key>PayloadIdentifier</key>
	<string>com.xiaolintv.profile.${uuid2}</string>
	<key>PayloadOrganization</key>
	<string>${displayName}</string>
	<key>PayloadRemovalDisallowed</key>
	<false/>
	<key>PayloadType</key>
	<string>Configuration</string>
	<key>PayloadUUID</key>
	<string>${uuid2}</string>
	<key>PayloadVersion</key>
	<integer>1</integer>
</dict>
</plist>
`;

fs.mkdirSync(APP_DIR, { recursive: true });
const siteFile = path.join(APP_DIR, 'xiaolintv-ios-latest.mobileconfig');
fs.writeFileSync(siteFile, xml, 'utf8');
console.log('[mobileconfig] 已生成 ' + path.relative(ROOT, siteFile));

const outDir = path.join(ROOT, 'out');
if (fs.existsSync(outDir)) {
  const relFile = path.join(outDir, '晓林影视-描述文件.mobileconfig');
  fs.writeFileSync(relFile, xml, 'utf8');
  console.log('[mobileconfig] 已生成 ' + path.relative(ROOT, relFile));
}
