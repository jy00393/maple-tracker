// Writes the offline worker's pre-cache list into site/sw.js (see scripts/lib/precache.mjs).
// Run after adding a module, a data file or an icon: node scripts/precache.mjs
// With --check it only says whether sw.js is up to date (exit code 1 when it is not).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { precacheBlock, precacheList, rawBlock, readBlock } from './lib/precache.mjs';

const site = fileURLToPath(new URL('../site/', import.meta.url));
const swPath = site + 'sw.js';
const src = readFileSync(swPath, 'utf8');
const old = readBlock(src);
if (old === null) { console.error('sw.js has no precache markers'); process.exit(1); }
const next = precacheBlock(precacheList(site));
if (process.argv.includes('--check')) {
  console.log(old === next ? 'sw.js pre-cache list is up to date' : 'sw.js pre-cache list is out of date: run node scripts/precache.mjs');
  process.exit(old === next ? 0 : 1);
}
// Keeps the file's own line ends.
const eol = src.includes('\r\n') ? '\r\n' : '\n';
if (old !== next) writeFileSync(swPath, src.replace(rawBlock(src), next.replace(/\n/g, eol)));
console.log(old === next ? 'No change' : 'Updated the pre-cache list in sw.js');
