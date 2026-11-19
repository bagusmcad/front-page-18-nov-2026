// Wednesday 18 November 2026 in one page — make.fun news-image-20261118 (round 2 rebuild)
// A one-page newspaper front page drawn entirely by code: software rasterizer,
// embedded bitmap font, simplified world map from embedded polygons, hand-written
// PNG encoder. Node 22, standard library only, no network, fully deterministic.
//
// Run:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Writes out/entry.png (1024x1024, <= 1 MiB). Two runs are byte-identical.

import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

type RGB = [number, number, number];

const PAPER: RGB = [247, 241, 222];
const INK: RGB = [26, 26, 26];
const RED: RGB = [160, 30, 30];
const BLUE: RGB = [28, 68, 140];
const TAN: RGB = [232, 217, 168];
const TAN_DARK: RGB = [196, 172, 110];
const SEA: RGB = [178, 205, 226];
const SEA_DARK: RGB = [120, 165, 200];
const GREY: RGB = [120, 120, 118];
const DARK: RGB = [40, 40, 40];
const WHITE: RGB = [250, 250, 246];
const GREEN: RGB = [30, 110, 60];
const ORANGE: RGB = [214, 116, 28];
const PURPLE: RGB = [110, 70, 150];
const TEAL: RGB = [20, 120, 120];

// ---------------------------------------------------------------------------
// CRC32 (PNG chunk checksums)
// ---------------------------------------------------------------------------

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}

// Encode an RGB canvas as a PNG (colour type 2, 8-bit, filter 0 on every row).
function encodePng(w: number, h: number, rgb: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0; // filter: none
    rgb.copy(raw, y * (1 + w * 3) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Canvas: a plain RGB framebuffer with tiny drawing primitives.
// ---------------------------------------------------------------------------

class Canvas {
  readonly w: number;
  readonly h: number;
  readonly px: Buffer;

  constructor(w: number, h: number, bg: RGB) {
    this.w = w;
    this.h = h;
    this.px = Buffer.alloc(w * h * 3);
    for (let i = 0; i < w * h; i++) {
      this.px[i * 3] = bg[0];
      this.px[i * 3 + 1] = bg[1];
      this.px[i * 3 + 2] = bg[2];
    }
  }

  set(x: number, y: number, c: RGB): void {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= this.w || yi >= this.h) return;
    const o = (yi * this.w + xi) * 3;
    this.px[o] = c[0];
    this.px[o + 1] = c[1];
    this.px[o + 2] = c[2];
  }

  rect(x: number, y: number, w: number, h: number, c: RGB): void {
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.w, Math.round(x + w));
    const y1 = Math.min(this.h, Math.round(y + h));
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const o = (yy * this.w + xx) * 3;
        this.px[o] = c[0];
        this.px[o + 1] = c[1];
        this.px[o + 2] = c[2];
      }
    }
  }

  // 1px outline rectangle.
  frame(x: number, y: number, w: number, h: number, c: RGB): void {
    this.rect(x, y, w, 1, c);
    this.rect(x, y + h - 1, w, 1, c);
    this.rect(x, y, 1, h, c);
    this.rect(x + w - 1, y, 1, h, c);
  }

  hline(x0: number, x1: number, y: number, c: RGB): void {
    const a = Math.min(x0, x1);
    const b = Math.max(x0, x1);
    for (let x = Math.round(a); x <= Math.round(b); x++) this.set(x, y, c);
  }

  vline(x: number, y0: number, y1: number, c: RGB): void {
    const a = Math.min(y0, y1);
    const b = Math.max(y0, y1);
    for (let y = Math.round(a); y <= Math.round(b); y++) this.set(x, y, c);
  }

  // Bresenham line, any slope.
  line(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
    let ax = Math.round(x0);
    let ay = Math.round(y0);
    const bx = Math.round(x1);
    const by = Math.round(y1);
    const dx = Math.abs(bx - ax);
    const dy = -Math.abs(by - ay);
    const sx = ax < bx ? 1 : -1;
    const sy = ay < by ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(ax, ay, c);
      if (ax === bx && ay === by) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        ax += sx;
      }
      if (e2 <= dx) {
        err += dx;
        ay += sy;
      }
    }
  }

  // A line drawn twice, one pixel apart, for a slightly heavier stroke.
  thickLine(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
    this.line(x0, y0, x1, y1, c);
    this.line(x0 + 1, y0, x1 + 1, y1, c);
  }

  circle(cx: number, cy: number, r: number, c: RGB): void {
    const rr = Math.round(r);
    for (let dy = -rr; dy <= rr; dy++) {
      const dx = Math.floor(Math.sqrt(Math.max(0, rr * rr - dy * dy)));
      this.hline(cx - dx, cx + dx, cy + dy, c);
    }
  }

  ring(cx: number, cy: number, r: number, c: RGB): void {
    const rr = Math.round(r);
    for (let a = 0; a < 360; a += 2) {
      const t = (a * Math.PI) / 180;
      this.set(cx + rr * Math.cos(t), cy + rr * Math.sin(t), c);
      this.set(cx + (rr - 1) * Math.cos(t), cy + (rr - 1) * Math.sin(t), c);
    }
  }

  // Filled polygon (scanline, even-odd). Points are [x, y] pairs.
  poly(points: Array<[number, number]>, c: RGB): void {
    if (points.length < 3) return;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [, y] of points) {
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    for (let y = Math.ceil(minY); y <= Math.floor(maxY); y++) {
      const xs: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const [x0, y0] = points[i];
        const [x1, y1] = points[(i + 1) % points.length];
        if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
          xs.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        this.hline(Math.ceil(xs[k]), Math.floor(xs[k + 1]), y, c);
      }
    }
  }

  // Outline of a polygon.
  strokePoly(points: Array<[number, number]>, c: RGB): void {
    for (let i = 0; i < points.length; i++) {
      const [x0, y0] = points[i];
      const [x1, y1] = points[(i + 1) % points.length];
      this.line(x0, y0, x1, y1, c);
    }
  }

  // N-pointed starburst (explosion / sun) made of radiating lines.
  starburst(cx: number, cy: number, r: number, points: number, c: RGB): void {
    for (let i = 0; i < points; i++) {
      const t = (i * 2 * Math.PI) / points;
      this.thickLine(cx, cy, cx + r * Math.cos(t), cy + r * Math.sin(t), c);
    }
    this.circle(cx, cy, Math.max(2, r * 0.35), c);
  }

  // Filled triangle.
  tri(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: RGB): void {
    this.poly(
      [
        [x0, y0],
        [x1, y1],
        [x2, y2],
      ],
      c,
    );
  }
}

// ---------------------------------------------------------------------------
// Bitmap font: 5x7 glyphs, one string per glyph, rows separated by "|".
// Designed for this entry: capitals fill all 7 rows, lowercase sit on rows
// 2-6 with descenders reaching row 6. Advance is 6px at scale 1.
// ---------------------------------------------------------------------------

