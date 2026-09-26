/**
 * rag-eval-vector.mjs —— 「端侧向量检索 + 云端生成」的对照实验
 *
 * 同一份评估集，跑三条检索路线，其余全不变（同一套判定、同一个生成层）：
 *   bm25   关键词检索（原基线，纯端侧确定性算法）
 *   vector 端侧向量检索（本机模型算 embedding + 余弦相似度）
 *   hybrid BM25 + 向量 的 RRF 融合
 *
 * 用法：
 *   node scripts/rag-eval-vector.mjs                     # 用模板生成（不需要 Key）
 *   node scripts/rag-eval-vector.mjs --generator llm     # 用云端大模型生成（需要 .env 里的 LLM_API_KEY）
 *   node scripts/rag-eval-vector.mjs --modes bm25,vector
 *
 * 产出：data/rag-eval-vector-report.json
 *
 * 报告里会明确写出「端侧做了什么、云端做了什么」，可以直接贴进参赛材料的
 * 「AI 技术实践说明」。
 */

import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_CONFIG, loadDocs, loadEvalSet, runEval } from "./lib/rag-eval-core.mjs";
import { getLLMConfig, makeLlmGenerator } from "./lib/llm.mjs";
import { loadEmbeddings, makeRetriever } from "./lib/rag-vector.mjs";
import { getEmbedConfig } from "./lib/embed-local.mjs";
import { ROOT } from "./lib/rag.mjs";

const args = process.argv.slice(2);
const val = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};
const MODES = String(val("--modes", "bm25,vector,hybrid")).split(",").map((s) => s.trim()).filter(Boolean);
const AS_JSON = args.includes("--json");
// 向量阈值可以在命令行覆盖，方便标定（默认值在 lib/rag-vector.mjs）
const vMinArg = val("--vector-min-score", null);
const vRelArg = val("--vector-rel", null);
const CONFIG = { ...DEFAULT_CONFIG };
if (vMinArg !== null) CONFIG.vectorMinScore = Number(vMinArg);
if (vRelArg !== null) CONFIG.vectorRelativeCutoff = Number(vRelArg);

const useLlm = args.includes("--generator") && val("--generator", "") === "llm";
const promptVersion = val("--prompt", "v1");
let generator = null;
let llmInfo = null;
if (useLlm) {
  const llmConfig = await getLLMConfig();
  if (!llmConfig.configured) {
    console.error(
      "❌ 没有找到 LLM_API_KEY。\n" +
        `   在仓库根目录建一个 .env（${path.join(ROOT, ".env")}），写上：\n` +
        "     LLM_API_KEY=sk-你的DeepSeekKey\n" +
        "     LLM_BASE_URL=https://api.deepseek.com\n" +
        "     LLM_MODEL=deepseek-chat",
    );
    process.exit(1);
  }
  generator = makeLlmGenerator(llmConfig, { promptVersion });
  llmInfo = { model: llmConfig.model, base: llmConfig.base, promptVersion };
}

const evalSet = await loadEvalSet();
const docs = await loadDocs();
const embedCfg = await getEmbedConfig();
const needVector = MODES.some((m) => m !== "bm25");
const embeddings = needVector ? await loadEmbeddings() : null;

const runs = {};
for (const mode of MODES) {
  const retriever = await makeRetriever(mode, { embeddings, cfg: embedCfg });
  const t0 = Date.now();
  const { summary, results, probes } = await runEval(evalSet, docs, CONFIG, generator, retriever);
  const ms = Date.now() - t0;
  runs[mode] = { summary, results, probes, ms };
  console.log(
    `跑完 ${mode.padEnd(6)} 检索命中 ${(summary.retrievalHitRate * 100).toFixed(0)}% · ` +
      `拒答 ${(summary.refusalAccuracy * 100).toFixed(0)}% · 用时 ${(ms / 1000).toFixed(1)}s`,
  );
}

const pct = (x) => `${(x * 100).toFixed(0)}%`;
const report = {
  generatedAt: new Date().toISOString(),
  title: "端云协同对照：端侧向量检索 × 云端生成",
  architecture: {
    edge: {
      where: "本机（开发者的 PC）",
      what: [
        "对语料做 embedding（全量语料不出本机）",
        "向量检索：查询 embedding + 余弦相似度 Top-K",
        "RRF 融合 BM25 与向量两路结果",
        "过阈值/过闸门的判断（宁可检索为空，也不要硬答）",
      ],
      model: needVector ? { name: embeddings.meta.model, dim: embeddings.meta.dim, provider: embeddings.meta.provider, base: embeddings.meta.base } : null,
    },
    cloud: {
      where: "DeepSeek（OpenAI 兼容接口）",
      what: ["拿到端侧检索出来的 Top-K 证据后生成自然语言回答", "硬规矩：每条结论必须挂 [来源n]，资料不足必须拒答"],
      model: llmInfo,
    },
    handoff: "端侧只把 Top-K 证据（不是全量语料）发给云端；云端不参与检索，端侧不参与生成。",
  },
  corpus: { docs: docs.length },
  config: CONFIG,
  generator: generator ? "llm" : "template",
  modes: MODES,
  runs,
};

const REPORT = path.join(ROOT, "data", "rag-eval-vector-report.json");
await fs.writeFile(REPORT, JSON.stringify(report, null, 2) + "\n", "utf8");

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 2));
} else {
console.log("");
console.log(`端云协同对照 · ${docs.length} 条语料 · 生成方式：${generator ? `云端 ${llmInfo.model}` : "模板（未接模型）"}`);
if (needVector) {
  console.log(`端侧模型：${embeddings.meta.model}（${embeddings.meta.dim} 维，${embeddings.meta.provider}）@ ${embeddings.meta.base}`);
}
console.log("");
console.log("模式      检索命中   Top1    引用正确   拒答正确   case通过   用时");
console.log("─".repeat(74));
for (const mode of MODES) {
  const s = runs[mode].summary;
  console.log(
    `${mode.padEnd(9)} ${pct(s.retrievalHitRate).padEnd(9)} ${pct(s.top1Accuracy).padEnd(7)} ` +
      `${pct(s.citationPrecisionAnswerable).padEnd(10)} ${pct(s.refusalAccuracy).padEnd(9)} ` +
      `${pct(s.passRate).padEnd(10)} ${(runs[mode].ms / 1000).toFixed(1)}s`,
  );
}

// 指出哪几条 case 的结果因检索方式不同而不同 —— 这是"加分点"的证据
const base = runs[MODES[0]];
for (const mode of MODES.slice(1)) {
  const changed = base.results
    .map((r, i) => [r, runs[mode].results[i]])
    .filter(([a, b]) => a && b && (a.retrieved.join(",") !== b.retrieved.join(",") || a.passed !== b.passed));
  if (changed.length) {
    console.log(`\n【${MODES[0]} → ${mode}】检索结果不同的 case：`);
    for (const [a, b] of changed) {
      console.log(`  ${b.id} 「${b.query}」`);
      console.log(`     ${MODES[0]}: ${a.retrieved.join(", ") || "（空 → 拒答）"}  ${a.passed ? "✅" : "❌"}`);
      console.log(`     ${mode}: ${b.retrieved.join(", ") || "（空 → 拒答）"}  ${b.passed ? "✅" : "❌"}`);
    }
  }
}

console.log(`\n报告已写入 ${path.relative(ROOT, REPORT)}`);
}
