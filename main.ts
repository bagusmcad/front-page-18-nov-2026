// The World — Wednesday 18 November 2026
// A one-page newspaper front page drawn entirely by code.
// Node 22, standard library only (node:fs, node:zlib, node:path), no network.
// The program renders a 1024x1024 PNG with its own software rasterizer, its own
// 7x10 serif-style bitmap font (designed for this entry), thirteen small vector
// illustrations, a world map with numbered pins, and a 30-story digest — then
// writes it to /output/entry.png. Output is fully deterministic: same bytes
// every run (fixed zlib level, filter 0 on every scanline, no time, no random).

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

// ---------------------------------------------------------------------------
// Framebuffer and rasterizer
// ---------------------------------------------------------------------------

const W = 1024;
const H = 1024;
const fb = new Uint8Array(W * H * 3);

type RGB = [number, number, number];
const PAPER: RGB = [246, 241, 227];
const INK: RGB = [20, 20, 20];
const RED: RGB = [163, 22, 33];
const NAVY: RGB = [31, 58, 95];
const GREY: RGB = [110, 108, 100];
const LIGHTGREY: RGB = [210, 205, 190];
const SKY: RGB = [168, 205, 228];
const SEA: RGB = [143, 188, 216];
const SAND: RGB = [232, 214, 170];
const LAND: RGB = [224, 206, 158];
const GREEN: RGB = [46, 125, 50];
const GOLD: RGB = [192, 122, 18];
const PURPLE: RGB = [122, 63, 160];
const TEAL: RGB = [13, 125, 122];
const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];

function setPx(x: number, y: number, c: RGB): void {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  fb[i] = c[0];
  fb[i + 1] = c[1];
  fb[i + 2] = c[2];
}

function fillRect(x: number, y: number, w: number, h: number, c: RGB): void {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(W, Math.ceil(x + w));
  const y1 = Math.min(H, Math.ceil(y + h));
  for (let yy = y0; yy < y1; yy++) {
    let i = (yy * W + x0) * 3;
    for (let xx = x0; xx < x1; xx++) {
      fb[i] = c[0];
      fb[i + 1] = c[1];
      fb[i + 2] = c[2];
      i += 3;
    }
  }
}

function fillCircle(cx: number, cy: number, r: number, c: RGB): void {
  const r2 = r * r;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) setPx(x, y, c);
    }
  }
}

function ring(cx: number, cy: number, r: number, t: number, c: RGB): void {
  for (let a = 0; a < 360; a += 1) {
    const rad = (a * Math.PI) / 180;
    for (let k = 0; k < t; k++) {
      setPx(Math.round(cx + (r + k) * Math.cos(rad)), Math.round(cy + (r + k) * Math.sin(rad)), c);
    }
  }
}