const FONT: Record<string, string> = {
  A: "01110|10001|10001|11111|10001|10001|10001",
  B: "11110|10001|10001|11110|10001|10001|11110",
  C: "01110|10001|10000|10000|10000|10001|01110",
  D: "11110|10001|10001|10001|10001|10001|11110",
  E: "11111|10000|10000|11110|10000|10000|11111",
  F: "11111|10000|10000|11110|10000|10000|10000",
  G: "01110|10001|10000|10111|10001|10001|01111",
  H: "10001|10001|10001|11111|10001|10001|10001",
  I: "01110|00100|00100|00100|00100|00100|01110",
  J: "00111|00010|00010|00010|00010|10010|01100",
  K: "10001|10010|10100|11000|10100|10010|10001",
  L: "10000|10000|10000|10000|10000|10000|11111",
  M: "10001|11011|10101|10101|10001|10001|10001",
  N: "10001|11001|10101|10011|10001|10001|10001",
  O: "01110|10001|10001|10001|10001|10001|01110",
  P: "11110|10001|10001|11110|10000|10000|10000",
  Q: "01110|10001|10001|10001|10101|10010|01101",
  R: "11110|10001|10001|11110|10100|10010|10001",
  S: "01111|10000|10000|01110|00001|00001|11110",
  T: "11111|00100|00100|00100|00100|00100|00100",
  U: "10001|10001|10001|10001|10001|10001|01110",
  V: "10001|10001|10001|10001|10001|01010|00100",
  W: "10001|10001|10001|10101|10101|10101|01010",
  X: "10001|10001|01010|00100|01010|10001|10001",
  Y: "10001|10001|01010|00100|00100|00100|00100",
  Z: "11111|00001|00010|00100|01000|10000|11111",
  a: "00000|00000|01110|00001|01111|10001|01111",
  b: "10000|10000|11110|10001|10001|10001|11110",
  c: "00000|00000|01110|10000|10000|10001|01110",
  d: "00001|00001|01111|10001|10001|10001|01111",
  e: "00000|00000|01110|10001|11111|10000|01110",
  f: "00110|01001|01000|11110|01000|01000|01000",
  g: "00000|00000|01111|10001|10001|01111|00001",
  h: "10000|10000|11110|10001|10001|10001|10001",
  i: "00100|00000|01100|00100|00100|00100|01110",
  j: "00010|00000|00110|00010|00010|10010|01100",
  k: "10000|10000|10010|10100|11000|10100|10010",
  l: "01100|00100|00100|00100|00100|00100|01110",
  m: "00000|00000|11010|10101|10101|10101|10101",
  n: "00000|00000|11110|10001|10001|10001|10001",
  o: "00000|00000|01110|10001|10001|10001|01110",
  p: "00000|00000|11110|10001|10001|11110|10000",
  q: "00000|00000|01111|10001|10001|01111|00001",
  r: "00000|00000|10110|11001|10000|10000|10000",
  s: "00000|00000|01111|10000|01110|00001|11110",
  t: "01000|01000|11100|01000|01000|01000|00110",
  u: "00000|00000|10001|10001|10001|10011|01101",
  v: "00000|00000|10001|10001|10001|01010|00100",
  w: "00000|00000|10001|10101|10101|10101|01010",
  x: "00000|00000|10001|01010|00100|01010|10001",
  y: "00000|00000|10001|10001|01111|00001|01110",
  z: "00000|00000|11111|00010|00100|01000|11111",
  "0": "01110|10001|10011|10101|11001|10001|01110",
  "1": "00100|01100|00100|00100|00100|00100|01110",
  "2": "01110|10001|00001|00110|01000|10000|11111",
  "3": "11111|00010|00100|00010|00001|10001|01110",
  "4": "00010|00110|01010|10010|11111|00010|00010",
  "5": "11111|10000|11110|00001|00001|10001|01110",
  "6": "00110|01000|10000|11110|10001|10001|01110",
  "7": "11111|00001|00010|00100|01000|01000|01000",
  "8": "01110|10001|10001|01110|10001|10001|01110",
  "9": "01110|10001|10001|01111|00001|00010|01100",
  " ": "00000|00000|00000|00000|00000|00000|00000",
  ".": "00000|00000|00000|00000|00000|01100|01100",
  ",": "00000|00000|00000|00000|01100|00100|01000",
  ":": "00000|01100|01100|00000|01100|01100|00000",
  ";": "00000|01100|01100|00000|01100|00100|01000",
  "!": "00100|00100|00100|00100|00100|00000|00100",
  "?": "01110|10001|00001|00110|00100|00000|00100",
  "-": "00000|00000|00000|01110|00000|00000|00000",
  "—": "00000|00000|00000|11111|00000|00000|00000",
  "–": "00000|00000|00000|01110|00000|00000|00000",
  "'": "00100|00100|01000|00000|00000|00000|00000",
  "’": "00100|00100|01000|00000|00000|00000|00000",
  '"': "01010|01010|01010|00000|00000|00000|00000",
  "“": "01010|01010|01010|00000|00000|00000|00000",
  "”": "01010|01010|01010|00000|00000|00000|00000",
  "(": "00010|00100|01000|01000|01000|00100|00010",
  ")": "01000|00100|00010|00010|00010|00100|01000",
  "/": "00001|00010|00010|00100|01000|01000|10000",
  "%": "11001|11010|00010|00100|01000|01011|10011",
  $: "00100|01111|10100|01110|00101|11110|00100",
  "&": "01100|10010|10100|01000|10101|10010|01101",
  "+": "00000|00100|00100|11111|00100|00100|00000",
  "=": "00000|00000|11111|00000|11111|00000|00000",
  "*": "00000|10101|01110|11111|01110|10101|00000",
  "#": "01010|01010|11111|01010|11111|01010|01010",
  "@": "01110|10001|10111|10101|10110|10000|01110",
  _: "00000|00000|00000|00000|00000|00000|11111",
  "·": "00000|00000|00000|01100|01100|00000|00000",
  "•": "00000|00000|01110|01110|01110|00000|00000",
  "×": "00000|10001|01010|00100|01010|10001|00000",
  "<": "00010|00100|01000|10000|01000|00100|00010",
  ">": "01000|00100|00010|00001|00010|00100|01000",
  "[": "01110|01000|01000|01000|01000|01000|01110",
  "]": "01110|00010|00010|00010|00010|00010|01110",
  "{": "00010|00100|00100|01100|00100|00100|00010",
  "}": "01000|00100|00100|00110|00100|00100|01000",
  "~": "00000|00000|01001|10110|00000|00000|00000",
  "^": "00100|01010|10001|00000|00000|00000|00000",
  "|": "00100|00100|00100|00100|00100|00100|00100",
  "\\": "10000|01000|01000|00100|00010|00010|00001",
};

// Parsed glyph rows, built once at startup.
const GLYPHS: Record<string, string[]> = {};
for (const key of Object.keys(FONT)) GLYPHS[key] = FONT[key].split("|");

const CHAR_ADVANCE = 6; // px at scale 1, including 1px letter spacing

function textWidth(text: string, scale: number): number {
  if (text.length === 0) return 0;
  return text.length * CHAR_ADVANCE * scale - scale;
}

// Draw one glyph; bold draws it a second time shifted 1px right.
function drawGlyph(cv: Canvas, x: number, y: number, ch: string, scale: number, c: RGB, bold: boolean): void {
  const rows = GLYPHS[ch] ?? GLYPHS["?"];
  const passes = bold ? 2 : 1;
  for (let p = 0; p < passes; p++) {
    const ox = x + p;
    for (let r = 0; r < 7; r++) {
      const row = rows[r];
      for (let col = 0; col < 5; col++) {
        if (row[col] === "1") cv.rect(ox + col * scale, y + r * scale, scale, scale, c);
      }
    }
  }
}

function drawText(cv: Canvas, x: number, y: number, text: string, scale: number, c: RGB, bold = false): void {
  let cx = x;
  for (const ch of text) {
    drawGlyph(cv, cx, y, ch, scale, c, bold);
    cx += CHAR_ADVANCE * scale;
  }
}

function drawTextCentered(cv: Canvas, cx: number, y: number, text: string, scale: number, c: RGB, bold = false): void {
  drawText(cv, cx - Math.floor(textWidth(text, scale) / 2), y, text, scale, c, bold);
}

function drawTextRight(cv: Canvas, rightX: number, y: number, text: string, scale: number, c: RGB, bold = false): void {
  drawText(cv, rightX - textWidth(text, scale), y, text, scale, c, bold);
}

