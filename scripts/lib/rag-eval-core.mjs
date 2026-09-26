/**
 * lib/rag-eval-core.mjs —— 评估的公共内核
 *
 * 被三个脚本共用：
 *   scripts/rag-eval.mjs        跑一次评估（当前配置），打印报告
 *   scripts/rag-iterations.mjs  跑 5 轮配置，输出「每轮改了什么、指标怎么变」
 *   scripts/agent-case-check.mjs 汇总 18 个 case 的通过情况
 *
 * 之所以把配置做成开关，是为了让「迭代」可复现：
 * 每一轮改动都对应一组配置，任何人跑一条命令就能复现每一轮的指标。
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCorpus, search } from "./rag.mjs";
import { composeAnswer } from "./rag-answer.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "..", "..");
export const EVAL_SET_PATH = path.join(ROOT, "data", "rag-eval-set.json");

/**
 * 当前（生产）配置 = 5 轮迭代后**幸存**的配置：
 * 只保留被评估集证明有效的三项（只切双字 / 相关性阈值 / 最少命中 2 个词）；
 * R4 的查询扩展与 R5 的引用门槛都没有采纳。
 */
export const DEFAULT_CONFIG = {
  k: 5,
  bigramOnly: true, // 只切双字
  minScore: 1.5, // 相关性绝对阈值
  relativeCutoff: 0.35, // 相对阈值（最高分的 35%）
  minMatched: 2, // 至少命中 2 个不同的词
  expand: false, // 口语化查询扩展（R4 未采纳）
  citationGate: 0, // 引用门槛（R5 未采纳）
};

/**
 * 5 轮迭代：每轮只改一件事，指标才能归因。
 * R1/R2/R3 是 2026-09-13 真实走过的三轮，R4/R5 是 09-18 补的两轮。
 */
export const ROUNDS = [
  {
    id: "R1",
    name: "初版：单字+双字切词、无任何阈值",
    changed: "起点实现（BM25，中文按单字+双字切）",
    config: { bigramOnly: false, minScore: 0, minMatched: 1, expand: false, citationGate: 0 },
  },
  {
    id: "R2",
    name: "只切双字 + 相关性阈值",
    changed: "发现单字（星/求/手）造成大量误命中 → 只切双字；再加 max(1.5, 最高分×0.35) 的丢弃阈值",
    config: { bigramOnly: true, minScore: 1.5, minMatched: 1, expand: false, citationGate: 0 },
  },
  {
    id: "R3",
    name: "最少命中 2 个不同的词",
    changed: "硬负例「米其林三星餐厅求婚直升机」只靠「餐厅」一个词就命中 → 加 minimum_should_match（≥2 个不同词）",
    config: { bigramOnly: true, minScore: 1.5, minMatched: 2, expand: false, citationGate: 0 },
  },
  {
    id: "R4",
    name: "口语化查询扩展（被评估集否决，已回退）",
    changed: "「想找个地方吃东西」这类口语改写 0 命中 → 加同义词表（餐厅/小吃/市场…）；结果把硬负例也救回来了，拒答正确率 100%→92%、引用正确率 85%→65%",
    config: { bigramOnly: true, minScore: 1.5, minMatched: 2, expand: true, citationGate: 0 },
  },
  {
    id: "R5",
    name: "回退扩展 + 引用门槛（试过，无净收益）",
    changed: "退回 R3 的检索策略，另试「只引用分数 ≥ 最高分 50% 的来源」：引用正确率 85%→83%（门槛反而把一条**正确**来源挤掉了），确认无净收益 → 不采纳，生产配置冻结在 R3",
    config: { bigramOnly: true, minScore: 1.5, minMatched: 2, expand: false, citationGate: 0.5 },
    rejected: ["R4"],
  },
];

/** 生产配置（= R3：口语扩展与引用门槛都没采纳） */
export const PRODUCTION_CONFIG = { ...DEFAULT_CONFIG, expand: false, citationGate: 0 };

export async function loadEvalSet(file = EVAL_SET_PATH) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

export async function loadDocs() {
  return loadCorpus();
}

/**
 * 跑一个 case：检索 → 生成回答 → 判定
 *   generator 不传 = 用模板回答（rag-answer.mjs）
 *   generator 传 makeLlmGenerator(...) 的返回值 = 用大模型生成
 */
