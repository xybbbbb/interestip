/**
 * apply-shanghai-photos.mjs —— 把处理好的上海地点图接进页面（含署名）
 *
 * 1) 往 index.html 的 LOCAL_PLACE_IMAGES / LOCAL_IMAGE_CREDITS 里补 sh-* 条目
 * 2) 往垂直线数据里写 images 映射 + 页脚加"图片来自高德"
 * 用法：node scripts/apply-shanghai-photos.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PREVIEW = path.join(ROOT, "web-preview", "index.html");
const VERT = path.join(ROOT, "data", "shanghai-vertical.json");
const PROC = path.join(ROOT, "work", "sh-photos-processed.json");
const MAP = path.join(ROOT, "work", "sh-photos-map.json");

const processed = JSON.parse(await fs.readFile(PROC, "utf8"));
const map = JSON.parse(await fs.readFile(MAP, "utf8"));
const ok = processed.ok || {};
const ids = Object.keys(ok);
if (!ids.length) { console.error("没有处理好的图片"); process.exit(1); }

function appendToObjectLiteral(html, declName, pairs) {
  const start = html.indexOf("const " + declName + "={");
  if (start < 0) throw new Error("找不到 " + declName);
  const end = html.indexOf("};", start);
  if (end < 0) throw new Error(declName + " 找不到结尾");
  const add = pairs.map(([k, v]) => "," + JSON.stringify(k) + ":" + JSON.stringify(v)).join("");
  return html.slice(0, end) + add + html.slice(end);
}

let html = await fs.readFile(PREVIEW, "utf8");
if (html.includes('"sh-bund":"assets/places/sh-bund.jpg"')) {
  console.log("页面里已有上海图片条目，跳过注入（但会同步垂直线）");
} else {
  html = appendToObjectLiteral(html, "LOCAL_PLACE_IMAGES", ids.map((id) => [id, ok[id].path]));
  html = appendToObjectLiteral(html, "LOCAL_IMAGE_CREDITS", ids.map((id) => [id, (map[id] && map[id].credit) || "© 高德地图 / Amap"]));
  await fs.writeFile(PREVIEW, html, "utf8");
  console.log(`已接入 ${ids.length} 张地点图（LOCAL_PLACE_IMAGES + LOCAL_IMAGE_CREDITS）`);
}

// 垂直线：images 映射 + 页脚署名
const v = JSON.parse(await fs.readFile(VERT, "utf8"));
v.images = { ...(v.images || {}) };
for (const id of ids) v.images[id] = ok[id].path;
if (!/图片/.test(v.i18n.zh.footer)) {
  v.i18n.zh.footer = v.i18n.zh.footer + "<br/>地点图片来自高德地图（UGC），已下载到本地。";
  v.i18n.en.footer = v.i18n.en.footer + "<br/>Place photos come from Amap (UGC) and are stored locally.";
}
await fs.writeFile(VERT, JSON.stringify(v, null, 2) + "\n", "utf8");
console.log(`垂直线 images 已写 ${Object.keys(v.images).length} 条`);
