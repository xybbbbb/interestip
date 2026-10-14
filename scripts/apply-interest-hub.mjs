/**
 * apply-interest-hub.mjs —— 把「进入兴趣圈子」重构成独立 Interest Hub（一次性）
 *
 * 内容来自 scripts/hub-assets/hub.css 与 hub.js。
 * 原则：进入 Hub ≠ 自动开始旅行规划；Hub 默认动态；Journey 是 Hub 里的独立 Tab。
 * 复用现有 PLACES / 地图 / place drawer / Journey Planner / i18n / CONTRIB。
 * 带 guard，重复运行直接退出。用法：node scripts/apply-interest-hub.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PREVIEW = path.join(ROOT, "web-preview", "index.html");
const CSS_FILE = path.join(HERE, "hub-assets", "hub.css");
const JS_FILE = path.join(HERE, "hub-assets", "hub.js");

const GUARD = "<!-- interestip-interest-hub v1 -->";
const HUB_HTML = '  <section class="hub" id="hub-view" hidden></section>';

const HUB_CSS = await fs.readFile(CSS_FILE, "utf8");
const HUB_JS = await fs.readFile(JS_FILE, "utf8");

let html = await fs.readFile(PREVIEW, "utf8");
if (html.includes(GUARD)) {
  console.log("已应用过 Interest Hub（guard 存在），跳过。");
  process.exit(0);
}

function replaceOnce(hay, needle, next, label) {
  if (!hay.includes(needle)) throw new Error("找不到锚点：" + label);
  return hay.replace(needle, next);
}

const CSS_ANCHOR = "@media(max-width:560px){ .ic-grid{grid-template-columns:1fr} .app-content{padding:10px} }\n</style>";
html = replaceOnce(html, CSS_ANCHOR,
  "@media(max-width:560px){ .ic-grid{grid-template-columns:1fr} .app-content{padding:10px} }\n" + HUB_CSS + "\n</style>",
  "home-restructure 样式结尾");

html = replaceOnce(html, '<div class="app-content">\n<div class="app-main">\n<main>',
  '<div class="app-content">\n<div class="app-main">\n<div id="home-view">\n<main>', "app-main 开始");

html = replaceOnce(html, '</section>\n</div><!-- /app-main -->',
  '</section>\n</div><!-- /home-view -->\n' + HUB_HTML + '\n</div><!-- /app-main -->', "app-main 结束");

html = replaceOnce(html, "  window.renderHome = renderHome;",
  "  window.__home = { D: D, feedCard: feedCard };\n  window.renderHome = renderHome;", "renderHome 暴露点");

const typePairs = [
  ['interest:"CORTIS \u00d7 Seoul", placeId:"cortis-004"', 'interest:"CORTIS \u00d7 Seoul", type:"discovery", placeId:"cortis-004"'],
  ['interest:"CORTIS \u00d7 Seoul", placeId:"vs-CNP012993"', 'interest:"CORTIS \u00d7 Seoul", type:"experience", placeId:"vs-CNP012993"'],
  ['interest:"CORTIS \u00d7 Seoul", placeId:"cortis-003"', 'interest:"CORTIS \u00d7 Seoul", type:"newplace", placeId:"cortis-003"'],
  ['interest:"New York × Art & Culture", placeId:"nyc-met"', 'interest:"New York × Art & Culture", type:"discussion", placeId:"nyc-met"'],
  ['interest:"New York × Art & Culture", placeId:"nyc-moma"', 'interest:"New York × Art & Culture", type:"route", placeId:"nyc-moma"'],
  ['interest:"New York × Art & Culture", placeId:"nyc-highline"', 'interest:"New York × Art & Culture", type:"experience", placeId:"nyc-highline"'],
];
for (const pair of typePairs) html = replaceOnce(html, pair[0], pair[1], "feed type: " + pair[0]);

html = replaceOnce(html, "</body>", GUARD + "\n<script>\n" + HUB_JS + "\n</script>\n</body>", "</body>");

await fs.writeFile(PREVIEW, html, "utf8");
const kb = (Buffer.byteLength(HUB_CSS + HUB_JS, "utf8") / 1024).toFixed(1);
console.log(`Interest Hub 已应用（+${kb} KB）→ ${path.relative(ROOT, PREVIEW)}`);