// Greedy word wrap into lines no wider than maxW px.
function wrapText(text: string, maxW: number, scale: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const trial = cur === "" ? word : cur + " " + word;
    if (textWidth(trial, scale) <= maxW || cur === "") {
      cur = trial;
    } else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur !== "") lines.push(cur);
  return lines;
}

// Draw wrapped lines, at most maxLines; truncate the last line with "..." if needed.
function drawPara(cv: Canvas, x: number, y: number, text: string, maxW: number, scale: number, c: RGB, lineH: number, maxLines: number): number {
  const lines = wrapText(text, maxW, scale).slice(0, maxLines);
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (i === maxLines - 1 && wrapText(text, maxW, scale).length > maxLines) {
      while (line.length > 3 && textWidth(line + "...", scale) > maxW) line = line.slice(0, -1);
      line = line + "...";
    }
    drawText(cv, x, y + i * lineH, line, scale, c);
  }
  return y + lines.length * lineH;
}

// ---------------------------------------------------------------------------
// The news of Wednesday 18 November 2026.
// 13 main stories (each with a drawn illustration) + a 30-item digest.
// Every fact is as reported on 18 November 2026; nothing is invented.
// Map pins use lon/lat; region colours: Americas red, Europe blue,
// Middle East orange, Asia purple, Africa green, Oceania teal.
// ---------------------------------------------------------------------------

type Region = "americas" | "europe" | "mideast" | "asia" | "africa" | "oceania";

const REGION_COLOR: Record<Region, RGB> = {
  americas: RED,
  europe: BLUE,
  mideast: ORANGE,
  asia: PURPLE,
  africa: GREEN,
  oceania: TEAL,
};

interface MainStory {
  n: number;
  region: Region;
  kicker: string;
  headline: string;
  deck: string;
  lon: number;
  lat: number;
  art: string;
}

const MAIN_STORIES: MainStory[] = [
  {
    n: 1,
    region: "mideast",
    kicker: "THE GULF - WAR",
    headline: "US jets strike Qeshm; Iran hits Bahrain and Kuwait",
    deck: "US fighter jets hit a Revolutionary Guard missile site on Qeshm Island after Iran fired drones at a US radar in Bahrain, its third attack in five days. Iran then fired at Kuwait; an ADNOC vessel was hit, 11 hurt.",
    lon: 56,
    lat: 26.5,
    art: "gulf",
  },
  {
    n: 2,
    region: "asia",
    kicker: "ASIA - APEC SUMMIT",
    headline: "Xi and Putin open APEC; Trump to join talks",
    deck: "China's Xi Jinping and Russia's Vladimir Putin opened the APEC summit in Shenzhen, Xi urging free trade and Putin denouncing Western sanctions, a day before the planned meeting with President Trump.",
    lon: 114,
    lat: 22.5,
    art: "apec",
  },
  {
    n: 3,
    region: "americas",
    kicker: "US - SENATE",
    headline: "Peltola flips Alaska; Democrats take Senate",
    deck: "Democrat Mary Peltola defeated Republican Dan Sullivan in Alaska's Senate race, giving Democrats a 56-44 majority - their largest since 2009 and a ninth Senate flip of the midterms.",
    lon: -150,
    lat: 64,
    art: "senate",
  },
  {
    n: 4,
    region: "europe",
    kicker: "UKRAINE - WAR",
    headline: "Kerch Bridge hit for a second day",
    deck: "Second day of strikes: a road span fell.",
    lon: 36.5,
    lat: 45.3,
    art: "kerch",
  },
  {
    n: 5,
    region: "africa",
    kicker: "AFRICA - HEALTH",
    headline: "Ebola in DR Congo passes 11,000 cases",
    deck: "Over 11,000 cases and 5,400 deaths, the UN said.",
    lon: 25,
    lat: -2,
    art: "ebola",
  },
  {
    n: 6,
    region: "americas",
    kicker: "US - BUSINESS",
    headline: "Nvidia sales double to $115.8bn",
    deck: "$115.8bn in sales, more than double a year earlier.",
    lon: -122,
    lat: 37.4,
    art: "nvidia",
  },
  {
    n: 7,
    region: "americas",
    kicker: "US - HEALTH",
    headline: "US loses measles-free status after 26 years",
    deck: "Measles-free status lost after 26 years; 5,412 cases.",
    lon: -98,
    lat: 39,
    art: "measles",
  },
  {
    n: 8,
    region: "oceania",
    kicker: "SPACE",
    headline: "Voyager 1 reaches one light-day",
    deck: "One light-day out - 16 billion miles, a first.",
    lon: -150,
    lat: -30,
    art: "voyager",
  },
  {
    n: 9,
    region: "oceania",
    kicker: "PACIFIC - WEATHER",
    headline: "Category 5 Cyclone Xavier hits",
    deck: "Category 5 over the Northern Cook Islands.",
    lon: -160,
    lat: -10,
    art: "cyclone",
  },
  {
    n: 10,
    region: "americas",
    kicker: "US - TECHNOLOGY",
    headline: "Tech outages hit US banks and the NSA",
    deck: "NSA network down, the latest of eight US outages.",
    lon: -77,
    lat: 39,
    art: "outage",
  },
  {
    n: 11,
    region: "europe",
    kicker: "RUSSIA - AIR CRASH",
    headline: "Russian An-12 crashes in Siberia",
    deck: "Russian An-12 crashes in Kemerovo; all 19 killed.",
    lon: 86,
    lat: 55.3,
    art: "crash",
  },
  {
    n: 12,
    region: "mideast",
    kicker: "MIDDLE EAST - GAZA",
    headline: "Gaza ceasefire may collapse",
    deck: "The Board of Peace warns the ceasefire may collapse.",
    lon: 34.5,
    lat: 31.5,
    art: "gaza",
  },
  {
    n: 13,
    region: "europe",
    kicker: "WORLD COURT - JUSTICE",
    headline: "World Court to rule on Myanmar",
    deck: "The court rules Thursday on Myanmar.",
    lon: 4.3,
    lat: 52.1,
    art: "court",
  },
];

interface DigestItem {
  text: string;
  lon: number;
  lat: number;
  region: Region;
}

