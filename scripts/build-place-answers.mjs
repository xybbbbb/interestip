/**
 * build-place-answers.mjs —— 把 RAG 的「生成」环节从命令行搬进产品（构建期预生成）
 *
 * 问题：线上原型是纯静态页，不能放 API Key，所以页面里目前没有模型生成的内容
 *       （推荐语是模板拼的）。这个脚本用同一套 RAG 管线，在构建期给每个地点生成一段
 *       带证据的推荐语（中英各一份），再由 apply-place-answers-to-preview.mjs 注入页面。
 *
 * 规则（和评估集里用的是同一套）：
 *   · 只能用该地点自己的资料，不许编造
 *   · medium/low 置信度必须写成「有粉丝提到（未核实）」
 *   · 只输出 1–2 句，不要加来源编号（来源由页面单独展示）
 *
 * 用法：
 *   node scripts/build-place-answers.mjs            # 增量：已生成的跳过
 *   node scripts/build-place-answers.mjs --force    # 全部重新生成
 * 产出：data/place-answers.json
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCorpus } from "./lib/rag.mjs";
import { callChat, getLLMConfig } from "./lib/llm.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const OUT = path.join(ROOT, "data", "place-answers.json");
const PREVIEW = path.join(ROOT, "web-preview", "index.html");
const FORCE = process.argv.includes("--force");

const SYSTEM = {
  zh: [
    "你是「Interestip 兴趣驱动旅行助手」的推荐语生成器。",
    "你只会拿到一个地点的资料，请写 1–2 句中文推荐语，说明它为什么值得去。",
    "硬规则：",
    "1) 只能使用资料里的事实，不许补充你自己的知识；资料没写的不要提。",
    "2) 置信度是 medium 或 low 时，必须写成「有粉丝提到（尚未核验）」，不能写成确定事实。",
    "3) 不要写来源编号、不要写「根据资料」这类套话，直接给推荐语。",
    "4) 最多 2 句，语气自然、像一个懂行的朋友在推荐。",
  ].join("\n"),
  en: [
    "You write recommendation blurbs for Interestip, an interest-driven travel assistant.",
    "You get the material for exactly one place. Write 1–2 natural English sentences on why it is worth a visit.",
    "IMPORTANT: write in English. The material and place names are in Chinese — translate the meaning,",
    "and always refer to the place by the English name given to you (e.g. Myeongdong, Namsan Seoul Tower).",
    "Hard rules:",
    "1) Use only facts from the material; never add outside knowledge; do not mention anything the material does not say.",
    "2) If the confidence is medium or low, it must be phrased as “a fan reported (not yet verified)” — never as a fact.",
    "3) No source numbers and no boilerplate like “according to the material” — just the recommendation.",
    "4) Two sentences maximum, natural tone, like a well-informed friend recommending it.",
  ].join("\n"),
};

/** 从原型里取出官方英文地名（EN_PLACES），让英文推荐语用英文用户看到的写法 */
async function readEnglishNames() {
  try {
    const html = await fs.readFile(PREVIEW, "utf8");
    const m = html.match(/const EN_PLACES=\{([\s\S]*?)\};/);
    if (!m) return {};
    return new Function(`return {${m[1]}};`)();
  } catch {
    return {};
  }
}

const EN_NAMES = await readEnglishNames();

function userPrompt(doc, lang) {
  const meta = [doc.typeCn, doc.district, `confidence: ${doc.confidence}`].filter(Boolean).join(" · ");
  const sources = (doc.sources || []).map((s) => `${s.label}: ${s.url}`).join("\n") || "(none)";
  return lang === "zh"
    ? [`地点：${doc.name}（${meta}）`, "", "资料：", doc.text, "", `链接：\n${sources}`].join("\n")
    : [
        `Place (English name to use): ${EN_NAMES[doc.id] || doc.nameLocal || doc.name}`,
        `Original name: ${doc.name}${doc.nameLocal ? ` / ${doc.nameLocal}` : ""}`,
        `Meta: ${meta}`,
        "",
        "Material (Chinese, translate the meaning — do not copy it verbatim):",
        doc.text,
        "",
        `Links:\n${sources}`,
        "",
        "Write the two English sentences now.",
      ].join("\n");
}

const config = await getLLMConfig();
if (!config.configured) {
  console.error("❌ 没找到 LLM_API_KEY（应放在 outputs/interest-mcp/.env）");
  process.exit(1);
}

const docs = await loadCorpus();
let existing = { generatedAt: null, model: null, answers: {} };
try {
  existing = JSON.parse(await fs.readFile(OUT, "utf8"));
} catch {}

const answers = { ...existing.answers };
let made = 0;
let skipped = 0;
let failed = 0;

for (const doc of docs) {
  const have = answers[doc.id];
  if (!FORCE && have && have.zh && have.en) {
    skipped += 1;
    continue;
  }
  const entry = { zh: have?.zh ?? "", en: have?.en ?? "" };
  for (const lang of ["zh", "en"]) {
    if (!FORCE && entry[lang]) continue;
    try {
      const { content } = await callChat({ system: SYSTEM[lang], user: userPrompt(doc, lang) }, config);
      entry[lang] = content.replace(/\s+/g, " ").trim();
    } catch (e) {
      failed += 1;
      console.log(`❌ ${doc.id} / ${lang}: ${e.message.slice(0, 90)}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  answers[doc.id] = {
    zh: entry.zh,
    en: entry.en,
    confidence: doc.confidence,
    sources: (doc.sources || []).map((s) => s.url),
    model: config.model,
    generatedAt: new Date().toISOString(),
  };
  made += 1;
  console.log(`✅ ${doc.id} ${doc.name}`);
  console.log(`   zh: ${entry.zh.slice(0, 60)}…`);
  console.log(`   en: ${entry.en.slice(0, 60)}…`);
}

await fs.writeFile(
  OUT,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      model: config.model,
      note: "构建期用 RAG 管线预生成的推荐语（中英各一份）；页面是静态的，读这里的文本展示。",
      answers,
    },
    null,
    2,
  ) + "\n",
  "utf8",
);

console.log(`\n完成：生成 ${made} 条，跳过 ${skipped} 条，失败 ${failed} 条 → ${path.relative(ROOT, OUT)}`);
