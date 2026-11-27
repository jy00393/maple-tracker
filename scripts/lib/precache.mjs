// The files the offline worker (site/sw.js) stores when it is installed, so the app opens offline after one
// visit. Built from the code itself: every module reached by following the imports from app/main.js, every
// data file the app fetches ('data/....json' written in a module), and the page shell (index.html, styles.css,
// the manifest and the icons both of them name). scripts/precache.mjs writes the list into sw.js; a test checks
// the two agree, so a new module or data file can never be left out.
import { readFileSync, existsSync } from 'node:fs';
import { join, posix } from 'node:path';

const IMPORT = /\b(?:import|export)\s+(?:[^'"]*?\sfrom\s+)?['"](\.{1,2}\/[^'"]+)['"]/g;
const DATA = /['"`](data\/[a-z0-9_-]+\.json)['"`]/gi;

// Relative module paths (forward slashes) reached from `entry`, entry included.
export function moduleGraph(siteDir, entry = 'app/main.js') {
  const seen = new Set();
  const walk = (rel) => {
    if (seen.has(rel)) return;
    const file = join(siteDir, rel);
    if (!existsSync(file)) throw new Error(`${rel} is imported but does not exist`);
    seen.add(rel);
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(IMPORT)) walk(posix.normalize(posix.join(posix.dirname(rel), m[1])));
  };
  walk(entry);
  return [...seen].sort();
}

// The data files the given modules name.
export function dataFiles(siteDir, modules) {
  const out = new Set();
  for (const rel of modules) for (const m of readFileSync(join(siteDir, rel), 'utf8').matchAll(DATA)) out.add(m[1]);
  return [...out].sort();
}

// Icons and the manifest named by index.html and the manifest.
export function shellFiles(siteDir) {
  const out = new Set(['./', 'index.html', 'styles.css']);
  const page = readFileSync(join(siteDir, 'index.html'), 'utf8');
  for (const m of page.matchAll(/<link\b[^>]*\bhref="([^"]+)"/g)) if (!/^[a-z]+:|^\/\//i.test(m[1])) out.add(m[1]);
  const manifest = JSON.parse(readFileSync(join(siteDir, 'manifest.webmanifest'), 'utf8'));
  for (const icon of manifest.icons || []) out.add(icon.src);
  return [...out];
}

export function precacheList(siteDir) {
  const modules = moduleGraph(siteDir);
  const shell = shellFiles(siteDir);
  return [...shell, ...modules, ...dataFiles(siteDir, modules)].map((p) => (p === './' ? p : './' + p.replace(/^\.\//, '')))
    .filter((p, i, all) => all.indexOf(p) === i);
}

// The list as written in sw.js, between the two marker lines.
export const START = '// precache:start (written by scripts/precache.mjs; do not edit by hand)';
export const END = '// precache:end';
export function precacheBlock(list) {
  return `${START}\nconst PRECACHE = [\n${list.map((p) => `  '${p}'`).join(',\n')}\n];\n${END}`;
}
// The block as it stands in the file (a Windows checkout may have \r\n line ends), or null.
export function rawBlock(swSource) {
  const a = swSource.indexOf(START);
  const b = swSource.indexOf(END);
  if (a < 0 || b < a) return null;
  return swSource.slice(a, b + END.length);
}
// The same with plain \n line ends, to compare with precacheBlock.
export function readBlock(swSource) {
  const raw = rawBlock(swSource);
  return raw === null ? null : raw.replace(/\r\n/g, '\n');
}
