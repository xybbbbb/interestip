/**
 * rag-search.mjs —— 单次检索（RAG 的 Retrieval 环节），用于验证"找资料"准不准
 *
 * 用法：
 *   node scripts/rag-search.mjs "不想跑太远的小众同款"
 *   node scripts/rag-search.mjs "购物 美妆" --k 5
 *   node scripts/rag-search.mjs "咖啡" --pool fan      # 只看粉丝点 / --pool sight 只看观光点
 *   node scripts/rag-search.mjs "咖啡" --json          # 输出 JSON，便于后续接模型生成
 *
 * 检索逻辑在 scripts/lib/rag.mjs（BM25 + 相关性阈值），与 rag-play.mjs 共用。
 */

import { loadCorpus, search } from "./lib/rag.mjs";

const args = process.argv.slice(2);
const query = args.find((a) => !a.startsWith("--"));
const kIndex = args.indexOf("--k");
const K = kIndex >= 0 ? Number(args[kIndex + 1]) || 5 : 5;
const poolIndex = args.indexOf("--pool");
const pool = poolIndex >= 0 ? args[poolIndex + 1] : null;
const AS_JSON = args.includes("--json");

if (!query) {
  console.error('用法：node scripts/rag-search.mjs "你的问题" [--k 5] [--pool fan|sight] [--json]');
  process.exit(1);
}

const docs = await loadCorpus();
const { hits, dropped, termFiltered } = search(query, docs, { k: K, pool });

if (AS_JSON) {
  console.log(
    JSON.stringify(
      {
        query,
        retrieved: hits.map((h) => ({
          id: h.doc.id,
          name: h.doc.name,
          district: h.doc.district,
          typeCn: h.doc.typeCn,
          confidence: h.doc.confidence,
          score: Number(h.score.toFixed(3)),
          sources: h.doc.sources,
          text: h.doc.text,
        })),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

console.log(`查询：${query}${pool ? `（限定：${pool}）` : ""}\n`);
if (!hits.length) {
  console.log("没有命中任何文档 —— 语料里没有相关内容（RAG 里宁可检索为空，也不要硬答）");
  process.exit(0);
}
if (dropped > 0 || termFiltered > 0) {
  console.log(
    `（另有 ${dropped} 条低于相关性阈值、${termFiltered} 条命中词数不足，已丢弃）\n`,
  );
}

for (const [i, h] of hits.entries()) {
  const d = h.doc;
  const badge = d.pool === "fan" ? `粉丝·${d.confidence}` : "观光";
  console.log(`${i + 1}. [${h.score.toFixed(2)}] ${d.name}（${d.district} · ${d.typeCn} · ${badge}）`);
  console.log(`   ${d.text.slice(0, 150).replace(/\s+/g, " ")}…`);
  if (d.sources.length) console.log(`   来源：${d.sources[0].url.slice(0, 90)}`);
  console.log("");
}