// Stories 14-43: one line each, in the digest columns, dots on the map.
const DIGEST: DigestItem[] = [
  { text: "Russia fires 141 drones; 126 downed", lon: 32, lat: 49, region: "europe" },
  { text: "165 battles; Pokrovsk hottest", lon: 37.2, lat: 48.3, region: "europe" },
  { text: "US scolds Kyiv on deep strikes", lon: 30.5, lat: 50.5, region: "europe" },
  { text: "Knesset elects Matan Kahana speaker", lon: 35.2, lat: 31.8, region: "mideast" },
  { text: "Iran says it downed a US MQ-9 near", lon: 54, lat: 26.5, region: "mideast" },
  { text: "Trump weighs Iran dirty-bomb report", lon: -77, lat: 38.9, region: "americas" },
  { text: "Stocks fall; S&P 500 down 1.03%", lon: -74, lat: 40.7, region: "americas" },
  { text: "France: 140,000 join pay protests", lon: 2.35, lat: 48.86, region: "europe" },
  { text: "Serbia student list takes parliament", lon: 20.5, lat: 44.8, region: "europe" },
  { text: "Turkey seizes opposition TV Sozcu", lon: 28.9, lat: 41, region: "europe" },
  { text: "Moldova shuts airspace after drone", lon: 28.8, lat: 47, region: "europe" },
  { text: "Romania: 5.3 quake felt in Moldova", lon: 26.1, lat: 45.7, region: "europe" },
  { text: "Papua New Guinea: 6.0 quake strikes", lon: 147, lat: -6.3, region: "oceania" },
  { text: "Five EU states plan Rwanda return", lon: 4.4, lat: 50.8, region: "europe" },
  { text: "27 years for Iran-linked plot on Trump", lon: -77, lat: 38.9, region: "americas" },
  { text: "US soldier held in UK moved to US", lon: -0.1, lat: 51.5, region: "europe" },
  { text: "Houthis press toward Aden", lon: 45, lat: 12.8, region: "mideast" },
  { text: "Clashes near Eritrea raise war fears", lon: 39, lat: 15, region: "africa" },
  { text: "South Korea lifts 2027 growth to 3.9%", lon: 127, lat: 37.5, region: "asia" },
  { text: "France-Malaysia pact on rare earths", lon: 101.7, lat: 3.1, region: "asia" },
  { text: "Brazil real falls on Lula fiscal plan", lon: -47.9, lat: -15.8, region: "americas" },
  { text: "Europe pays up for LNG with gas stocks", lon: 4.9, lat: 52.4, region: "europe" },
  { text: "Pakistan solar share hits 28%", lon: 67, lat: 24.9, region: "asia" },
  { text: "US tightens chip-access rules", lon: -77, lat: 38.9, region: "americas" },
  { text: "Anthropic set to list on Nasdaq", lon: -74, lat: 40.7, region: "americas" },
  { text: "Fiji declares disaster over drought", lon: 178, lat: -17.7, region: "oceania" },
  { text: "WHO warns on drug-resistance threat", lon: 6.1, lat: 46.2, region: "europe" },
  { text: "Juan Mata retires from football at 38", lon: -3.7, lat: 40.4, region: "europe" },
  { text: "Fela Kuti enters Rock Hall of Fame", lon: -81.7, lat: 41.5, region: "americas" },
  { text: "Pattinson named the new James Bond", lon: -0.1, lat: 51.5, region: "europe" },
];

// ---------------------------------------------------------------------------
// World map. Simplified continent outlines in [lon, lat] pairs, drawn in an
// equirectangular projection. Rough but recognisable: the map's job is to
// place the day's stories, not to navigate by.
// ---------------------------------------------------------------------------

type LonLat = [number, number];

const NORTH_AMERICA: LonLat[] = [
  [-168, 66], [-162, 60], [-155, 58], [-148, 60], [-140, 60], [-134, 57],
  [-130, 54], [-126, 49], [-124, 42], [-120, 34], [-114, 29], [-109, 23],
  [-105, 20], [-97, 16], [-93, 15], [-88, 13], [-84, 10], [-80, 8],
  [-78, 8], [-81, 12], [-84, 15], [-87, 16], [-90, 14], [-91, 19],
  [-94, 19], [-97, 22], [-97, 26], [-93, 30], [-89, 30], [-84, 30],
  [-81, 26], [-80, 32], [-76, 35], [-74, 40], [-70, 42], [-66, 45],
  [-60, 47], [-56, 48], [-60, 51], [-65, 51], [-66, 58], [-70, 60],
  [-76, 62], [-82, 63], [-88, 66], [-94, 66], [-98, 69], [-108, 68],
  [-118, 69], [-128, 70], [-140, 70], [-152, 70], [-162, 68], [-168, 66],
];

const GREENLAND: LonLat[] = [
  [-56, 64], [-51, 60], [-43, 60], [-40, 64], [-33, 67], [-25, 70],
  [-20, 73], [-24, 77], [-34, 80], [-45, 80], [-55, 76], [-58, 71],
  [-58, 66], [-56, 64],
];

const SOUTH_AMERICA: LonLat[] = [
  [-79, 9], [-77, 4], [-80, -3], [-81, -6], [-77, -12], [-72, -18],
  [-70, -23], [-70, -30], [-72, -37], [-73, -44], [-74, -50], [-70, -54],
  [-66, -55], [-68, -50], [-65, -45], [-62, -40], [-58, -34], [-52, -32],
  [-48, -28], [-41, -23], [-39, -17], [-35, -9], [-35, -6], [-40, -3],
  [-44, -2], [-50, 0], [-53, 4], [-58, 6], [-62, 9], [-68, 11],
  [-72, 12], [-76, 10], [-79, 9],
];

const AFRICA: LonLat[] = [
  [-6, 35], [-10, 31], [-15, 27], [-17, 21], [-17, 15], [-15, 11],
  [-12, 8], [-8, 5], [-4, 5], [0, 6], [6, 4], [9, 4], [9, 0],
  [12, -4], [13, -10], [12, -17], [14, -22], [16, -28], [19, -34],
  [26, -34], [32, -28], [35, -24], [40, -16], [40, -10], [42, -4],
  [46, -1], [51, 2], [51, 10], [44, 11], [40, 15], [38, 18], [37, 22],
  [34, 27], [32, 31], [30, 31], [25, 32], [20, 32], [15, 32], [11, 34],
  [10, 37], [5, 37], [0, 36], [-6, 35],
];

const EURASIA: LonLat[] = [
  [-10, 36], [-9, 43], [-2, 44], [-1, 46], [-4, 48], [-1, 49], [2, 51],
  [5, 53], [8, 55], [8, 57], [10, 59], [6, 60], [6, 62], [11, 64],
  [14, 66], [19, 69], [25, 71], [30, 70], [35, 68], [41, 68], [46, 68],
  [52, 69], [58, 69], [64, 69], [68, 72], [74, 73], [79, 73], [84, 74],
  [89, 75], [94, 76], [99, 77], [104, 77], [109, 74], [114, 73], [119, 73],
  [124, 72], [129, 72], [134, 71], [139, 72], [144, 72], [149, 70],
  [154, 69], [158, 66], [160, 62], [162, 58], [158, 55], [155, 59],
  [150, 60], [145, 60], [142, 55], [140, 50], [138, 46], [135, 43],
  [132, 43], [129, 41], [127, 39], [124, 38], [122, 37], [120, 33],
  [121, 29], [119, 25], [114, 22], [109, 20], [106, 19], [104, 15],
  [101, 13], [99, 10], [99, 7], [101, 5], [103, 2], [102, 1], [100, 4],
  [98, 7], [96, 10], [94, 16], [92, 21], [89, 22], [86, 20], [82, 17],
  [80, 13], [77, 8], [75, 12], [72, 20], [68, 22], [66, 25], [62, 25],
  [58, 26], [56, 27], [54, 26], [52, 26], [50, 29], [48, 30], [44, 29],
  [40, 28], [38, 24], [36, 21], [35, 18], [39, 15], [43, 12], [45, 12],
  [48, 14], [50, 16], [52, 20], [55, 25], [57, 26], [58, 22], [56, 18],
  [54, 17], [52, 15], [50, 13], [48, 16], [44, 18], [42, 15], [40, 15],
  [38, 20], [36, 22], [34, 27], [33, 31], [30, 36], [27, 36], [26, 38],
  [23, 36], [22, 37], [19, 40], [16, 40], [12, 44], [10, 44], [8, 44],
  [6, 43], [3, 42], [0, 40], [-2, 37], [-6, 36], [-9, 37], [-10, 36],
];

const AUSTRALIA: LonLat[] = [
  [114, -22], [114, -30], [115, -34], [118, -35], [124, -33], [129, -32],
  [132, -32], [135, -35], [138, -35], [140, -38], [145, -38], [150, -37],
  [153, -32], [153, -27], [150, -23], [146, -19], [142, -15], [142, -11],
  [140, -17], [136, -15], [135, -12], [132, -11], [130, -13], [126, -14],
  [122, -17], [118, -20], [114, -22],
];

