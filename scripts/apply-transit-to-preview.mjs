/**
 * apply-transit-to-preview.mjs
 *
 * 把 data/transit-matrix.json 注入 web-preview/index.html 的
 * `// >>> TRANSIT_MATRIX` / `// <<< TRANSIT_MATRIX` 标记之间。
 *
 * 用法：node scripts/apply-transit-to-preview.mjs
 * 重跑 build-transit-matrix.mjs 之后再跑一次这个即可刷新页面数据。
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const MATRIX = path.join(ROOT, "data", "transit-matrix.json");
const PREVIEW = path.join(ROOT, "web-preview", "index.html");

const START = "// >>> TRANSIT_MATRIX";
const END = "// <<< TRANSIT_MATRIX";

const matrix = JSON.parse(await fs.readFile(MATRIX, "utf8"));
const html = await fs.readFile(PREVIEW, "utf8");

// 字段名必须和 index.html 里 matrixHit / roughMin 读取的一致
const pairs = {};
for (const [key, v] of Object.entries(matrix.pairs ?? {})) {
  if (!v || !v.ok) continue;
  pairs[key] = {
    ok: true,
    minutes: Math.round(v.minutes),
    transfers: v.transfers ?? 0,
    mode: v.mode === "walk-estimate" ? "walk-estimate" : "transit",
    modes: Array.isArray(v.modes) ? v.modes : [],
  };
}

const payload = {
  generatedAt: matrix.generatedAt ?? null,
  queryTime: matrix.queryTime ?? null,
  source: matrix.source ?? "Transitous (MOTIS)",
  sourceUrl: matrix.sourceUrl ?? "https://transitous.org/sources/",
  note: matrix.note ?? "",
  pairs,
};

// 注意：页面里的算法通过 window.TRANSIT_MATRIX 读取，所以这里必须显式挂到 window 上
// （只用 const 声明的话不会成为 window 的属性）。
const block =
  `${START}\n` +
  `const TRANSIT_MATRIX = ${JSON.stringify(payload)};\n` +
  `window.TRANSIT_MATRIX = TRANSIT_MATRIX;\n` +
  `${END}`;

const startIdx = html.indexOf(START);
const endIdx = html.indexOf(END);
if (startIdx < 0 || endIdx < 0) {
  throw new Error("index.html 里找不到 TRANSIT_MATRIX 标记，请先加好标记");
}

const updated = html.slice(0, startIdx) + block + html.slice(endIdx + END.length);
await fs.writeFile(PREVIEW, updated, "utf8");

const sizeKb = (Buffer.byteLength(block, "utf8") / 1024).toFixed(1);
console.log(
  `已注入 ${Object.keys(pairs).length} 组耗时（${sizeKb} KB）→ ${path.relative(ROOT, PREVIEW)}\n` +
    `时间基准：${payload.queryTime}｜来源：${payload.source}`,
);
