/**
 * apply-shanghai-to-preview.mjs —— 把「F1 × Shanghai」这条垂直线注入 web-preview/index.html
 *
 * 数据来自 data/shanghai-vertical.json（高德地理编码 + 高德真实公交耗时）。
 * 同时接入：首页兴趣匹配（INTEREST_HUBS）、Featured 卡片、Hub 圈子与动态。
 * 带 guard，重复运行直接退出。用法：node scripts/apply-shanghai-to-preview.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PREVIEW = path.join(ROOT, "web-preview", "index.html");
const VERT_FILE = path.join(ROOT, "data", "shanghai-vertical.json");
const GUARD = "<!-- interestip-shanghai-vertical v1 -->";

const vertical = JSON.parse(await fs.readFile(VERT_FILE, "utf8"));
let html = await fs.readFile(PREVIEW, "utf8");
if (html.includes(GUARD)) { console.log("已注入过 F1 × Shanghai，跳过。"); process.exit(0); }

function once(hay, needle, next, label) {
  if (!hay.includes(needle)) throw new Error("找不到锚点：" + label);
  return hay.replace(needle, next);
}

// 1) 垂直线本体（挂在纽约线之后）
const vertBlock =
  "// >>> VERTICAL_SHANGHAI\n" +
  "VERTICALS.shanghai = " + JSON.stringify(vertical) + ";\n" +
  "// <<< VERTICAL_SHANGHAI";
html = once(html, "// <<< VERTICAL_NYC", "// <<< VERTICAL_NYC\n" + vertBlock, "VERTICAL_NYC 结束标记");

// 2) 首页「兴趣 + 目的地」匹配入口
html = once(html,
  '   destinationKeys:["new york","new york city","nyc","纽约"]}\n];',
  '   destinationKeys:["new york","new york city","nyc","纽约"]},\n' +
  '  {verticalId:"shanghai",interest:"F1",destination:"Shanghai",\n' +
  '   interestKeys:["f1","formula 1","formula one","grand prix","motorsport","赛车","大奖赛","f1赛车"],\n' +
  '   destinationKeys:["shanghai","上海","嘉定"]}\n];',
  "INTEREST_HUBS 结尾");

// 3) Featured 卡片（放在济州岛那张之前）
const card =
  '      <article class="trip-card" data-trip="shanghai">\n' +
  '        <div class="trip-media" style="display:grid;place-items:center;font-size:34px;background:linear-gradient(140deg,#FFE9E4,#E6F4FF)">🏎</div>\n' +
  '        <div class="trip-body">\n' +
  '          <h3 data-i18n="tripF1Title">F1 × Shanghai</h3>\n' +
  '          <p data-i18n="tripF1Desc">示例线：2026 年 3 月上海站期间的市区快闪与展台（现多已结束），演示兴趣地点如何排成行程。</p>\n' +
  '          <div class="trip-foot">\n' +
  '            <div class="trip-tags"><span class="badge plain" data-i18n="tripF1Tag">赛车</span><span class="badge plain">Shanghai</span></div>\n' +
  '            <span class="trip-go" data-i18n="tripF1Example">示例</span>\n' +
  '          </div>\n' +
  '        </div>\n' +
  '      </article>\n';
html = once(html, '      <article class="trip-card" data-trip="hike">', card + '      <article class="trip-card" data-trip="hike">', "济州岛卡片");

// 4) Featured 卡片的中英文案
html = once(html,
  'trip3Title:"济州岛徒步之旅",trip3Desc:"把“兴趣”换成户外路线：徒步段、休息点与住宿推荐用同一套约束求解。",',
  'trip3Title:"济州岛徒步之旅",trip3Desc:"把“兴趣”换成户外路线：徒步段、休息点与住宿推荐用同一套约束求解。",\n' +
  '    tripF1Title:"F1 × Shanghai",tripF1Desc:"示例线：2026 年 3 月上海站期间的市区快闪与展台（现多已结束），演示兴趣地点如何排成行程。",tripF1Tag:"赛车",tripF1Example:"示例",',
  "zh trip3");
html = once(html,
  'trip3Title:"Jeju hiking trip",trip3Desc:"Swap the interest for an outdoor route: hikes, rest stops and lodging solved with the same constraints.",',
  'trip3Title:"Jeju hiking trip",trip3Desc:"Swap the interest for an outdoor route: hikes, rest stops and lodging solved with the same constraints.",\n' +
  '    tripF1Title:"F1 × Shanghai",tripF1Desc:"Example vertical: F1 pop-ups around Shanghai during the March 2026 race week (mostly over now), showing how interest places become an itinerary.",tripF1Tag:"Motorsport",tripF1Example:"Example",',
  "en trip3");

// 5) Hub 圈子 + 动态
html = once(html,
  '      zh:"徒步路线、难度与到达方式。", en:"Trails, difficulty and how to get there." }\n  ],',
  '      zh:"徒步路线、难度与到达方式。", en:"Trails, difficulty and how to get there." },\n' +
  '    { id:"shanghai", emoji:"🏎", name:"F1 × Shanghai", members:"6.2K", vertical:"shanghai",\n' +
  '      zh:"F1 上海站期间的市区快闪与展台（示例线，活动多已结束）。", en:"F1 pop-ups around Shanghai during race week (example; mostly over)." }\n  ],',
  "interest 数组结尾");

html = once(html,
  '        en:"Walk the High Line from Chelsea Market to the Hudson — public art all the way, best at dusk." }\n    ]\n  },',
  '        en:"Walk the High Line from Chelsea Market to the Hudson — public art all the way, best at dusk." }\n    ],\n' +
  '    shanghai: [\n' +
  '      { user:"圈友 · 上海", userEn:"Circle member · Shanghai", interest:"F1 × Shanghai", type:"discovery", placeId:"sh-01", emoji:"🏁", likes:268, comments:41,\n' +
  '        tZh:"中信泰富广场的汉密尔顿快闪", tEn:"Hamilton pop-up at CITIC Square", tags:["F1","快闪","上海"], tagsEn:["F1","Pop-up","Shanghai"],\n' +
  '        zh:"赛事那周在中信泰富广场碰到的汉密尔顿主题快闪，有很多周边。（示例：活动已结束）",\n' +
  '        en:"The Hamilton pop-up at CITIC Square during race week — plenty of merch. (Example: the event is over.)" },\n' +
  '      { user:"圈友 · 嘉定", userEn:"Circle member · Jiading", interest:"F1 × Shanghai", type:"experience", placeId:"sh-circuit", emoji:"🏎", likes:512, comments:88,\n' +
  '        tZh:"比赛日在上海国际赛车场的动线", tEn:"Race day at the Shanghai International Circuit", tags:["F1","嘉定","观赛"], tagsEn:["F1","Jiading","Race"],\n' +
  '        zh:"比赛日从市区过去要 90 分钟（地铁 2 号线转 11 号线），建议一早出发，散场高峰很挤。",\n' +
  '        en:"Race day takes ~90 min from downtown (Metro Line 2 → Line 11). Leave early; the exit crush is real." }\n' +
  '    ]\n  },',
  "feedByCircle 结尾");

html = once(html, "</body>", GUARD + "\n</body>", "</body>");
await fs.writeFile(PREVIEW, html, "utf8");
console.log("F1 × Shanghai 已注入：" + vertical.places.length + " 个地点 / " + Object.keys(vertical.transit.pairs).length + " 组耗时");
