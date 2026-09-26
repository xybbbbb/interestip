/**
 * apply-local-images.mjs —— 把本地图片接进页面
 *
 * 扫描 web-preview\assets\ 里的成品，然后重写 index.html 里标记之间的那张映射表：
 *   · assets\places\<id>.jpg    → 覆盖该地点的图（优先于 VisitSeoul 的远程图）
 *   · assets\hero-<垂直id>.jpg  → 覆盖该垂直线的 hero 图
 *   · assets\credits.json       → 可选，图片署名 { "nyc-met": "Photo: ... CC BY-SA 4.0" }
 *
 * 用法：node scripts/apply-local-images.mjs
 *
 * 成品图必须在 web-preview\assets\ 里 —— Cloudflare Pages 发布的是 web-preview 目录，
 * 放项目根目录的 assets\ 是发布不出去的。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const HTML = path.join(ROOT, "web-preview", "index.html");
const ASSETS = path.join(ROOT, "web-preview", "assets");
const PLACES = path.join(ASSETS, "places");
const START = "/* >>> LOCAL_IMAGES";
const END = "/* <<< LOCAL_IMAGES */";

const js = (v) => JSON.stringify(v);
const posix = (p) => p.split(path.sep).join("/");

// 1) 地点图
const placeMap = {};
const tiny = [];
if (fs.existsSync(PLACES)) {
  for (const f of fs.readdirSync(PLACES).sort()) {
    const m = /^(.+)\.(jpg|jpeg|png|webp)$/i.exec(f);
    if (!m) continue;
    // 尺寸闸门：560x350 的正常照片至少 15 KB；小于 6 KB 基本是空白图/纯色图，
    // 放上去就是一块白，不如退回类型图标。
    const kb = fs.statSync(path.join(PLACES, f)).size / 1024;
    if (kb < 6) {
      tiny.push(`${m[1]}（${kb.toFixed(1)} KB）`);
      continue;
    }
    placeMap[m[1]] = `assets/places/${posix(f)}`;
  }
}

// 2) Hero 图：文件名 hero-<垂直id>.jpg
const heroMap = {};
if (fs.existsSync(ASSETS)) {
  for (const f of fs.readdirSync(ASSETS).sort()) {
    const m = /^hero-(.+)\.(jpg|jpeg|png|webp)$/i.exec(f);
    if (m) heroMap[m[1]] = `assets/${posix(f)}`;
  }
}

// 3) 可选署名
let credits = {};
const creditsFile = path.join(ASSETS, "credits.json");
if (fs.existsSync(creditsFile)) {
  try {
    credits = JSON.parse(fs.readFileSync(creditsFile, "utf8"));
  } catch (e) {
    console.log("credits.json 解析失败，忽略：" + e.message);
  }
}

const block =
  START + "（由 scripts/apply-local-images.mjs 生成，不要手改） */\n" +
  `const LOCAL_PLACE_IMAGES=${js(placeMap)};\n` +
  `const LOCAL_HERO_IMAGES=${js(heroMap)};\n` +
  `const LOCAL_IMAGE_CREDITS=${js(credits)};\n` +
  END;

const html = fs.readFileSync(HTML, "utf8");
let next;
const s = html.indexOf(START);
if (s >= 0) {
  const e = html.indexOf(END, s);
  next = html.slice(0, s) + block + html.slice(e + END.length);
} else {
  // 第一次：插在 PLACE_IMAGES 定义之后
  const anchor = html.indexOf("let PLACE_IMAGES=");
  if (anchor < 0) throw new Error("找不到 PLACE_IMAGES，中止");
  const close = html.indexOf("\n};", anchor);
  if (close < 0) throw new Error("找不到 PLACE_IMAGES 的结尾，中止");
  const insertAt = close + 3; // 跳过 "\n};"
  next = html.slice(0, insertAt) + "\n" + block + html.slice(insertAt);
}
fs.writeFileSync(HTML, next, "utf8");

console.log(`地点图 ${Object.keys(placeMap).length} 张`);
for (const [id, p] of Object.entries(placeMap)) console.log("  " + id.padEnd(22) + p);
console.log(`\nHero 图 ${Object.keys(heroMap).length} 张`);
for (const [id, p] of Object.entries(heroMap)) console.log("  " + id.padEnd(22) + p);
if (Object.keys(credits).length) console.log(`\n署名 ${Object.keys(credits).length} 条`);
if (tiny.length) {
  console.log(`\n跳过 ${tiny.length} 张疑似空白图（卡片会退回类型图标）：`);
  for (const t of tiny) console.log("  " + t);
}
console.log(`\n已写入 ${path.relative(ROOT, HTML)}`);
