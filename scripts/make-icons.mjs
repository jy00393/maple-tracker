// Makes the phone icons from the square, opaque artwork in site/icons/icon-maskable-512.png (Node only):
// - apple-touch-icon.png, 180x180: iPhone home screen. iOS fills see-through corners with black, so it must be
//   opaque; iOS rounds the corners itself.
// - icon-maskable-192.png: Android's smaller adaptive icon (the 512 one is already there).
// Run: node scripts/make-icons.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readPng, resize, writePng } from './lib/png.mjs';

const icons = fileURLToPath(new URL('../site/icons/', import.meta.url));
const art = readPng(readFileSync(icons + 'icon-maskable-512.png'));
if (art.channels !== 3) throw new Error('the artwork must be opaque (RGB)');
// The maskable artwork keeps the leaf inside the middle 80% (Android may cut the rest). iOS only rounds the
// corners, so the iPhone icon uses that middle part and the leaf is drawn as large as on the other icons.
function middle(img, share) {
  const side = Math.round(img.width * share);
  const off = Math.round((img.width - side) / 2);
  const px = new Uint8Array(side * side * img.channels);
  for (let y = 0; y < side; y++) {
    const from = ((y + off) * img.width + off) * img.channels;
    px.set(img.pixels.subarray(from, from + side * img.channels), y * side * img.channels);
  }
  return { width: side, height: side, channels: img.channels, pixels: px };
}
for (const [name, size, src] of [['apple-touch-icon.png', 180, middle(art, 0.8)], ['icon-maskable-192.png', 192, art]]) {
  writeFileSync(icons + name, writePng(resize(src, size)));
  console.log(`wrote site/icons/${name} (${size}x${size})`);
}
