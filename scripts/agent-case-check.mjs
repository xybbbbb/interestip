/**
 * agent-case-check.mjs —— 18 个测试 case 的总检查（《AI Agent Use Case & Evaluation》的证据来源）
 *
 * 用法：
 *   node scripts/agent-case-check.mjs          # 用当前配置跑一遍 A/B 组，读 benchmark 结果拿 C 组
 *   node scripts/agent-case-check.mjs --json
 *
 * 三组 case：
 *   A 组（12）证据检索与回答：9 个"语料里有答案" + 3 个"语料里没有"的负例
 *   B 组（3） 边界探针：口语改写 / 范围限定 / 专有名词
 *   C 组（3） 行程工作流硬约束：19:00 锁定 / 18:30 后不排点 / 不丢点（来自 benchmark-travel-model.json）
 */

import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_CONFIG, ROOT, loadDocs, loadEvalSet, runEval } from "./lib/rag-eval-core.mjs";
import { getLLMConfig, makeLlmGenerator } from "./lib/llm.mjs";

const BENCH = path.join(ROOT, "data", "benchmark-travel-model.json");
const AS_JSON = process.argv.includes("--json");

const useLlm = process.argv.includes("--generator") && process.argv[process.argv.indexOf("--generator") + 1] === "llm";
const promptIndex = process.argv.indexOf("--prompt");
const promptVersion = promptIndex >= 0 ? process.argv[promptIndex + 1] : "v2";
let generator = null;
if (useLlm) {
  const cfg = await getLLMConfig();
  if (!cfg.configured) {
    console.error("❌ 没有找到 LLM_API_KEY（应放在 outputs/interest-mcp/.env 里）");
    process.exit(1);
  }
  generator = makeLlmGenerator(cfg, { promptVersion });
}

// 报告文件名跟着生成方式走（模板版 / 模型版各留一份，方便对比）
const OUT = path.join(
  ROOT,
  "data",
  useLlm ? `agent-case-report-llm-${promptVersion}.json` : "agent-case-report.json",
);

const evalSet = await loadEvalSet();
const docs = await loadDocs();
const { summary, results, probes } = await runEval(evalSet, docs, DEFAULT_CONFIG, generator);

let workflowCases = [];
let benchNote = "";
try {
  const bench = JSON.parse(await fs.readFile(BENCH, "utf8"));
  workflowCases = bench.cases ?? [];
  benchNote = `（来自 ${path.relative(ROOT, BENCH)}，生成于 ${bench.generatedAt}）`;
} catch {
  benchNote = `⚠ 没找到 ${path.relative(ROOT, BENCH)}，先跑一次 node scripts/benchmark-travel-model.mjs`;
}

const cases = [
  ...results.map((r) => ({
    id: r.id,
    group: "A",
    question: r.query,
    expect: r.expect === "answer" ? `答出：${r.expected.join(" / ")}` : "拒答（语料里没有）",
    actual: r.retrieved.length ? r.retrieved.join(", ") : "拒答",
    passed: r.passed,
    detail: r.hit ? "命中期望来源" : r.expect === "refuse" ? "正确拒答" : "未命中期望来源",
  })),
  ...probes.map((r) => ({
    id: r.id,
    group: "B",
    question: r.query,
    expect: r.expect === "answer" ? `答出：${r.expected.join(" / ")}` : "拒答",
    actual: r.retrieved.length ? r.retrieved.join(", ") : "拒答",
    passed: r.passed,
    detail: r.hit ? "命中期望来源" : "未命中（关键词检索的已知边界）",
  })),
  ...workflowCases.map((c) => ({
    id: c.id,
    group: "C",
    question: c.name,
    expect: "在 3 个行程场景下都成立",
    actual: c.passed ? "成立" : "不成立",
    passed: c.passed,
    detail: c.detail,
  })),
];

const passed = cases.filter((c) => c.passed).length;
const report = {
  generatedAt: new Date().toISOString(),
  config: DEFAULT_CONFIG,
  generator: summary.generator,
  llm: generator?.stats?.() ?? null,
  corpus: { docs: docs.length },
  evalSet: "data/rag-eval-set.json",
  benchmark: benchNote,
  totals: {
    cases: cases.length,
    passed,
    failed: cases.length - passed,
    passRate: Number((passed / cases.length).toFixed(4)),
    byGroup: ["A", "B", "C"].map((g) => {
      const list = cases.filter((c) => c.group === g);
      return { group: g, cases: list.length, passed: list.filter((c) => c.passed).length };
    }),
  },
  ragMetrics: summary,
  cases,
};

await fs.writeFile(OUT, JSON.stringify(report, null, 2) + "\n", "utf8");

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const pad = (s, n) => String(s).padEnd(n);
console.log(`AI Agent 测试 case 总检查 · ${cases.length} 个 case ｜ 语料 ${docs.length} 条 ｜ ${benchNote}\n`);
console.log(`${pad("case", 6)}${pad("组", 4)}${pad("内容", 40)}${pad("期望", 26)}${pad("实际", 40)}结果`);
console.log("─".repeat(126));
for (const c of cases) {
  console.log(
    `${pad(c.id, 6)}${pad(c.group, 4)}${pad(String(c.question).slice(0, 38), 40)}${pad(String(c.expect).slice(0, 24), 26)}${pad(String(c.actual).slice(0, 38), 40)}${c.passed ? "✅" : "❌"}`,
  );
}
console.log(
  `\n通过 ${passed}/${cases.length}（${((passed / cases.length) * 100).toFixed(0)}%）` +
    `｜A 组 ${report.totals.byGroup[0].passed}/${report.totals.byGroup[0].cases}` +
    ` · B 组 ${report.totals.byGroup[1].passed}/${report.totals.byGroup[1].cases}` +
    ` · C 组 ${report.totals.byGroup[2].passed}/${report.totals.byGroup[2].cases}`,
);
const failed = cases.filter((c) => !c.passed);
if (failed.length) console.log(`未通过：${failed.map((c) => `${c.id}（${c.detail}）`).join("；")}`);
console.log(`\n报告已写入 ${path.relative(ROOT, OUT)}`);
