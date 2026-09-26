/**
 * benchmark-travel-model.mjs —— T1 量化对比实验
 *
 * 问题：把「直线距离 × 11 分钟/公里」换成真实公共交通耗时，行程到底变好了多少？
 *
 * 做法：把原型 index.html 里的排程引擎原封不动抽出来，在 Node 里跑两遍**同一批地点、同样的天数/节奏/住宿策略**：
 *   A 组（估算版）：不加载 TRANSIT_MATRIX，站点耗时一律用「直线距离 × 11 分钟/公里」
 *   B 组（真实版）：加载 data/transit-matrix.json 里的 69 组真实耗时（Transitous / KTDB）
 *
 * 比较四个数字：
 *   1. 全程总通勤（把两组的行程都按**真实耗时**折算，公平可比）
 *   2. 演唱会日安全：按真实耗时会晚于 18:30 才到的点数（应为 0）
 *   3. 估算误差：矩阵覆盖的组合上，估算值 vs 真实值的平均/最大偏差
 *   4. 待定清单：因为排不下而没进行程的点数
 *
 * 用法：node scripts/benchmark-travel-model.mjs [--json]
 * 产出：data/benchmark-travel-model.json
 */

import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PREVIEW = path.join(ROOT, "web-preview", "index.html");
const OUT = path.join(ROOT, "data", "benchmark-travel-model.json");
const MISSING = path.join(ROOT, "data", "transit-missing-pairs.json");
const AS_JSON = process.argv.includes("--json");

// ---------------------------------------------------------------- 从原型里抽引擎
const html = await fs.readFile(PREVIEW, "utf8");

function slice(from, to, label) {
  const a = html.indexOf(from);
  if (a < 0) throw new Error(`在 index.html 里找不到 ${label} 的起点：${from}`);
  const b = html.indexOf(to, a);
  if (b < 0) throw new Error(`在 index.html 里找不到 ${label} 的终点：${to}`);
  return html.slice(a, b + to.length);
}

const MATRIX_CODE = slice("// >>> TRANSIT_MATRIX", "// <<< TRANSIT_MATRIX", "耗时矩阵");
const ALGO_CODE = slice("(function (global) {", "})(typeof window !== \"undefined\" ? window : globalThis);", "排程引擎");
const PLACES_CODE = slice("const PLACES = [", "\n];", "PLACES");
const STAYS_CODE = slice("const STAYS=[", "\n];", "STAYS");

/** 在干净的 vm 上下文里加载引擎；withMatrix=false 时不注入 TRANSIT_MATRIX（= 估算版） */
function loadEngine({ withMatrix }) {
  const sandbox = {};
  const code = [
    // 原页面里是 window.TRANSIT_MATRIX = ...，在 Node 的 vm 里改成 globalThis
    withMatrix ? MATRIX_CODE.replace("window.TRANSIT_MATRIX", "globalThis.TRANSIT_MATRIX") : "// 估算版：不加载耗时矩阵",
    ALGO_CODE,
    PLACES_CODE,
    STAYS_CODE,
    "globalThis.__X = { RouteAlgo, PLACES, STAYS };",
  ].join("\n");
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  const { RouteAlgo, PLACES, STAYS } = sandbox.__X;
  return { RouteAlgo, PLACES: JSON.parse(JSON.stringify(PLACES)), STAYS };
}

const estimateEngine = loadEngine({ withMatrix: false });
const matrixEngine = loadEngine({ withMatrix: true });

// ---------------------------------------------------------------- 复刻 buildPlan 的流程
function taxiMin(algo, a, b) {
  return Math.max(6, Math.round(algo.distKm(a, b) * 3.2));
}

