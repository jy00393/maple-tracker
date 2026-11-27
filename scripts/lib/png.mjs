// A tiny PNG reader and writer (Node only, no packages): 8-bit RGB or RGBA, not interlaced. Enough for the icons.
import { deflateSync, inflateSync } from 'node:zlib';

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// { width, height, channels (3 or 4), pixels: Uint8Array of width * height * channels }
export function readPng(buf) {
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG');
  let pos = 8;
  let head = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') head = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], colour: data[9], interlace: data[12] };
    if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  if (!head || head.depth !== 8 || head.interlace !== 0 || (head.colour !== 2 && head.colour !== 6)) throw new Error('unsupported PNG');
  const channels = head.colour === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = head.width * channels;
  const out = new Uint8Array(stride * head.height);
  for (let y = 0; y < head.height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= channels ? out[y * stride + x - channels] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels] : 0;
      let p;
      if (filter === 0) p = 0;
      else if (filter === 1) p = a;
      else if (filter === 2) p = b;
      else if (filter === 3) p = (a + b) >> 1;
      else { const q = a + b - c; const pa = Math.abs(q - a); const pb = Math.abs(q - b); const pc = Math.abs(q - c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[y * stride + x] = (v + p) & 255;
    }
  }
  return { width: head.width, height: head.height, channels, pixels: out };
}

export function writePng({ width, height, channels, pixels }) {
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(pixels.buffer, pixels.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = channels === 4 ? 6 : 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// Box-filter resize (each new pixel is the area-weighted average of the old pixels it covers).
export function resize(img, size) {
  const { width, height, channels, pixels } = img;
  const out = new Uint8Array(size * size * channels);
  const sx = width / size;
  const sy = height / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const acc = new Float64Array(channels);
      let total = 0;
      for (let yy = Math.floor(y * sy); yy < Math.ceil((y + 1) * sy); yy++) {
        const wy = Math.min(yy + 1, (y + 1) * sy) - Math.max(yy, y * sy);
        for (let xx = Math.floor(x * sx); xx < Math.ceil((x + 1) * sx); xx++) {
          const w = wy * (Math.min(xx + 1, (x + 1) * sx) - Math.max(xx, x * sx));
          for (let c = 0; c < channels; c++) acc[c] += w * pixels[(yy * width + xx) * channels + c];
          total += w;
        }
      }
      for (let c = 0; c < channels; c++) out[(y * size + x) * channels + c] = Math.round(acc[c] / total);
    }
  }
  return { width: size, height: size, channels, pixels: out };
}