const UK: LonLat[] = [
  [-5, 50], [-3, 53], [-5, 56], [-3, 58], [-1, 57], [0, 53], [1, 51], [-5, 50],
];

const JAPAN: LonLat[] = [
  [130, 31], [132, 33], [135, 34], [137, 35], [139, 35], [140, 38],
  [141, 41], [142, 44], [143, 42], [141, 40], [139, 37], [136, 35],
  [133, 34], [130, 31],
];

const NEW_ZEALAND: LonLat[] = [
  [167, -45], [170, -43], [173, -41], [175, -38], [177, -38],
  [174, -41], [171, -44], [167, -46], [167, -45],
];

const INDONESIA: LonLat[] = [
  [95, 5], [98, 3], [100, 0], [102, -3], [105, -5], [108, -7], [111, -7],
  [114, -8], [116, -9], [119, -9], [120, -10], [122, -8], [124, -10],
  [127, -8], [129, -3], [131, -1], [128, 1], [126, 1], [124, 1], [121, 0],
  [119, 2], [117, 4], [114, 3], [111, 1], [108, 0], [105, -2], [102, 1],
  [100, 4], [97, 6], [95, 5],
];

const MADAGASCAR: LonLat[] = [
  [44, -16], [47, -15], [50, -16], [50, -20], [47, -24], [45, -25],
  [43, -22], [43, -18], [44, -16],
];

const ICELAND: LonLat[] = [
  [-22, 64], [-18, 63], [-15, 64], [-14, 66], [-18, 66], [-22, 65], [-22, 64],
];

const CONTINENTS: LonLat[][] = [
  NORTH_AMERICA, GREENLAND, SOUTH_AMERICA, AFRICA, EURASIA, AUSTRALIA,
  UK, JAPAN, NEW_ZEALAND, INDONESIA, MADAGASCAR, ICELAND,
];

// Equirectangular projection into a map box: lon -180..180, lat 85..-60.
function project(lon: number, lat: number, mx: number, my: number, mw: number, mh: number): [number, number] {
  const x = mx + ((lon + 180) / 360) * mw;
  const y = my + ((85 - lat) / 145) * mh;
  return [x, y];
}

function drawWorldMap(cv: Canvas, mx: number, my: number, mw: number, mh: number): void {
  cv.rect(mx, my, mw, mh, SEA);
  // Faint latitude/longitude graticule.
  const grid: RGB = [150, 185, 210];
  for (let lon = -150; lon <= 150; lon += 30) {
    const [x] = project(lon, 0, mx, my, mw, mh);
    for (let y = my; y < my + mh; y += 2) cv.set(x, y, grid);
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const [, y] = project(0, lat, mx, my, mw, mh);
    for (let x = mx; x < mx + mw; x += 2) cv.set(x, y, grid);
  }
  for (const land of CONTINENTS) {
    const pts = land.map(([lon, lat]) => project(lon, lat, mx, my, mw, mh));
    cv.poly(pts, TAN);
    cv.strokePoly(pts, TAN_DARK);
  }
  // Numbered pins for the 13 main stories, dots for digest stories 14-43.
  for (const s of MAIN_STORIES) {
    const [x, y] = project(s.lon, s.lat, mx, my, mw, mh);
    const col = REGION_COLOR[s.region];
    if (s.n === 8) {
      // Voyager 1 is in deep space, not on Earth: a star out in the Pacific.
      cv.starburst(x, y, 7, 8, WHITE);
      cv.circle(x, y, 3, col);
      drawText(cv, x + 9, y - 3, "8", 1, INK, true);
      continue;
    }
    cv.circle(x, y, 8, WHITE);
    cv.ring(x, y, 8, col);
    cv.ring(x, y, 7, col);
    const label = String(s.n);
    drawText(cv, x - Math.floor(textWidth(label, 1) / 2), y - 3, label, 1, col, true);
  }
  for (const d of DIGEST) {
    const [x, y] = project(d.lon, d.lat, mx, my, mw, mh);
    cv.circle(x, y, 2, REGION_COLOR[d.region]);
    cv.ring(x, y, 3, WHITE);
  }
}

function drawMapLegend(cv: Canvas, x: number, y: number): void {
  const items: Array<[string, RGB]> = [
    ["Americas", RED],
    ["Europe", BLUE],
    ["Middle East", ORANGE],
    ["Asia", PURPLE],
    ["Africa", GREEN],
    ["Oceania", TEAL],
  ];
  let cx = x;
  for (const [label, col] of items) {
    cv.circle(cx + 3, y + 3, 3, col);
    drawText(cv, cx + 9, y, label, 1, INK);
    cx += 9 + textWidth(label, 1) + 10;
  }
  drawText(cv, x, y + 11, "Pins: stories 1-13. Dots: stories 14-43.", 1, INK);
}

// ---------------------------------------------------------------------------
// Story illustrations. Every scene is drawn with the primitives above —
// no photos, no network, nothing copied in. Each function fills its box.
// ---------------------------------------------------------------------------

function artGulf(cv: Canvas, x: number, y: number, w: number, h: number): void {
  // Sky, sea, Qeshm Island, two jets, a carrier, an explosion over the island.
  cv.rect(x, y, w, Math.floor(h * 0.45), [168, 205, 228]);
  cv.rect(x, y + Math.floor(h * 0.45), w, h - Math.floor(h * 0.45), SEA_DARK);
  cv.hline(x, x + w, y + Math.floor(h * 0.45), [90, 130, 170]);
  // Qeshm Island: a low tan shape mid-sea.
  const iy = y + Math.floor(h * 0.62);
  cv.poly(
    [
      [x + w * 0.42, iy],
      [x + w * 0.52, iy - 14],
      [x + w * 0.72, iy - 16],
      [x + w * 0.86, iy - 6],
      [x + w * 0.88, iy + 4],
      [x + w * 0.55, iy + 8],
      [x + w * 0.44, iy + 4],
    ],
    [224, 200, 140],
  );
  // Carrier: dark hull with a flat deck, lower left.
  const cy = y + Math.floor(h * 0.78);
  cv.rect(x + w * 0.06, cy, w * 0.3, 7, [30, 30, 30]);
  cv.rect(x + w * 0.08, cy - 8, w * 0.12, 8, [50, 50, 50]);
  cv.rect(x + w * 0.06, cy - 2, w * 0.3, 3, [70, 70, 70]);
  // Small patrol boat.
  cv.tri(x + w * 0.62, cy + 2, x + w * 0.68, cy + 2, x + w * 0.65, cy - 5, [40, 40, 40]);
  // Two jets diving from the top left, with contrails.
  for (const [jx, jy] of [
    [x + w * 0.16, y + h * 0.14],
    [x + w * 0.3, y + h * 0.07],
  ] as Array<[number, number]>) {
    cv.line(jx - 26, jy - 12, jx, jy, WHITE);
    cv.line(jx - 26, jy - 10, jx, jy + 2, WHITE);
    cv.tri(jx, jy, jx - 16, jy - 4, jx - 14, jy + 5, [45, 45, 45]);
    cv.tri(jx - 2, jy - 5, jx - 2, jy + 6, jx + 8, jy, [45, 45, 45]);
  }
  // Explosion over the island: orange starburst + smoke.
  const ex = x + w * 0.62;
  const ey = iy - 22;
  cv.starburst(ex, ey, 15, 10, [255, 170, 30]);
  cv.starburst(ex, ey, 8, 8, [255, 230, 120]);
  cv.circle(ex - 12, ey - 14, 5, [120, 120, 120]);
  cv.circle(ex + 10, ey - 18, 4, [140, 140, 140]);
  drawText(cv, x + 6, y + 6, "QESHM", 1, INK, true);
  drawTextRight(cv, x + w - 6, y + h - 12, "HORMUZ", 1, WHITE, true);
}

