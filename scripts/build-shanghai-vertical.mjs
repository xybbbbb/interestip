/**
 * build-shanghai-vertical.mjs —— 生成「F1 × Shanghai」垂直线数据
 *
 * 输入：data/shanghai-f1-spots.json（用户表格 + 高德候选坐标）
 * 产出：data/shanghai-transit-matrix.json（高德真实公交耗时）
 *       data/shanghai-vertical.json（可直接注入 index.html 的 VERTICALS.shanghai）
 *
 * Key 只从本地 .env 读（AMAP_KEY），不打印、不进页面。
 * 用法：node scripts/build-shanghai-vertical.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { loadEnvFile, ROOT } from "./lib/llm.mjs";

const SPOTS = path.join(ROOT, "data", "shanghai-f1-spots.json");
const MATRIX = path.join(ROOT, "data", "shanghai-transit-matrix.json");
const OUT = path.join(ROOT, "data", "shanghai-vertical.json");

const env = await loadEnvFile();
const KEY = (process.env.AMAP_KEY || env.AMAP_KEY || "").trim();
if (!KEY) { console.error("❌ .env 缺少 AMAP_KEY"); process.exit(1); }
console.log(`AMAP_KEY = ${KEY.slice(0, 6)}…(len ${KEY.length})`);

const data = JSON.parse(await fs.readFile(SPOTS, "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 1) 地点（P1 兴趣地点，含锚点赛车场） ---------- */
const TYPE_MAP = { "快闪店": "ad_spot", "展览": "ad_spot", "店铺": "shop", "F1官方商店": "shop", "海报": "photo_spot" };
const TYPE_CN = { ad_spot: "广告/快闪", shop: "同款店铺", photo_spot: "打卡点" };

function evidenceFor(s) {
  return [{
    srcType: "community",
    src: s.sourceLabel || "小红书",
    claim: s.note || `用户整理的 F1 上海打卡地点：${s.name}`,
    date: "",
    url: s.url || "",
    summary: s.note || "",
    conf: s.conf || "high",
  }];
}

const spots = data.spots.map((s) => ({
  id: s.id,
  name: s.name,
  nameLocal: "",
  type: TYPE_MAP[s.type] || "ad_spot",
  pool: "fan",
  district: (s.geocode?.district) || s.area || "",
  lat: s.lat,
  lng: s.lng,
  hours: "快闪活动时间以官方为准",
  conf: "high",
  why: s.note || `F1 上海站期间的活动地点（来源：${s.sourceLabel || "小红书"}）。`,
  address: (s.geocode?.address || s.clue || ""),
  officialUrl: "",
  source: s.url || "",
  note: "",
  evidence: evidenceFor(s),
}));

const circuit = {
  id: "sh-circuit",
  name: "上海国际赛车场",
  nameLocal: "Shanghai International Circuit",
  type: "venue",
  pool: "fan",
  district: "嘉定区",
  lat: data.anchor.lat,
  lng: data.anchor.lng,
  hours: "比赛日按赛程开放",
  conf: "high",
  why: "F1 中国大奖赛举办地；3/15 正赛观赛（P0 锚点，当天围着它排）。",
  address: data.anchor.clue,
  officialUrl: "https://www.shanghai-international-circuit.com/",
  source: "高德地图（上海国际赛车场）",
  note: "正赛发车时间以官方赛程为准。",
  evidence: [],
};

const places = [...spots, circuit];

/* ---------- 2) 真实公交耗时（高德） ---------- */
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

const pairs = {};
let okCount = 0, failCount = 0;
for (let i = 0; i < places.length; i++) {
  for (let k = i + 1; k < places.length; k++) {
    const a = places[i], b = places[k];
    const key = `${a.id}|${b.id}`;
    try {
      const j = await amap("/v3/direction/transit/integrated", {
        origin: `${a.lng},${a.lat}`, destination: `${b.lng},${b.lat}`,
        city: "上海", cityd: "上海", strategy: "0", extensions: "base",
      });
      const t = (j.route?.transits || [])[0];
      if (!t) { pairs[key] = { ok: false }; failCount++; }
      else {
        const segs = t.segments || [];
        const modes = [];
        for (const s of segs) {
          const bl = s.bus?.buslines?.[0]?.name;
          const rw = s.railway?.name;
          if (bl) modes.push(String(bl).split("(")[0]);
          else if (rw) modes.push(String(rw));
          else if (s.walking) modes.push("WALK");
        }
        pairs[key] = {
          ok: true,
          minutes: Math.max(1, Math.round(Number(t.duration) / 60)),
          transfers: Math.max(0, segs.length - 1),
          mode: "transit",
          modes: [...new Set(modes)].slice(0, 4),
        };
        okCount++;
      }
    } catch (e) {
      pairs[key] = { ok: false, error: String(e.message).slice(0, 60) };
      failCount++;
    }
    await sleep(160);
  }
  process.stderr.write(`\r  公交耗时进度 ${i + 1}/${places.length}`);
}
process.stderr.write("\n");