export async function runCase(item, docs, config, generator = null, retriever = null) {
  // 默认用 BM25（保持原行为不变）；传 retriever 就能换成向量 / 混合检索做对照
  const retrieve =
    retriever ??
    ((q, d, c) =>
      search(q, d, {
        k: c.k,
        pool: c.pool,
        minScore: c.minScore,
        relativeCutoff: c.relativeCutoff,
        minMatched: c.minMatched,
        bigramOnly: c.bigramOnly,
        expand: c.expand,
      }));
  const { hits, dropped, termFiltered, topScore } = await retrieve(item.query, docs, {
    ...config,
    pool: item.pool ?? null,
  });
  const answer = generator
    ? await generator.generate(item.query, hits)
    : composeAnswer(item.query, hits, { citationGate: config.citationGate });
  const retrieved = hits.map((h) => h.doc.id);
  const expected = new Set(item.expected ?? []);
  const wantAnswer = (item.expect ?? "answer") === "answer";
  const answered = !answer.refused;
  const hit = expected.size > 0 && retrieved.some((id) => expected.has(id));
  const citations = answer.citations;
  const correctCitations = citations.filter((c) => expected.has(c.id)).length;

  return {
    id: item.id,
    query: item.query,
    group: item.group ?? ((item.id ?? "").startsWith("p") ? "B" : "A"),
    pool: item.pool ?? null,
    expect: wantAnswer ? "answer" : "refuse",
    expected: [...expected],
    retrieved,
    topScore: Number(topScore.toFixed(2)),
    dropped,
    termFiltered,
    hit,
    answered,
    passed: wantAnswer ? hit && answered : !answered,
    correctBehaviour: wantAnswer ? answered : !answered,
    citations: citations.map((c) => ({ n: c.n, id: c.id, confidence: c.confidence, correct: expected.has(c.id) })),
    invalidCitations: answer.invalid ?? [],
    citationCount: citations.length,
    correctCitationCount: correctCitations,
    answerText: answer.text,
    generator: generator ? generator.name : "template",
  };
}

/** 跑整份评估集（A 组 12 题 + B 组 3 个边界探针） */
export async function runEval(evalSet, docs, config = DEFAULT_CONFIG, generator = null, retriever = null) {
  const merged = { ...DEFAULT_CONFIG, ...config };
  const results = [];
  for (const q of evalSet.questions ?? []) results.push(await runCase({ group: "A", ...q }, docs, merged, generator, retriever));
  const probes = [];
  for (const p of evalSet.probes ?? []) probes.push(await runCase({ group: "B", ...p }, docs, merged, generator, retriever));

  const answerCases = results.filter((r) => r.expect === "answer");
  const refuseCases = results.filter((r) => r.expect === "refuse");
  const hitRate = answerCases.length ? answerCases.filter((r) => r.hit).length / answerCases.length : 0;
  const top1Rate = answerCases.length
    ? answerCases.filter((r) => r.retrieved.length && r.expected.includes(r.retrieved[0])).length / answerCases.length
    : 0;

  const answerableCitations = answerCases.reduce((s, r) => s + r.citationCount, 0);
  const answerableCorrect = answerCases.reduce((s, r) => s + r.correctCitationCount, 0);
  const totalCitations = results.reduce((s, r) => s + r.citationCount, 0);
  const totalCorrect = results.reduce((s, r) => s + r.correctCitationCount, 0);

  const refuseCorrect = refuseCases.filter((r) => r.correctBehaviour).length;
  const answerCorrect = answerCases.filter((r) => r.correctBehaviour).length;
  const refusalAccuracy = results.length ? (refuseCorrect + answerCorrect) / results.length : 0;

  const allCases = [...results, ...probes];
  const passed = allCases.filter((r) => r.passed).length;

  return {
    config: merged,
    summary: {
      cases: allCases.length,
      passed,
      passRate: Number((passed / allCases.length).toFixed(4)),
      answerable: answerCases.length,
      negative: refuseCases.length,
      retrievalHitRate: Number(hitRate.toFixed(4)),
      top1Accuracy: Number(top1Rate.toFixed(4)),
      citationPrecisionAnswerable: answerableCitations
        ? Number((answerableCorrect / answerableCitations).toFixed(4))
        : 0,
      citationPrecision: totalCitations ? Number((totalCorrect / totalCitations).toFixed(4)) : 0,
      refusalAccuracy: Number(refusalAccuracy.toFixed(4)),
      negativeRefused: refuseCorrect,
      positiveAnswered: answerCorrect,
      falseRefusals: answerCases.filter((r) => !r.answered).map((r) => r.id),
      missedRefusals: refuseCases.filter((r) => r.answered).map((r) => r.id),
      failedCases: allCases.filter((r) => !r.passed).map((r) => r.id),
      citationsAreRetrieved: allCases.every((r) => r.citations.every((c) => r.retrieved.includes(c.id))),
      fabricatedCitations: allCases.reduce((s, r) => s + (r.invalidCitations?.length ?? 0), 0),
      generator: generator ? generator.name : "template",
    },
    results,
    probes,
  };
}
