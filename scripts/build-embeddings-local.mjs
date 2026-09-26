/**
 * build-embeddings-local.mjs —— 用**本机模型**给语料算向量（端云协同里的「端」）
 *
 * 用法：
 *   node scripts/build-embeddings-local.mjs              # 已是最新就跳过
 *   node scripts/build-embeddings-local.mjs --force      # 强制重算
 *   node scripts/build-embeddings-local.mjs --model bge-m3
 *
 * 产出：data/rag-embeddings.local.json
 *   { provider, base, model, dim, corpusHash, generatedAt, docs:[{id, vec:[...]}] }
 *
 * 注意：向量是在本机算的，全量语料不出本机；只有检索出的 Top-K 才会发给云端。
 */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { loadCorpus, ROOT } from "./lib/rag.mjs";
import { embedTexts, getEmbedConfig, l2normalize } from "./lib/embed-local.mjs";

const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const modelIdx = args.indexOf("--model");
const OUT = path.join(ROOT, "data", "rag-embeddings.local.json");

/** 和 BM25 完全一致的检索文本：名字重复一次提高权重 */
export function embedTextOf(doc) {
  return `${doc.name} ${doc.name} ${doc.nameLocal} ${doc.typeCn} ${doc.district} ${doc.text}`;
}

function corpusHash(docs) {
  const h = crypto.createHash("sha256");
  for (const d of docs) h.update(d.id + "\u0000" + embedTextOf(d) + "\u0001");
  return h.digest("hex").slice(0, 16);
}

const docs = await loadCorpus();
const hash = corpusHash(docs);
const cfg = await getEmbedConfig();
if (modelIdx >= 0) cfg.model = args[modelIdx + 1] || cfg.model;

if (!FORCE) {
  try {
    const prev = JSON.parse(await fs.readFile(OUT, "utf8"));
    if (prev.corpusHash === hash && prev.model === cfg.model && prev.docs?.length === docs.length) {
      console.log(
        `已有最新向量，跳过（模型 ${prev.model} · ${prev.dim} 维 · ${prev.docs.length} 条 · 语料哈希 ${prev.corpusHash}）\n` +
          `要强制重算：node scripts/build-embeddings-local.mjs --force`,
      );
      process.exit(0);
    }
  } catch { /* 没有就继续 */ }
}

console.log(`端侧 embedding`);
console.log(`  本机服务：${cfg.base}`);
console.log(`  模型：    ${cfg.model}`);
console.log(`  语料：    ${docs.length} 条 · 哈希 ${hash}\n`);

const texts = docs.map(embedTextOf);
const t0 = Date.now();
const { vectors, provider, dim } = await embedTexts(texts, { cfg });
const secs = ((Date.now() - t0) / 1000).toFixed(1);

if (vectors.length !== docs.length) throw new Error(`向量条数不匹配：${vectors.length} vs ${docs.length}`);

const payload = {
  generatedAt: new Date().toISOString(),
  provider: provider.provider,
  endpoint: provider.endpoint,
  base: cfg.base,
  model: cfg.model,
  dim,
  corpusHash: hash,
  note: "本机模型算出的语料向量；全量语料不出本机。检索用余弦相似度（向量已 L2 归一化）。",
  docs: docs.map((d, i) => ({ id: d.id, vec: l2normalize(vectors[i]) })),
};

await fs.writeFile(OUT, JSON.stringify(payload), "utf8");
const sizeKb = (JSON.stringify(payload).length / 1024).toFixed(0);

console.log(`\n完成：${docs.length} 条 × ${dim} 维 · 用时 ${secs}s · 落盘 ${path.relative(ROOT, OUT)}（${sizeKb} KB）`);
console.log(`接口：${provider.provider} ${provider.endpoint}`);
