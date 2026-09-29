import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const src = 'C:/Users/Administrator/.gemini/antigravity/brain/52d221aa-e4d9-4b5a-b080-faf7665e8f21/.user_uploaded/media_1790648910057.png';

async function main() {
  if (!fs.existsSync(src)) {
    throw new Error('Source logo file not found: ' + src);
  }

  const iconsDir = path.join(root, 'public', 'icons');
  if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

  const imageDir = path.join(root, 'public', 'image');
  if (!fs.existsSync(imageDir)) fs.mkdirSync(imageDir, { recursive: true });

  console.log('Generating icons from:', src);

  await sharp(src).resize(1024, 1024).png().toFile(path.join(iconsDir, 'icon-1024.png'));
  console.log('-> public/icons/icon-1024.png (1024x1024)');

  await sharp(src).resize(512, 512).png().toFile(path.join(iconsDir, 'icon-512.png'));
  console.log('-> public/icons/icon-512.png (512x512)');

  await sharp(src).resize(192, 192).png().toFile(path.join(iconsDir, 'icon-192.png'));
  console.log('-> public/icons/icon-192.png (192x192)');

  await sharp(src).resize(180, 180).png().toFile(path.join(iconsDir, 'apple-touch-icon.png'));
  console.log('-> public/icons/apple-touch-icon.png (180x180)');

  await sharp(src).resize(32, 32).png().toFile(path.join(iconsDir, 'icon-32.png'));
  console.log('-> public/icons/icon-32.png (32x32)');

  await sharp(src).resize(512, 512).png().toFile(path.join(imageDir, 'SY-z.png'));
  console.log('-> public/image/SY-z.png (512x512)');

  await sharp(src).resize(192, 192).png().toFile(path.join(imageDir, 'SY-Y.png'));
  console.log('-> public/image/SY-Y.png (192x192)');

  // favicon.svg
  const b64 = (await sharp(src).resize(128, 128).png().toBuffer()).toString('base64');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <image href="data:image/png;base64,${b64}" width="128" height="128"/>
</svg>\n`;
  fs.writeFileSync(path.join(root, 'public', 'favicon.svg'), svg, 'utf8');
  console.log('-> public/favicon.svg (embedded data URI)');

  console.log('Done generating all logo assets!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
