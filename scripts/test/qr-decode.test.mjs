// Reads the tracker's QR codes back with a decoder written separately from the encoder (straight from the
// QR specification: format bits, unmasking, zigzag reading, block de-interleaving, Reed-Solomon check, byte mode).
// It cannot replace scanning with a real phone, but it proves the encoder's output is a readable, self-consistent
// QR symbol for every size it can produce.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qrEncode, qrPath } from '../../site/app/calc/qr.js';

// Error correction level L: [ec codewords per block, [data codewords of each block]] for versions 1 to 10.
const BLOCKS = { 1: [7, [19]], 2: [10, [34]], 3: [15, [55]], 4: [20, [80]], 5: [26, [108]], 6: [18, [68, 68]], 7: [20, [78, 78]], 8: [24, [97, 97]], 9: [30, [116, 116]], 10: [18, [68, 68, 69, 69]] };
const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };
const MASK = [
  (r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
];

function decode(m) {
  const size = m.length;
  const version = (size - 17) / 4;
  assert.ok(Number.isInteger(version) && BLOCKS[version], `size ${size} is a valid version`);
  const at = (r, c) => (m[r][c] ? 1 : 0);

  // Format information, first copy: bits 14..0 run down column 8 then along row 8 (skipping the timing lines).
  const cells = [[0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [7, 8], [8, 8], [8, 7], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0]];
  let fmt = 0;
  cells.forEach(([r, c], i) => { fmt |= at(r, c) << i; });
  fmt ^= 0x5412;
  // The 15 bits are a (15,5) BCH code word: check it rather than trust it.
  let rem = fmt;
  for (let i = 14; i >= 10; i--) if ((rem >> i) & 1) rem ^= 0x537 << (i - 10);
  assert.equal(rem, 0, 'format information passes its BCH check');
  assert.equal(fmt >> 13, 1, 'error correction level is L');
  const mask = (fmt >> 10) & 7;
  // Second copy must agree.
  let fmt2 = 0;
  for (let i = 0; i < 8; i++) fmt2 |= at(8, size - 1 - i) << i;
  for (let i = 8; i < 15; i++) fmt2 |= at(size - 15 + i, 8) << i;
  assert.equal(fmt2 ^ 0x5412, fmt, 'both copies of the format information agree');
  assert.equal(at(size - 8, 8), 1, 'the dark module is set');

  // Which modules are not data.
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const mark = (r0, c0, h, w) => { for (let r = r0; r < r0 + h; r++) for (let c = c0; c < c0 + w; c++) if (r >= 0 && c >= 0 && r < size && c < size) fn[r][c] = true; };
  mark(0, 0, 9, 9); mark(0, size - 8, 9, 8); mark(size - 8, 0, 8, 9);
  mark(6, 0, 1, size); mark(0, 6, size, 1);
  const al = ALIGN[version];
  for (const r of al) for (const c of al) {
    if ((r === 6 && c === 6) || (r === 6 && c === al[al.length - 1]) || (r === al[al.length - 1] && c === 6)) continue;
    mark(r - 2, c - 2, 5, 5);
    // An alignment pattern is a 5x5 dark ring around a light ring around a dark centre.
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) assert.equal(at(r + dr, c + dc), Math.max(Math.abs(dr), Math.abs(dc)) === 1 ? 0 : 1, `alignment pattern at ${r},${c}`);
  }
  if (version >= 7) {
    mark(0, size - 11, 6, 3); mark(size - 11, 0, 3, 6);
    let v = 0;
    for (let i = 0; i < 18; i++) v |= at(Math.floor(i / 3), size - 11 + (i % 3)) << i;
    assert.equal(v >> 12, version, 'version information names the right version');
    let vr = v;
    for (let i = 17; i >= 12; i--) if ((vr >> i) & 1) vr ^= 0x1f25 << (i - 12);
    assert.equal(vr, 0, 'version information passes its BCH check');
    let v2 = 0;
    for (let i = 0; i < 18; i++) v2 |= at(size - 11 + (i % 3), Math.floor(i / 3)) << i;
    assert.equal(v2, v, 'both copies of the version information agree');
  }
  // Timing patterns alternate, starting dark.
  for (let i = 8; i < size - 8; i++) { assert.equal(at(6, i), i % 2 === 0 ? 1 : 0); assert.equal(at(i, 6), i % 2 === 0 ? 1 : 0); }

  // Read data modules: two columns at a time from the right, snaking up and down, skipping column 6.
  const bits = [];
  let up = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right--;
    for (let i = 0; i < size; i++) {
      const r = up ? size - 1 - i : i;
      for (const c of [right, right - 1]) if (!fn[r][c]) bits.push(at(r, c) ^ (MASK[mask](r, c) ? 1 : 0));
    }
    up = !up;
  }
  const [ecLen, dataLens] = BLOCKS[version];
  const total = dataLens.reduce((a, b) => a + b, 0) + ecLen * dataLens.length;
  assert.ok(bits.length >= total * 8 && bits.length - total * 8 < 8, 'the symbol holds exactly the expected number of codewords');
  const cw = [];
  for (let i = 0; i < total; i++) cw.push(bits.slice(i * 8, i * 8 + 8).reduce((a, b) => (a << 1) | b, 0));

  // Undo the interleaving.
  const blocks = dataLens.map(() => ({ data: [], ec: [] }));
  let k = 0;
  for (let i = 0; i < Math.max(...dataLens); i++) blocks.forEach((b, j) => { if (i < dataLens[j]) b.data.push(cw[k++]); });
  for (let i = 0; i < ecLen; i++) blocks.forEach((b) => { b.ec.push(cw[k++]); });

  // Reed-Solomon: each block evaluated at the generator's roots must give zero.
  const exp = [];
  let x = 1;
  for (let i = 0; i < 255; i++) { exp.push(x); x <<= 1; if (x & 256) x ^= 0x11d; }
  const log = new Array(256).fill(0);
  exp.forEach((v, i) => { log[v] = i; });
  const mul = (a, b) => (a && b ? exp[(log[a] + log[b]) % 255] : 0);
  for (const b of blocks) for (let root = 0; root < ecLen; root++) {
    let acc = 0;
    for (const byte of [...b.data, ...b.ec]) acc = mul(acc, exp[root]) ^ byte;
    assert.equal(acc, 0, 'a block passes its Reed-Solomon check');
  }

  // Byte mode: 0100, a length, then the bytes.
  const stream = blocks.flatMap((b) => b.data).flatMap((byte) => Array.from({ length: 8 }, (_, i) => (byte >> (7 - i)) & 1));
  const take = (n) => stream.splice(0, n).reduce((a, b) => (a << 1) | b, 0);
  assert.equal(take(4), 4, 'byte mode');
  const count = take(version < 10 ? 8 : 16);
  const bytes = [];
  for (let i = 0; i < count; i++) bytes.push(take(8));
  return { text: new TextDecoder().decode(new Uint8Array(bytes)), version, mask };
}

