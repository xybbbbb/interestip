/**
 * fetch-shanghai-photos.mjs —— 用高德 POI 的 photos 字段给上海线抓地点图
 *
 * 高德 place/text 带 extensions=all 时返回 photos[]（托管在高德 CDN，国内可直连）。
 * 这里把首图下载到 work/sh-photos/，交给 prepare-shanghai-photos.py 处理。
 *
 * 用法：node scripts/fetch-shanghai-photos.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { loadEnvFile, ROOT } from "./lib/llm.mjs";

const OUTDIR = path.join(ROOT, "work", "sh-photos");
const MAPFILE = path.join(ROOT, "work", "sh-photos-map.json");

const env = await loadEnvFile();
const KEY = (process.env.AMAP_KEY || env.AMAP_KEY || "").trim();
if (!KEY) { console.error("❌ .env 缺少 AMAP_KEY"); process.exit(1); }

const v = JSON.parse(await fs.readFile(path.join(ROOT, "data", "shanghai-vertical.json"), "utf8"));
await fs.mkdir(OUTDIR, { recursive: true });

async function poiPhotos(kw) {
  const url = new URL("https://restapi.amap.com/v3/place/text");
  url.searchParams.set("key", KEY);
  url.searchParams.set("keywords", kw);
  url.searchParams.set("city", "上海");
  url.searchParams.set("citylimit", "true");
  url.searchParams.set("offset", "1");
  url.searchParams.set("extensions", "all"); // 关键：all 才带 photos
  const r = await fetch(url, { headers: { "User-Agent": "InterestipPrototype/0.1" } });
  const j = await r.json();
  return Array.isArray(j?.pois?.[0]?.photos) ? j.pois[0].photos : [];
}

async function download(candidates, dest) {
  for (const c of candidates) {
    const u = String(c.url || "").replace(/^http:/, "https:");
    if (!u) continue;
    try {
      const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0", Referer: "https://www.amap.com/" } });
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 6000) continue; // 太小多半是占位图
      await fs.writeFile(dest, buf);
      return { url: u, bytes: buf.length, title: c.title || "" };
    } catch { /* 试下一张 */ }
  }
  return null;
}

const map = {};
let got = 0;
for (const p of v.places) {
  const photos = await poiPhotos(p.name);
  const dest = path.join(OUTDIR, p.id + ".jpg");
  const r = photos.length ? await download(photos.slice(0, 3), dest) : null;
  if (r) { map[p.id] = { file: dest, url: r.url, bytes: r.bytes, title: r.title, credit: "© 高德地图 / Amap" }; got++; }
  console.log(`${p.id.padEnd(16)} ${p.name.padEnd(22)} ${r ? "✅ " + Math.round(r.bytes / 1024) + "KB" : "（无图）"}`);
  await new Promise((x) => setTimeout(x, 150));
}

await fs.writeFile(MAPFILE, JSON.stringify(map, null, 2) + "\n", "utf8");
console.log(`\n下载成功 ${got}/${v.places.length} → ${path.relative(ROOT, OUTDIR)}`);
