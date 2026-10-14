/**
 * build-shanghai-sights.mjs —— 给「F1 × Shanghai」补 P2 基础景点（高德 POI）
 *
 * 1) 高德 POI 搜索 6 个上海地标 → 坐标 / 区 / 地址
 * 2) 扩展真实公交耗时矩阵（新地点 × 全部地点）
 * 3) 写回 data/shanghai-vertical.json（pool = "sight"）
 *
 * Key 只从本地 .env 读（AMAP_KEY）。用法：node scripts/build-shanghai-sights.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { loadEnvFile, ROOT } from "./lib/llm.mjs";

const VERT = path.join(ROOT, "data", "shanghai-vertical.json");
const MATRIX = path.join(ROOT, "data", "shanghai-transit-matrix.json");

const env = await loadEnvFile();
const KEY = (process.env.AMAP_KEY || env.AMAP_KEY || "").trim();
if (!KEY) { console.error("❌ .env 缺少 AMAP_KEY"); process.exit(1); }
console.log(`AMAP_KEY = ${KEY.slice(0, 6)}…(len ${KEY.length})`);

const SIGHTS = [
  { id: "sh-bund",   kw: "外滩",       name: "外滩",      en: "The Bund",           hours: "全天开放",
    whyZh: "上海最经典的城市天际线步道：一边是外滩万国建筑群，一边是陆家嘴（来源：高德地图）。",
    whyEn: "Shanghai's classic waterfront promenade: the colonial-era Bund buildings on one side, the Lujiazui skyline on the other." },
  { id: "sh-yuyuan", kw: "豫园",       name: "豫园",      en: "Yu Garden",          hours: "开放时间以官方为准",
    whyZh: "明代古典园林与老城隍庙商圈，上海最典型的“老城”一景（来源：高德地图）。",
    whyEn: "A Ming-dynasty classical garden and the surrounding old-city bazaar." },
  { id: "sh-pearl",  kw: "东方明珠",   name: "东方明珠",  en: "Oriental Pearl Tower", hours: "开放时间以官方为准",
    whyZh: "陆家嘴地标电视塔，有玻璃观光廊，是看浦江两岸最直接的位置（来源：高德地图）。",
    whyEn: "The landmark TV tower in Lujiazui, with a glass sightseeing deck over the Huangpu River." },
  { id: "sh-museum", kw: "上海博物馆", name: "上海博物馆", en: "Shanghai Museum",   hours: "开放时间以官方为准",
    whyZh: "人民广场上的中国古代艺术博物馆，青铜与书画馆藏最有名（来源：高德地图）。",
    whyEn: "The city's main museum of ancient Chinese art on People's Square, best known for bronzes and painting." },
  { id: "sh-xintiandi", kw: "新天地",  name: "新天地",    en: "Xintiandi",          hours: "街区全天开放",
    whyZh: "石库门里弄改造的餐饮与街区，逛街和吃饭顺路（来源：高德地图）。",
    whyEn: "Restored shikumen lanes turned into a dining and shopping district." },
  { id: "sh-wukang", kw: "武康大楼",   name: "武康大楼",  en: "Wukang Mansion",     hours: "外观全天可看",
    whyZh: "1924 年的船型公寓，武康路口最出片的一角，法租界散步线的起点（来源：高德地图）。",
    whyEn: "The 1924 flat-iron apartment block at Wukang Road — the most photographed corner of the former French Concession." },
  { id: "sh-nanjingrd", kw: "南京路步行街", name: "南京路步行街", en: "Nanjing Road Pedestrian Street", hours: "街区全天开放",
    whyZh: "人民广场到外滩之间的老牌商业步行街，逛街吃饭都顺路（来源：高德地图）。",
    whyEn: "China's best-known shopping street, running from People's Square down to the Bund." },
  { id: "sh-jingantemple", kw: "静安寺", name: "静安寺", en: "Jing'an Temple", hours: "开放时间以官方为准",
    whyZh: "金顶佛寺夹在静安商圈高楼之间，闹中取静的一站（来源：高德地图）。",
    whyEn: "A gold-roofed Buddhist temple standing in the middle of the Jing'an business district." },
  { id: "sh-tower", kw: "上海中心大厦", name: "上海中心大厦", en: "Shanghai Tower", hours: "开放时间以官方为准",
    whyZh: "中国最高楼，118 层观光厅可以俯瞰整个陆家嘴与浦江（来源：高德地图）。",
    whyEn: "China's tallest building, with the Top of Shanghai observation deck on the 118th floor." },
  { id: "sh-tianzifang", kw: "田子坊", name: "田子坊", en: "Tianzifang", hours: "街区全天开放",
    whyZh: "石库门里弄里的小店、工作室与咖啡馆，适合傍晚慢慢逛（来源：高德地图）。",
    whyEn: "A warren of shikumen lanes packed with small studios, shops and cafés." },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function amap(pathname, params) {
  const url = new URL("https://restapi.amap.com" + pathname);
  url.searchParams.set("key", KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { "User-Agent": "InterestipPrototype/0.1" } });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const j = await res.json();
  if (String(j.status) !== "1") throw new Error(`${j.info}(${j.infocode})`);
  return j;
}
const toXY = (s) => { const [lng, lat] = String(s || "").split(",").map(Number); return Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : null; };

const v = JSON.parse(await fs.readFile(VERT, "utf8"));
const matrix = JSON.parse(await fs.readFile(MATRIX, "utf8"));
const existing = v.places.map((p) => p.id);

/* 1) POI 搜索 */
const newPlaces = [];
for (const s of SIGHTS) {
  if (v.places.some((p) => p.id === s.id)) { console.log(`${s.name} 已存在，跳过`); continue; }
  try {
    const j = await amap("/v3/place/text", { keywords: s.kw, city: "上海", citylimit: "true", offset: "1", page: "1", extensions: "base" });
    const p = (j.pois || [])[0];
    const pt = p ? toXY(p.location) : null;
    if (!pt) { console.log(`${s.name} ★未解析`); await sleep(160); continue; }
    newPlaces.push({
      id: s.id, name: s.name, nameLocal: s.en, type: "sightseeing", pool: "sight",
      district: p.adname || "", lat: pt.lat, lng: pt.lng, hours: s.hours, conf: null,
      why: s.whyZh, address: p.address || "", officialUrl: "", source: "高德地图（POI 搜索）", note: "", evidence: [],
      _enWhy: s.whyEn,
    });
    console.log(`${s.name.padEnd(10)} → ${pt.lat.toFixed(5)},${pt.lng.toFixed(5)}  ${p.adname} · ${p.address}`);
  } catch (e) { console.log(`${s.name} 失败: ${e.message}`); }
  await sleep(200);
}

