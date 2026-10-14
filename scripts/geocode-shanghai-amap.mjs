/**
 * geocode-shanghai-amap.mjs —— 用高德 Web 服务 API 给上海 F1 地点做候选地理编码
 *
 * 数据：data/shanghai-f1-spots.json（来自用户表格）
 * 产出：把 lat/lng/geocode 写回同一个文件，并打印表格供人工核验
 *
 * 规则：高德结果只作「候选坐标」，必须人工核验后才算高置信度（沿用项目红线）。
 * Key 只从本地 .env 读（AMAP_KEY），不打印、不进页面。
 *
 * 用法：node scripts/geocode-shanghai-amap.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile, ROOT } from "./lib/llm.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(ROOT, "data", "shanghai-f1-spots.json");
const CITY = "上海";
const UA = "InterestipPrototype/0.1 (local build script)";

const env = await loadEnvFile();
const KEY = (process.env.AMAP_KEY || env.AMAP_KEY || "").trim();
if (!KEY) {
  console.error("❌ .env 里没有 AMAP_KEY。请在 " + path.join(ROOT, ".env") + " 里加一行 AMAP_KEY=你的key");
  process.exit(1);
}
console.log(`读到 AMAP_KEY = ${KEY.slice(0, 6)}…(len ${KEY.length})`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function amap(pathname, params) {
  const url = new URL("https://restapi.amap.com" + pathname);
  url.searchParams.set("key", KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  if (String(j.status) !== "1") throw new Error(`amap: ${j.info || "unknown"} (${j.infocode || ""})`);
  return j;
}

function loc(s) {
  const [lng, lat] = String(s || "").split(",").map(Number);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return { lng, lat };
}

/** 先按 POI 关键词搜，再退回地址地理编码 */
async function resolveOne({ name, clue, area }) {
  const out = { poi: null, geo: null, err: [] };
  const kw = [name, clue].filter(Boolean).join(" ").trim();
  try {
    const j = await amap("/v3/place/text", { keywords: kw, city: CITY, citylimit: "true", offset: "3", page: "1", extensions: "base" });
    const p = (j.pois || [])[0];
    if (p && loc(p.location)) out.poi = { name: p.name, type: p.type, district: p.adname, address: p.address, pt: loc(p.location) };
  } catch (e) { out.err.push("poi:" + e.message); }
  await sleep(400);
  const addr = [clue, area, CITY].filter(Boolean).join("");
  try {
    const j = await amap("/v3/geocode/geo", { address: addr, city: CITY });
    const g = (j.geocodes || [])[0];
    if (g && loc(g.location)) out.geo = { formatted: g.formatted_address, district: g.district, level: g.level, pt: loc(g.location) };
  } catch (e) { out.err.push("geo:" + e.message); }
  await sleep(400);
  return out;
}

const data = JSON.parse(await fs.readFile(DATA, "utf8"));
let okCount = 0;

// 锚点：上海国际赛车场
{
  const a = data.anchor;
  const r = await resolveOne({ name: a.name, clue: a.clue, area: a.area });
  const pick = r.poi || r.geo;
  if (pick) { a.lat = pick.pt.lat; a.lng = pick.pt.lng; a.geocode = pick; okCount++; }
  console.log(`锚点 ${a.name}：${pick ? `${pick.pt.lat.toFixed(5)},${pick.pt.lng.toFixed(5)}  ${pick.name || pick.formatted || ""}` : "★未解析"}${r.err.length ? "  [" + r.err.join(" | ") + "]" : ""}`);
}

for (const s of data.spots) {
  const r = await resolveOne(s);
  const pick = r.poi || r.geo;
  if (pick) { s.lat = pick.pt.lat; s.lng = pick.pt.lng; s.geocode = pick; okCount++; }
  const shown = pick ? `${pick.pt.lat.toFixed(5)},${pick.pt.lng.toFixed(5)}  ${pick.name || pick.formatted || ""}${pick.district ? " · " + pick.district : ""}` : "★未解析";
  console.log(`${String(s.no).padStart(2)} ${s.name.padEnd(26)} → ${shown}${r.err.length ? "  [" + r.err.join(" | ") + "]" : ""}`);
}

data.geocodedAt = new Date().toISOString();
data.geocodeProvider = "高德 Web 服务 API（候选坐标，需人工核验）";
await fs.writeFile(DATA, JSON.stringify(data, null, 2) + "\n", "utf8");

console.log(`\n解析成功 ${okCount}/${data.spots.length + 1} → ${path.relative(ROOT, DATA)}`);
console.log("⚠ 高德结果是候选坐标：请对照地图核对，确认后再当成高置信度使用。");