function drawFlag(cv: Canvas, x: number, y: number, w: number, h: number, kind: "china" | "russia" | "usa"): void {
  if (kind === "china") {
    cv.rect(x, y, w, h, [222, 40, 40]);
    cv.starburst(x + 6, y + 5, 4, 5, [255, 220, 60]);
    cv.circle(x + w - 6, y + 4, 1, [255, 220, 60]);
    cv.circle(x + w - 5, y + 9, 1, [255, 220, 60]);
  } else if (kind === "russia") {
    cv.rect(x, y, w, Math.ceil(h / 3), WHITE);
    cv.rect(x, y + Math.ceil(h / 3), w, Math.ceil(h / 3), [0, 70, 180]);
    cv.rect(x, y + (2 * Math.ceil(h / 3)), w, h - 2 * Math.ceil(h / 3), [220, 30, 30]);
  } else {
    for (let i = 0; i < 7; i++) cv.rect(x, y + i * Math.ceil(h / 7), w, Math.ceil(h / 14), i % 2 === 0 ? [190, 40, 50] : WHITE);
    cv.rect(x, y, Math.floor(w * 0.45), Math.floor(h * 0.55), [30, 50, 130]);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) cv.set(x + 2 + c * 4, y + 2 + r * 4, WHITE);
  }
}

function artApec(cv: Canvas, x: number, y: number, w: number, h: number): void {
  // Shenzhen skyline at dusk, three flags above it.
  cv.rect(x, y, w, h, [214, 226, 232]);
  const base = y + h - 22;
  const towers: Array<[number, number, number]> = [
    [0.02, 0.1, 0.5], [0.14, 0.16, 0.72], [0.3, 0.12, 0.58], [0.44, 0.18, 0.85],
    [0.62, 0.13, 0.66], [0.76, 0.17, 0.78], [0.9, 0.09, 0.55],
  ];
  for (const [fx, fw, fh] of towers) {
    cv.rect(x + w * fx, base - h * fh, w * fw, h * fh + 22, [110, 118, 128]);
    for (let wy = base - h * fh + 5; wy < base - 4; wy += 9) {
      for (let wx = x + w * fx + 4; wx < x + w * (fx + fw) - 4; wx += 8) cv.set(wx, wy, [255, 220, 120]);
    }
  }
  cv.rect(x, base, w, 22, [122, 84, 52]);
  // Flag poles.
  const poles: Array<[number, "china" | "russia" | "usa"]> = [
    [0.2, "china"],
    [0.48, "russia"],
    [0.76, "usa"],
  ];
  for (const [fx, kind] of poles) {
    const px = x + w * fx;
    cv.vline(px, y + 6, base, DARK);
    drawFlag(cv, px + 1, y + 8, 26, 15, kind);
  }
  drawTextCentered(cv, x + w / 2, y + h - 17, "SHENZHEN", 1, WHITE, true);
}

function artSenate(cv: Canvas, x: number, y: number, w: number, h: number): void {
  // A hemicycle of seats: blue on the left, red on the right, 56-44.
  cv.rect(x, y, w, h, [240, 234, 214]);
  drawTextCentered(cv, x + w / 2, y + 4, "DEMOCRATS 56 - 44", 1, INK, true);
  const cx = x + w / 2;
  const cy = y + h - 12;
  const rows = [0.72, 0.57, 0.42, 0.27];
  for (let r = 0; r < rows.length; r++) {
    const rad = h * rows[r];
    const seats = 15 + r * 4;
    for (let s = 0; s < seats; s++) {
      const ang = Math.PI + (s / (seats - 1)) * Math.PI;
      const px = cx + rad * 1.15 * Math.cos(ang);
      const py = cy + rad * 0.72 * Math.sin(ang);
      // Left half blue (56), right half red (44).
      cv.circle(px, py, 4, px < cx ? BLUE : RED);
    }
  }
  cv.circle(cx, cy - 4, 6, [90, 90, 90]);
  drawText(cv, x + 8, y + h - 26, "56", 2, BLUE, true);
  drawTextRight(cv, x + w - 8, y + h - 26, "44", 2, RED, true);
}

function artKerch(cv: Canvas, x: number, y: number, w: number, h: number): void {
  // A bridge over the strait, its middle span dropped, smoke rising.
  cv.rect(x, y, w, h, [196, 216, 228]);
  const wy = y + Math.floor(h * 0.6);
  cv.rect(x, wy, w, h - Math.floor(h * 0.6), SEA_DARK);
  const deckY = y + Math.floor(h * 0.42);
  cv.rect(x + 4, deckY, w * 0.38, 5, [80, 80, 80]);
  cv.rect(x + w * 0.62, deckY, w * 0.36, 5, [80, 80, 80]);
  // Dropped span, tilted into the water.
  cv.line(x + w * 0.42, deckY + 2, x + w * 0.58, wy + 12, [80, 80, 80]);
  cv.line(x + w * 0.42, deckY + 5, x + w * 0.58, wy + 15, [80, 80, 80]);
  // Piers.
  for (const fx of [0.14, 0.3, 0.68, 0.86]) cv.rect(x + w * fx, deckY + 5, 4, wy - deckY, [60, 60, 60]);
  // Smoke puffs above the gap.
  cv.circle(x + w * 0.5, deckY - 12, 7, [110, 110, 110]);
  cv.circle(x + w * 0.56, deckY - 20, 5, [130, 130, 130]);
  cv.circle(x + w * 0.46, deckY - 22, 4, [140, 140, 140]);
  drawText(cv, x + 6, y + 5, "KERCH STRAIT", 1, INK, true);
}

function artEbola(cv: Canvas, x: number, y: number, w: number, h: number): void {
  // Case clusters as red dots over a pale map of Africa, with a red cross.
  cv.rect(x, y, w, h, [242, 236, 214]);
  drawText(cv, x + 6, y + 5, "11,000+ CASES", 1, RED, true);
  // Stylised Africa silhouette (small, centred left).
  cv.poly(
    [
      [x + 22, y + 18], [x + 34, y + 14], [x + 48, y + 16], [x + 54, y + 24],
      [x + 50, y + 34], [x + 56, y + 44], [x + 50, y + 56], [x + 40, y + 62],
      [x + 30, y + 56], [x + 24, y + 44], [x + 18, y + 32], [x + 22, y + 18],
    ],
    [222, 205, 160],
  );
  // Red dots: the outbreak, densest in the centre.
  const dots: Array<[number, number, number]> = [
    [36, 30, 3], [42, 38, 2], [30, 42, 2], [46, 30, 2], [38, 48, 3],
    [28, 28, 2], [50, 40, 2], [34, 54, 2], [44, 52, 2], [26, 36, 1],
    [52, 34, 1], [40, 22, 1], [32, 60, 1], [48, 58, 1],
  ];
  for (const [dx, dy, r] of dots) cv.circle(x + dx, y + dy, r, RED);
  // Medical cross, small, bottom right.
  const kx = x + w - 26;
  const ky = y + h - 26;
  cv.rect(kx - 3, ky - 9, 6, 18, RED);
  cv.rect(kx - 9, ky - 3, 18, 6, RED);
  drawText(cv, x + 6, y + h - 12, "5,400 DEAD", 1, INK, true);
}