const matrix = {
  generatedAt: new Date().toISOString(),
  queryTime: new Date().toISOString(),
  city: "上海",
  source: "高德地图 Web 服务 API（公交路径规划 /v3/direction/transit/integrated）",
  sourceUrl: "https://lbs.amap.com/api/webservice/guide/api/direction",
  note: "耗时来自高德公交路径规划；按规划时刻的推荐方案，个别线路可能有偏差。",
  pairs,
};
await fs.writeFile(MATRIX, JSON.stringify(matrix, null, 2) + "\n", "utf8");
console.log(`公交耗时：${okCount} 组成功 / ${failCount} 组失败 → ${path.relative(ROOT, MATRIX)}`);

/* ---------- 3) i18n + 垂直线对象 ---------- */
const I18N_ZH = {
  p0Title: "P0 · 大奖赛（已订票）",
  p0Desc: "锚点是你已经订好的比赛日：那天围着观赛安排，其余按赛程前后排。",
  lblConcertDay: "比赛在第几天",
  concertDayBadge: "比赛日",
  restNote: "🏁 这一天以观赛为核心；前后留出交通、吃饭与休息。",
  alertNoFan: "请至少选择一个「F1 相关地点」。",
  legendFan: "F1 同款",
  poolFanLabel: "P1 · F1 相关地点（候选）",
  poolFanSub: "F1 上海站期间在市区的快闪、展台与官方商店；每条都带来源链接，点卡片看证据，再标「必去 / 顺路」。",
  poolSightLabel: "P2 · 上海观光（可选）",
  poolSightSub: "这条线目前只有兴趣地点（还没有整理好的上海观光点数据）。",
  p1Title: "P1 · F1 相关地点",
  p1Desc: "从公开的玩家整理里收集的快闪与展台，每条带来源链接；点卡片看简介与出处。",
  p2Title: "P2 · 上海观光",
  p2Desc: "普通观光点用于调剂行程（当前为空）。",
  drawerFan: "F1 同款",
  visitseoul: "高德地图数据",
  noArtist: "不属于某个兴趣点，用于平衡行程。",
  planTitle: "你的 F1 上海之旅",
  planSub: "路线默认显示全部行程总览（深色连贯线）；可切换「按天分开」看每天不同颜色。紫色图钉是可选酒店，红点是 F1 相关地点、蓝点是普通观光。",
  planTagFandom: "F1 + 旅行",
  planTagEvidence: "带来源链接",
  stayNearby: "每晚就近换",
  stayConcert: "赛车场周边优先",
  stayReasonNearby: "这条线还没有住宿数据，行程只排地点。",
  note: "路线由确定性排程引擎生成：地理聚类分天 + 最近邻排序 + 2-opt 优化。<b>比赛日是锚点</b>：那天围着观赛安排。「多久到」来自<b>高德公交路径规划的真实耗时</b>；地点坐标由高德地理编码（候选坐标，已人工核对）；来源为用户整理的小红书帖子。",
  footer: "© 2026 Interestip · 「F1 × Shanghai」地点来自用户整理的公开资料（含来源链接）；坐标与站点间耗时来自 <a href=\"https://lbs.amap.com/\" target=\"_blank\" rel=\"noreferrer\">高德地图</a>。",
  aiReply: "收到！我先按优先级处理：\n① P0 比赛日已锁定（3/15 · 上海国际赛车场），那天围着它排\n② P1 收集 F1 上海的快闪与展台（每条带来源）\n③ P2 上海观光点目前为空\n\n请先选择想去的地点：给地点标「必去」或「顺路」。",
  intentDefault: "我 3 月去上海看 F1 大奖赛，想顺便把市区的 F1 快闪和展台逛了。",
  intentPlaceholder: "你为什么去上海？",
  hint: "直接说想法，例如：“我去上海看 F1，想顺路打卡市区的快闪店。”",
  catNote: "F1 × Shanghai 是第三条垂直线——和 CORTIS × Seoul、New York × Art & Culture 用同一套引擎。",
  stayReasonConcert: "比赛日优先住赛车场附近（这条线暂无住宿数据）。",
  noEvidenceNote: "这一条来自公开地图数据。",
  heroBadgeTitle: "F1 × Shanghai · 第三条垂直线",
  heroBadgeText: "大奖赛观赛 + 市区 F1 快闪与展台，排进同一份可行行程",
  onsiteGo: "请带我去这里",
  onsiteGoSub: "Please take me here",
  phrasesTitle: "常用语（给对方看）",
};
const I18N_EN = {
  p0Title: "P0 · Grand Prix (booked)",
  p0Desc: "The anchor is your race day: that day is built around the race, and everything else fits around it.",
  lblConcertDay: "Which day is the race",
  concertDayBadge: "Race day",
  restNote: "🏁 This day centres on the race; travel, food and rest go around it.",
  alertNoFan: "Pick at least one F1 place.",
  legendFan: "F1 spots",
  poolFanLabel: "P1 · F1 spots (candidates)",
  poolFanSub: "Pop-ups, installations and the official store around the Shanghai GP. Every entry links to its source; open a card for the evidence, then mark it must-go or on-the-way.",
  poolSightLabel: "P2 · Shanghai sightseeing (optional)",
  poolSightSub: "This vertical currently has interest places only (no curated Shanghai sightseeing data yet).",
  p1Title: "P1 · F1 spots",
  p1Desc: "Pop-ups and installations collected from public player write-ups; each links to its source.",
  p2Title: "P2 · Shanghai sightseeing",
  p2Desc: "Ordinary sightseeing to balance the trip (currently empty).",
  drawerFan: "F1 spots",
  visitseoul: "Amap data",
  noArtist: "Not tied to an interest; used to balance the day.",
  planTitle: "Your F1 Shanghai trip",
  planSub: "The map shows the whole trip as one line by default; switch to “By day” for daily colours. Purple pins are optional hotels, red dots are F1 spots, blue dots are sightseeing.",
  planTagFandom: "F1 + travel",
  planTagEvidence: "With source links",
  stayNearby: "Move nightly",
  stayConcert: "Prioritise hotels near the circuit",
  stayReasonNearby: "This vertical has no hotel data yet, so the itinerary schedules places only.",
  note: "The route comes from a deterministic scheduling engine: geographic clustering + nearest-neighbour ordering + 2-opt. <b>The race day is the anchor.</b> Travel times come from <b>real public-transit routing via Amap</b>; coordinates are Amap geocoding results (candidate, manually checked); sources are collected public posts.",
  footer: "© 2026 Interestip · “F1 × Shanghai” places come from collected public sources (with links); coordinates and travel times come from <a href=\"https://lbs.amap.com/\" target=\"_blank\" rel=\"noreferrer\">Amap</a>.",
  aiReply: "Got it. Here's the plan:\n① P0 — race day locked (Mar 15 · Shanghai International Circuit)\n② P1 — collect F1 pop-ups and installations in the city (each with a source)\n③ P2 — Shanghai sightseeing is currently empty\n\nFirst, pick the places you want: mark them “must-go” or “on-the-way”.",
  intentDefault: "I'm going to Shanghai in March for the F1 Grand Prix and want to hit the F1 pop-ups in town too.",
  intentPlaceholder: "Why are you going to Shanghai?",
  hint: "Say it in your own words — e.g. “I'm going to Shanghai for F1 and want to check out the pop-ups.”",
  catNote: "F1 × Shanghai is the third vertical — same engine as CORTIS × Seoul and New York × Art & Culture.",
  stayReasonConcert: "Stay near the circuit on race day (no hotel data yet).",
  noEvidenceNote: "This one comes from public map data.",
  heroBadgeTitle: "F1 × Shanghai · third vertical",
  heroBadgeText: "Grand Prix + F1 pop-ups around the city, in one feasible itinerary",
  onsiteGo: "请带我去这里",
  onsiteGoSub: "Please take me here",
  phrasesTitle: "常用语（给对方看）",
};

