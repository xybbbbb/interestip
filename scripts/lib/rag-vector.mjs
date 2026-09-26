/**
 * lib/rag-vector.mjs —— 端侧「向量检索」和「BM25 + 向量 混合检索」
 *
 * 和 lib/rag.mjs（纯关键词 BM25）并列的第二条检索路径：
 *   · 向量检索：查询 → 本机模型 embedding → 与语料向量做余弦相似度
 *                能救关键词检索的硬伤（「想找个地方吃东西」这种口语化表达）
 *   · 混合检索：两路各自过阈值后做 RRF 融合，兼顾精确匹配和语义召回
 *
 * 返回值形状与 lib/rag.mjs 的 search() 一致：{ hits, dropped, termFiltered, topScore, indexed }
 * 所以可以直接喂给 rag-eval-core 的 runCase / 生成层，不用改下游。
 */

import fs from "node:fs/promises";
import path from "node:path";
import { search, ROOT } from "./rag.mjs";
import { embedTexts, getEmbedConfig, l2normalize, dot } from "./embed-local.mjs";

// 用脚本位置推出来的仓库根目录，避免"必须站在仓库根目录跑"这种坑
export const EMBEDDINGS_PATH = path.join(ROOT, "data", "rag-embeddings.local.json");

export async function loadEmbeddings(file) {
  const p = file ?? EMBEDDINGS_PATH;
  let json;
  try {
    json = JSON.parse(await fs.readFile(p, "utf8"));
  } catch {
    throw new Error(
      `找不到语料向量文件 ${p}\n` +
        `先跑一次端侧 embedding：node scripts/build-embeddings-local.mjs\n` +
        `（需要本机模型服务，例如 Ollama：https://ollama.com/download）`,
    );
  }
  const byId = new Map();
  for (const d of json.docs ?? []) byId.set(d.id, d.vec);
  return { meta: json, byId };
}

/**
 * 向量检索：余弦相似度 + 阈值。
 *
 * 阈值是**用评估集标定出来的**，不是拍脑袋：
 *   node scripts/rag-eval-vector.mjs --modes vector --vector-min-score <值>
 * bge-m3 + 25 条语料的扫描结果（检索命中 / 拒答正确 / case 通过）：
 *   0.30 → 100% / 75% / 80%
 *   0.40 → 100% / 83% / 87%
 *   0.50 → 100% / 92% / 93%   ← 拐点，取这个
 *   0.55 →  89% / 83% / 87%   ← 开始伤召回
 * 硬负例「怎么从首尔坐火车去釜山」在 0.50 下仍会被硬答 —— 这是纯阈值方案的已知边界。
 * 换 embedding 模型时请重新扫一遍，不同模型的余弦分布不一样。
 */
export function searchVector(queryVec, docs, byId, { k = 5, pool = null, minScore = 0.50, relativeCutoff = 0.85 } = {}) {
  const filtered = pool ? docs.filter((d) => d.pool === pool) : docs;
  const scored = filtered
    .map((doc) => {
      const v = byId.get(doc.id);
      return { doc, score: v ? dot(queryVec, v) : 0 };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const topScore = scored.length ? scored[0].score : 0;
  // 和 BM25 一样的思路：宁可检索为空，也不要塞不相关的进去让模型硬编
  const cutoff = Math.max(minScore, topScore * relativeCutoff);
  const hits = scored.filter((x) => x.score >= cutoff).slice(0, k);
  return { hits, dropped: scored.length - hits.length, termFiltered: 0, topScore, indexed: filtered.length };
}

/**
 * RRF 融合（Reciprocal Rank Fusion）—— 把两路排序合成一路。
 * 只在**各自都过了自己阈值**的结果上融合，这样「资料里确实没有」的问题仍然是空集，
 * 不会因为多了一路而把拒答变成硬答。
 */
export function rrfFuse(lists, { k = 5, k0 = 60 } = {}) {
  const acc = new Map();
  lists.forEach((hits) => {
    hits.forEach((h, rank) => {
      const cur = acc.get(h.doc.id) ?? { doc: h.doc, score: 0, via: {} };
      cur.score += 1 / (k0 + rank + 1);
      cur.via[h.from ?? "?"] = Number(Number(h.score).toFixed(4));
      acc.set(h.doc.id, cur);
    });
  });
  const hits = [...acc.values()].sort((a, b) => b.score - a.score).slice(0, k);
  return { hits, topScore: hits.length ? hits[0].score : 0, indexed: acc.size };
}

/**
 * 造一个「端侧检索器」，签名与 rag-eval-core 的默认检索一致：
 *   async (query, docs, config) => { hits, dropped, termFiltered, topScore, indexed, mode }
 *
 * mode:
 *   "bm25"   —— 原来的关键词检索（用来做对照）
 *   "vector" —— 纯向量（端侧模型）
 *   "hybrid" —— BM25 + 向量 RRF 融合
 */
export async function makeRetriever(mode, { embeddings, cfg, quiet = true } = {}) {
  const conf = cfg ?? (await getEmbedConfig());

  if (mode === "bm25") {
    return async (query, docs, c) => {
      const r = search(query, docs, {
        k: c.k, pool: c.pool, minScore: c.minScore, relativeCutoff: c.relativeCutoff,
        minMatched: c.minMatched, bigramOnly: c.bigramOnly, expand: c.expand,
      });
      return { ...r, mode: "bm25" };
    };
  }

  const emb = embeddings ?? (await loadEmbeddings());
  const embedQuery = async (query) => {
    const { vectors } = await embedTexts([query], { cfg: conf });
    return l2normalize(vectors[0]);
  };

  const runVector = async (query, docs, c) => {
    const qv = await embedQuery(query);
    const r = searchVector(qv, docs, emb.byId, {
      k: c.k, pool: c.pool,
      minScore: c.vectorMinScore ?? 0.50,
      relativeCutoff: c.vectorRelativeCutoff ?? 0.85,
    });
    return { ...r, mode: "vector" };
  };

  if (mode === "vector") return runVector;

  if (mode === "hybrid") {
    return async (query, docs, c) => {
      const bm = search(query, docs, {
        k: c.k, pool: c.pool, minScore: c.minScore, relativeCutoff: c.relativeCutoff,
        minMatched: c.minMatched, bigramOnly: c.bigramOnly, expand: c.expand,
      });
      const ve = await runVector(query, docs, c);
      const fused = rrfFuse(
        [
          bm.hits.map((h) => ({ ...h, from: "bm25" })),
          ve.hits.map((h) => ({ ...h, from: "vector" })),
        ],
        { k: c.k },
      );
      return {
        hits: fused.hits,
        dropped: bm.dropped + ve.dropped,
        termFiltered: bm.termFiltered,
        topScore: fused.topScore,
        indexed: bm.indexed,
        mode: "hybrid",
        parts: { bm25: bm.hits.map((h) => h.doc.id), vector: ve.hits.map((h) => h.doc.id) },
      };
    };
  }

  throw new Error(`未知的检索模式：${mode}（可选 bm25 | vector | hybrid）`);
}