function artNvidia(cv: Canvas, x: number, y: number, w: number, h: number): void {
  // Dark board, green bars climbing, the number in bright green.
  cv.rect(x, y, w, h, [12, 40, 22]);
  drawText(cv, x + 6, y + 5, "NVDA", 1, [120, 220, 140], true);
  const base = y + h - 16;
  const bars = [0.2, 0.28, 0.24, 0.4, 0.52, 0.68, 0.9];
  const bw = Math.floor((w - 16) / bars.length);
  for (let i = 0; i < bars.length; i++) {
    const bh = Math.floor((h - 30) * bars[i]);
    cv.rect(x + 8 + i * bw, base - bh, bw - 3, bh, i === bars.length - 1 ? [90, 230, 120] : [30, 160, 80]);
  }
  drawText(cv, x + 6, y + h - 13, "$115.8BN", 1, [150, 240, 160], true);
  drawTextRight(cv, x + w - 6, y + 5, "DOUBLE", 1, [150, 240, 160], true);
}

function artMeasles(cv: Canvas, x: number, y: number, w: number, h: number): void {
  // A field of red rash dots, densest at the centre, with the case count.
  cv.rect(x, y, w, h, [242, 236, 214]);
  drawText(cv, x + 6, y + 5, "5,412 CASES", 1, RED, true);
  // Deterministic pseudo-random scatter from a fixed seed sequence.
  let seed = 1234567;
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < 46; i++) {
    const px = x + 8 + rnd() * (w - 16);
    const py = y + 18 + rnd() * (h - 30);
    const near = Math.abs(px - (x + w / 2)) < w * 0.22 && Math.abs(py - (y + h / 2 + 6)) < h * 0.22;
    cv.circle(px, py, near ? 3 : 2, RED);
  }
  cv.circle(x + w / 2, y + h / 2 + 6, 5, RED);
  drawText(cv, x + 6, y + h - 12, "26 YEARS LOST", 1, INK, true);
}

function artVoyager(cv: Canvas, x: number, y: number, w: number, h: number): void {
  // Black space, a yellow sun, a tiny probe with its dish, a star field.
  cv.rect(x, y, w, h, [8, 10, 24]);
  let seed = 987654;
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < 34; i++) {
    cv.set(x + 4 + rnd() * (w - 8), y + 4 + rnd() * (h - 8), rnd() > 0.5 ? WHITE : [180, 180, 200]);
  }
  // The Sun, bottom left.
  cv.circle(x + 18, y + h - 16, 11, [255, 210, 60]);
  cv.starburst(x + 18, y + h - 16, 17, 10, [255, 210, 60]);
  // Voyager: bus + dish + boom, top right.
  const vx = x + w - 42;
  const vy = y + 18;
  cv.rect(vx, vy, 12, 7, [200, 200, 210]);
  cv.line(vx + 12, vy + 3, vx + 22, vy - 4, [200, 200, 210]);
  cv.tri(vx + 22, vy - 8, vx + 22, vy + 2, vx + 30, vy - 3, [220, 220, 230]);
  cv.line(vx + 2, vy + 7, vx - 6, vy + 14, [160, 160, 170]);
  drawText(cv, x + 6, y + 5, "1 LIGHT-DAY", 1, WHITE, true);
  drawTextRight(cv, x + w - 6, y + h - 12, "16BN MILES", 1, WHITE, true);
}

function artCyclone(cv: Canvas, x: number, y: number, w: number, h: number): void {
  // A spiral storm seen from above, over a pale sea.
  cv.rect(x, y, w, h, [200, 220, 235]);
  const cx = x + w / 2;
  const cy = y + h / 2 + 4;
  // Spiral arms: three arcs winding outwards.
  for (let arm = 0; arm < 3; arm++) {
    let px = cx;
    let py = cy;
    for (let t = 0; t < 300; t += 4) {
      const a = (t * Math.PI) / 180 + (arm * 2 * Math.PI) / 3;
      const r = 3 + t * 0.11;
      const nx = cx + r * Math.cos(a);
      const ny = cy + r * Math.sin(a) * 0.85;
      cv.line(px, py, nx, ny, arm === 0 ? [30, 80, 160] : [70, 120, 190]);
      px = nx;
      py = ny;
    }
  }
  cv.circle(cx, cy, 5, WHITE);
  cv.ring(cx, cy, 5, [30, 80, 160]);
  drawText(cv, x + 6, y + 5, "315 KM/H", 1, INK, true);
  drawTextRight(cv, x + w - 6, y + h - 12, "CAT 5", 1, [30, 80, 160], true);
}

function artOutage(cv: Canvas, x: number, y: number, w: number, h: number): void {
  // Server racks going dark, one red row, a warning triangle.
  cv.rect(x, y, w, h, [22, 24, 30]);
  for (let rack = 0; rack < 3; rack++) {
    const rx = x + 8 + rack * Math.floor((w - 16) / 3);
    const rw = Math.floor((w - 16) / 3) - 6;
    cv.rect(rx, y + 8, rw, h - 20, [40, 44, 52]);
    for (let row = 0; row < 4; row++) {
      const ry = y + 12 + row * 11;
      const lit = rack === 2 && row === 1 ? RED : [70, 200, 110];
      cv.rect(rx + 4, ry, rw - 8, 4, [20, 20, 24]);
      cv.circle(rx + rw - 8, ry + 2, 2, lit);
    }
  }
  // Warning triangle, top right.
  const tx = x + w - 24;
  const ty = y + 12;
  cv.tri(tx, ty, tx - 10, ty + 18, tx + 10, ty + 18, [255, 200, 40]);
  drawText(cv, tx - 2, ty + 5, "!", 1, [22, 24, 30], true);
  drawText(cv, x + 6, y + h - 13, "NSA DOWN", 1, [255, 200, 40], true);
}

function artCrash(cv: Canvas, x: number, y: number, w: number, h: number): void {
  // Grey sky, snow-capped mountains, a plane going down with a smoke trail.
  cv.rect(x, y, w, h, [206, 216, 226]);
  const base = y + h - 6;
  cv.poly(
    [[x, base], [x + w * 0.3, y + h * 0.42], [x + w * 0.55, base]],
    [150, 158, 168],
  );
  cv.poly(
    [[x + w * 0.4, base], [x + w * 0.68, y + h * 0.34], [x + w, base]],
    [128, 138, 150],
  );
  cv.tri(x + w * 0.26, y + h * 0.5, x + w * 0.34, y + h * 0.5, x + w * 0.3, y + h * 0.42, WHITE);
  cv.tri(x + w * 0.64, y + h * 0.44, x + w * 0.72, y + h * 0.44, x + w * 0.68, y + h * 0.34, WHITE);
  // The plane, nose down, with a smoke trail behind it.
  const px = x + w * 0.62;
  const py = y + h * 0.2;
  cv.line(px - 40, py - 26, px - 6, py - 6, [150, 150, 150]);
  cv.circle(px - 42, py - 27, 3, [150, 150, 150]);
  cv.tri(px, py, px - 18, py - 6, px - 16, py + 4, [50, 50, 50]);
  cv.tri(px - 2, py - 7, px - 2, py + 5, px + 10, py - 2, [50, 50, 50]);
  drawText(cv, x + 6, y + 5, "19 KILLED", 1, INK, true);
}

function artGaza(cv: Canvas, x: number, y: number, w: number, h: number): void {
  // A row of tents under a cold grey sky, frost on the ground.
  cv.rect(x, y, w, h, [226, 228, 224]);
  cv.rect(x, y + h - 14, w, 14, [200, 208, 214]);
  const base = y + h - 14;
  for (let i = 0; i < 4; i++) {
    const tx = x + 8 + i * Math.floor((w - 16) / 4);
    const tw = Math.floor((w - 16) / 4) - 4;
    cv.tri(tx, base, tx + tw / 2, base - 26, tx + tw, base, [244, 240, 228]);
    cv.line(tx, base, tx + tw / 2, base - 26, [150, 150, 140]);
    cv.line(tx + tw, base, tx + tw / 2, base - 26, [150, 150, 140]);
    cv.rect(tx + tw / 2 - 2, base - 8, 4, 8, [90, 90, 90]);
  }
  // Snowflakes drifting.
  cv.set(x + w * 0.2, y + 12, [120, 130, 150]);
  cv.set(x + w * 0.5, y + 8, [120, 130, 150]);
  cv.set(x + w * 0.8, y + 14, [120, 130, 150]);
  cv.set(x + w * 0.65, y + 20, [120, 130, 150]);
  drawText(cv, x + 6, y + 5, "COLD IN TENTS", 1, INK, true);
}

