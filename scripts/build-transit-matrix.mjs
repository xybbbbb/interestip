/**
 * build-transit-matrix.mjs
 *
 * 用免费的 Transitous（MOTIS 引擎，数据源：KTDB / Korail）计算原型里各地点之间的
 * 真实公共交通耗时，输出 data/transit-matrix.json。
 *
 * 用法：
 *   node scripts/build-transit-matrix.mjs            # 增量：已有结果的组合会跳过
 *   node scripts/build-transit-matrix.mjs --force    # 全部重新计算
 *   node scripts/build-transit-matrix.mjs --k 4      # 每个点取最近 4 个邻居（默认 3）
 *
 * 设计要点：
 * - 只算「必要组合」：每个地点与最近的 K 个邻居 + 演唱会场馆与所有地点（场馆是 P0 锚点）
 * - 每次请求间隔 1.3 秒；结果写入 JSON 永久缓存，重复运行不会重复打扰对方服务器
 * - Transitous 是志愿者运营的免费服务，使用时请保留署名（见 README / 页面页脚）
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PREVIEW = path.join(ROOT, "web-preview", "index.html");
let OUT = path.join(ROOT, "data", "transit-matrix.json");

const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const K = (() => {
  const i = args.indexOf("--k");
  return i >= 0 ? Number(args[i + 1]) || 3 : 3;
})();

// 工作日上午 10 点（首尔时间）作为代表性时刻
let QUERY_TIME = "2026-09-16T10:00:00+09:00";
let TIME_LABEL = "weekday-10am";

// 可选参数：换城市 / 换垂直线时，从 JSON 读地点、结果写到另一个文件
const optVal = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const PLACES_FILE = optVal("--places");
const ANCHOR_ID = optVal("--anchor");
const DEMAND_FILE = optVal("--demand") || path.join(ROOT, "data", "transit-missing-pairs.json");
if (optVal("--out")) OUT = optVal("--out");
if (optVal("--time")) QUERY_TIME = optVal("--time");
if (optVal("--time-label")) TIME_LABEL = optVal("--time-label");
const UA =
  "InterestTravelPrototype/0.1 (personal travel planning prototype; https://github.com/xybbbbb)";

/** 从 index.html 里读出 PLACES 数组 */
async function readPlaces() {
  if (PLACES_FILE) {
    const raw = JSON.parse(await fs.readFile(PLACES_FILE, "utf8"));
    const list = Array.isArray(raw) ? raw : raw.places;
    return list.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  }
  const html = await fs.readFile(PREVIEW, "utf8");
  const start = html.indexOf("const PLACES = [");
  if (start < 0) throw new Error("在 index.html 里找不到 const PLACES = [");
  const end = html.indexOf("\n];", start);
  if (end < 0) throw new Error("找不到 PLACES 数组的结尾");
  const literal = html.slice(start + "const PLACES = ".length, end + 3);
  const places = new Function(`return ${literal};`)();
  return places.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
}

/** 球面距离（公里），用于挑最近邻 */
function km(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * 近距离步行的兜底估算（Transitous 对"只能步行"的组合不返回结果）。
 * 直线距离 × 1.25 绕路系数 ÷ 4.5km/h，只用于 2km 以内。
 */
function walkEstimate(a, b) {
  const d = km(a, b);
  if (d > 2) return null;
  return {
    ok: true,
    mode: "walk-estimate",
    minutes: Math.max(3, Math.round(((d * 1.25) / 4.5) * 60)),
    transfers: 0,
    walkMinutes: Math.max(3, Math.round(((d * 1.25) / 4.5) * 60)),
    modes: ["WALK"],
    distanceKm: Number(d.toFixed(3)),
  };
}

/** 挑选要计算的组合 */
function pickPairs(places, k) {
  const keys = new Set();
  const pairs = [];
  const add = (a, b) => {
    if (a.id === b.id) return;
    const [from, to] = a.id < b.id ? [a, b] : [b, a];
    const key = `${from.id}|${to.id}`;
    if (keys.has(key)) return;
    keys.add(key);
    pairs.push({ key, from, to });
  };

  // 1) 每个点的最近 K 个邻居
  for (const p of places) {
    const nearest = places
      .filter((q) => q.id !== p.id)
      .map((q) => ({ q, d: km(p, q) }))
      .sort((x, y) => x.d - y.d)
      .slice(0, k);
    for (const { q } of nearest) add(p, q);
  }

  // 2) 锚点（已预约、不可改的那个点）<-> 所有地点
  const venue = ANCHOR_ID
    ? places.find((p) => p.id === ANCHOR_ID)
    : places.find((p) => p.type === "venue");
  if (venue) for (const p of places) add(venue, p);

  return pairs;
}

/**
 * 按需补全：读 data/transit-missing-pairs.json（由 benchmark-travel-model.mjs 生成）。
 *
 * 最近邻选组合有个天然盲区：两个点各自附近都有更近的邻居时，它们之间的"跨区长途"组合
 * 永远进不了候选（例：南山首尔塔 → 金浦）。所以改成"按需补全"——
 * 基准测试跑真实行程，把实际用到、但矩阵里没有的组合写下来，这里再补算。
 */
function appendDemandPairs(pairs, places, extras) {
  const keys = new Set(pairs.map((p) => p.key));
  const byId = new Map(places.map((p) => [p.id, p]));
  const out = [...pairs];
  let added = 0;
  for (const e of extras) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b || a.id === b.id) continue;
    const [from, to] = a.id < b.id ? [a, b] : [b, a];
    const key = `${from.id}|${to.id}`;
    if (keys.has(key)) continue;
    keys.add(key);
    out.push({ key, from, to });
    added += 1;
  }
  return { pairs: out, added };
}