/* 2) 扩展耗时矩阵 */
let okc = 0, failc = 0;
for (const np of newPlaces) {
  for (const pid of [...existing, ...newPlaces.filter((x) => x.id !== np.id).map((x) => x.id)]) {
    const other = [...v.places, ...newPlaces].find((x) => x.id === pid);
    if (!other) continue;
    const key = [np.id, other.id].sort().join("|");
    if (matrix.pairs[key]) continue;
    try {
      const j = await amap("/v3/direction/transit/integrated", {
        origin: `${np.lng},${np.lat}`, destination: `${other.lng},${other.lat}`,
        city: "上海", cityd: "上海", strategy: "0", extensions: "base",
      });
      const t = (j.route?.transits || [])[0];
      if (!t) { matrix.pairs[key] = { ok: false }; failc++; }
      else {
        const segs = t.segments || []; const modes = [];
        for (const sg of segs) {
          const bl = sg.bus?.buslines?.[0]?.name; const rw = sg.railway?.name;
          if (bl) modes.push(String(bl).split("(")[0]); else if (rw) modes.push(String(rw)); else if (sg.walking) modes.push("WALK");
        }
        matrix.pairs[key] = { ok: true, minutes: Math.max(1, Math.round(Number(t.duration) / 60)), transfers: Math.max(0, segs.length - 1), mode: "transit", modes: [...new Set(modes)].slice(0, 4) };
        okc++;
      }
    } catch (e) { matrix.pairs[key] = { ok: false, error: String(e.message).slice(0, 50) }; failc++; }
    await sleep(160);
  }
  process.stderr.write(`\r  P2 耗时进度 ${newPlaces.indexOf(np) + 1}/${newPlaces.length}`);
}
process.stderr.write("\n");
console.log(`新增耗时：${okc} 组成功 / ${failc} 组失败（矩阵共 ${Object.keys(matrix.pairs).length} 组）`);

/* 3) 合进垂直线 */
const enDetails = v.enDetails || {};
for (const np of newPlaces) {
  enDetails[np.id] = { why: np._enWhy, hours: "" };
  delete np._enWhy;
}
v.places = [...v.places, ...newPlaces];
v.enPlaces = { ...(v.enPlaces || {}) };
for (const np of newPlaces) v.enPlaces[np.id] = np.nameLocal;
v.enDetails = enDetails;
v.transit = matrix;
await fs.writeFile(MATRIX, JSON.stringify(matrix, null, 2) + "\n", "utf8");
await fs.writeFile(VERT, JSON.stringify(v, null, 2) + "\n", "utf8");

console.log(`垂直线现为 ${v.places.length} 个地点（兴趣 ${v.places.filter((p) => p.pool === "fan").length} / 观光 ${v.places.filter((p) => p.pool === "sight").length}）`);
for (const p of v.places.filter((p) => p.pool === "sight")) console.log(`  [P2] ${p.name} · ${p.nameLocal} · ${p.district}`);
