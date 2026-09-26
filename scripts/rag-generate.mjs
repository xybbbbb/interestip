/**
 * rag-generate.mjs —— 端云协同的单次完整链路：**端侧检索 → 云端生成**
 *
 * 用法：
 *   node scripts/rag-generate.mjs "想买 CORTIS 同款的手串"
 *   node scripts/rag-generate.mjs "想找个地方吃东西" --mode hybrid      # 用端侧向量 + BM25 混合检索
 *   node scripts/rag-generate.mjs "咖啡" --mode vector                   # 纯端侧向量检索
 *   node scripts/rag-generate.mjs "汉江夜景" --k 5 --prompt v2
 *   node scripts/rag-generate.mjs "米其林三星求婚直升机" --show-prompt   # 只看会发给云端模型的提示词
 *
 * 端侧做：检索（BM25 / 向量 / 混合）—— 全量语料不出本机
 * 云端做：只拿 Top-K 证据生成回答，每条结论必须挂 [来源n]，资料不足必须拒答
 *
 * 需要 .env 里的 LLM_API_KEY（DeepSeek 等 OpenAI 兼容接口）。
 * --mode vector / hybrid 还需要本机模型服务（Ollama）和先跑过 build-embeddings-local.mjs。
 * 整份评估集的三路对照见：node scripts/rag-eval-vector.mjs
 */

import { DEFAULT_CONFIG, ROOT, loadDocs, loadEvalSet } from "./lib/rag-eval-core.mjs";
import { makeRetriever, loadEmbeddings } from "./lib/rag-vector.mjs";
import { getEmbedConfig } from "./lib/embed-local.mjs";
import { buildRagPrompt, getLLMConfig, makeLlmGenerator, PROMPTS } from "./lib/llm.mjs";
import path from "node:path";

const args = process.argv.slice(2);
const query = args.find((a) => !a.startsWith("--"));
const kIndex = args.indexOf("--k");
const K = kIndex >= 0 ? Number(args[kIndex + 1]) || DEFAULT_CONFIG.k : DEFAULT_CONFIG.k;
const promptIndex = args.indexOf("--prompt");
const promptVersion = promptIndex >= 0 ? args[promptIndex + 1] : "v1";
const SHOW_PROMPT = args.includes("--show-prompt");
const poolIndex = args.indexOf("--pool");
const pool = poolIndex >= 0 ? args[poolIndex + 1] : null;
const modeIndex = args.indexOf("--mode");
const mode = modeIndex >= 0 ? args[modeIndex + 1] : "bm25";

if (!query) {
  console.error('用法：node scripts/rag-generate.mjs "你的问题" [--mode bm25|vector|hybrid] [--k 5] [--prompt v1|v2] [--pool fan|sight] [--show-prompt]');
  process.exit(1);
}

const docs = await loadDocs();
const embedCfg = mode === "bm25" ? null : await getEmbedConfig();
const embeddings = mode === "bm25" ? null : await loadEmbeddings();
const retriever = await makeRetriever(mode, { embeddings, cfg: embedCfg });

const tEdge = Date.now();
const { hits, topScore } = await retriever(query, docs, { ...DEFAULT_CONFIG, k: K, pool });
const edgeMs = Date.now() - tEdge;

const modeLabel = { bm25: "BM25 关键词", vector: "端侧向量", hybrid: "BM25 + 端侧向量（RRF）" }[mode] ?? mode;

console.log(`问题：${query}`);
console.log(`端侧检索【${modeLabel}】：命中 ${hits.length} 条（最高分 ${Number(topScore).toFixed(4)}）· 用时 ${edgeMs}ms`);
if (mode !== "bm25") console.log(`  本机模型：${embedCfg.model} @ ${embedCfg.base}`);
for (const [i, h] of hits.entries()) {
  const via = h.via ? ` · 来自 ${Object.keys(h.via).join("+")}` : "";
  console.log(`  [来源${i + 1}] ${h.doc.name}（${h.doc.district}·置信度 ${h.doc.confidence}）${Number(h.score).toFixed(4)}${via}`);
}

if (!hits.length) {
  console.log("\n回答（检索层直接拒答，不调用模型）：资料里没有能回答这个问题的内容。");
  console.log(`端云分工：端侧判定「无证据」→ 云端一次都没调用（省 token，也不给编造的机会）`);
} else {
  const cfg = await getLLMConfig();
  if (SHOW_PROMPT || !cfg.configured) {
    const { system, user } = buildRagPrompt(query, hits);
    console.log(`\n${!cfg.configured ? "⚠ 没找到 LLM_API_KEY，只显示将发送的提示词" : "提示词预览"}（${PROMPTS[promptVersion]?.name ?? promptVersion}）：`);
    console.log("──── system ────\n" + system);
    console.log("──── user ────\n" + user);
    if (!cfg.configured) {
      console.log(
        `\n（在仓库根目录建 .env 并写入 LLM_API_KEY 即可真实调用，路径：${path.join(ROOT, ".env")}）`,
      );
    }
  } else {
    const gen = makeLlmGenerator(cfg, { promptVersion });
    const t0 = Date.now();
    const out = await gen.generate(query, hits);
    const ms = Date.now() - t0;

    console.log(`\n云端生成（${cfg.model} / 提示词 ${promptVersion} / ${ms}ms${out.usage ? ` / ${out.usage.total_tokens} tokens` : ""}）：`);
    console.log(out.text);
    console.log(`\n引用：${out.citations.map((c) => `[来源${c.n}] ${c.name}`).join(" ") || "（无）"}`);
    if (out.invalid?.length) console.log(`⚠ 编造的来源编号：${out.invalid.join(", ")}`);
    console.log(`是否拒答：${out.refused ? "是" : "否"}`);
    console.log(`\n端云分工：端侧检索 ${edgeMs}ms（${modeLabel}）→ 云端生成 ${ms}ms（只收到 ${hits.length} 条证据，不是全量语料）`);
  }
}