// Bresenham line, thickness t (square brush). Inputs are rounded first:
// with float endpoints the x===x1 test could never become true.
function line(x0: number, y0: number, x1: number, y1: number, c: RGB, t = 1): void {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;
  const half = Math.floor(t / 2);
  for (;;) {
    for (let oy = -half; oy <= half; oy++)
      for (let ox = -half; ox <= half; ox++) setPx(x + ox, y + oy, c);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}

// Filled polygon (scanline fill). pts: [[x,y],...]
function poly(pts: number[][], c: RGB): void {
  if (pts.length < 3) return;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  for (let y = Math.ceil(minY); y <= Math.floor(maxY); y++) {
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
        const t = (y - a[1]) / (b[1] - a[1]);
        xs.push(a[0] + t * (b[0] - a[0]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.ceil(xs[k]); x <= Math.floor(xs[k + 1]); x++) setPx(x, y, c);
    }
  }
}

function tri(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: RGB): void {
  poly(
    [
      [x0, y0],
      [x1, y1],
      [x2, y2],
    ],
    c
  );
}

// Horizontal rule with a thin double line, like a newspaper column rule.
function rule(x: number, y: number, w: number, c: RGB = INK, weight = 1): void {
  fillRect(x, y, w, weight, c);
  fillRect(x, y + weight + 2, w, 1, c);
}

function box(x: number, y: number, w: number, h: number, c: RGB, border: RGB = INK, bw = 1): void {
  fillRect(x, y, w, h, c);
  fillRect(x, y, w, bw, border);
  fillRect(x, y + h - bw, w, bw, border);
  fillRect(x, y, bw, h, border);
  fillRect(x + w - bw, y, bw, h, border);
}

// ---------------------------------------------------------------------------
// PNG encoder (deterministic: zlib level 6, filter 0 on every scanline)
// ---------------------------------------------------------------------------

const CRC_TABLE: number[] = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

function encodePng(): Buffer {
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0; // filter type 0
    raw.set(fb.subarray(y * W * 3, (y + 1) * W * 3), y * (1 + W * 3) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = zlib.deflateSync(raw, { level: 6 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Bitmap font — 7 wide x 10 tall, serif style, designed for this entry.
// Each glyph is 10 rows of 7 cells ('#' = ink). Cap height rows 0-8, baseline
// row 9 carries the serif feet. Lowercase x-height is rows 3-8, descenders
// reach row 9. Proportional advances: advance = rightmost ink column + 2.
// ---------------------------------------------------------------------------

const FONT: Record<string, string[]> = {
  A: [
    ".#####.",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    "#######",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
  ],
  B: [
    "######.",
    "##...##",
    "##...##",
    "##...##",
    "######.",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    "######.",
  ],
  C: [
    ".#####.",
    "##...##",
    "##.....",
    "##.....",
    "##.....",
    "##.....",
    "##.....",
    "##.....",
    "##...##",
    ".#####.",
  ],
  D: [
    "#####..",
    "##..##.",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    "##..##.",
    "#####..",
  ],
  E: [
    "#######",
    "##.....",
    "##.....",
    "##.....",
    "#####..",
    "##.....",
    "##.....",
    "##.....",
    "##.....",
    "#######",
  ],
  F: [
    "#######",
    "##.....",
    "##.....",
    "##.....",
    "#####..",
    "##.....",
    "##.....",
    "##.....",
    "##.....",
    "##.....",
  ],
  G: [
    ".#####.",
    "##...##",
    "##.....",
    "##.....",
    "##..###",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    ".####.#",
  ],
  H: [
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    "#######",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
  ],
  I: [
    ".#####.",
    "...##..",
    "...##..",
    "...##..",
    "...##..",
    "...##..",
    "...##..",
    "...##..",
    "...##..",
    ".#####.",
  ],
  J: [
    "..#####",
    ".....##",
    ".....##",
    ".....##",
    ".....##",
    ".....##",
    ".....##",
    "##...##",
    "##...##",
    ".#####.",
  ],
  K: [
    "##...##",
    "##..##.",
    "##.##..",
    "####...",
    "####...",
    "##.##..",
    "##..##.",
    "##...##",
    "##...##",
    "##...##",
  ],
  L: [
    "##.....",
    "##.....",
    "##.....",
    "##.....",
    "##.....",
    "##.....",
    "##.....",
    "##.....",
    "##.....",
    "#######",
  ],
  M: [
    "##...##",
    "###.###",
    "#######",
    "#######",
    "##.#.##",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
  ],
  N: [
    "##...##",
    "###..##",
    "####.##",
    "#######",
    "##.####",
    "##..###",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
  ],
  O: [
    ".#####.",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    ".#####.",
  ],
  P: [
    "######.",
    "##...##",
    "##...##",
    "##...##",
    "######.",
    "##.....",
    "##.....",
    "##.....",
    "##.....",
    "##.....",
  ],
  Q: [
    ".#####.",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    "##.#.##",
    "##..##.",
    ".####.#",
  ],
  R: [
    "######.",
    "##...##",
    "##...##",
    "##...##",
    "######.",
    "##.##..",
    "##..##.",
    "##...##",
    "##...##",
    "##...##",
  ],
  S: [
    ".#####.",
    "##...##",
    "##.....",
    "##.....",
    ".####..",
    ".....##",
    ".....##",
    ".....##",
    "##...##",
    ".#####.",
  ],
  T: [
    "#######",
    "...##..",
    "...##..",
    "...##..",
    "...##..",
    "...##..",
    "...##..",
    "...##..",
    "...##..",
    "...##..",
  ],
  U: [
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    ".#####.",
  ],
  V: [
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    ".##.##.",
    ".##.##.",
    "..###..",
    "..###..",
  ],
  W: [
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    "##.#.##",
    "#######",
    "#######",
    "###.###",
    "##...##",
  ],
  X: [
    "##...##",
    "##...##",
    ".##.##.",
    "..###..",
    "..###..",
    "..###..",
    ".##.##.",
    "##...##",
    "##...##",
    "##...##",
  ],
  Y: [
    "##...##",
    "##...##",
    ".##.##.",
    "..###..",
    "..###..",
    "...##..",
    "...##..",
    "...##..",
    "...##..",
    "...##..",
  ],
  Z: [
    "#######",
    ".....##",
    "....##.",
    "....##.",
    "...##..",
    "..##...",
    ".##....",
    ".##....",
    "##.....",
    "#######",
  ],
};

Object.assign(FONT, {
  a: [
    ".......",
    ".......",
    ".......",
    ".####..",
    "....##.",
    ".#####.",
    "##..##.",
    "##..##.",
    ".###.#.",
    ".......",
  ],
  b: [
    "##.....",
    "##.....",
    "##.....",
    "#####..",
    "##..##.",
    "##...##",
    "##...##",
    "##...##",
    "##..##.",
    "#####..",
  ],
  c: [
    ".......",
    ".......",
    ".......",
    ".####..",
    "##..##.",
    "##.....",
    "##.....",
    "##.....",
    "##..##.",
    ".####..",
  ],
  d: [
    ".....##",
    ".....##",
    ".....##",
    ".#####.",
    "##..##.",
    "##...##",
    "##...##",
    "##...##",
    "##..##.",
    ".#####.",
  ],
  e: [
    ".......",
    ".......",
    ".......",
    ".####..",
    "##..##.",
    "#######",
    "##.....",
    "##.....",
    "##..##.",
    ".####..",
  ],
  f: [
    "...##..",
    "..##...",
    "..##...",
    ".####..",
    "..##...",
    "..##...",
    "..##...",
    "..##...",
    "..##...",
    "..##...",
  ],
  g: [
    ".......",
    ".......",
    ".......",
    ".#####.",
    "##..##.",
    "##...##",
    "##...##",
    "##..##.",
    ".#####.",
    "....##.",
  ],
  h: [
    "##.....",
    "##.....",
    "##.....",
    "#####..",
    "##..##.",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
  ],
  i: [
    ".......",
    "...##..",
    ".......",
    "..###..",
    "...##..",
    "...##..",
    "...##..",
    "...##..",
    "...##..",
    "..###..",
  ],
  j: [
    ".......",
    "....##.",
    ".......",
    "...###.",
    "....##.",
    "....##.",
    "....##.",
    "....##.",
    "##..##.",
    ".####..",
  ],
  k: [
    "##.....",
    "##.....",
    "##.....",
    "##..##.",
    "##.##..",
    "####...",
    "##.##..",
    "##..##.",
    "##...##",
    "##...##",
  ],
  l: [
    "..###..",
    "...##..",
    "...##..",
    "...##..",
    "...##..",
    "...##..",
    "...##..",
    "...##..",
    "...##..",
    "..###..",
  ],
  m: [
    ".......",
    ".......",
    ".......",
    "##.##..",
    "#######",
    "#######",
    "##.#.##",
    "##.#.##",
    "##...##",
    "##...##",
  ],
  n: [
    ".......",
    ".......",
    ".......",
    "#####..",
    "##..##.",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
  ],
  o: [
    ".......",
    ".......",
    ".......",
    ".####..",
    "##..##.",
    "##...##",
    "##...##",
    "##...##",
    "##..##.",
    ".####..",
  ],
  p: [
    ".......",
    ".......",
    ".......",
    "#####..",
    "##..##.",
    "##...##",
    "##...##",
    "##..##.",
    "#####..",
    "##.....",
  ],
  q: [
    ".......",
    ".......",
    ".......",
    ".#####.",
    "##..##.",
    "##...##",
    "##...##",
    "##..##.",
    ".#####.",
    ".....##",
  ],
  r: [
    ".......",
    ".......",
    ".......",
    "##.##..",
    "##..##.",
    "##.....",
    "##.....",
    "##.....",
    "##.....",
    "##.....",
  ],
  s: [
    ".......",
    ".......",
    ".......",
    ".####..",
    "##..##.",
    "##.....",
    ".###...",
    "....##.",
    "##..##.",
    ".####..",
  ],
  t: [
    "...##..",
    "...##..",
    "...##..",
    ".####..",
    "...##..",
    "...##..",
    "...##..",
    "...##..",
    "...##..",
    "....##.",
  ],
  u: [
    ".......",
    ".......",
    ".......",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    "##..##.",
    ".####.#",
  ],
  v: [
    ".......",
    ".......",
    ".......",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    ".##.##.",
    ".##.##.",
    "..###..",
  ],
  w: [
    ".......",
    ".......",
    ".......",
    "##...##",
    "##...##",
    "##...##",
    "##.#.##",
    "#######",
    "#######",
    "##...##",
  ],
  x: [
    ".......",
    ".......",
    ".......",
    "##...##",
    "##...##",
    ".##.##.",
    "..###..",
    ".##.##.",
    "##...##",
    "##...##",
  ],
  y: [
    ".......",
    ".......",
    ".......",
    "##...##",
    "##...##",
    "##...##",
    ".##.##.",
    "..###..",
    "...##..",
    "..##...",
  ],
  z: [
    ".......",
    ".......",
    ".......",
    "#######",
    "....##.",
    "...##..",
    "..##...",
    ".##....",
    "##.....",
    "#######",
  ],
  "0": [
    ".#####.",
    "##...##",
    "##..###",
    "##.##.#",
    "###..##",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    ".#####.",
  ],
  "1": [
    "...##..",
    "..###..",
    ".####..",
    "...##..",
    "...##..",
    "...##..",
    "...##..",
    "...##..",
    "...##..",
    "..####.",
  ],
  "2": [
    ".#####.",
    "##...##",
    ".....##",
    "....##.",
    "...##..",
    "..##...",
    ".##....",
    "##.....",
    "##.....",
    "#######",
  ],
  "3": [
    "#####..",
    "....##.",
    "....##.",
    "....##.",
    ".####..",
    "....##.",
    "....##.",
    "....##.",
    "##...##",
    ".####..",
  ],
  "4": [
    "....##.",
    "...###.",
    "..##.#.",
    ".##..##",
    "##...##",
    "#######",
    "....##.",
    "....##.",
    "....##.",
    "....##.",
  ],
  "5": [
    "#######",
    "##.....",
    "##.....",
    "#####..",
    "....##.",
    "....##.",
    "....##.",
    "....##.",
    "##...##",
    ".####..",
  ],
  "6": [
    ".#####.",
    "##.....",
    "##.....",
    "##.....",
    "#####..",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    ".#####.",
  ],
  "7": [
    "#######",
    ".....##",
    "....##.",
    "....##.",
    "...##..",
    "...##..",
    "..##...",
    "..##...",
    "..##...",
    "..##...",
  ],
  "8": [
    ".#####.",
    "##...##",
    "##...##",
    "##...##",
    ".#####.",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    ".#####.",
  ],
  "9": [
    ".#####.",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    ".#####.",
    ".....##",
    ".....##",
    ".....##",
    ".####..",
  ],
  " ": [
    ".......",
    ".......",
    ".......",
    ".......",
    ".......",
    ".......",
    ".......",
    ".......",
    ".......",
    ".......",
  ],
  ".": [
    ".......",
    ".......",
    ".......",
    ".......",
    ".......",
    ".......",
    ".......",
    ".......",
    "..##...",
    "..##...",
  ],
  ",": [
    ".......",
    ".......",
    ".......",
    ".......",
    ".......",
    ".......",
    ".......",
    ".......",
    "..##...",
    ".##....",
  ],
  ":": [
    ".......",
    ".......",
    ".......",
    "..##...",
    "..##...",
    ".......",
    ".......",
    "..##...",
    "..##...",
    ".......",
  ],
  ";": [
    ".......",
    ".......",
    ".......",
    "..##...",
    "..##...",
    ".......",
    ".......",
    "..##...",
    "..##...",
    ".##....",
  ],
  "!": [
    "..##...",
    "..##...",
    "..##...",
    "..##...",
    "..##...",
    "..##...",
    "..##...",
    "..##...",
    ".......",
    "..##...",
  ],
  "?": [
    ".####..",
    "##..##.",
    "....##.",
    "...##..",
    "..##...",
    "..##...",
    ".......",
    "..##...",
    "..##...",
    ".......",
  ],
  "'": [
    "..##...",
    "..##...",
    "..#....",
    ".......",
    ".......",
    ".......",
    ".......",
    ".......",
    ".......",
    ".......",
  ],
  '"': [
    ".##.##.",
    ".##.##.",
    ".##.##.",
    ".......",
    ".......",
    ".......",
    ".......",
    ".......",
    ".......",
    ".......",
  ],
  "(": [
    "....##.",
    "...##..",
    "..##...",
    "..##...",
    "..##...",
    "..##...",
    "..##...",
    "..##...",
    "...##..",
    "....##.",
  ],
  ")": [
    ".##....",
    "..##...",
    "...##..",
    "...##..",
    "...##..",
    "...##..",
    "...##..",
    "...##..",
    "..##...",
    ".##....",
  ],
  "-": [
    ".......",
    ".......",
    ".......",
    ".......",
    ".####..",
    ".####..",
    ".......",
    ".......",
    ".......",
    ".......",
  ],
  "–": [
    ".......",
    ".......",
    ".......",
    ".......",
    "#######",
    "#######",
    ".......",
    ".......",
    ".......",
    ".......",
  ],
  "&": [
    ".###...",
    "##.##..",
    "##..##.",
    ".##....",
    "..###..",
    ".##.##.",
    "##..##.",
    "##..##.",
    "##.###.",
    ".##..##",
  ],
  "%": [
    "##...##",
    "##..##.",
    "##..##.",
    "....##.",
    "...##..",
    "..##...",
    ".##....",
    "##..##.",
    "##..##.",
    "##...##",
  ],
  "$": [
    "...##..",
    ".#####.",
    "##.##..",
    "##.....",
    ".####..",
    "....##.",
    "##..##.",
    ".#####.",
    "...##..",
    "...##..",
  ],
  "/": [
    ".....##",
    ".....##",
    "....##.",
    "....##.",
    "...##..",
    "...##..",
    "..##...",
    "..##...",
    ".##....",
    ".##....",
  ],
  "+": [
    ".......",
    ".......",
    "...##..",
    "...##..",
    ".#####.",
    ".#####.",
    "...##..",
    "...##..",
    ".......",
    ".......",
  ],
  "=": [
    ".......",
    ".......",
    ".......",
    ".......",
    "#######",
    ".......",
    "#######",
    ".......",
    ".......",
    ".......",
  ],
  "#": [
    ".##.##.",
    ".##.##.",
    ".##.##.",
    "#######",
    ".##.##.",
    ".##.##.",
    "#######",
    ".##.##.",
    ".##.##.",
    ".##.##.",
  ],
  "*": [
    ".......",
    ".......",
    "##...##",
    ".##.##.",
    "..###..",
    "#######",
    "..###..",
    ".##.##.",
    "##...##",
    ".......",
  ],
  "·": [
    ".......",
    ".......",
    ".......",
    ".......",
    "..##...",
    "..##...",
    ".......",
    ".......",
    ".......",
    ".......",
  ],
  "×": [
    ".......",
    ".......",
    ".......",
    "##...##",
    ".##.##.",
    "..###..",
    ".##.##.",
    "##...##",
    ".......",
    ".......",
  ],
});

// Width of one glyph in font columns (0..7), for proportional layout.
// A space is 3 columns wide: with only 1 column of advance, words ran
// together at every scale.
function glyphWidth(ch: string): number {
  if (ch === " ") return 3;
  const g = FONT[ch];
  if (!g) return 7;
  let w = 0;
  for (const row of g)
    for (let i = 0; i < 7; i++) if (row[i] === "#") w = Math.max(w, i + 1);
  return w;
}

function textWidth(s: string, scale: number): number {
  let w = 0;
  for (const ch of s) w += (glyphWidth(ch) + 1) * scale;
  return w - 1 * scale;
}

// Draw one glyph at (x, y) — top-left of the 7x10 cell, scaled.
function drawGlyph(x: number, y: number, ch: string, scale: number, c: RGB): void {
  const g = FONT[ch];
  if (!g) return;
  for (let r = 0; r < 10; r++) {
    const row = g[r];
    for (let col = 0; col < 7; col++) {
      if (row[col] !== "#") continue;
      if (scale === 1) setPx(x + col, y + r, c);
      else fillRect(x + col * scale, y + r * scale, scale, scale, c);
    }
  }
}

// Draw text left-aligned at (x, y). Returns the width drawn.
function drawText(x: number, y: number, s: string, scale: number, c: RGB): number {
  let cx = x;
  for (const ch of s) {
    drawGlyph(cx, y, ch, scale, c);
    cx += (glyphWidth(ch) + 1) * scale;
  }
  return cx - x - 1 * scale;
}

// Draw text centred on cx.
function drawTextC(cx: number, y: number, s: string, scale: number, c: RGB): number {
  const w = textWidth(s, scale);
  return drawText(Math.round(cx - w / 2), y, s, scale, c);
}

// Draw text right-aligned to rx.
function drawTextR(rx: number, y: number, s: string, scale: number, c: RGB): number {
  const w = textWidth(s, scale);
  return drawText(rx - w, y, s, scale, c);
}

// Word-wrap a paragraph into lines no wider than maxW (in pixels).
function wrap(s: string, scale: number, maxW: number): string[] {
  const words = s.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? cur + " " + w : w;
    if (textWidth(test, scale) <= maxW) {
      cur = test;
    } else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Draw a wrapped paragraph; returns the y just below the last line.
function drawPara(x: number, y: number, s: string, scale: number, c: RGB, maxW: number, lh: number): number {
  const lines = wrap(s, scale, maxW);
  let yy = y;
  for (const ln of lines) {
    drawText(x, yy, ln, scale, c);
    yy += lh;
  }
  return yy;
}

// Small caps kicker: draw uppercase text at scale 1 with letter spacing.
function kicker(x: number, y: number, s: string, c: RGB): number {
  return drawText(x, y, s.toUpperCase(), 1, c);
}

// A numbered badge: filled circle with a white number.
function badge(cx: number, cy: number, n: number, c: RGB, r = 8): void {
  fillCircle(cx, cy, r, c);
  ring(cx, cy, r, 1, WHITE);
  const s = String(n);
  const w = textWidth(s, 1);
  drawText(cx - Math.round(w / 2), cy - 5, s, 1, WHITE);
}

// ---------------------------------------------------------------------------
// The day's news — Wednesday 18 November 2026.
// Every story below happened, or was first reported, on 18 November 2026
// (cross-checked against Reuters, AP, CNN, BBC, Al Jazeera, WHO and UN
// reporting carried by One Turn, Zark News, Horizon, Teh World News and
// the Associated Press on the day). Nothing is invented; contested claims
// are marked as claims. Numbers are as reported that day.
// ---------------------------------------------------------------------------

type Region = "Americas" | "Europe" | "Middle East" | "Asia" | "Africa" | "Oceania" | "Global";
const REGION_COLOR: Record<Region, RGB> = {
  Americas: [192, 57, 43],
  Europe: [44, 90, 160],
  "Middle East": [192, 122, 18],
  Asia: [122, 63, 160],
  Africa: [46, 125, 50],
  Oceania: [13, 125, 122],
  Global: [85, 85, 85],
};

interface Story {
  n: number;
  region: Region;
  place: string;
  kicker: string;
  headline: string;
  deck: string;
  art: string;
  lon: number;
  lat: number;
}

const BIG: Story[] = [
  {
    n: 1,
    region: "Middle East",
    place: "Qeshm Island, Iran",
    kicker: "THE GULF - WAR",
    headline: "US jets strike Qeshm; Iran hits Bahrain and Kuwait",
    deck: "US fighter jets hit a Revolutionary Guard missile site on Qeshm Island after Iran fired drones at a US radar in Bahrain, its third attack in five days. Iran then fired at Kuwait; an ADNOC vessel was hit, 11 hurt.",
    art: "gulf",
    lon: 56.3,
    lat: 26.6,
  },
  {
    n: 2,
    region: "Asia",
    place: "Shenzhen, China",
    kicker: "ASIA - APEC SUMMIT",
    headline: "Xi and Putin open APEC; Trump due for three-way talks",
    deck: "China's Xi Jinping and Russia's Vladimir Putin opened the APEC summit in Shenzhen, Xi urging free trade and Putin denouncing Western sanctions, a day before their planned meeting with President Trump.",
    art: "apec",
    lon: 114.1,
    lat: 22.5,
  },
  {
    n: 3,
    region: "Americas",
    place: "Alaska, US",
    kicker: "US - SENATE",
    headline: "Peltola flips Alaska; Democrats take 56 Senate seats",
    deck: "Democrat Mary Peltola defeated Republican Dan Sullivan in Alaska's Senate race, giving Democrats a 56-44 majority - their largest since 2009 and a ninth Senate flip of the midterms.",
    art: "senate",
    lon: -152,
    lat: 64,
  },
];

const SMALL: Story[] = [
  {
    n: 4,
    region: "Europe",
    place: "Kerch Strait",
    kicker: "UKRAINE - WAR",
    headline: "Kerch Bridge hit for a second day",
    deck: "Second day of strikes; a road span fell.",
    art: "kerch",
    lon: 36.5,
    lat: 45.3,
  },
  {
    n: 5,
    region: "Africa",
    place: "DR Congo",
    kicker: "AFRICA - HEALTH",
    headline: "Ebola in DR Congo passes 11,000 cases",
    deck: "Over 11,000 cases and 5,400 deaths, the UN said.",
    art: "ebola",
    lon: 25,
    lat: -2.5,
  },
  {
    n: 6,
    region: "Americas",
    place: "Santa Clara, US",
    kicker: "US - BUSINESS",
    headline: "Nvidia sales double to $115.8bn",
    deck: "$115.8bn in sales, more than double a year earlier.",
    art: "nvidia",
    lon: -122,
    lat: 37.4,
  },
  {
    n: 7,
    region: "Americas",
    place: "United States",
    kicker: "US - HEALTH",
    headline: "US loses measles-free status after 26 years",
    deck: "Measles-free status lost after 26 years; 5,412 cases.",
    art: "measles",
    lon: -98,
    lat: 39.5,
  },
  {
    n: 8,
    region: "Global",
    place: "Deep space",
    kicker: "SPACE",
    headline: "Voyager 1 reaches one light-day from Earth",
    deck: "One light-day out - 16 billion miles, a first.",
    art: "voyager",
    lon: -118.2,
    lat: 34.2,
  },
  {
    n: 9,
    region: "Oceania",
    place: "Cook Islands",
    kicker: "PACIFIC - WEATHER",
    headline: "Category 5 Cyclone Xavier hits Cook Islands",
    deck: "Category 5 over the Northern Cook Islands.",
    art: "cyclone",
    lon: -160,
    lat: -21,
  },
  {
    n: 10,
    region: "Americas",
    place: "Washington, US",
    kicker: "US - TECHNOLOGY",
    headline: "Tech outages hit US banks and the NSA",
    deck: "NSA network down, the latest of eight US outages.",
    art: "outages",
    lon: -77,
    lat: 38.9,
  },
  {
    n: 11,
    region: "Europe",
    place: "Kemerovo, Russia",
    kicker: "RUSSIA - AIR CRASH",
    headline: "Russian An-12 crashes in Siberia",
    deck: "Russian An-12 crashes in Kemerovo; all 19 killed.",
    art: "crash",
    lon: 87,
    lat: 55.4,
  },
  {
    n: 12,
    region: "Middle East",
    place: "Gaza",
    kicker: "MIDDLE EAST - GAZA",
    headline: "Gaza ceasefire may collapse",
    deck: "The Board of Peace warns the ceasefire may collapse.",
    art: "gaza",
    lon: 34.5,
    lat: 31.5,
  },
  {
    n: 13,
    region: "Europe",
    place: "The Hague",
    kicker: "WORLD COURT - JUSTICE",
    headline: "World Court to rule on Myanmar genocide case",
    deck: "The court rules Thursday on Myanmar.",
    art: "icj",
    lon: 4.3,
    lat: 52.1,
  },
];

interface DigestItem {
  n: number;
  region: Region;
  text: string;
  lon: number;
  lat: number;
}

const DIGEST: DigestItem[] = [
  { n: 14, region: "Europe", text: "Russia fires 141 drones; 126 downed", lon: 31.5, lat: 50.8 },
  { n: 15, region: "Europe", text: "165 battles in a day; Pokrovsk hottest", lon: 38.5, lat: 48.8 },
  { n: 16, region: "Europe", text: "US scolds Kyiv on deep strikes", lon: 12, lat: 54 },
  { n: 17, region: "Middle East", text: "Knesset elects Matan Kahana speaker, 66-52", lon: 35.2, lat: 31.8 },
  { n: 18, region: "Middle East", text: "Iran says it downed a US MQ-9 near Hormuz", lon: 57.5, lat: 26.8 },
  { n: 19, region: "Americas", text: "Trump weighs Iran dirty-bomb report", lon: -78.5, lat: 39.5 },
  { n: 20, region: "Americas", text: "Stocks fall; S&P 500 down 1.03%", lon: -74, lat: 40.7 },
  { n: 21, region: "Europe", text: "France: 140,000 join pay protests", lon: 1, lat: 49.5 },
  { n: 22, region: "Europe", text: "Serbia's student list takes parliament", lon: 22, lat: 45.5 },
  { n: 23, region: "Europe", text: "Turkey seizes opposition TV Sozcu", lon: 30, lat: 41.5 },
  { n: 24, region: "Europe", text: "Moldova shuts airspace after drone", lon: 29.5, lat: 47.5 },
  { n: 25, region: "Europe", text: "Romania: 5.3 quake felt in Moldova", lon: 26, lat: 46.5 },
  { n: 26, region: "Oceania", text: "Papua New Guinea: 6.0 quake strikes", lon: 147, lat: -6.3 },
  { n: 27, region: "Africa", text: "Five EU states plan Rwanda return hubs", lon: 30.1, lat: -1.9 },
  { n: 28, region: "Americas", text: "27 years for Iran-linked plot on Trump", lon: -73, lat: 41.3 },
  { n: 29, region: "Europe", text: "US soldier held in UK moved to US custody", lon: -1.5, lat: 52 },
  { n: 30, region: "Middle East", text: "Houthis press toward Aden", lon: 45, lat: 12.8 },
  { n: 31, region: "Africa", text: "Clashes near Eritrea raise war fears", lon: 39.5, lat: 13.5 },
  { n: 32, region: "Asia", text: "South Korea lifts 2027 growth to 3.9%", lon: 127, lat: 37.5 },
  { n: 33, region: "Asia", text: "France-Malaysia pact on rare earths", lon: 101.7, lat: 3.1 },
  { n: 34, region: "Americas", text: "Brazil real falls on Lula fiscal plan", lon: -47.9, lat: -15.8 },
  { n: 35, region: "Europe", text: "Europe pays up for LNG with gas stocks low", lon: 5.5, lat: 51 },
  { n: 36, region: "Asia", text: "Pakistan solar share hits 28%", lon: 73, lat: 33.7 },
  { n: 37, region: "Americas", text: "US tightens chip-access rules for China", lon: -79, lat: 38.2 },
  { n: 38, region: "Americas", text: "Anthropic set to list on Nasdaq on Nov 19", lon: -123.5, lat: 38.5 },
  { n: 39, region: "Oceania", text: "Fiji declares disaster over drought", lon: 178.4, lat: -17.7 },
  { n: 40, region: "Europe", text: "WHO warns on drug-resistance threat", lon: 7.5, lat: 46.5 },
  { n: 41, region: "Oceania", text: "Juan Mata retires from football at 38", lon: 145, lat: -37.8 },
  { n: 42, region: "Americas", text: "Fela Kuti enters Rock Hall of Fame", lon: -81.7, lat: 41.5 },
  { n: 43, region: "Europe", text: "Pattinson named the new James Bond", lon: 1, lat: 52.3 },
];

// ---------------------------------------------------------------------------
// Illustrations — small flat vector scenes, one per illustrated story.
// Each draws inside the box (x, y, w, h). All original drawings.
// ---------------------------------------------------------------------------

function starburst(cx: number, cy: number, r: number, c1: RGB, c2: RGB): void {
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const x2 = cx + Math.cos(a) * r;
    const y2 = cy + Math.sin(a) * r;
    line(Math.round(cx), Math.round(cy), Math.round(x2), Math.round(y2), i % 2 ? c2 : c1, 3);
  }
  fillCircle(cx, cy, Math.max(2, r / 3), c2);
}

function drawArt(kind: string, x: number, y: number, w: number, h: number): void {
  const cx = x + w / 2;
  if (kind === "gulf") {
    fillRect(x, y, w, h, SKY);
    fillRect(x, y + Math.round(h * 0.55), w, h - Math.round(h * 0.55), SEA);
    // Qeshm island
    poly(
      [
        [x + w * 0.52, y + h * 0.52],
        [x + w * 0.78, y + h * 0.45],
        [x + w * 0.95, y + h * 0.58],
        [x + w * 0.88, y + h * 0.72],
        [x + w * 0.6, y + h * 0.68],
      ],
      SAND
    );
    // Bahrain island
    poly(
      [
        [x + w * 0.2, y + h * 0.5],
        [x + w * 0.32, y + h * 0.46],
        [x + w * 0.36, y + h * 0.6],
        [x + w * 0.24, y + h * 0.62],
      ],
      SAND
    );
    // jets
    tri(x + w * 0.14, y + h * 0.16, x + w * 0.2, y + h * 0.1, x + w * 0.2, y + h * 0.22, INK);
    tri(x + w * 0.3, y + h * 0.08, x + w * 0.36, y + h * 0.04, x + w * 0.36, y + h * 0.14, INK);
    line(x + w * 0.1, y + h * 0.18, x + w * 0.02, y + h * 0.2, INK, 1);
    // explosion on Qeshm
    starburst(Math.round(x + w * 0.72), Math.round(y + h * 0.5), 12, [255, 140, 0], [255, 220, 60]);
    // tankers with smoke
    fillRect(x + w * 0.42, y + h * 0.78, Math.round(w * 0.2), 7, INK);
    fillCircle(x + w * 0.47, y + h * 0.72, 4, GREY);
    fillCircle(x + w * 0.45, y + h * 0.66, 3, GREY);
    fillRect(x + w * 0.68, y + h * 0.84, Math.round(w * 0.16), 6, [60, 60, 60]);
    // carrier
    fillRect(x + w * 0.06, y + h * 0.86, Math.round(w * 0.26), 6, [90, 90, 90]);
    drawText(x + 4, y + h - 12, "QESHM", 1, INK);
    drawText(x + w - 52, y + h - 12, "HORMUZ", 1, INK);
    drawText(x + 4, y + 4, "BAHRAIN", 1, INK);
  } else if (kind === "apec") {
    fillRect(x, y, w, h, [238, 232, 214]);
    // skyline
    const skyline = [0.42, 0.6, 0.35, 0.7, 0.5, 0.62, 0.45];
    for (let i = 0; i < skyline.length; i++) {
      const bw = w / skyline.length;
      fillRect(x + i * bw + 2, y + h - h * skyline[i] - 18, bw - 4, h * skyline[i], [120, 125, 135]);
    }
    // flags on poles: China, Russia, US
    const flags: { bx: number; draw: () => void }[] = [
      {
        bx: x + w * 0.12,
        draw: () => {
          fillRect(x + w * 0.12, y + 8, 34, 22, [222, 41, 16]);
          fillCircle(x + w * 0.12 + 8, y + 15, 3, [255, 222, 0]);
        },
      },
      {
        bx: x + w * 0.44,
        draw: () => {
          fillRect(x + w * 0.44, y + 8, 34, 22, WHITE);
          fillRect(x + w * 0.44, y + 8, 34, 7, WHITE);
          fillRect(x + w * 0.44, y + 15, 34, 8, [0, 57, 166]);
          fillRect(x + w * 0.44, y + 23, 34, 7, [213, 0, 50]);
        },
      },
      {
        bx: x + w * 0.76,
        draw: () => {
          fillRect(x + w * 0.76, y + 8, 34, 22, WHITE);
          for (let s = 0; s < 4; s++) fillRect(x + w * 0.76, y + 8 + s * 6, 34, 3, [178, 34, 52]);
          fillRect(x + w * 0.76, y + 8, 14, 12, [60, 59, 110]);
        },
      },
    ];
    for (const f of flags) {
      line(Math.round(f.bx) - 2, y + 6, Math.round(f.bx) - 2, y + h - 18, INK, 2);
      f.draw();
    }
    fillRect(x, y + h - 18, w, 18, [120, 85, 50]);
    drawTextC(cx, y + h - 15, "SHENZHEN", 1, WHITE);
  } else if (kind === "senate") {
    fillRect(x, y, w, h, [238, 232, 214]);
    // semicircle of 100 seats: 5 arcs x 20
    let seat = 0;
    for (let arc = 0; arc < 5; arc++) {
      const r = 26 + arc * 12;
      for (let i = 0; i < 20; i++) {
        const a = Math.PI + (i / 19) * Math.PI;
        const sx = cx + Math.cos(a) * r * 1.35;
        const sy = y + h - 26 + Math.sin(a) * r * 0.85;
        fillCircle(Math.round(sx), Math.round(sy), 3, seat < 56 ? [44, 90, 160] : [192, 57, 43]);
        seat++;
      }
    }
    drawText(x + 6, y + h - 24, "56", 2, [44, 90, 160]);
    drawTextR(x + w - 6, y + h - 24, "44", 2, [192, 57, 43]);
    drawTextC(cx, y + 4, "DEMOCRATS 56 - 44", 1, INK);
  } else if (kind === "kerch") {
    fillRect(x, y, w, h, SKY);
    fillRect(x, y + Math.round(h * 0.6), w, h - Math.round(h * 0.6), SEA);
    line(x + 4, y + h * 0.7, x + w - 4, y + h * 0.66, [200, 210, 220], 1);
    line(x + 4, y + h * 0.8, x + w - 4, y + h * 0.78, [200, 210, 220], 1);
    // bridge deck with a gap in the middle
    fillRect(x + 4, y + h * 0.42, Math.round(w * 0.4), 6, [70, 70, 70]);
    fillRect(x + w * 0.56, y + h * 0.42, Math.round(w * 0.4), 6, [70, 70, 70]);
    // fallen span, tilted into the water
    line(x + w * 0.45, y + h * 0.44, x + w * 0.55, y + h * 0.66, [50, 50, 50], 4);
    // pillars
    line(x + w * 0.18, y + h * 0.42, x + w * 0.18, y + h * 0.6, [70, 70, 70], 3);
    line(x + w * 0.78, y + h * 0.42, x + w * 0.78, y + h * 0.6, [70, 70, 70], 3);
    // smoke
    fillCircle(x + w * 0.5, y + h * 0.32, 8, GREY);
    fillCircle(x + w * 0.54, y + h * 0.26, 6, [140, 140, 140]);
    // drone
    tri(x + w * 0.82, y + h * 0.14, x + w * 0.88, y + h * 0.1, x + w * 0.88, y + h * 0.18, INK);
    drawText(x + 4, y + h - 12, "KERCH STRAIT", 1, INK);
  } else if (kind === "ebola") {
    fillRect(x, y, w, h, [238, 232, 214]);
    // clinic tent
    poly(
      [
        [x + w * 0.3, y + h * 0.78],
        [x + w * 0.5, y + h * 0.3],
        [x + w * 0.7, y + h * 0.78],
      ],
      WHITE
    );
    fillRect(x + w * 0.47, y + h * 0.48, Math.round(w * 0.06), Math.round(h * 0.16), RED);
    fillRect(x + w * 0.43, y + h * 0.54, Math.round(w * 0.14), Math.round(h * 0.05), RED);
    // virus dots
    const dots: [number, number][] = [
      [0.12, 0.25],
      [0.2, 0.55],
      [0.82, 0.2],
      [0.88, 0.5],
      [0.78, 0.75],
      [0.14, 0.8],
    ];
    for (const [dx, dy] of dots) fillCircle(Math.round(x + w * dx), Math.round(y + h * dy), 4, RED);
    drawText(x + 4, y + 4, "11,000+ CASES", 1, RED);
  } else if (kind === "nvidia") {
    fillRect(x, y, w, h, [16, 24, 18]);
    // chip
    const cw = Math.round(w * 0.34);
    fillRect(x + 8, y + h / 2 - cw / 2, cw, cw, [30, 90, 40]);
    for (let i = 0; i < 4; i++) {
      line(x + 8, y + h / 2 - cw / 2 + 6 + i * 8, x + 2, y + h / 2 - cw / 2 + 6 + i * 8, [192, 160, 40], 1);
      line(x + 8 + cw, y + h / 2 - cw / 2 + 6 + i * 8, x + 8 + cw + 6, y + h / 2 - cw / 2 + 6 + i * 8, [192, 160, 40], 1);
    }
    drawText(x + 14, y + h / 2 - 6, "NVDA", 1, WHITE);
    // rising bars on the right, kept below the top label area
    const bars = [0.25, 0.45, 0.65, 0.9];
    const barMax = h - 34;
    for (let i = 0; i < bars.length; i++) {
      const bh = Math.round(barMax * bars[i]);
      fillRect(x + w * 0.48 + i * 14, y + h - 14 - bh, 10, bh, [60, 200, 90]);
    }
    drawText(x + w * 0.48, y + 4, "$115.8BN", 1, [120, 220, 120]);
    drawText(x + w * 0.48, y + 16, "DOUBLE", 1, [120, 220, 120]);
  } else if (kind === "measles") {
    fillRect(x, y, w, h, [238, 232, 214]);
    // simplified US outline
    poly(
      [
        [x + w * 0.08, y + h * 0.3],
        [x + w * 0.15, y + h * 0.18],
        [x + w * 0.35, y + h * 0.14],
        [x + w * 0.6, y + h * 0.16],
        [x + w * 0.85, y + h * 0.2],
        [x + w * 0.92, y + h * 0.32],
        [x + w * 0.88, y + h * 0.5],
        [x + w * 0.8, y + h * 0.62],
        [x + w * 0.7, y + h * 0.55],
        [x + w * 0.55, y + h * 0.6],
        [x + w * 0.4, y + h * 0.72],
        [x + w * 0.3, y + h * 0.6],
        [x + w * 0.18, y + h * 0.55],
        [x + w * 0.1, y + h * 0.42],
      ],
      [200, 200, 190]
    );
    const dots: [number, number][] = [
      [0.25, 0.3],
      [0.4, 0.28],
      [0.55, 0.3],
      [0.7, 0.35],
      [0.35, 0.45],
      [0.5, 0.42],
      [0.65, 0.5],
      [0.3, 0.55],
      [0.8, 0.5],
      [0.45, 0.58],
    ];
    for (const [dx, dy] of dots) fillCircle(Math.round(x + w * dx), Math.round(y + h * dy), 3, RED);
    drawText(x + 4, y + h - 12, "5,412 CASES", 1, RED);
  } else if (kind === "voyager") {
    fillRect(x, y, w, h, [8, 10, 24]);
    // stars
    const stars: [number, number][] = [
      [0.1, 0.15],
      [0.25, 0.4],
      [0.4, 0.12],
      [0.55, 0.3],
      [0.7, 0.15],
      [0.85, 0.4],
      [0.92, 0.2],
      [0.3, 0.7],
      [0.6, 0.65],
    ];
    for (const [dx, dy] of stars) fillCircle(Math.round(x + w * dx), Math.round(y + h * dy), 1, WHITE);
    // sun
    fillCircle(x + w * 0.14, y + h * 0.82, 12, [255, 210, 60]);
    // dotted trajectory
    for (let t = 0; t <= 10; t++) {
      const px = x + w * 0.14 + ((x + w * 0.72 - (x + w * 0.14)) * t) / 10;
      const py = y + h * 0.82 + ((y + h * 0.3 - (y + h * 0.82)) * t) / 10;
      fillCircle(Math.round(px), Math.round(py), 1, [180, 180, 180]);
    }
    // probe: dish + body
    fillCircle(x + w * 0.74, y + h * 0.28, 9, [220, 220, 220]);
    fillRect(x + w * 0.74, y + h * 0.28, 16, 6, [200, 170, 60]);
    line(x + w * 0.74, y + h * 0.28, x + w * 0.86, y + h * 0.18, [200, 170, 60], 2);
    drawText(x + 4, y + 4, "1 LIGHT-DAY", 1, WHITE);
    drawTextR(x + w - 4, y + h - 12, "16BN MILES", 1, [180, 180, 180]);
  } else if (kind === "cyclone") {
    fillRect(x, y, w, h, [200, 225, 240]);
    // spiral arms, drawn 2px thick so they read at small size
    for (let r = 8; r <= 30; r += 7) {
      for (let a = 0; a < 270; a += 6) {
        const rad = (a * Math.PI) / 180;
        fillRect(
          Math.round(cx + r * Math.cos(rad)) - 1,
          Math.round(y + h * 0.45 + r * Math.sin(rad) * 0.8) - 1,
          2,
          2,
          WHITE
        );
      }
    }
    fillCircle(cx, y + h * 0.45, 5, [40, 90, 140]);
    // islands
    fillCircle(x + w * 0.16, y + h * 0.82, 4, GREEN);
    fillCircle(x + w * 0.84, y + h * 0.8, 3, GREEN);
    drawText(x + 4, y + 4, "315 KM/H", 1, [40, 90, 140]);
    drawTextR(x + w - 4, y + h - 12, "CAT 5", 1, [40, 90, 140]);
  } else if (kind === "outages") {
    fillRect(x, y, w, h, [40, 44, 52]);
    // server racks
    for (let i = 0; i < 3; i++) {
      const rx = x + 8 + i * Math.round(w * 0.28);
      fillRect(rx, y + 10, Math.round(w * 0.22), h - 26, [20, 22, 28]);
      for (let l = 0; l < 4; l++) {
        fillCircle(rx + 6, y + 18 + l * 10, 2, l === 2 ? RED : [60, 220, 90]);
      }
    }
    // warning triangle
    tri(x + w - 26, y + 10, x + w - 14, y + 10, x + w - 20, y + 26, [255, 200, 0]);
    drawText(x + w - 22, y + 14, "!", 1, INK);
    drawText(x + 4, y + h - 12, "NSA DOWN", 1, [255, 120, 100]);
  } else if (kind === "crash") {
    fillRect(x, y, w, h, [190, 198, 208]);
    // mountains
    poly(
      [
        [x, y + h],
        [x + w * 0.25, y + h * 0.35],
        [x + w * 0.45, y + h],
      ],
      WHITE
    );
    poly(
      [
        [x + w * 0.35, y + h],
        [x + w * 0.65, y + h * 0.25],
        [x + w, y + h],
      ],
      [225, 228, 235]
    );
    // plane, tilted down
    line(x + w * 0.3, y + h * 0.3, x + w * 0.62, y + h * 0.42, INK, 3);
    line(x + w * 0.5, y + h * 0.36, x + w * 0.56, y + h * 0.28, INK, 2);
    // smoke
    fillCircle(x + w * 0.68, y + h * 0.46, 5, GREY);
    fillCircle(x + w * 0.73, y + h * 0.5, 4, GREY);
    drawText(x + 4, y + h - 12, "19 KILLED", 1, INK);
  } else if (kind === "gaza") {
    fillRect(x, y, w, h, [232, 222, 200]);
    // tents
    for (let i = 0; i < 4; i++) {
      const tx = x + 8 + i * Math.round(w * 0.24);
      poly(
        [
          [tx, y + h * 0.75],
          [tx + 14, y + h * 0.42],
          [tx + 30, y + h * 0.75],
        ],
        WHITE
      );
      line(tx, y + h * 0.75, tx + 30, y + h * 0.75, GREY, 1);
    }
    // snowflakes
    for (const [dx, dy] of [
      [0.15, 0.2],
      [0.5, 0.15],
      [0.85, 0.25],
      [0.3, 0.35],
    ] as [number, number][]) {
      const sx = x + w * dx;
      const sy = y + h * dy;
      line(Math.round(sx) - 3, Math.round(sy), Math.round(sx) + 3, Math.round(sy), WHITE, 1);
      line(Math.round(sx), Math.round(sy) - 3, Math.round(sx), Math.round(sy) + 3, WHITE, 1);
    }
    // aid truck
    fillRect(x + w * 0.62, y + h * 0.78, Math.round(w * 0.3), 12, WHITE);
    fillRect(x + w * 0.7, y + h * 0.8, 8, 8, RED);
    fillCircle(x + w * 0.68, y + h * 0.92, 3, INK);
    fillCircle(x + w * 0.86, y + h * 0.92, 3, INK);
    drawText(x + 4, y + 4, "COLD IN TENTS", 1, INK);
  } else if (kind === "icj") {
    fillRect(x, y, w, h, [238, 232, 214]);
    // pediment
    tri(x + w * 0.12, y + h * 0.32, x + w * 0.88, y + h * 0.32, cx, y + h * 0.12, [210, 205, 190]);
    // columns
    for (let i = 0; i < 4; i++) {
      const colx = x + w * (0.16 + i * 0.2);
      fillRect(Math.round(colx), y + h * 0.34, 8, Math.round(h * 0.5), WHITE);
    }
    fillRect(x + w * 0.12, y + h * 0.84, Math.round(w * 0.76), 5, [210, 205, 190]);
    // scales
    line(cx, y + h * 0.4, cx, y + h * 0.56, INK, 2);
    line(cx - 12, y + h * 0.44, cx + 12, y + h * 0.44, INK, 2);
    tri(cx - 16, y + h * 0.44, cx - 8, y + h * 0.44, cx - 12, y + h * 0.54, INK);
    tri(cx + 8, y + h * 0.44, cx + 16, y + h * 0.44, cx + 12, y + h * 0.54, INK);
    drawText(x + 4, y + 4, "THE HAGUE", 1, INK);
  }
}

// ---------------------------------------------------------------------------
// World map — simplified equirectangular continents (lon/lat polygons).
// ---------------------------------------------------------------------------

const MAP_X = 28;
const MAP_Y = 754;
const MAP_W = 380;
const MAP_H = 190;

const CONTINENTS: number[][][] = [
  // North America
  [
    [-168, 66], [-155, 58], [-140, 60], [-130, 54], [-125, 48], [-124, 40], [-120, 34],
    [-112, 28], [-105, 20], [-95, 16], [-88, 13], [-82, 9], [-78, 8], [-84, 12], [-90, 18],
    [-96, 19], [-97, 26], [-90, 30], [-83, 30], [-80, 26], [-79, 33], [-75, 37], [-71, 42],
    [-67, 44], [-60, 47], [-55, 48], [-55, 53], [-60, 55], [-65, 59], [-70, 61], [-78, 62],
    [-85, 66], [-93, 66], [-100, 69], [-115, 68], [-130, 70], [-145, 70], [-160, 70], [-168, 66],
  ],
  // Greenland
  [[-55, 60], [-45, 60], [-40, 64], [-32, 68], [-25, 70], [-20, 74], [-25, 78], [-35, 80], [-50, 80], [-58, 76], [-60, 70], [-55, 64]],
  // South America
  [
    [-79, 9], [-77, 4], [-80, -4], [-77, -12], [-71, -18], [-70, -24], [-72, -33], [-73, -44],
    [-70, -54], [-66, -55], [-65, -47], [-60, -38], [-52, -32], [-46, -24], [-39, -15], [-35, -8],
    [-38, -3], [-44, -2], [-50, 0], [-54, 5], [-59, 8], [-65, 10], [-71, 12], [-76, 10], [-79, 9],
  ],
  // Africa
  [
    [-17, 15], [-16, 21], [-11, 28], [-6, 33], [0, 36], [10, 37], [15, 32], [20, 32], [25, 31],
    [30, 31], [33, 28], [35, 23], [38, 18], [41, 12], [46, 11], [51, 12], [48, 8], [42, 2],
    [40, -6], [38, -14], [34, -22], [31, -29], [26, -34], [19, -35], [16, -29], [13, -20],
    [12, -12], [13, -4], [9, 0], [8, 4], [4, 6], [-3, 5], [-8, 4], [-13, 8], [-17, 12], [-17, 15],
  ],
  // Eurasia
  [
    [-10, 37], [-9, 43], [-2, 44], [-4, 48], [-1, 50], [2, 52], [6, 54], [8, 57], [10, 59],
    [7, 61], [12, 65], [18, 69], [25, 71], [32, 70], [40, 68], [48, 69], [55, 68], [62, 69],
    [70, 72], [78, 73], [86, 74], [94, 76], [102, 77], [110, 76], [118, 73], [126, 72],
    [134, 71], [142, 72], [150, 70], [158, 69], [162, 64], [160, 60], [156, 52], [150, 59],
    [143, 58], [140, 52], [138, 46], [135, 43], [130, 42], [127, 39], [124, 38], [121, 35],
    [120, 30], [118, 25], [110, 20], [106, 10], [103, 8], [99, 8], [97, 14], [94, 17],
    [91, 22], [88, 22], [85, 19], [81, 15], [78, 9], [75, 12], [72, 20], [68, 23], [64, 25],
    [59, 25], [55, 26], [51, 28], [49, 30], [47, 29], [44, 29], [41, 31], [39, 33], [36, 36],
    [33, 36], [30, 36], [27, 37], [23, 36], [19, 38], [16, 40], [13, 42], [10, 44], [7, 44],
    [4, 43], [1, 41], [-1, 38], [-5, 36], [-9, 37], [-10, 37],
  ],
  // UK
  [[-5, 50], [-3, 53], [-5, 56], [-3, 58], [-1, 57], [0, 53], [1, 51], [-3, 50], [-5, 50]],
  // Japan
  [
    [130, 31], [132, 33], [135, 34], [137, 35], [139, 37], [140, 39], [141, 41], [143, 43],
    [145, 44], [143, 42], [141, 39], [139, 36], [137, 34], [134, 34], [131, 33], [130, 31],
  ],
  // Sumatra
  [[95, 5], [98, 3], [101, 0], [104, -3], [106, -5], [103, -5], [100, -2], [97, 1], [95, 5]],
  // Borneo
  [[109, 1], [113, 4], [117, 6], [119, 1], [117, -3], [112, -4], [109, -1], [109, 1]],
  // New Guinea
  [[131, -1], [136, -2], [141, -3], [146, -6], [147, -8], [142, -8], [137, -6], [132, -4], [131, -1]],
  // Australia
  [
    [113, -22], [114, -30], [115, -34], [118, -35], [124, -33], [129, -32], [132, -32],
    [135, -35], [138, -35], [140, -38], [145, -38], [147, -39], [150, -37], [153, -32],
    [153, -27], [151, -24], [147, -19], [143, -15], [142, -11], [140, -17], [137, -12],
    [135, -12], [132, -11], [130, -13], [127, -14], [124, -15], [122, -17], [118, -20], [113, -22],
  ],
  // New Zealand
  [[167, -45], [170, -42], [173, -40], [175, -38], [177, -38], [175, -41], [172, -43], [169, -46], [167, -45]],
  // Madagascar
  [[44, -16], [47, -15], [50, -16], [50, -20], [47, -25], [44, -25], [43, -20], [44, -16]],
];

function lonLatToXY(lon: number, lat: number): [number, number] {
  const x = MAP_X + ((lon + 180) / 360) * MAP_W;
  const y = MAP_Y + ((90 - lat) / 180) * MAP_H;
  return [x, y];
}

function drawWorldMap(): void {
  fillRect(MAP_X, MAP_Y, MAP_W, MAP_H, [205, 228, 240]);
  for (const cont of CONTINENTS) {
    const pts = cont.map(([lo, la]) => {
      const [x, y] = lonLatToXY(lo, la);
      return [x, y];
    });
    poly(pts, LAND);
  }
  // border only (no interior fill)
  fillRect(MAP_X, MAP_Y, MAP_W, 1, INK);
  fillRect(MAP_X, MAP_Y + MAP_H - 1, MAP_W, 1, INK);
  fillRect(MAP_X, MAP_Y, 1, MAP_H, INK);
  fillRect(MAP_X + MAP_W - 1, MAP_Y, 1, MAP_H, INK);
  // numbered pins for the 13 illustrated stories
  for (const s of [...BIG, ...SMALL]) {
    const [px, py] = lonLatToXY(s.lon, s.lat);
    badge(Math.round(px), Math.round(py), s.n, REGION_COLOR[s.region], 7);
  }
  // dots for the 30 digest stories
  for (const d of DIGEST) {
    const [px, py] = lonLatToXY(d.lon, d.lat);
    fillCircle(Math.round(px), Math.round(py), 3, REGION_COLOR[d.region]);
  }
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const MARGIN = 28;
const COLW = (W - MARGIN * 2 - 2 * 11) / 3; // three big columns
const SMALLW = (W - MARGIN * 2 - 4 * 9) / 5; // five small columns

// Fit a string to one line of at most maxW px by dropping whole words.
function fitOneLine(s: string, maxW: number): string {
  if (textWidth(s, 1) <= maxW) return s;
  const words = s.split(" ");
  let cur = "";
  for (const w of words) {
    const test = cur ? cur + " " + w : w;
    if (textWidth(test, 1) <= maxW) cur = test;
    else break;
  }
  return cur;
}

function drawBigStory(s: Story, x: number, y: number): void {
  const w = COLW;
  box(x, y, w, 120, WHITE, INK, 1);
  drawArt(s.art, x + 1, y + 1, w - 2, 118);
  let yy = y + 128;
  badge(x + 9, yy + 5, s.n, REGION_COLOR[s.region], 8);
  drawText(x + 22, yy - 2, s.kicker, 1, RED);
  yy += 16;
  const headLines = wrap(s.headline, 2, w).slice(0, 3);
  for (const ln of headLines) {
    drawText(x, yy, ln, 2, INK);
    yy += 22;
  }
  yy += 2;
  const deckLines = wrap(s.deck, 1, w).slice(0, 5);
  for (const ln of deckLines) {
    drawText(x, yy, ln, 1, INK);
    yy += 12;
  }
}

function drawSmallStory(s: Story, x: number, y: number): void {
  const w = SMALLW;
  box(x, y, w, 60, WHITE, INK, 1);
  drawArt(s.art, x + 1, y + 1, w - 2, 58);
  let yy = y + 68;
  badge(x + 8, yy + 4, s.n, REGION_COLOR[s.region], 7);
  drawText(x + 19, yy - 2, s.kicker, 1, RED);
  yy += 14;
  const headLines = wrap(s.headline, 2, w).slice(0, 3);
  for (const ln of headLines) {
    drawText(x, yy, ln, 2, INK);
    yy += 21;
  }
  yy += 2;
  const deckLines = wrap(s.deck, 1, w).slice(0, 2);
  for (const ln of deckLines) {
    drawText(x, yy, ln, 1, INK);
    yy += 11;
  }
}

function render(): void {
  fillRect(0, 0, W, H, PAPER);
  // Top kicker line
  drawText(MARGIN, 10, "THE WORLD'S NEWS IN ONE PICTURE", 1, RED);
  drawTextR(W - MARGIN, 10, "43 STORIES · 6 CONTINENTS · ALL FROM WEDNESDAY", 1, INK);
  rule(MARGIN, 24, W - MARGIN * 2, INK, 1);
  // Masthead: the date, huge
  drawTextC(W / 2, 30, "Wednesday 18 November 2026", 5, INK);
  rule(MARGIN, 88, W - MARGIN * 2, INK, 2);
  // Row 1: three big stories
  let x = MARGIN;
  for (const s of BIG) {
    drawBigStory(s, x, 98);
    x += COLW + 11;
  }
  rule(MARGIN, 376, W - MARGIN * 2, INK, 1);
  // Row 2: five small stories
  x = MARGIN;
  for (let i = 0; i < 5; i++) {
    drawSmallStory(SMALL[i], x, 384);
    x += SMALLW + 9;
  }
  rule(MARGIN, 556, W - MARGIN * 2, INK, 1);
  // Row 3: five small stories
  x = MARGIN;
  for (let i = 5; i < 10; i++) {
    drawSmallStory(SMALL[i], x, 564);
    x += SMALLW + 9;
  }
  rule(MARGIN, 736, W - MARGIN * 2, INK, 1);
  // Bottom: world map + digest
  drawText(MARGIN, 744, "WHERE IT HAPPENED", 1, RED);
  drawWorldMap();
  // legend under the map
  const legend: [string, RGB][] = [
    ["Americas", REGION_COLOR.Americas],
    ["Europe", REGION_COLOR.Europe],
    ["Middle East", REGION_COLOR["Middle East"]],
    ["Asia", REGION_COLOR.Asia],
    ["Africa", REGION_COLOR.Africa],
    ["Oceania", REGION_COLOR.Oceania],
  ];
  let lx = MAP_X;
  for (const [label, c] of legend) {
    fillCircle(lx + 4, 954, 3, c);
    lx += 10;
    lx += drawText(lx, 949, label, 1, INK) + 10;
  }
  drawText(MAP_X, 966, "Pins: stories 1-13. Dots: stories 14-43.", 1, GREY);
  // digest list, two columns
  const dx = MAP_X + MAP_W + 16;
  const dw = W - MARGIN - dx;
  const colW = (dw - 12) / 2;
  drawText(dx, 744, "ALSO ON WEDNESDAY 18 NOVEMBER", 1, RED);
  for (let i = 0; i < DIGEST.length; i++) {
    const d = DIGEST[i];
    const col = i < 15 ? 0 : 1;
    const row = i % 15;
    const ix = dx + col * (colW + 12);
    const iy = 762 + row * 15;
    badge(ix + 7, iy + 4, d.n, REGION_COLOR[d.region], 7);
    drawText(ix + 17, iy - 1, fitOneLine(d.text, colW - 18), 1, INK);
  }
  // footer
  rule(MARGIN, 984, W - MARGIN * 2, INK, 1);
  drawText(
    MARGIN,
    990,
    "Every story here happened or was first reported on Wednesday 18 November 2026.",
    1,
    GREY
  );
}

function main(): void {
  const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
  render();
  const png = encodePng();
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "entry.png"), png);
  // eslint-disable-next-line no-console
  console.log(`wrote ${path.join(outDir, "entry.png")} (${png.length} bytes)`);
}

main();
