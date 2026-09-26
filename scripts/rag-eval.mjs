/**
 * rag-eval.mjs —— RAG 评估集（跑一次，用当前配置）
 *
 * 用法：
 *   node scripts/rag-eval.mjs                  # 用当前（生产）配置跑
 *   node scripts/rag-eval.mjs --show-answers   # 额外打印每题的回答与引用
 *   node scripts/rag-eval.mjs --json           # 只输出 JSON
 *   node scripts/rag-eval.mjs --min-score 2 --citation-gate 0.5 --no-expand   # 临时改配置做对照
 *
 * 评估集：data/rag-eval-set.json（A 组 12 题 + B 组 3 个边界探针）。
 * 三个核心指标：检索命中率 / 引用正确率 / 拒答正确率。
 * 想看 5 轮迭代的完整对照表 → node scripts/rag-iterations.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_CONFIG, EVAL_SET_PATH, ROOT, loadDocs, loadEvalSet, runEval } from "./lib/rag-eval-core.mjs";
import { getLLMConfig, makeLlmGenerator } from "./lib/llm.mjs";

const args = process.argv.slice(2);
const num = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};

const config = {
  ...DEFAULT_CONFIG,
  k: num("--k", DEFAULT_CONFIG.k),
  minScore: num("--min-score", DEFAULT_CONFIG.minScore),
  minMatched: num("--min-matched", DEFAULT_CONFIG.minMatched),
  citationGate: num("--citation-gate", DEFAULT_CONFIG.citationGate),
  expand: args.includes("--no-expand") ? false : DEFAULT_CONFIG.expand,
  bigramOnly: args.includes("--legacy-token") ? false : DEFAULT_CONFIG.bigramOnly,
};

const AS_JSON = args.includes("--json");
const SHOW = args.includes("--show-answers");

// --generator llm 时改用大模型生成（需要 .env 里的 LLM_API_KEY）
const useLlm = args.includes("--generator") && args[args.indexOf("--generator") + 1] === "llm";
const promptIndex = args.indexOf("--prompt");
const promptVersion = promptIndex >= 0 ? args[promptIndex + 1] : "v1";
let generator = null;
let llmInfo = null;
if (useLlm) {
  const llmConfig = await getLLMConfig();
  if (!llmConfig.configured) {
    console.error("❌ 没有找到 LLM_API_KEY（应放在 outputs/interest-mcp/.env 里）");
    process.exit(1);
  }
  generator = makeLlmGenerator(llmConfig, { promptVersion });
  llmInfo = { model: llmConfig.model, base: llmConfig.base, promptVersion };
}

// 报告文件名跟着生成方式走，方便把「模板版」和「模型版」放在一起对比
const REPORT = path.join(
  ROOT,
  "data",
  useLlm ? `rag-eval-report-llm-${promptVersion}.json` : "rag-eval-report.json",
);

const evalSet = await loadEvalSet();
const docs = await loadDocs();
const { summary, results, probes } = await runEval(evalSet, docs, config, generator);

const pct = (x) => `${(x * 100).toFixed(0)}%`;
const report = {
  generatedAt: new Date().toISOString(),
  k: config.k,
  config,
  generator: summary.generator,
  llm: llmInfo ? { ...llmInfo, ...(generator?.stats?.() ?? {}) } : null,
  corpus: {
    docs: docs.length,
    fan: docs.filter((d) => d.pool === "fan").length,
    sight: docs.filter((d) => d.pool === "sight").length,
  },
  summary,
  results,
  probes,
};

await fs.writeFile(REPORT, JSON.stringify(report, null, 2) + "\n", "utf8");

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

console.log(
  `RAG 评估集 · ${summary.cases} 个 case（A 组 ${results.length} + B 组 ${probes.length}）· Top-K=${config.k}` +
    `｜生成方式：${summary.generator}` +
    `${llmInfo ? `（${llmInfo.model} / 提示词 ${llmInfo.promptVersion}）` : ""}` +
    `\n   检索配置：切词=${config.bigramOnly ? "只双字" : "单字+双字"} · 阈值=${config.minScore} · 最少命中=${config.minMatched} 词 · 扩展=${config.expand ? "开" : "关"} · 引用门槛=${config.citationGate}\n`,
);

console.log("题号  期望    实际 Top-K                                          引用   判定");
console.log("─".repeat(104));
for (const r of [...results, ...probes]) {
  const want = r.expect === "answer" ? "答出" : "拒答";
  const shown = r.retrieved.length ? r.retrieved.join(", ") : "（空 → 拒答）";
  const cites = r.citationCount ? `${r.correctCitationCount}/${r.citationCount}` : "—";
  console.log(`${r.id}   ${want}    ${shown.padEnd(52)} ${cites.padEnd(5)} ${r.passed ? "✅" : "❌"}`);
}

console.log("\n【三个指标】");
console.log(`检索命中率 Hit@${config.k}：${pct(summary.retrievalHitRate)}`);
console.log(`引用正确率：       ${pct(summary.citationPrecisionAnswerable)}（可答题的引用里，命中期望来源的比例）`);
console.log(`拒答正确率：       ${pct(summary.refusalAccuracy)}（负例拒答 ${summary.negativeRefused}/${summary.negative}，正例误拒答 ${summary.falseRefusals.length}）`);
console.log(`case 通过率：      ${pct(summary.passRate)}（${summary.passed}/${summary.cases}）`);
console.log(`引用结构自检：     ${summary.citationsAreRetrieved ? "✅ 没有凭空造来源" : "❌ 有引用不在检索结果里"}`);
if (summary.fabricatedCitations) console.log(`⚠️ 编造的来源编号：${summary.fabricatedCitations} 处（模型引用了不存在的 [来源n]）`);

if (generator?.stats) {
  const s = generator.stats();
  console.log(`模型调用：         ${s.calls} 次 · prompt ${s.promptTokens} tokens · completion ${s.completionTokens} tokens`);
}

if (summary.failedCases.length) console.log(`\n未通过：${summary.failedCases.join(", ")}`);

if (SHOW) {
  console.log("\n【每题的回答（模板版；接大模型后用同一套判定）】");
  for (const r of [...results, ...probes]) {
    console.log(`\n── ${r.id} ${r.query}`);
    console.log(r.answerText);
  }
}

console.log(`\n报告已写入 ${path.relative(ROOT, REPORT)}（题面：${path.relative(ROOT, EVAL_SET_PATH)}）`);