/** 与 index.html 里的 chooseHotel 完全一致（住宿评分：当天通勤 + 地铁线路数 + 换店代价 + 次日演唱会优先级） */
function chooseHotel(algo, stays, points, { prevHotel, isConcertDay, isNightBefore, concertPoint, mode }) {
  let best = null;
  let bestScore = Infinity;
  stays.forEach((stay) => {
    const ordered = algo.orderRoute(points, stay, null);
    let travel = 0;
    if (ordered.length) {
      travel += algo.roughMin(stay, ordered[0]);
      for (let i = 0; i < ordered.length - 1; i += 1) travel += algo.roughMin(ordered[i], ordered[i + 1]);
      travel += algo.roughMin(ordered[ordered.length - 1], stay) * 0.7;
    }
    let score = travel;
    score -= Math.min(3, (stay.lines || []).length) * 3;
    if (prevHotel && prevHotel.id !== stay.id) {
      const km = algo.distKm(prevHotel, stay);
      const taxi = taxiMin(algo, prevHotel, stay);
      const factor = isConcertDay || isNightBefore ? 0.3 : 1;
      if (km > 12) score += 60 * factor;
      else if (taxi > 25) score += (taxi - 25) * 2.2 * factor;
    }
    if (concertPoint) {
      if (isNightBefore) score += algo.distKm(stay, concertPoint) * 45;
      if (isConcertDay) score += algo.distKm(stay, concertPoint) * 30;
      if (mode === "concert") score += algo.distKm(stay, concertPoint) * 12;
    }
    if (mode === "same" && prevHotel && prevHotel.id !== stay.id) score += 25;
    if (score < bestScore) {
      bestScore = score;
      best = stay;
    }
  });
  return best || stays[0];
}

const visitMinutes = (pace) => (pace === "relaxed" ? 90 : pace === "busy" ? 60 : 75);

/**
 * 「按真实耗时排序」的对照实现（C 组用）。
 * 原型的最近邻 + 2-opt 用的是**直线距离**，真实耗时只用在「排时间」和「选酒店」。
 * 这里把距离函数换成真实耗时（分钟），回答一个问题：如果排序也看真实耗时，能再省多少？
 * ⚠ 这只是一个对照实验，还没有进原型。
 */
function orderRouteByMinutes(algo, points, start, endPoint) {
  const middle = points.filter((p) => !(endPoint && p.id === endPoint.id));
  const min = (a, b) => algo.roughMin(a, b);

  // 最近邻
  const rest = [...middle];
  const order = [];
  let current = start || rest[0];
  while (rest.length) {
    let bestIndex = 0;
    let bestCost = Infinity;
    rest.forEach((p, i) => {
      const cost = min(current, p);
      if (cost < bestCost) {
        bestCost = cost;
        bestIndex = i;
      }
    });
    current = rest.splice(bestIndex, 1)[0];
    order.push(current);
  }

  // 2-opt（同样的邻域，只换评价函数）
  const arr = order.slice();
  let improved = true;
  let guard = 0;
  while (improved && guard < 200) {
    improved = false;
    guard += 1;
    for (let i = 0; i < arr.length - 1; i += 1) {
      for (let j = i + 1; j < arr.length; j += 1) {
        const a = i === 0 ? start : arr[i - 1];
        const b = arr[i];
        const c = arr[j];
        const d = j + 1 < arr.length ? arr[j + 1] : null;
        const before = min(a, b) + (d ? min(c, d) : 0);
        const after = min(a, c) + (d ? min(b, d) : 0);
        if (after + 1e-9 < before) {
          arr.splice(i, j - i + 1, ...arr.slice(i, j + 1).reverse());
          improved = true;
        }
      }
    }
  }
  if (endPoint) arr.push(endPoint);
  return arr;
}

