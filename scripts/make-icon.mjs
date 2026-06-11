// Rasterize packages/app/build/icon.svg into a macOS .iconset (PNG set) + a 1024 PNG.
// Then run `iconutil -c icns -o build/icon.icns build/icon.iconset` to produce the .icns.
// Usage: node scripts/make-icon.mjs   (run from repo root)
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve relative to this script (scripts/) so it works from any cwd.
const here = fileURLToPath(new URL('.', import.meta.url));
const buildDir = resolve(here, '../packages/app/build');
const svg = readFileSync(resolve(buildDir, 'icon.svg'), 'utf8');
const iconset = resolve(buildDir, 'icon.iconset');

const png = (size) =>
  new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();

rmSync(iconset, { recursive: true, force: true });
mkdirSync(iconset, { recursive: true });

for (const s of [16, 32, 128, 256, 512]) {
  writeFileSync(resolve(iconset, `icon_${s}x${s}.png`), png(s));
  writeFileSync(resolve(iconset, `icon_${s}x${s}@2x.png`), png(s * 2));
}
writeFileSync(resolve(buildDir, 'icon.png'), png(1024));     // Linux / fallback
writeFileSync(resolve(buildDir, 'icon-preview.png'), png(512)); // for eyeballing

console.log('Wrote iconset + icon.png');
