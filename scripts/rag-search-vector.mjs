/**
 * rag-search-vector.mjs —— 端侧检索单跑一条（向量 / 混合），和 rag-search.mjs 是姊妹脚本
 *
 * 用法：
 *   node scripts/rag-search-vector.mjs "想找个地方吃东西"                  # 默认 hybrid
 *   node scripts/rag-search-vector.mjs "想找个地方吃东西" --mode vector    # 只用端侧向量
 *   node scripts/rag-search-vector.mjs "咖啡" --mode bm25                  # 对照组
 *   node scripts/rag-search-vector.mjs "咖啡" --k 5 --pool fan --json
 *
 * 前置：先跑过 node scripts/build-embeddings-local.mjs（需要本机模型服务）
 */

import { loadCorpus } from "./lib/rag.mjs";
import { DEFAULT_CONFIG } from "./lib/rag-eval-core.mjs";
import { makeRetriever, loadEmbeddings } from "./lib/rag-vector.mjs";
import { getEmbedConfig } from "./lib/embed-local.mjs";

const args = process.argv.slice(2);
const query = args.find((a) => !a.startsWith("--"));
const val = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};
const mode = val("--mode", "hybrid");
const k = Number(val("--k", DEFAULT_CONFIG.k)) || 5;
const pool = val("--pool", null);
const AS_JSON = args.includes("--json");

if (!query) {
  console.error('用法：node scripts/rag-search-vector.mjs "你的问题" [--mode bm25|vector|hybrid] [--k 5] [--pool fan|sight] [--json]');
  process.exit(1);
}

const docs = await loadCorpus();
const cfg = await getEmbedConfig();
const embeddings = mode === "bm25" ? null : await loadEmbeddings();
const retriever = await makeRetriever(mode, { embeddings, cfg });

const t0 = Date.now();
const result = await retriever(query, docs, { ...DEFAULT_CONFIG, k, pool });
const ms = Date.now() - t0;

if (AS_JSON) {
  console.log(
    JSON.stringify(
      {
        query,
        mode,
        ms,
        embed: mode === "bm25" ? null : { base: cfg.base, model: cfg.model },
        retrieved: result.hits.map((h) => ({
          id: h.doc.id,
          name: h.doc.name,
          district: h.doc.district,
          confidence: h.doc.confidence,
          score: Number(Number(h.score).toFixed(4)),
          via: h.via ? Object.keys(h.via).join("+") : mode,
        })),
      },
      null,
      2,
    ),
  );
} else {
  const modeLabel = { bm25: "BM25 关键词", vector: "端侧向量", hybrid: "BM25 + 端侧向量（RRF）" }[mode] ?? mode;
  console.log(`查询：${query}`);
  console.log(`模式：${modeLabel}${pool ? `（限定：${pool}）` : ""} · Top-${k} · 用时 ${ms}ms`);
  if (mode !== "bm25") console.log(`端侧模型：${cfg.model} @ ${cfg.base}`);
  console.log("");

  if (result.parts) {
    console.log(`  BM25 命中：${result.parts.bm25.join(", ") || "（空）"}`);
    console.log(`  向量命中：${result.parts.vector.join(", ") || "（空）"}`);
    console.log("");
  }

  if (!result.hits.length) {
    console.log("没有命中任何文档 —— 语料里没有相关内容（宁可检索为空，也不要硬答）");
  } else {
    for (const [i, h] of result.hits.entries()) {
      const d = h.doc;
      const badge = d.pool === "fan" ? `粉丝·${d.confidence}` : "观光";
      const via = h.via ? ` · 来自 ${Object.keys(h.via).join("+")}` : "";
      console.log(`${i + 1}. [${Number(h.score).toFixed(4)}] ${d.name}（${d.district} · ${d.typeCn} · ${badge}）${via}`);
      console.log(`   ${String(d.text).slice(0, 150).replace(/\s+/g, " ")}…`);
      if (d.sources?.length) console.log(`   来源：${String(d.sources[0].url).slice(0, 90)}`);
      console.log("");
    }
  }
}