/** 跑一次完整排程（等价于点击「生成行程」） */
function runPlan(engine, scenario) {
  const { RouteAlgo, PLACES, STAYS } = engine;
  const { days, concertDay, pace, arrival, stayMode, selectAllSight, orderBy } = scenario;
  const cap = pace === "busy" ? 5 : pace === "relaxed" ? 3 : 4;

  const fanSelected = PLACES.filter((p) => p.pool === "fan");
  const sightSelected = selectAllSight ? PLACES.filter((p) => p.pool === "sight") : [];
  const concert = fanSelected.find((p) => p.type === "venue") || fanSelected[0];
  const otherFan = fanSelected.filter((p) => p.id !== concert.id);
  const mustFan = otherFan; // 粉丝点全部按「必去」处理
  const optionalFan = [];
  mustFan.forEach((p) => { p._priority = 2; });
  optionalFan.forEach((p) => { p._priority = 1; });
  sightSelected.forEach((p) => { p._priority = 0; });

  const points = [...mustFan, ...optionalFan, ...sightSelected];
  const plan = RouteAlgo.planDays({ points, days, concertDay, concertPoint: concert, cap });
  const overflow = [...plan.overflow];
  const firstStart = arrival === "上午" ? 600 : arrival === "下午" ? 780 : arrival === "晚上" ? 960 : 690;

  const hotels = [];
  const dayPlans = [];
  plan.buckets.forEach((places, d) => {
    const prevHotel = d > 0 ? hotels[d - 1] : null;
    const isConcertDay = d === concertDay;
    const isNightBefore = d + 1 === concertDay;
    const hotel =
      stayMode === "same" && hotels[0]
        ? hotels[0]
        : chooseHotel(RouteAlgo, STAYS, places, { prevHotel, isConcertDay, isNightBefore, concertPoint: concert, mode: stayMode });
    hotels[d] = hotel;
    const ordered =
      orderBy === "minutes"
        ? orderRouteByMinutes(RouteAlgo, places, hotel, isConcertDay ? concert : null)
        : RouteAlgo.orderRoute(places, hotel, isConcertDay ? concert : null);
    const scheduled = RouteAlgo.scheduleDay(ordered, {
      startPoint: hotel,
      startMinutes: d === 0 ? firstStart : 9 * 60 + 30,
      pace,
      isConcertDay,
      concertPoint: concert,
    });
    let items = scheduled.items;
    if (isConcertDay && !items.some((x) => x.locked)) items = [...items, { place: concert, time: "19:00", locked: true }];
    items.sort((a, c) => String(a.time || "").localeCompare(String(c.time || "")));
    scheduled.overflow.forEach((p) => overflow.push(p));
    dayPlans.push({ day: d, hotel, items });
  });

  return { cap, concert, overflow, dayPlans };
}

/** 把一次排程结果折算成「按真实耗时走一遍」的细节 */
function measure(planEngine, truthEngine, plan, scenario) {
  const believedOf = (a, b) => planEngine.RouteAlgo.roughMin(a, b);
  const realOf = (a, b) => truthEngine.RouteAlgo.roughMin(a, b);
  const placeIds = new Set(truthEngine.PLACES.map((p) => p.id)); // 用来区分「酒店出发段」和「页面可见的地点↔地点段」
  const visit = visitMinutes(scenario.pace);
  const matrixTable = JSON.parse(MATRIX_CODE.slice(MATRIX_CODE.indexOf("{"), MATRIX_CODE.lastIndexOf("}") + 1)).pairs;
  const isCovered = (a, b) => Boolean(matrixTable[`${a.id}|${b.id}`] || matrixTable[`${b.id}|${a.id}`]);

  let believedTotal = 0;
  let trueTotal = 0;
  let coveredLegs = 0;
  let legCount = 0;
  const legs = [];
  const unsafe = [];

  plan.dayPlans.forEach(({ day, hotel, items }) => {
    const startMinutes = day === 0
      ? (scenario.arrival === "上午" ? 600 : scenario.arrival === "下午" ? 780 : scenario.arrival === "晚上" ? 960 : 690)
      : 9 * 60 + 30;
    let prev = hotel;
    let current = startMinutes;
    items.forEach((item) => {
      const p = item.place;
      // 「以为要花多久」= 生成这份行程的那个引擎算出来的
      const believed = believedOf(prev, p);
      // 「真值」= 真实版引擎算出的耗时（矩阵命中用矩阵，未命中才退回估算）
      const real = realOf(prev, p);
      const covered = isCovered(prev, p);
      believedTotal += believed;
      trueTotal += real;
      legCount += 1;
      if (covered) coveredLegs += 1;
      legs.push({
        day,
        from: prev.id,
        to: p.id,
        fromLabel: prev.name,
        toLabel: p.name,
        believed,
        real,
        covered,
        visible: placeIds.has(prev.id), // 页面只显示地点↔地点的衔接行，酒店出发段不显示
      });
      current += real;
      if (day === scenario.concertDay && !item.locked && current + visit > 18 * 60 + 30) {
        unsafe.push({ day, place: p.name, id: p.id, arrivesAt: truthEngine.RouteAlgo.formatTime(current) });
      }
      current += item.locked ? 0 : visit;
      prev = p;
    });
  });

  const uncoveredLegs = legs
    .filter((l) => !l.covered)
    .map((l) => ({ day: l.day, fromId: l.from, toId: l.to, from: l.fromLabel, to: l.toLabel }));
  const visible = legs.filter((l) => l.visible);
  const visibleCovered = visible.filter((l) => l.covered).length;
  return {
    believedTotal,
    trueTotal,
    legs,
    legCount,
    coveredLegs,
    unsafe,
    uncoveredLegs,
    visibleLegs: visible.length,
    visibleCoveredLegs: visibleCovered,
    uncoveredVisibleLegs: visible
      .filter((l) => !l.covered)
      .map((l) => ({ day: l.day, fromId: l.from, toId: l.to, from: l.fromLabel, to: l.toLabel })),
  };
}

