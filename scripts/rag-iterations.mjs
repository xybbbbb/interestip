/**
 * rag-iterations.mjs —— 5 轮迭代的对照表（评估驱动迭代的可复现证据）
 *
 * 用法：node scripts/rag-iterations.mjs [--json]
 * 产出：data/rag-iterations.json + 终端表格
 *
 * 每一轮只改一件事（切词方式 / 阈值 / 最小命中词数 / 查询扩展 / 引用门槛），
 * 用同一份评估集跑同一套判定 —— 这样「指标为什么变了」才能归因到具体改动。
 */

import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_CONFIG, ROOT, ROUNDS, loadDocs, loadEvalSet, runEval } from "./lib/rag-eval-core.mjs";

const OUT = path.join(ROOT, "data", "rag-iterations.json");
const AS_JSON = process.argv.includes("--json");

const evalSet = await loadEvalSet();
const docs = await loadDocs();

const rows = [];
for (const round of ROUNDS) {
  const { summary } = await runEval(evalSet, docs, { ...DEFAULT_CONFIG, ...round.config });
  rows.push({ id: round.id, name: round.name, changed: round.changed, config: round.config, summary });
}

const report = {
  generatedAt: new Date().toISOString(),
  evalSet: "data/rag-eval-set.json",
  corpus: { docs: docs.length },
  note:
    "每轮只改一件事；指标用的是同一份评估集（A 组 12 题 + B 组 3 个边界探针）。" +
    "R1–R3 是 2026-09-13 真实走过的三轮，R4–R5 是 09-18 补的两轮。",
  rounds: rows,
};

await fs.writeFile(OUT, JSON.stringify(report, null, 2) + "\n", "utf8");

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const pct = (x) => `${(x * 100).toFixed(0)}%`.padStart(4);
console.log(`RAG 5 轮迭代对照 · 评估集 ${rows[0].summary.cases} 个 case（A 12 + B 3）· 语料 ${docs.length} 条\n`);
console.log("轮次  检索命中率  引用正确率  拒答正确率  case 通过率   这轮改了什么");
console.log("─".repeat(118));
for (const r of rows) {
  const s = r.summary;
  console.log(
    `${r.id}    ${pct(s.retrievalHitRate)}       ${pct(s.citationPrecisionAnswerable)}        ${pct(s.refusalAccuracy)}       ` +
      `${pct(s.passRate)} (${String(s.passed).padStart(2)}/${s.cases})   ${r.changed}`,
  );
}
const first = rows[0].summary;
const last = rows[rows.length - 1].summary;
console.log(
  `\n净变化：case 通过率 ${pct(first.passRate)} → ${pct(last.passRate)}｜拒答正确率 ${pct(first.refusalAccuracy)} → ${pct(last.refusalAccuracy)}` +
    `｜引用正确率 ${pct(first.citationPrecisionAnswerable)} → ${pct(last.citationPrecisionAnswerable)}`,
);
console.log(`\n对照表已写入 ${path.relative(ROOT, OUT)}`);
