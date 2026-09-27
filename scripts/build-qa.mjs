/**
 * build-qa.mjs —— 生成「问一句」问答区的构建期答案
 *
 * 跑完整的端云协同链路，把结果烘焙成静态 JSON（Key 永远不进页面）：
 *   端侧（本机 BGE-M3 + Ollama）：语料/查询向量化 + 余弦检索 + 与 BM25 做 RRF 融合
 *   云端（DeepSeek）：只拿 Top-K 证据，生成带 [来源n] 的回答
 *
 * 用法：node scripts/build-qa.mjs
 * 产出：data/qa.json（之后用 scripts/apply-qa-to-preview.mjs 注入 index.html）
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG, loadDocs } from "./lib/rag-eval-core.mjs";
import { loadEmbeddings, makeRetriever } from "./lib/rag-vector.mjs";
import { getEmbedConfig } from "./lib/embed-local.mjs";
import {
  buildRagPrompt,
  callChat,
  getLLMConfig,
  makeLlmGenerator,
  parseCitations,
  ROOT,
} from "./lib/llm.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "data", "qa.json");

/** 10 个真实常见问题（中英各一份，胶囊用短句，答案用完整问题） */
const QUESTIONS = [
  { id: "qa-food", zh: "想找个地方吃东西", en: "Where can I grab something to eat?" },
  { id: "qa-night", zh: "晚上想看汉江夜景和喷泉，去哪里？", en: "Where can I see the Han River and its fountain at night?" },
  { id: "qa-walk", zh: "想找个能拍照、散步、看夜景的地方", en: "A place to walk, take photos and see the night view" },
  { id: "qa-beauty", zh: "想逛街买美妆，去哪里？", en: "Where should I go shopping for beauty products?" },
  { id: "qa-bracelet", zh: "想买 CORTIS 成员同款的手串", en: "Where can I buy a CORTIS member-style bracelet?" },
  { id: "qa-birthday", zh: "成员过生日那天去的餐厅是哪家？", en: "Which restaurant did a member go to on their birthday?" },
  { id: "qa-mv", zh: "MV 拍摄地的地铁站怎么打卡？", en: "How do I visit the subway station from the MV?" },
  { id: "qa-smoothie", zh: "可以直接和店员说要 CORTIS 同款冰沙的店", en: "Where can I order a CORTIS-style smoothie?" },
  { id: "qa-gimpo", zh: "金浦那家烧烤店值得专门跑一趟吗？", en: "Is the BBQ restaurant in Gimpo worth a special trip?" },
  { id: "qa-hongdae", zh: "想去弘大附近逛逛", en: "What's worth a look around Hongdae?" },
];

const EN_SYSTEM = [
  "You are the recommendation generator for an interest-driven travel assistant.",
  "You may ONLY use the content in 【资料】. Do not add facts from your own knowledge or memory.",
  "",
  "Decide (without explaining the decision):",
  "A. If the sources contain places relevant to the question -> recommend them and state what the sources say. Even if the sources don't cover every detail, answer the parts they do cover.",
  "B. If the sources are completely irrelevant -> output only: The sources don't contain enough to answer this.",
  "",
  "Output rules:",
  "1) Every claim must cite a source as [来源n] (use this exact marker, same as the sources list).",
  "2) Only refuse in case B, and when refusing say only that one sentence.",
  "3) For medium or low confidence places, say \"a fan mentioned (not yet verified)\".",
  "4) Do not invent opening hours, prices or addresses.",
  "5) Answer in English, at most 3 sentences.",
].join("\n");

const EN_REFUSAL = "The sources don't contain enough to answer this.";

function sourceEntries(hits) {
  return hits.map((h, i) => {
    const d = h.doc;
    const src = Array.isArray(d.sources) ? d.sources[0] : null;
    return {
      n: i + 1,
      id: d.id,
      name: d.name,
      district: d.district || "",
      confidence: d.confidence ?? "plain",
      pool: d.pool || "",
      type: d.typeCn || d.type || "",
      label: src?.label || "",
      url: src?.url || "",
    };
  });
}

const docs = await loadDocs();
const embedCfg = await getEmbedConfig();
const embeddings = await loadEmbeddings();
const retriever = await makeRetriever("hybrid", { embeddings, cfg: embedCfg });
const llmCfg = await getLLMConfig();
if (!llmCfg.configured) {
  console.error("❌ 没有找到 LLM_API_KEY（.env）。请先配置 DeepSeek Key 再跑。");
  process.exit(1);
}
const zhGen = makeLlmGenerator(llmCfg, { promptVersion: "v2" });

const items = [];
let totalCalls = 0;
let totalTokens = 0;

for (const q of QUESTIONS) {
  const { hits } = await retriever(q.zh, docs, { ...DEFAULT_CONFIG, pool: null });
  const retrieved = hits.map((h) => h.doc.id);

  const zhOut = await zhGen.generate(q.zh, hits);
  totalCalls += 1;
  totalTokens += zhOut.usage?.total_tokens ?? 0;

  let enText = EN_REFUSAL;
  let enRefused = true;
  if (hits.length) {
    const { user } = buildRagPrompt(q.en, hits);
    const { content, usage } = await callChat({ system: EN_SYSTEM, user }, llmCfg);
    const { citations } = parseCitations(content, hits);
    totalCalls += 1;
    totalTokens += usage?.total_tokens ?? 0;
    enText = content;
    enRefused = citations.length === 0 && /don't contain|not enough|can'?t answer|unable to answer/i.test(content);
  }

  items.push({
    id: q.id,
    q: { zh: q.zh, en: q.en },
    a: { zh: zhOut.text, en: enText },
    refused: { zh: zhOut.refused, en: enRefused },
    sources: sourceEntries(hits),
    retrieved,
  });

  const srcLine = hits.map((h, i) => `[来源${i + 1}]${h.doc.name}`).join(" ");
  console.log(`√ ${q.zh}\n    ${srcLine || "（无证据 → 拒答）"}`);
}

const payload = {
  generatedAt: new Date().toISOString(),
  mode: "hybrid",
  retriever: "BM25 + BGE-M3 向量（RRF 融合，端侧）",
  model: llmCfg.model,
  corpusDocs: docs.length,
  calls: totalCalls,
  totalTokens,
  items,
};

await fs.writeFile(OUT, JSON.stringify(payload, null, 2) + "\n", "utf8");
console.log(
  `\n已生成 ${items.length} 条问答 → ${path.relative(ROOT, OUT)}` +
    `（${llmCfg.model}，${totalCalls} 次调用，${totalTokens} tokens）`,
);