async function queryPair(from, to, attempt = 1) {
  const url =
    `https://api.transitous.org/api/v1/plan?fromPlace=${from.lat},${from.lng}` +
    `&toPlace=${to.lat},${to.lng}&time=${encodeURIComponent(QUERY_TIME)}&transitModes=TRANSIT`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const j = await res.json();
    const its = j.itineraries ?? [];
    if (!its.length) return { ok: false, reason: "no-itinerary" };

    const best = its.reduce((p, c) =>
      new Date(c.endTime) - new Date(c.startTime) < new Date(p.endTime) - new Date(p.startTime) ? c : p,
    );
    const legs = best.legs ?? [];
    const transit = legs.filter((l) => l.mode !== "WALK");
    const walkMin = legs
      .filter((l) => l.mode === "WALK")
      .reduce((s, l) => s + (new Date(l.endTime) - new Date(l.startTime)) / 60000, 0);

    return {
      ok: true,
      mode: "transit",
      minutes: Math.round((new Date(best.endTime) - new Date(best.startTime)) / 60000),
      transfers: Math.max(0, transit.length - 1),
      walkMinutes: Math.round(walkMin),
      modes: transit.map((l) => (l.routeShortName ? `${l.mode}:${l.routeShortName}` : l.mode)),
      depart: best.startTime,
      arrive: best.endTime,
    };
  } catch (e) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 2500));
      return queryPair(from, to, attempt + 1);
    }
    return { ok: false, reason: e.message };
  }
}

const places = await readPlaces();
let pairs = pickPairs(places, K);

// 按需补全（可选）：基准测试跑出来的"实际用到但没覆盖"的组合
let demandAdded = 0;
try {
  const demand = JSON.parse(await fs.readFile(DEMAND_FILE, "utf8"));
  const merged = appendDemandPairs(pairs, places, demand);
  pairs = merged.pairs;
  demandAdded = merged.added;
} catch {
  /* 没有按需清单就跳过 */
}

let existing = { pairs: {} };
try {
  existing = JSON.parse(await fs.readFile(OUT, "utf8"));
} catch {
  /* 首次运行 */
}

console.log(
  `地点 ${places.length} 个，计划计算 ${pairs.length} 组（K=${K}${demandAdded ? ` + 按需补全 ${demandAdded} 组` : ""}）`,
);
console.log(`时间基准：${QUERY_TIME}（${TIME_LABEL}）\n`);

const out = {
  ...existing,
  generatedAt: new Date().toISOString(),
  source: optVal("--source") || "Transitous (MOTIS) — data: KTDB, Korail",
  sourceUrl: "https://transitous.org/sources/",
  queryTime: QUERY_TIME,
  timeLabel: TIME_LABEL,
  note: PLACES_FILE
    ? "耗时来自 Transitous 免费公益接口（MOTIS）。时刻取工作日 10:00 一次采样，个别线路可能有偏差。"
    : "耗时来自 Transitous 免费公益接口；韩国数据源 KTDB 最后更新于 2025-05，个别线路时刻可能有偏差。",
  pairs: { ...existing.pairs },
};

let done = 0;
let skipped = 0;
let failed = 0;

for (const { key, from, to } of pairs) {
  const cached = out.pairs[key];
  if (!FORCE && cached && cached.queryTime === QUERY_TIME && cached.ok) {
    skipped++;
    continue;
  }
  const r = await queryPair(from, to);
  let result = r;
  if (!r.ok && r.reason === "no-itinerary") {
    const fallback = walkEstimate(from, to);
    if (fallback) result = fallback;
  }
  out.pairs[key] = { ...result, queryTime: QUERY_TIME, fromName: from.name, toName: to.name };
  if (result.ok) {
    done++;
    const tag = result.mode === "walk-estimate" ? "🚶 步行估算" : `换乘 ${result.transfers} 次`;
    console.log(`✅ ${from.name} → ${to.name}: ${result.minutes} 分钟，${tag}`);
  } else {
    failed++;
    console.log(`❌ ${from.name} → ${to.name}: ${r.reason}`);
  }
  await new Promise((r2) => setTimeout(r2, 1300));
}

out.stats = {
  places: places.length,
  pairs: pairs.length,
  computed: done,
  cached: skipped,
  failed,
};

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, JSON.stringify(out, null, 2), "utf8");

console.log(
  `\n完成：新算 ${done} 组，跳过缓存 ${skipped} 组，失败 ${failed} 组 → ${path.relative(ROOT, OUT)}`,
);
