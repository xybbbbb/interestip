/**
 * lib/rag.mjs —— 检索层公共模块（被 rag-search.mjs 和 rag-play.mjs 共用）
 *
 * 这是 RAG 的「Retrieval」部分：从语料里按相关性找出 Top-K 文档。
 * 目前用 BM25（关键词），语料小（几十 KB）不需要向量库。
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "..", "..");
const DEFAULT_CORPUS = path.join(ROOT, "data", "rag-corpus.jsonl");

/** 读取语料（JSONL，每行一个地点文档） */
export async function loadCorpus(file = DEFAULT_CORPUS) {
  const raw = await fs.readFile(file, "utf8");
  return raw
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

/**
 * 切词：
 * - 拉丁字母/数字 → 按词
 * - 中日韩 → 默认只切「双字」（单字会造成大量误命中）
 * - bigramOnly=false 时回到初版行为：双字 + 单字都切（用于复现第 1 轮基线）
 */
export function tokenize(input, { bigramOnly = true } = {}) {
  const s = String(input).toLowerCase();
  const out = [];
  for (const m of s.matchAll(/[a-z0-9]+/g)) out.push(m[0]);
  for (const m of s.matchAll(/[\u3400-\u9fff\uac00-\ud7af]+/g)) {
    const run = m[0];
    if (run.length === 1) {
      out.push(run);
      continue;
    }
    out.push(run);
    for (let i = 0; i < run.length - 1; i += 1) out.push(run.slice(i, i + 2));
    if (!bigramOnly) for (const ch of run) out.push(ch);
  }
  return out;
}

/**
 * 口语化查询扩展（第 4 轮加入）。
 *
 * 关键词检索的硬伤：用户说「想找个地方吃东西」，语料里写的是「餐厅 / 小吃 / 市场」，
 * 字面完全不重叠 → 检索为空。这里用一张很小的同义词表把口语词映射到语料里的词。
 * 表是有意写得很克制的（只做"同义"不做"相关"），否则会污染精确匹配。
 */
const SYNONYMS = [
  { re: /吃东西|吃饭|吃的|美食|小吃|餐厅|餐馆|去哪儿吃/, add: ["餐厅", "小吃", "市场"] },
  { re: /购物|逛街|买点|血拼|美妆|化妆/, add: ["购物", "美妆", "店铺"] },
  { re: /咖啡|甜点|甜品|冰沙|奶茶|喝的/, add: ["咖啡", "甜点", "冰沙"] },
  { re: /夜景|晚上|夜里|看夜/, add: ["夜景"] },
  { re: /拍照|打卡|出片|好拍/, add: ["打卡", "拍照"] },
  { re: /散步|走走|骑行|野餐/, add: ["散步", "公园"] },
  { re: /手串|佛珠|寺庙|寺院/, add: ["手串", "寺"] },
  { re: /同款|爱豆|偶像|成员/, add: ["同款", "成员"] },
  { re: /演唱会|演出|公演/, add: ["演唱会", "场地"] },
];

export function expandQuery(query) {
  const extra = [];
  for (const { re, add } of SYNONYMS) if (re.test(String(query))) extra.push(...add);
  return extra;
}

/** 建 BM25 索引 */
export function buildIndex(docs, { bigramOnly = true } = {}) {
  const docTokens = docs.map((d) => {
    // 名字与类型重复一次，提高它们对排序的权重
    const searchable = `${d.name} ${d.name} ${d.nameLocal} ${d.typeCn} ${d.district} ${d.text}`;
    const tokens = tokenize(searchable, { bigramOnly });
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    return { tf, len: tokens.length };
  });
  const df = new Map();
  for (const { tf } of docTokens) for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  const avgLen = docTokens.reduce((s, d) => s + d.len, 0) / docTokens.length;
  return { docTokens, df, avgLen, n: docs.length };
}

/**
 * 检索：返回 { hits, dropped, termFiltered, topScore, indexed }
 *   dropped       = 通过词命中数、但被相关性阈值丢掉的条数
 *   termFiltered  = 连"命中词数"这一关都没过的条数
 * hits 只包含通过相关性阈值的文档（阈值见下方注释）
 *
 * 两道闸门（都是「宁可检索为空，也不要硬答」这条产品规则的落地）：
 *   1. 词命中数：查询里有 2 个以上不同的词时，文档至少命中 2 个不同词才算候选。
 *      只用 1 个词就命中的文档最容易造成「答非所问」——例如问
 *      「米其林三星餐厅求婚直升机怎么安排」，只因文中出现「餐厅」/「安排」就返回结果。
 *      做法对应 Elasticsearch 里的 minimum_should_match。
 *   2. 相关性阈值：低于 max(minScore, 最高分 × relativeCutoff) 的一律丢掉。
 */
export function search(
  query,
  docs,
  {
    k = 5,
    pool = null,
    minScore = 1.5,
    relativeCutoff = 0.35,
    minMatched: forcedMinMatched = null,
    bigramOnly = true,
    expand = false,
  } = {},
) {
  const filtered = pool ? docs.filter((d) => d.pool === pool) : docs;
  if (!filtered.length) return { hits: [], dropped: 0, termFiltered: 0, topScore: 0, indexed: 0 };

  const { docTokens, df, avgLen, n } = buildIndex(filtered, { bigramOnly });
  const k1 = 1.2;
  const b = 0.75;
  const rawQueryTokens = tokenize(query, { bigramOnly });
  const expandedTokens = expand ? expandQuery(query).flatMap((t) => tokenize(t, { bigramOnly })) : [];
  const qTokens = [...new Set([...rawQueryTokens, ...expandedTokens])];
  // 短查询（1–2 个词）命中 1 个词即可；更长的查询至少要有 2 个不同的词命中
  const minMatched = forcedMinMatched !== null ? forcedMinMatched : qTokens.length <= 2 ? 1 : 2;

  const scored = filtered
    .map((doc, i) => {
      const { tf, len } = docTokens[i];
      let score = 0;
      let matched = 0;
      for (const t of qTokens) {
        const f = tf.get(t);
        if (!f) continue;
        matched += 1;
        const idf = Math.log(1 + (n - (df.get(t) || 0) + 0.5) / ((df.get(t) || 0) + 0.5));
        score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * len) / avgLen)));
      }
      return { doc, score, matched };
    });
  const termFiltered = scored.filter((x) => x.matched < minMatched).length;
  const ranked = scored
    .filter((x) => x.matched >= minMatched)
    .filter((x) => x.score > 0)
    .sort((a, b2) => b2.score - a.score);

  const topScore = ranked.length ? ranked[0].score : 0;
  // 低于「最高分的 relativeCutoff」或绝对下限的结果一律丢掉：
  // RAG 宁可检索为空（然后老实说不知道），也不要塞不相关资料让模型硬编。
  const cutoff = Math.max(minScore, topScore * relativeCutoff);
  const hits = ranked.filter((x) => x.score >= cutoff).slice(0, k);
  return { hits, dropped: ranked.length - hits.length, termFiltered, topScore, indexed: filtered.length };
}
