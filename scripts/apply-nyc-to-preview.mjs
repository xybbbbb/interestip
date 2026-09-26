/**
 * apply-nyc-to-preview.mjs
 *
 * 把纽约「艺术与文化」这条垂直线注入 web-preview/index.html 的
 * `// >>> VERTICAL_NYC` / `// <<< VERTICAL_NYC` 标记之间。
 *
 * 数据来源：
 *   data/nyc-places.json        地点池（坐标 / 开放时间 / 官网，来自 OpenStreetMap）
 *   data/nyc-stays.json         住宿候选
 *   data/nyc-transit-matrix.json 站点间真实耗时（Transitous）
 *
 * 用法：node scripts/apply-nyc-to-preview.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PREVIEW = path.join(ROOT, "web-preview", "index.html");
const START = "// >>> VERTICAL_NYC";
const END = "// <<< VERTICAL_NYC";

const placesFile = JSON.parse(await fs.readFile(path.join(ROOT, "data", "nyc-places.json"), "utf8"));
const staysFile = JSON.parse(await fs.readFile(path.join(ROOT, "data", "nyc-stays.json"), "utf8"));
const matrix = JSON.parse(await fs.readFile(path.join(ROOT, "data", "nyc-transit-matrix.json"), "utf8"));

// 英文短评（英文界面用；中文短评已在地点数据里）
const EN_WHY = {
  "nyc-met": "New York's encyclopedic museum — Egyptian tombs, European painting, the armour hall.",
  "nyc-moma": "Home of modern art: Van Gogh's Starry Night and a whole floor of contemporary work.",
  "nyc-guggenheim": "Wright's spiral building is itself the exhibit; you take in the art walking up the ramp.",
  "nyc-whitney": "The home of American contemporary art, with a terrace over the Hudson.",
  "nyc-morgan": "A financier's private library preserved intact, with medieval manuscripts.",
  "nyc-frick": "A mansion turned museum: a small collection where every piece is a highlight.",
  "nyc-neue": "German and Austrian art, including Klimt's Portrait of Adele Bloch-Bauer I.",
  "nyc-cloisters": "The Met's medieval branch, in a park at the top of Manhattan.",
  "nyc-brooklynmuseum": "Brooklyn's art museum — strong African, Egyptian and feminist holdings.",
  "nyc-ps1": "MoMA's contemporary outpost in a former school; experimental shows and summer music.",
  "nyc-noguchi": "Sculptor Isamu Noguchi's own museum and garden — light and stone.",
  "nyc-newmuseum": "A stacked white building on the Bowery, contemporary art only.",
  "nyc-elmuseo": "Caribbean and Latin American art, at the top of Museum Mile.",
  "nyc-highline": "A disused elevated railway turned into a park, with public art and river views.",
  "nyc-shed": "A retractable-shell arts centre with commissioned, ticketed performances.",
  "nyc-printedmatter": "Artist's books and zines since 1976 — the shop for independent publishing.",
  "nyc-queensmuseum": "Its Panorama models every building in New York City; inside Flushing Meadows.",
  "nyc-cpark": "The big park in the middle of Manhattan — right outside the Met.",
  "nyc-brooklynbridge": "Walk across for the classic skyline view.",
  "nyc-wsquare": "The centre of Greenwich Village: the arch, street music, people-watching.",
  "nyc-grandcentral": "Beaux-Arts station hall with a celestial ceiling worth looking up at.",
  "nyc-nypl": "The main library's Rose Reading Room is free to enter, next to Grand Central.",
  "nyc-chelseamarket": "A food market in an old biscuit factory, next to the High Line.",
  "nyc-littleisland": "A tulip-shaped artificial island on the Hudson, free to enter.",
  "nyc-flushingmeadows": "A park on the old World's Fair site; the Unisphere is the landmark.",
  "nyc-flushingmain": "One of the largest Chinese neighbourhoods in the US — eat, then head back.",
};

// 英文开放时间（英文界面用；中文界面继续显示 data/nyc-places.json 里的原文，不改数据）
// OSM 的 opening_hours 语法（Mo-Su / We off）在英文界面里换成更好读的写法
const EN_HOURS = {
  "nyc-met": "10:00–17:00 (Fri–Sat until 21:00); closed Wed",
  "nyc-moma": "Daily 10:30–17:30; Sat until 19:00",
  "nyc-guggenheim": "Daily 10:30–17:30",
  "nyc-whitney": "10:30–18:00; closed Tue; Fri until 22:00",
  "nyc-morgan": "Tue–Sun 10:30–17:00; Fri until 20:00; closed Mon",
  "nyc-frick": "Mon, Wed–Sun 10:30–17:30",
  "nyc-neue": "Wed–Mon 10:00–18:00",
  "nyc-cloisters": "Check the official site",
  "nyc-brooklynmuseum": "Wed–Sun 11:00–18:00",
  "nyc-ps1": "Check the official site",
  "nyc-noguchi": "Closed Mon–Tue; Wed–Sun 11:00–18:00",
  "nyc-newmuseum": "Tue, Wed, Fri–Sun 11:00–18:00; Thu until 21:00",
  "nyc-elmuseo": "Thu–Sun 11:00–17:00",
  "nyc-highline": "Check the official site",
  "nyc-shed": "Closed Mon",
  "nyc-printedmatter": "Daily 11:00–19:00",
  "nyc-cpark": "06:00–01:00",
  "nyc-brooklynbridge": "Open 24 hours",
  "nyc-wsquare": "Open all day",
  "nyc-grandcentral": "Daily 05:30–02:00",
  "nyc-nypl": "Mon, Thu–Sat 10:00–18:00; Tue–Wed 08:00–20:00",
  "nyc-chelseamarket": "Daily 07:00–22:00",
  "nyc-littleisland": "Daily 06:00–23:00",
  "nyc-flushingmeadows": "Park open all day (venues keep their own hours)",
  "nyc-flushingmain": "24/7",
  "nyc-queensmuseum": "Check the official site",
};

const I18N_ZH = {
  p0Title: "P0 · 已预约（不可更改）",
  p0Desc: "锚点是你已经订好的定时入场：那天从它开始，其余安排绕开它。",
  lblConcertDay: "预约在第几天",
  concertDayBadge: "已预约日",
  restNote: "🎫 这一天以预约入场开始；之后的安排从它结束的时间往后排。",
  alertNoFan: "请至少选择一个「艺术与文化」地点。",
  legendFan: "艺术与文化",
  poolFanLabel: "P1 · 艺术与文化（候选）",
  poolFanSub: "纽约的美术馆、画廊与艺术空间；点卡片可以看来源，再标「必去 / 顺路」。",
  poolSightLabel: "P2 · 纽约观光（可选）",
  poolSightSub: "中央公园、布鲁克林大桥、中央车站、法拉盛一带等地标；时间够就顺手加上，行程不至于变成连着看展。",
  p1Title: "P1 · 艺术与文化地点",
  p1Desc: "从开放地图数据里策展出来的美术馆与艺术空间，每条都带地图来源；点卡片看简介和出处。",
  p2Title: "P2 · 纽约观光",
  p2Desc: "普通观光点用来调剂，别让旅行变成纯看展。",
  drawerFan: "艺术与文化",
  visitseoul: "OpenStreetMap 数据",
  noArtist: "不属于某个兴趣点，用于平衡行程。",
  planTitle: "你的纽约艺术之旅",
  planSub: "路线默认显示全部行程总览（深色连贯线）；可切换「按天分开」看每天不同颜色。紫色图钉是可选酒店，红点是艺术与文化地点、蓝点是普通观光。",
  planTagFandom: "艺术 + 旅行",
  planTagEvidence: "带来源链接",
  stayNearby: "每晚就近换（含预约日就近）",
  stayConcert: "预约地点周边优先",
  stayReasonNearby: "每晚就近换：按当天路线总通勤最短，优先多线地铁；预约日与前一晚会优先住锚点附近（强约束）。",
  note: "路线由确定性排程引擎生成：地理聚类分天 + 最近邻排序 + 2-opt 优化，同一区域尽量放在同一天。<b>「定时入场」是锚点</b>：那天从它开始排，其余安排绕开它。住宿评分 = 当天路线总通勤 + 地铁线路数 + 换酒店打车距离；<b>「多久到」来自 Transitous 的真实公共交通路线</b>；地点与开放时间来自 OpenStreetMap（候选数据，待人工核验）；酒店为真实名称与坐标，<b>不含价格</b>。",
  footer: "© 2026 Interestip · 「纽约 · 艺术与文化」的地点与酒店数据来自 <a href=\"https://www.openstreetmap.org/copyright\" target=\"_blank\" rel=\"noreferrer\">OpenStreetMap</a> contributors（ODbL）；站点间耗时来自 <a href=\"https://transitous.org/sources/\" target=\"_blank\" rel=\"noreferrer\">Transitous</a> 的真实公共交通路线；开放时间为候选数据，出行前请以官网为准。<br/>CORTIS × Seoul 线：P1 粉丝地点来自用户整理的真实资料；P2 观光点来自 VisitSeoul 官方 API；酒店为演示数据。",
  aiReply: "收到！我先按优先级处理：\n① P0 定时入场已锁定，那天从它开始排，其余安排绕开它\n② P1 收集纽约的艺术与文化地点（来自 OpenStreetMap，每条带来源）\n③ P2 补充普通观光点\n\n请先选择想去的地点：给地点标「必去」或「顺路」。",
  intentDefault: "我对艺术与文化感兴趣。想去纽约逛美术馆和画廊，也想顺路看看这座城市。",
  intentPlaceholder: "你想为什么去纽约？",
  hint: "直接说想法，例如：“我喜欢逛美术馆，想以艺术为主题安排几天纽约行程。”",
  catNote: "演示数据目前有 CORTIS × Seoul 与 纽约艺术与文化 两条垂直线；其他兴趣会走同一套流程。",
  stayReasonConcert: "预约优先：锚点当天优先住附近。",
  noEvidenceNote: "这一条来自公开地图数据，不带粉丝证据链。",
  heroBadgeTitle: "纽约 · 艺术与文化 · 第二条垂直线",
  heroBadgeText: "定时入场 + 美术馆与画廊 + 普通纽约观光，排进同一份可行行程",
  onsiteGo: "Please take me here",
  onsiteGoSub: "请带我去这里",
  phrasesTitle: "常用语（给对方看）",
};

const I18N_EN = {
  p0Title: "P0 · Booked (fixed)",
  p0Desc: "The anchor is a timed entry you've already booked: that day starts with it, and everything else works around it.",
  lblConcertDay: "Which day is the booking",
  concertDayBadge: "Booked",
  restNote: "🎫 This day starts with your timed entry; the rest of the day follows after it.",
  alertNoFan: "Pick at least one Art & Culture place.",
  legendFan: "Art & culture",
  poolFanLabel: "P1 · Art & culture (candidates)",
  poolFanSub: "New York's museums, galleries and art spaces. Open a card for its source, then mark it must-go or on-the-way.",
  poolSightLabel: "P2 · New York sightseeing (optional)",
  poolSightSub: "Central Park, Brooklyn Bridge, Grand Central, Flushing and other landmarks — add them when there's room, so the trip isn't back-to-back museums.",
  p1Title: "P1 · Art & culture places",
  p1Desc: "Museums and art spaces curated from open map data; every entry links back to its map source. Open a card for the summary and provenance.",
  p2Title: "P2 · New York sightseeing",
  p2Desc: "Ordinary sightseeing keeps the trip balanced, so it doesn't turn into a museum marathon.",
  drawerFan: "Art & culture",
  visitseoul: "OpenStreetMap data",
  noArtist: "Not tied to an interest; used to balance the day.",
  planTitle: "Your New York art trip",
  planSub: "The map shows the whole trip as one line by default; switch to “By day” for daily colours. Purple pins are optional hotels, red dots are art & culture places, blue dots are ordinary sightseeing.",
  planTagFandom: "Art + travel",
  planTagEvidence: "With source links",
  stayNearby: "Move nightly (closest to each day, incl. the booking)",
  stayConcert: "Prioritise hotels near the booking",
  stayReasonNearby: "Move nightly: shortest total travel for that day's route, preferring multi-line stations; the booking day and the night before stay near the anchor (hard constraint).",
  note: "The route comes from a deterministic scheduling engine: geographic clustering by day + nearest-neighbour ordering + 2-opt optimisation, keeping each area together. <b>The timed entry is the anchor</b>: that day starts with it, and everything else works around it. Lodging score = that day's total travel + number of subway lines + taxi distance when changing hotels; <b>travel times come from real public-transit routing via Transitous</b>; places and opening hours come from OpenStreetMap (candidate data, pending manual verification); hotels use real names and coordinates, <b>no prices</b>.",
  footer: "© 2026 Interestip · “New York · Art & Culture” places and hotels come from <a href=\"https://www.openstreetmap.org/copyright\" target=\"_blank\" rel=\"noreferrer\">OpenStreetMap</a> contributors (ODbL); travel times come from real public-transit routing via <a href=\"https://transitous.org/sources/\" target=\"_blank\" rel=\"noreferrer\">Transitous</a>; opening hours are candidate data — check the official site before you go.<br/>CORTIS × Seoul vertical: P1 fan places come from collected public sources; P2 sightseeing from the official VisitSeoul API; hotels are sample data.",
  aiReply: "Got it. Here's how I'll handle it:\n① P0 — your timed entry is locked; that day starts with it\n② P1 — collect New York's art & culture places (from OpenStreetMap, each with its source)\n③ P2 — add ordinary sightseeing\n\nFirst, pick the places you want: mark them “must-go” or “nice-to-have”.",
  intentDefault: "I'm into art and culture. I want to see New York's museums and galleries, and still see a bit of the city.",
  intentPlaceholder: "Why are you going to New York?",
  hint: "Say it in your own words — e.g. “I love museums and want a few days in New York built around art.”",
  catNote: "The demo covers two verticals: CORTIS × Seoul and New York · Art & Culture. Other interests run the same flow.",
  stayReasonConcert: "Booking-first: on the anchor day, stay near the venue.",
  noEvidenceNote: "This one comes from open map data and has no fan evidence chain.",
  heroBadgeTitle: "New York · Art & Culture · second vertical",
  heroBadgeText: "A timed entry + museums and galleries + ordinary NYC sightseeing, in one feasible itinerary",
  onsiteGo: "Please take me here",
  onsiteGoSub: "请带我去这里",
  phrasesTitle: "Essential phrases (show this screen)",
};

// 现场模式：纽约的"当地语言"就是英语，所以大字用英文名，常用语也换成英文
const ONSITE_EN = {
  nameField: "en",
  phrases: [
    { big: "Please take me to this address.", zh: "请带我去这个地址", en: "Taxi / rideshare driver" },
    { big: "Could you stop here, please?", zh: "请在这里停车", en: "Taxi / driver" },
    { big: "How much will it cost?", zh: "大概多少钱？", en: "Taxi / driver" },
    { big: "One ticket, please.", zh: "一张票，谢谢", en: "Museum or venue ticket desk" },
    { big: "What time do you close?", zh: "你们几点关门？", en: "Museum / shop" },
    { big: "Do you have a table for two?", zh: "有两人桌吗？", en: "Restaurant" },
    { big: "Can I pay by card?", zh: "可以刷卡吗？", en: "Shops / restaurants" },
    { big: "Where is the nearest subway station?", zh: "最近的地铁站在哪里？", en: "Street / hotel desk" },
    { big: "Excuse me, could you help me?", zh: "打扰一下，可以帮我一下吗？", en: "Anywhere" },
    { big: "Sorry, I don't speak much English.", zh: "抱歉，我的英语不太好", en: "Anywhere" },
    { big: "Please write it down for me.", zh: "请帮我写下来", en: "Anywhere" },
    { big: "Thank you very much.", zh: "非常感谢", en: "Anywhere" },
  ],
};

// 耗时矩阵：只保留页面 runtime 需要的字段，减小体积
const pairs = {};
for (const [key, v] of Object.entries(matrix.pairs || {})) {
  if (!v || !v.ok) continue;
  pairs[key] = {
    ok: true,
    minutes: Math.round(v.minutes),
    transfers: v.transfers ?? 0,
    mode: v.mode === "walk-estimate" ? "walk-estimate" : "transit",
    modes: Array.isArray(v.modes) ? v.modes : [],
  };
}
const transit = {
  generatedAt: matrix.generatedAt ?? null,
  queryTime: matrix.queryTime ?? null,
  source: matrix.source ?? "Transitous (MOTIS)",
  sourceUrl: matrix.sourceUrl ?? "https://transitous.org/sources/",
  note: matrix.note ?? "",
  pairs,
};

const places = placesFile.places.map((p) => ({
  id: p.id,
  name: p.name,
  nameLocal: p.nameLocal || "",
  type: p.type || "sightseeing",
  pool: p.pool === "sight" ? "sight" : "fan", // 页面内部沿用 fan/sight 两池；标签由 i18n 覆盖改成「艺术与文化」
  district: p.district || "",
  lat: p.lat,
  lng: p.lng,
  hours: p.hours || "",
  conf: p.conf ?? (p.pool === "sight" ? null : "high"),
  why: p.why || EN_WHY[p.id] || "",
  address: p.address || "",
  officialUrl: p.officialUrl || "",
  source: p.source || "",
  note: p.note || "",
  evidence: [],
}));

const enPlaces = {};
const enDetails = {};
for (const p of places) {
  enPlaces[p.id] = p.nameLocal || p.name;
  const detail = {};
  if (EN_WHY[p.id]) detail.why = EN_WHY[p.id];
  if (EN_HOURS[p.id]) detail.hours = EN_HOURS[p.id];
  if (Object.keys(detail).length) enDetails[p.id] = detail;
}

const nyc = {
  id: "nyc",
  label: placesFile.label || { zh: "纽约 · 艺术与文化", en: "New York · Art & Culture" },
  heroEmoji: "🖼",
  places,
  stays: staysFile.stays,
  enPlaces,
  enDetails,
  enStays: staysFile.en || {},
  images: {},
  transit,
  answers: null,
  anchor: placesFile.anchor || { placeId: "nyc-met", time: "10:30", position: "first" },
  i18n: { zh: I18N_ZH, en: I18N_EN },
  onsite: ONSITE_EN,
};

const html = await fs.readFile(PREVIEW, "utf8");
const block = `${START}\nVERTICALS.nyc = ${JSON.stringify(nyc)};\n${END}`;
const s = html.indexOf(START);
const e = html.indexOf(END);
if (s < 0 || e < 0) throw new Error("index.html 里找不到 VERTICAL_NYC 标记");
await fs.writeFile(PREVIEW, html.slice(0, s) + block + html.slice(e + END.length), "utf8");

console.log(
  `已注入纽约垂直线：${places.length} 个地点、${nyc.stays.length} 家酒店、${Object.keys(pairs).length} 组耗时（${(Buffer.byteLength(block, "utf8") / 1024).toFixed(1)} KB）`,
);