test('QR codes read back as the text that went in, for every size the encoder can make', () => {
  const versions = new Set();
  const masks = new Set();
  const check = (text) => {
    const qr = qrEncode(text);
    assert.ok(qr, `encodes ${text.length} characters`);
    const out = decode(qr.modules);
    assert.equal(out.text, text);
    assert.equal(out.version, qr.version);
    assert.equal(out.mask, qr.mask);
    versions.add(out.version);
    masks.add(out.mask);
  };
  // Every length from 1 to the largest that fits, with varied content so different masks get chosen.
  for (let n = 1; n <= 271; n++) check(Array.from({ length: n }, (_, i) => String.fromCharCode(33 + ((i * 7 + n * 13) % 90))).join(''));
  // Real pairing links, classic and fine-grained token lengths, plus characters that need escaping.
  check('https://jy00393.github.io/maple-tracker/#pair=ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8');
  check('https://jy00393.github.io/maple-tracker/#pair=github_pat_' + '11ABCDEFG0aBcDeFgHiJkL_' + 'mNoPqRsTuVwXyZ0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJ');
  check('한국어 텍스트와 emoji ✓ %2B&=#');
  check('0'.repeat(100));
  check('ÿ'.repeat(60));
  assert.deepEqual([...versions].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.ok(masks.size >= 4, `several masks were exercised (${[...masks].join(', ')})`);
  assert.equal(qrEncode('x'.repeat(272)), null);
});

test('QR drawing covers exactly the dark modules, with a quiet zone', () => {
  const qr = qrEncode('https://jy00393.github.io/maple-tracker/#pair=ghp_' + 'x'.repeat(36));
  const { d, box } = qrPath(qr, 4);
  assert.equal(box, qr.size + 8);
  const painted = Array.from({ length: box }, () => new Array(box).fill(false));
  for (const m of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) for (let i = 0; i < Number(m[3]); i++) painted[Number(m[2])][Number(m[1]) + i] = true;
  for (let y = 0; y < box; y++) for (let x = 0; x < box; x++) {
    const inside = x >= 4 && y >= 4 && x < box - 4 && y < box - 4;
    assert.equal(painted[y][x], inside ? qr.modules[y - 4][x - 4] : false, `module ${x},${y}`);
  }
});