function artCourt(cv: Canvas, x: number, y: number, w: number, h: number): void {
  // The Peace Palace: pediment, columns, steps, a small scales emblem.
  cv.rect(x, y, w, h, [232, 228, 212]);
  const base = y + h - 12;
  cv.rect(x + 10, base, w - 20, 4, [160, 155, 140]);
  cv.rect(x + 16, base - 4, w - 32, 4, [175, 170, 155]);
  const top = y + 18;
  cv.tri(x + w * 0.18, top + 14, x + w * 0.82, top + 14, x + w * 0.5, top, [190, 185, 170]);
  cv.rect(x + w * 0.18, top + 14, w * 0.64, 3, [160, 155, 140]);
  for (let i = 0; i < 5; i++) {
    const cx0 = x + w * (0.22 + i * 0.14);
    cv.rect(cx0, top + 17, 7, base - 4 - (top + 17), [245, 242, 232]);
    cv.rect(cx0 - 1, top + 17, 9, 3, [160, 155, 140]);
  }
  // Scales of justice, small, in the pediment.
  const sx = x + w / 2;
  const sy = top + 8;
  cv.vline(sx, sy - 4, sy + 4, INK);
  cv.hline(sx - 5, sx + 5, sy - 4, INK);
  cv.line(sx - 5, sy - 4, sx - 7, sy + 3, INK);
  cv.line(sx + 5, sy - 4, sx + 7, sy + 3, INK);
  drawText(cv, x + 6, y + h - 11, "THE HAGUE", 1, INK, true);
}

const ART: Record<string, (cv: Canvas, x: number, y: number, w: number, h: number) => void> = {
  gulf: artGulf,
  apec: artApec,
  senate: artSenate,
  kerch: artKerch,
  ebola: artEbola,
  nvidia: artNvidia,
  measles: artMeasles,
  voyager: artVoyager,
  cyclone: artCyclone,
  outage: artOutage,
  crash: artCrash,
  gaza: artGaza,
  court: artCourt,
};

// ---------------------------------------------------------------------------
// Page layout. One broadsheet: kicker, masthead, three big stories, two
// rows of five, then the world map beside the 30-item digest, then a footer.
// ---------------------------------------------------------------------------

const PAGE_W = 1024;
const PAGE_H = 1024;
const MARGIN = 10;
const CONTENT_W = PAGE_W - 2 * MARGIN;

// Bold wrapped headline; returns the y just below the last line.
function drawHeadline(cv: Canvas, x: number, y: number, text: string, maxW: number, scale: number, maxLines: number): number {
  const lineH = 7 * scale + 4;
  const lines = wrapText(text, maxW, scale).slice(0, maxLines);
  for (let i = 0; i < lines.length; i++) drawText(cv, x, y + i * lineH, lines[i], scale, INK, true);
  return y + lines.length * lineH;
}

// One of the three lead stories: big art, kicker, 3-line headline, deck.
function drawBigStory(cv: Canvas, s: MainStory, x: number, y: number, w: number): void {
  const artH = 118;
  ART[s.art](cv, x, y, w, artH);
  cv.frame(x, y, w, artH, INK);
  let cy = y + artH + 5;
  drawText(cv, x, cy, `${s.n} ${s.kicker}`, 1, RED, true);
  cy += 11;
  cy = drawHeadline(cv, x, cy, s.headline, w, 3, 3);
  cy += 2;
  drawPara(cv, x, cy, s.deck, w, 1, INK, 9, 4);
}

// One of the ten smaller stories: small art, kicker, headline, deck.
function drawSmallStory(cv: Canvas, s: MainStory, x: number, y: number, w: number): void {
  const artH = 74;
  ART[s.art](cv, x, y, w, artH);
  cv.frame(x, y, w, artH, INK);
  let cy = y + artH + 4;
  drawText(cv, x, cy, `${s.n} ${s.kicker}`, 1, RED, true);
  cy += 11;
  cy = drawHeadline(cv, x, cy, s.headline, w, 2, 4);
  cy += 2;
  drawPara(cv, x, cy, s.deck, w, 1, INK, 9, 5);
}

// One digest column: numbered one-liners, numbers coloured by region.
function drawDigestColumn(cv: Canvas, x: number, y: number, items: DigestItem[], firstN: number): void {
  for (let i = 0; i < items.length; i++) {
    const d = items[i];
    const ly = y + i * 11;
    const num = String(firstN + i);
    drawText(cv, x, ly, num, 1, REGION_COLOR[d.region], true);
    drawText(cv, x + 18, ly, d.text, 1, INK);
  }
}

function buildPage(): Canvas {
  const cv = new Canvas(PAGE_W, PAGE_H, PAPER);

  // Top kicker strip.
  drawText(cv, MARGIN, 6, "THE WORLD'S NEWS IN ONE PICTURE", 1, RED, true);
  drawTextRight(cv, PAGE_W - MARGIN, 6, "43 STORIES · 6 CONTINENTS · ALL FROM WEDNESDAY", 1, INK, true);

  // Masthead.
  drawTextCentered(cv, PAGE_W / 2, 18, "Wednesday 18 November 2026", 6, INK, true);
  cv.rect(MARGIN, 64, CONTENT_W, 2, INK);
  cv.rect(MARGIN, 68, CONTENT_W, 1, INK);

  // Row 1: three lead stories.
  const row1X = [MARGIN, 348, 686];
  for (let i = 0; i < 3; i++) drawBigStory(cv, MAIN_STORIES[i], row1X[i], 76, 328);
  cv.rect(MARGIN, 329, CONTENT_W, 1, INK);

  // Rows 2 and 3: five stories each.
  const rowX = [MARGIN, 213, 416, 619, 822];
  for (let i = 0; i < 5; i++) drawSmallStory(cv, MAIN_STORIES[3 + i], rowX[i], 336, 192);
  cv.rect(MARGIN, 546, CONTENT_W, 1, INK);
  for (let i = 0; i < 5; i++) drawSmallStory(cv, MAIN_STORIES[8 + i], rowX[i], 553, 192);
  cv.rect(MARGIN, 763, CONTENT_W, 1, INK);

  // Bottom: world map (left) and digest (right).
  drawText(cv, MARGIN, 770, "WHERE IT HAPPENED", 1, RED, true);
  drawText(cv, 512, 770, "ALSO ON WEDNESDAY 18 NOVEMBER", 1, RED, true);
  drawWorldMap(cv, MARGIN, 782, 492, 186);
  cv.frame(MARGIN, 782, 492, 186, INK);
  drawMapLegend(cv, MARGIN + 4, 782 + 186 - 24);
  drawDigestColumn(cv, 512, 782, DIGEST.slice(0, 15), 14);
  drawDigestColumn(cv, 768, 782, DIGEST.slice(15, 30), 29);

  // Footer.
  drawTextCentered(
    cv,
    PAGE_W / 2,
    994,
    "Every story here happened or was first reported on Wednesday 18 November 2026.",
    1,
    INK,
  );

  return cv;
}

function main(): void {
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "out";
  mkdirSync(outDir, { recursive: true });
  const cv = buildPage();
  const png = encodePng(PAGE_W, PAGE_H, cv.px);
  writeFileSync(`${outDir}/entry.png`, png);
}

main();
