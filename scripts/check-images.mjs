/**
 * check-images.mjs —— 看看图片收得怎么样了
 *
 * 用法：
 *   node scripts/check-images.mjs                     # 默认看 D:\interestip-images（原图收件箱）
 *   node scripts/check-images.mjs <目录>               # 也可以指向别处
 *
 * 期望的摆放（文件名 = 地点 id）：
 *   <目录>\hero-seoul.jpg            首尔 hero
 *   <目录>\hero-nyc.jpg              纽约 hero
 *   <目录>\places\<地点id>.jpg        每个地点的小图，例如 places\nyc-met.jpg
 *
 * 没按 id 命名的文件也会被列出来，你告诉我哪个是哪个就行。
 * 支持 .jpg / .jpeg / .png / .webp。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const DEFAULT_ASSETS = "D:\\interestip-images"; // 原图收件箱（放 D 盘省 C 盘空间）
// 可以传入自定义目录（比如 D:\interestip-images），原图放别的盘也能查
const ASSETS = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_ASSETS;
const PLACES_DIR = path.join(ASSETS, "places");
const REL = ASSETS + path.sep;
const HTML = path.join(ROOT, "web-preview", "index.html");
const EXTS = [".jpg", ".jpeg", ".png", ".webp", ".avif"];

/** 从 index.html 里把当前所有地点 id 抓出来 */
function placeIds() {
  const s = fs.readFileSync(HTML, "utf8");
  const ids = new Set();
  for (const m of s.matchAll(/\bid:\s*"((?:cortis|nyc|vs|demo)-[A-Za-z0-9]+)"/g)) ids.add(m[1]);
  for (const m of s.matchAll(/"id":"((?:cortis|nyc|vs|demo)-[A-Za-z0-9]+)"/g)) ids.add(m[1]);
  // 已经有官方图的（首尔 P2 观光点）不用你找
  const withImg = new Set();
  const im = s.match(/let PLACE_IMAGES=(\{[\s\S]*?\n\});/);
  if (im) for (const m of im[1].matchAll(/"((?:cortis|nyc|vs|demo)-[A-Za-z0-9]+)":/g)) withImg.add(m[1]);
  return [...ids].filter((id) => !withImg.has(id)).sort();
}

/** 读图片尺寸（只解析文件头，不依赖任何库） */
function dims(file) {
  try {
    const b = fs.readFileSync(file);
    if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; // PNG
    // AVIF / HEIF（ISO-BMFF 容器）：ispe 盒 = [size:4]["ispe":4][version+flags:4][width:4][height:4]
    const ispe = b.indexOf(Buffer.from("ispe", "ascii"));
    if (ispe > 0 && b.length > ispe + 16) return { w: b.readUInt32BE(ispe + 8), h: b.readUInt32BE(ispe + 12) };
    if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
      let i = 2; // JPEG：找 SOF 段
      while (i < b.length - 9) {
        if (b[i] !== 0xff) { i += 1; continue; }
        const mk = b[i + 1];
        const len = b.readUInt16BE(i + 2);
        if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) {
          return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
        }
        i += 2 + len;
      }
    }
  } catch { /* 忽略 */ }
  return null;
}

function findFile(id, dir) {
  for (const ext of EXTS) {
    const p = path.join(dir, id + ext);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function describe(p) {
  const st = fs.statSync(p);
  const d = dims(p);
  const kb = Math.round(st.size / 1024);
  const flags = [];
  if (kb > 400) flags.push("偏大");
  if (d && d.w < 800) flags.push("分辨率偏低");
  return `${String(kb).padStart(4)} KB${d ? `  ${d.w}x${d.h}` : ""}${flags.length ? "  ⚠ " + flags.join("/") : ""}`;
}

const ids = placeIds();
const heroes = ["hero-seoul", "hero-nyc"];

console.log("图片收取情况\n");

console.log("【Hero 大图】" + REL);
let heroGot = 0;
for (const h of heroes) {
  const p = findFile(h, ASSETS);
  if (p) { heroGot++; console.log("  ✅ " + h.padEnd(14) + describe(p)); }
  else console.log("  ⬜ " + h.padEnd(14) + "（还没放）");
}

console.log("\n【地点小图】" + REL + "places\\   —— " + ids.length + " 个待配");
let got = 0;
const missing = [];
for (const id of ids) {
  const p = findFile(id, PLACES_DIR);
  if (p) { got++; console.log("  ✅ " + id.padEnd(22) + describe(p)); }
  else missing.push(id);
}
if (missing.length) {
  console.log("\n  还缺 " + missing.length + " 个：");
  for (let i = 0; i < missing.length; i += 4) console.log("    " + missing.slice(i, i + 4).join("  "));
}

// 没按 id 命名的文件
const known = new Set([...ids, ...heroes]);
const strays = [];
for (const dir of [ASSETS, PLACES_DIR]) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    if (f.startsWith(".") || f.endsWith(".md")) continue;
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) continue;
    const base = f.replace(/\.[^.]+$/, "");
    if (!known.has(base)) strays.push(ASSETS === DEFAULT_ASSETS ? path.relative(ROOT, full) : full);
  }
}
if (strays.length) {
  console.log("\n【没按 id 命名的文件】（告诉我哪个是哪个，我来对号）");
  for (const s of strays) console.log("  ?  " + s);
}

console.log(
  `\n进度：hero ${heroGot}/${heroes.length} · 地点小图 ${got}/${ids.length}` +
    (strays.length ? ` · 未识别文件 ${strays.length}` : ""),
);