const enPlaces = {};
const enDetails = {};
for (const p of places) {
  enPlaces[p.id] = p.nameLocal || p.name;
  if (p.nameLocal) enDetails[p.id] = { why: p.why };
}

const vertical = {
  id: "shanghai",
  label: { zh: "F1 × Shanghai", en: "F1 × Shanghai" },
  heroEmoji: "🏎",
  places,
  stays: [],
  enPlaces,
  enDetails,
  enStays: {},
  images: {},
  transit: matrix,
  answers: null,
  anchor: {
    placeId: "sh-circuit", time: data.anchor.time, position: "last",
    labelZh: "F1 中国大奖赛（观赛）", labelEn: "F1 Chinese GP (race)",
  },
  i18n: { zh: I18N_ZH, en: I18N_EN },
  onsite: {
    nameField: "name",
    phrases: [
      { big: "请带我去这个地址", zh: "请带我去这个地址", en: "Taxi / driver" },
      { big: "请在这里停车", zh: "请在这里停车", en: "Taxi / driver" },
      { big: "大概多少钱？", zh: "大概多少钱？", en: "Taxi / driver" },
      { big: "请问怎么走？", zh: "请问怎么走？", en: "Anywhere" },
      { big: "可以刷卡吗？", zh: "可以刷卡吗？", en: "Shops / restaurants" },
      { big: "谢谢！", zh: "谢谢！", en: "Anywhere" },
    ],
  },
};

await fs.writeFile(OUT, JSON.stringify(vertical, null, 2) + "\n", "utf8");
console.log(`垂直线已生成：${places.length} 个地点 → ${path.relative(ROOT, OUT)}`);
console.log(`  锚点：${vertical.anchor.labelZh} ${vertical.anchor.time} (position=${vertical.anchor.position})`);