// ---------------------------------------------------------------- 跑场景
const SCENARIOS = [
  { name: "3 天 · 适中 · 默认（中午到）", days: 3, concertDay: 1, pace: "normal", arrival: "中午", stayMode: "nearby", selectAllSight: true },
  { name: "5 天 · 适中（中午到）", days: 5, concertDay: 1, pace: "normal", arrival: "中午", stayMode: "nearby", selectAllSight: true },
  { name: "7 天 · 宽松（上午到）", days: 7, concertDay: 2, pace: "relaxed", arrival: "上午", stayMode: "nearby", selectAllSight: true },
];

const results = [];
// 行程工作流的行为断言（C 组测试 case）：每个 case 都要在**所有场景**下成立
const workflowRaw = [];

for (const scenario of SCENARIOS) {
  const estimatePlan = runPlan(estimateEngine, scenario); // A 组：估算耗时 + 直线排序
  const matrixPlan = runPlan(matrixEngine, scenario); // B 组：真实耗时 + 直线排序（= 现在的原型）
  const matrixOrderPlan = runPlan(matrixEngine, { ...scenario, orderBy: "minutes" }); // C 组：真实耗时 + 真实耗时排序（对照实验）
  // 三份行程都按真实耗时折算（同一把尺子），但「以为要花多久」各用各的引擎
  const estimate = measure(estimateEngine, matrixEngine, estimatePlan, scenario);
  const matrix = measure(matrixEngine, matrixEngine, matrixPlan, scenario);
  const matrixOrder = measure(matrixEngine, matrixEngine, matrixOrderPlan, scenario);

  // C 组断言（只针对"真实耗时版"，也就是现在线上的行为）
  const totalPlaces = matrixEngine.PLACES.length;
  const concertItems = matrixPlan.dayPlans[scenario.concertDay]?.items ?? [];
  workflowRaw.push({
    scenario: scenario.name,
    lockedConcert: concertItems.some((x) => x.locked && x.time === "19:00"),
    noLateOnConcertDay: matrix.unsafe.length === 0,
    noDrop: matrixPlan.dayPlans.reduce((s, d) => s + d.items.length, 0) + matrixPlan.overflow.length === totalPlaces,
    totalPlaces,
  });

  // 估算误差：只在矩阵覆盖的腿上算（没覆盖的组合没有"真值"）
  const coveredLegs = estimate.legs.filter((l) => l.covered);
  const errors = coveredLegs.map((l) => l.believed - l.real);
  const absErrors = errors.map(Math.abs);
  const avgAbsError = absErrors.length ? absErrors.reduce((s, x) => s + x, 0) / absErrors.length : 0;
  const maxAbsError = absErrors.length ? Math.max(...absErrors) : 0;
  const meanSignedError = errors.length ? errors.reduce((s, x) => s + x, 0) / errors.length : 0;

  const sameItinerary =
    estimatePlan.dayPlans.map((d) => d.items.filter((x) => !x.locked).map((x) => x.place.id).join(",")).join("|") ===
    matrixPlan.dayPlans.map((d) => d.items.filter((x) => !x.locked).map((x) => x.place.id).join(",")).join("|");

  const drop = (a, b) => (a === 0 ? (b === 0 ? "0%" : "-100%") : `${(((b - a) / a) * 100).toFixed(0)}%`);
  const legs = (plan) => plan.dayPlans.reduce((s, d) => s + d.items.length, 0);
  const sig = (plan) => plan.dayPlans.map((d) => d.items.filter((x) => !x.locked).map((x) => x.place.id));
  const worstLegs = [...coveredLegs]
    .sort((a, b) => Math.abs(b.believed - b.real) - Math.abs(a.believed - a.real))
    .slice(0, 3)
    .map((l) => ({ from: l.from, to: l.to, believed: l.believed, real: l.real, diff: l.believed - l.real }));

  results.push({
    scenario: scenario.name,
    config: scenario,
    sameItinerary,
    estimate: {
      totalTrueMinutes: estimate.trueTotal,
      totalBelievedMinutes: estimate.believedTotal,
      scheduledPoints: legs(estimatePlan),
      overflowPoints: estimatePlan.overflow.length,
      unsafeConcertPoints: estimate.unsafe,
      hotelIds: estimatePlan.dayPlans.map((d) => d.hotel.id),
    },
    matrix: {
      totalTrueMinutes: matrix.trueTotal,
      totalBelievedMinutes: matrix.believedTotal,
      scheduledPoints: legs(matrixPlan),
      overflowPoints: matrixPlan.overflow.length,
      unsafeConcertPoints: matrix.unsafe,
      hotelIds: matrixPlan.dayPlans.map((d) => d.hotel.id),
    },
    matrixOrder: {
      totalTrueMinutes: matrixOrder.trueTotal,
      totalBelievedMinutes: matrixOrder.believedTotal,
      scheduledPoints: legs(matrixOrderPlan),
      overflowPoints: matrixOrderPlan.overflow.length,
      unsafeConcertPoints: matrixOrder.unsafe,
      hotelIds: matrixOrderPlan.dayPlans.map((d) => d.hotel.id),
    },
    delta: {
      totalMinutesDelta: matrix.trueTotal - estimate.trueTotal,
      totalMinutesDeltaPct: drop(estimate.trueTotal, matrix.trueTotal),
      matrixVsMatrixOrderDelta: matrixOrder.trueTotal - matrix.trueTotal,
      matrixVsMatrixOrderDeltaPct: drop(matrix.trueTotal, matrixOrder.trueTotal),
      estimateVsMatrixOrderDeltaPct: drop(estimate.trueTotal, matrixOrder.trueTotal),
    },
    itineraries: { estimate: sig(estimatePlan), matrix: sig(matrixPlan), matrixOrder: sig(matrixOrderPlan) },
    worstEstimateErrors: worstLegs,
    error: {
      legsMeasured: coveredLegs.length,
      legsTotal: estimate.legs.length,
      coveragePct: estimate.legs.length ? Number(((coveredLegs.length / estimate.legs.length) * 100).toFixed(0)) : 0,
      uncoveredLegs: estimate.uncoveredLegs,
      visibleLegs: estimate.visibleLegs,
      visibleCoveredLegs: estimate.visibleCoveredLegs,
      visibleCoveragePct: estimate.visibleLegs
        ? Number(((estimate.visibleCoveredLegs / estimate.visibleLegs) * 100).toFixed(0))
        : 0,
      uncoveredVisibleLegs: estimate.uncoveredVisibleLegs,
      avgAbsErrorMinutes: Number(avgAbsError.toFixed(1)),
      maxAbsErrorMinutes: maxAbsError,
      meanSignedErrorMinutes: Number(meanSignedError.toFixed(1)),
    },
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  source: "web-preview/index.html 的 RouteAlgo ← 直接抽取原型的排程引擎，不重写算法",
  matrixPairs: Object.keys(JSON.parse(MATRIX_CODE.slice(MATRIX_CODE.indexOf("{"), MATRIX_CODE.lastIndexOf("}") + 1)).pairs).length,
  note:
    "A = 估算耗时 + 直线排序；B = 真实耗时 + 直线排序（= 现在的原型）；C = 真实耗时 + 真实耗时排序（对照实验，未进原型）。" +
    "三份行程都按真实耗时折算总通勤（同一把尺子）；估算误差只在矩阵覆盖的地点组合上统计，因为未覆盖的组合没有真值。" +
    "演唱会日安全 = 按真实耗时会晚于 18:30 才到达的点数。",
  scenarios: results,
  // C 组测试 case：行程工作流的硬约束（每个都要在三个场景下全部成立）
  cases: [
    {
      id: "W1",
      name: "演唱会日 19:00 必须锁定在场馆",
      passed: workflowRaw.every((w) => w.lockedConcert),
      detail: workflowRaw.map((w) => `${w.scenario}:${w.lockedConcert ? "✅" : "❌"}`).join(" · "),
    },
    {
      id: "W2",
      name: "演出日 18:30 之后不再排景点（按真实耗时复核）",
      passed: workflowRaw.every((w) => w.noLateOnConcertDay),
      detail: workflowRaw.map((w) => `${w.scenario}:${w.noLateOnConcertDay ? "✅" : "❌"}`).join(" · "),
    },
    {
      id: "W3",
      name: "装不下的地点进「待定清单」，不能丢点",
      passed: workflowRaw.every((w) => w.noDrop),
      detail: workflowRaw.map((w) => `${w.scenario}:${w.noDrop ? "✅" : "❌"}（共 ${w.totalPlaces} 个点）`).join(" · "),
    },
  ],
};

await fs.writeFile(OUT, JSON.stringify(report, null, 2) + "\n", "utf8");

// 顺手把「实际用到、但矩阵里还没有」的地点组合写下来，交给 build-transit-matrix.mjs 按需补全。
// 只收地点↔地点的段：酒店出发段不显示在页面上，且酒店本身还是示例数据（见 TECH_BACKLOG T6）。
const demandPairs = [];
const seenPairs = new Set();
for (const r of results) {
  for (const l of r.error.uncoveredVisibleLegs) {
    const key = l.fromId < l.toId ? `${l.fromId}|${l.toId}` : `${l.toId}|${l.fromId}`;
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    demandPairs.push({ from: l.fromId, to: l.toId, key });
  }
}
await fs.writeFile(MISSING, JSON.stringify(demandPairs, null, 2) + "\n", "utf8");

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

console.log(`估算版 vs 真实耗时版 · ${results.length} 个场景 · 矩阵覆盖 ${report.matrixPairs} 组地点组合`);
console.log("A = 估算耗时·直线排序 ｜ B = 真实耗时·直线排序（现在的原型）｜ C = 真实耗时·真实耗时排序（对照实验）\n");
for (const r of results) {
  console.log(`── ${r.scenario}`);
  console.log(`   全程总通勤（按真实耗时折算）：A ${r.estimate.totalTrueMinutes} → B ${r.matrix.totalTrueMinutes} → C ${r.matrixOrder.totalTrueMinutes} 分钟`);
  console.log(`      B 相对 A：${r.delta.totalMinutesDeltaPct} ｜ C 相对 B：${r.delta.matrixVsMatrixOrderDeltaPct}（${r.delta.matrixVsMatrixOrderDelta >= 0 ? "+" : ""}${r.delta.matrixVsMatrixOrderDelta} 分钟）｜ C 相对 A：${r.delta.estimateVsMatrixOrderDeltaPct}`);
  console.log(`   实际排入的点：${r.estimate.scheduledPoints} / ${r.matrix.scheduledPoints} / ${r.matrixOrder.scheduledPoints} · 待定清单：${r.estimate.overflowPoints} / ${r.matrix.overflowPoints} / ${r.matrixOrder.overflowPoints}`);
  console.log(`   演唱会日会超时（18:30 后到）的点：A ${r.estimate.unsafeConcertPoints.length} · B ${r.matrix.unsafeConcertPoints.length} · C ${r.matrixOrder.unsafeConcertPoints.length}`);
  if (r.estimate.unsafeConcertPoints.length) {
    for (const u of r.estimate.unsafeConcertPoints) console.log(`      ⚠ ${u.place}（${u.arrivesAt} 才到）`);
  }
  console.log(`   A/B 行程是否相同：${r.sameItinerary ? "相同" : "不同"} · 住酒店：${r.estimate.hotelIds.join("/")} → ${r.matrix.hotelIds.join("/")} → ${r.matrixOrder.hotelIds.join("/")}`);
  console.log(`   估算误差（矩阵覆盖的 ${r.error.legsMeasured}/${r.error.legsTotal} 段）：平均 ±${r.error.avgAbsErrorMinutes} 分钟，最大 ${r.error.maxAbsErrorMinutes} 分钟，系统性偏差 ${r.error.meanSignedErrorMinutes > 0 ? "+" : ""}${r.error.meanSignedErrorMinutes} 分钟\n`);
  console.log(
    `   覆盖率：全部路段 ${r.error.legsMeasured}/${r.error.legsTotal}（${r.error.coveragePct}%）· ` +
      `页面可见的地点↔地点段 ${r.error.visibleCoveredLegs}/${r.error.visibleLegs}（${r.error.visibleCoveragePct}%）\n`,
  );
}

console.log(`报告已写入 ${path.relative(ROOT, OUT)}`);
