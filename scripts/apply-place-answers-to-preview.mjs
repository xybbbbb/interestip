/**
 * apply-place-answers-to-preview.mjs
 *
 * 把 data/place-answers.json（构建期由 DeepSeek 预生成的推荐语，中英各一份）
 * 注入 web-preview/index.html 的 `// >>> PLACE_ANSWERS` / `// <<< PLACE_ANSWERS` 标记之间。
 *
 * 用法：node scripts/apply-place-answers-to-preview.mjs
 * 重跑 build-place-answers.mjs 之后再跑一次这个即可刷新页面数据。
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const ANSWERS = path.join(ROOT, "data", "place-answers.json");
const PREVIEW = path.join(ROOT, "web-preview", "index.html");

const START = "// >>> PLACE_ANSWERS";
const END = "// <<< PLACE_ANSWERS";

const raw = JSON.parse(await fs.readFile(ANSWERS, "utf8"));

// 只保留运行时需要的字段，去掉每条里的 model / generatedAt，减少页面体积
const answers = {};
for (const [id, a] of Object.entries(raw.answers ?? {})) {
  if (!a || !a.zh || !a.en) continue;
  answers[id] = {
    zh: a.zh,
    en: a.en,
    confidence: a.confidence ?? null,
    sources: Array.isArray(a.sources) ? a.sources : [],
  };
}

const payload = {
  generatedAt: raw.generatedAt ?? null,
  model: raw.model ?? null,
  answers,
};

const html = await fs.readFile(PREVIEW, "utf8");

// 页面通过 window.PLACE_ANSWERS 读取，必须显式挂到 window 上（const 声明不会成为 window 属性）
const block =
  `${START}\n` +
  `const PLACE_ANSWERS = ${JSON.stringify(payload)};\n` +
  `window.PLACE_ANSWERS = PLACE_ANSWERS;\n` +
  `${END}`;

const startIdx = html.indexOf(START);
const endIdx = html.indexOf(END);
if (startIdx < 0 || endIdx < 0 || endIdx <= startIdx) {
  throw new Error("index.html 里找不到 PLACE_ANSWERS 标记，请先加好标记");
}

const updated = html.slice(0, startIdx) + block + html.slice(endIdx + END.length);
await fs.writeFile(PREVIEW, updated, "utf8");

const sizeKb = (Buffer.byteLength(block, "utf8") / 1024).toFixed(1);
console.log(
  `已注入 ${Object.keys(answers).length} 条推荐语（${sizeKb} KB）→ ${path.relative(ROOT, PREVIEW)}\n` +
    `模型：${payload.model}｜生成时间：${payload.generatedAt}`,
);
