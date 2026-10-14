/**
 * build-qa-vertical.mjs —— 给「纽约线 / 上海线」各生成一套「问一句」问答
 *
 * 和 build-qa.mjs（首尔线）走的是同一条端云协同链路：
 *   端侧（本机 Ollama + BGE-M3）：语料向量 + 余弦检索 + 与 BM25 做 RRF 融合 + 相关性闸门
 *   云端（DeepSeek）：只拿检索出的 Top-K 证据生成回答，必须挂 [来源n]，证据不足必须拒答
 *
 * 用法：node scripts/build-qa-vertical.mjs nyc
 *       node scripts/build-qa-vertical.mjs shanghai
 * 产出：data/rag-corpus-<v>.jsonl
 *       data/rag-embeddings-<v>.local.json
 *       data/qa-<v>.json
 */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG } from "./lib/rag-eval-core.mjs";
import { loadEmbeddings, makeRetriever } from "./lib/rag-vector.mjs";
import { embedTexts, getEmbedConfig, l2normalize } from "./lib/embed-local.mjs";
import {
  buildRagPrompt,
  callChat,
  getLLMConfig,
  makeLlmGenerator,
  parseCitations,
  ROOT,
} from "./lib/llm.mjs";

const PREVIEW = path.join(ROOT, "web-preview", "index.html");
const verticalId = (process.argv[2] || "").trim();
if (!["nyc", "shanghai"].includes(verticalId)) {
  console.error("用法：node scripts/build-qa-vertical.mjs nyc|shanghai");
  process.exit(1);
}

/* ---------- 每条线 10 个真实常见问题（前 8 个问得到，后 2 个故意问不到，用来演示拒答） ---------- */
const QUESTION_SETS = {
  nyc: [
    { id: "nyc-plan-day", zh: "想一天逛完主要的美术馆，怎么排？", en: "How should I plan a single day for the main museums?" },
    { id: "nyc-starry", zh: "MoMA 的《星月夜》在哪儿？几点去合适？", en: "Where is Starry Night at MoMA, and when should I go?" },
    { id: "nyc-highline-walk", zh: "想在高线公园一带散步，顺便看看公共艺术", en: "I want to walk around the High Line and see public art" },
    { id: "nyc-quiet", zh: "想找个安静看展的下午", en: "A quiet afternoon of looking at art" },
    { id: "nyc-artbooks", zh: "想买艺术书和独立出版物", en: "Where can I buy art books and independent publishing?" },
    { id: "nyc-klimt", zh: "想看克里姆特那幅金色肖像", en: "Where can I see Klimt's golden portrait?" },
    { id: "nyc-evening", zh: "晚上还有哪些美术馆开着？", en: "Which museums are open in the evening?" },
    { id: "nyc-medieval", zh: "想看中世纪的艺术品", en: "Where can I see medieval art?" },
    { id: "nyc-flushing", zh: "法拉盛除了吃东西还有什么值得看？", en: "What's worth seeing in Flushing besides the food?" },
    { id: "nyc-boston", zh: "想坐火车去波士顿看美术馆，怎么安排？", en: "How do I take the train to Boston for museums?" },
  ],
  shanghai: [
    { id: "sh-race-day", zh: "比赛日从市区去赛车场要多久？", en: "How long does it take to get to the circuit from downtown on race day?" },
    { id: "sh-merch", zh: "想买 F1 周边，去哪里？", en: "Where can I buy F1 merchandise?" },
    { id: "sh-popup-status", zh: "那些快闪店现在还开着吗？", en: "Are those pop-up stores still open?" },
    { id: "sh-river-night", zh: "晚上想看浦江两岸的夜景", en: "Where can I see the river night view?" },
    { id: "sh-museum", zh: "想看中国古代艺术，去哪里？", en: "Where can I see classical Chinese art?" },
    { id: "sh-bund-yuyuan", zh: "一天想逛外滩和豫园，怎么安排？", en: "How do I fit the Bund and Yu Garden into one day?" },
    { id: "sh-shopping-food", zh: "想逛街吃饭都顺路的地方", en: "Somewhere to shop and eat along the way" },
    { id: "sh-walk-photo", zh: "想找适合散步拍照的老街区", en: "An old neighbourhood for walking and photos" },
    { id: "sh-hangzhou", zh: "想在上海租车自驾去杭州看西湖", en: "Renting a car in Shanghai to drive to Hangzhou" },
    { id: "sh-tickets", zh: "上海站的 F1 门票在哪里买？", en: "Where do I buy F1 Shanghai tickets?" },
  ],
};

const TYPE_CN = {
  venue: "演唱会场地",
  cafe: "咖啡馆",
  restaurant: "餐厅",
  shop: "同款店铺",
  company: "公司",
  ad_spot: "快闪 / 展台",
  filming_location: "拍摄地",
  photo_spot: "打卡点",
  sightseeing: "观光点",
  museum: "美术馆",
};

const POOL_LABEL = {
  nyc: { fan: "艺术与文化相关地点", sight: "纽约观光点" },
  shanghai: { fan: "F1 相关地点（快闪 / 展台，多为限时活动）", sight: "上海观光点" },
};

const EN_SYSTEM = [
  "You are the recommendation generator for an interest-driven travel assistant.",
  "You may ONLY use the content in 【资料】. Do not add facts from your own knowledge or memory.",
  "",
  "Decide (without explaining the decision):",
  "A. If the sources contain places relevant to the question -> recommend them and state what the sources say. Even if the sources don't cover every detail, answer the parts they do cover.",
  "B. If the sources are completely irrelevant -> output only: The sources don't contain enough to answer this.",
  "",
  "Output rules:",
  "1) Every claim must cite a source as [来源n] (use this exact marker, same as the sources list).",
  "2) Only refuse in case B, and when refusing say only that one sentence.",
  "3) For medium or low confidence places, say \"a fan mentioned (not yet verified)\".",
  "4) Do not invent opening hours, prices or addresses.",
  "5) Answer in English, at most 3 sentences.",
].join("\n");
const EN_REFUSAL = "The sources don't contain enough to answer this.";

/** 和 build-embeddings-local.mjs 保持完全一致的检索文本 */
function embedTextOf(doc) {
  return `${doc.name} ${doc.name} ${doc.nameLocal} ${doc.typeCn} ${doc.district} ${doc.text}`;
}
function corpusHash(docs) {
  const h = crypto.createHash("sha256");
  for (const d of docs) h.update(d.id + "\u0000" + embedTextOf(d) + "\u0001");
  return h.digest("hex").slice(0, 16);
}
function sourceLabel(url) {
  const u = String(url || "").toLowerCase();
  if (u.includes("openstreetmap")) return "OpenStreetMap";
  if (u.includes("amap") || u.includes("gaode")) return "高德地图";
  if (u.includes("xiaohongshu")) return "小红书";
  if (u.includes("visitseoul")) return "VisitSeoul 官方";
  return "来源";
}

function readVertical(html, id) {
  for (const line of html.split("\n")) {
    const m = /^VERTICALS\.([a-z0-9_-]+) = (\{.*\});$/.exec(line.trim());
    if (m && m[1] === id) return JSON.parse(m[2]);
  }
  throw new Error(`index.html 里找不到 VERTICALS.${id}`);
}

/* ---------- 语料：地点 → RAG 文档 ---------- */
function buildDocs(v, transit) {
  const docs = [];
  for (const p of v.places) {
    const typeCn = TYPE_CN[p.type] ?? p.type ?? "地点";
    const poolLabel = (POOL_LABEL[v.id] || {})[p.pool] || "";
    const evidence = Array.isArray(p.evidence) ? p.evidence : [];
    const evidenceText = [
      ...new Set(
        evidence.flatMap((ev) => [ev.claim, ev.summary].filter(Boolean).map((s) => String(s).trim())).filter(Boolean)
      ),
    ].join(" ｜ ");

    // 上海线：把高德实测的公交耗时写进赛车场那条文档（只取几个市区代表点），问题才答得出真实数字
    const transitNotes = [];
    if (transit && transit.pairs && p.id === "sh-circuit") {
      for (const fromId of ["sh-bund", "sh-nanjingrd", "sh-jingantemple", "sh-xintiandi", "sh-tower", "sh-01"]) {
        const other = v.places.find((x) => x.id === fromId);
        const pair = transit.pairs[`${fromId}|${p.id}`];
        if (other && pair && pair.ok && pair.minutes) {
          transitNotes.push(`从${other.name}出发约 ${pair.minutes} 分钟（${(pair.modes || []).join(" + ")}）`);
        }
      }
    }
    const transitText = transitNotes.length
      ? `高德公交路径规划实测耗时（${String(transit.queryTime || "").slice(0, 10)}，比赛日建议预留更多时间）：${transitNotes.join("；")}`
      : "";

    const text = [
      p.name,
      p.nameLocal,
      typeCn,
      p.district || "",
      poolLabel,
      p.why ?? "",
      p.note ?? "",
      p.address ? `地址：${p.address}` : "",
      p.hours ? `时间：${p.hours}` : "",
      evidenceText ? `证据：${evidenceText}` : "",
      transitText,
    ]
      .filter(Boolean)
      .join("。");

    const sources = [];
    for (const ev of evidence) {
      if (ev?.url) sources.push({ label: ev.src || ev.srcType || sourceLabel(ev.url), url: ev.url });
    }
    if (!sources.length && p.source) sources.push({ label: sourceLabel(p.source), url: p.source });
    if (p.officialUrl) sources.push({ label: "官网", url: p.officialUrl });

    docs.push({
      id: p.id,
      name: p.name,
      nameLocal: p.nameLocal ?? "",
      type: p.type ?? "",
      typeCn,
      pool: p.pool ?? "",
      district: p.district ?? "",
      confidence: p.conf ?? "plain",
      lat: p.lat,
      lng: p.lng,
      text,
      sources,
    });
  }
  return docs;
}

function sourceEntries(hits) {
  return hits.map((h, i) => {
    const d = h.doc;
    const src = Array.isArray(d.sources) ? d.sources[0] : null;
    return {
      n: i + 1,
      id: d.id,
      name: d.name,
      district: d.district || "",
      confidence: d.confidence ?? "plain",
      pool: d.pool || "",
      type: d.typeCn || d.type || "",
      label: src?.label || "",
      url: src?.url || "",
    };
  });
}

/* ---------- 主流程 ---------- */
const html = await fs.readFile(PREVIEW, "utf8");
const v = readVertical(html, verticalId);

let transit = null;
if (verticalId === "shanghai") {
  try { transit = JSON.parse(await fs.readFile(path.join(ROOT, "data", "shanghai-transit-matrix.json"), "utf8")); } catch {}
}

const docs = buildDocs(v, transit);
const corpusPath = path.join(ROOT, "data", `rag-corpus-${verticalId}.jsonl`);
await fs.writeFile(corpusPath, docs.map((d) => JSON.stringify(d)).join("\n") + "\n", "utf8");
console.log(`语料：${docs.length} 条 → data/rag-corpus-${verticalId}.jsonl`);

/* 端侧 embedding（本机 Ollama） */
const embedCfg = await getEmbedConfig();
const embedPath = path.join(ROOT, "data", `rag-embeddings-${verticalId}.local.json`);
const hash = corpusHash(docs);
let embeddings = null;
try {
  const prev = JSON.parse(await fs.readFile(embedPath, "utf8"));
  if (prev.corpusHash === hash && prev.model === embedCfg.model && prev.docs?.length === docs.length) {
    embeddings = prev;
    console.log(`端侧向量：复用已有文件（${prev.dim} 维 · ${prev.docs.length} 条 · 哈希 ${prev.corpusHash}）`);
  }
} catch {}
if (!embeddings) {
  console.log(`端侧 embedding：${embedCfg.base} · ${embedCfg.model} · ${docs.length} 条…`);
  const t0 = Date.now();
  const { vectors, provider, dim } = await embedTexts(docs.map(embedTextOf), { cfg: embedCfg });
  if (vectors.length !== docs.length) throw new Error(`向量条数不匹配：${vectors.length} vs ${docs.length}`);
  const payload = {
    generatedAt: new Date().toISOString(),
    provider: provider.provider,
    endpoint: provider.endpoint,
    base: embedCfg.base,
    model: embedCfg.model,
    dim,
    corpusHash: hash,
    note: "本机模型算出的语料向量；全量语料不出本机。检索用余弦相似度（向量已 L2 归一化）。",
    docs: docs.map((d, i) => ({ id: d.id, vec: l2normalize(vectors[i]) })),
  };
  await fs.writeFile(embedPath, JSON.stringify(payload), "utf8");
  embeddings = payload;
  console.log(`  完成：${dim} 维 · ${((Date.now() - t0) / 1000).toFixed(1)}s · ${provider.provider} ${provider.endpoint}`);
}

// makeRetriever 需要的是 loadEmbeddings 的索引形状 { meta, byId }
const embedIndex = await loadEmbeddings(embedPath);
const retriever = await makeRetriever("hybrid", { embeddings: embedIndex, cfg: embedCfg });
const llmCfg = await getLLMConfig();
if (!llmCfg.configured) {
  console.error("❌ 没有找到 LLM_API_KEY（.env）。请先配置 DeepSeek Key 再跑。");
  process.exit(1);
}
const zhGen = makeLlmGenerator(llmCfg, { promptVersion: "v2" });

console.log(`\n云端生成（${llmCfg.model}）——每条线 10 个问题：`);
const items = [];
let calls = 0;
let tokens = 0;
for (const q of QUESTION_SET(verticalId)) {
  const { hits } = await retriever(q.zh, docs, { ...DEFAULT_CONFIG, pool: null });
  const retrieved = hits.map((h) => h.doc.id);
  const zhOut = await zhGen.generate(q.zh, hits);
  calls += 1;
  tokens += zhOut.usage?.total_tokens ?? 0;

  let enText = EN_REFUSAL;
  let enRefused = true;
  if (hits.length) {
    const { user } = buildRagPrompt(q.en, hits);
    const { content, usage } = await callChat({ system: EN_SYSTEM, user }, llmCfg);
    const { citations } = parseCitations(content, hits);
    calls += 1;
    tokens += usage?.total_tokens ?? 0;
    enText = content;
    enRefused = citations.length === 0 && /don't contain|not enough|can'?t answer|unable to answer/i.test(content);
  }

  items.push({
    id: q.id,
    q: { zh: q.zh, en: q.en },
    a: { zh: zhOut.text, en: enText },
    refused: { zh: zhOut.refused, en: enRefused },
    sources: sourceEntries(hits),
    retrieved,
  });
  const flag = zhOut.refused ? "（拒答）" : "";
  console.log(`√ ${flag}${q.zh}`);
  console.log(`    ${hits.map((h, i) => `[来源${i + 1}]${h.doc.name}`).join(" ") || "无证据 → 拒答"}`);
}

function QUESTION_SET(id) {
  return QUESTION_SETS[id];
}

const payload = {
  vertical: verticalId,
  generatedAt: new Date().toISOString(),
  mode: "hybrid",
  retriever: "BM25 + BGE-M3 向量（RRF 融合，端侧）",
  model: llmCfg.model,
  corpusDocs: docs.length,
  calls,
  totalTokens: tokens,
  items,
};
const outPath = path.join(ROOT, "data", `qa-${verticalId}.json`);
await fs.writeFile(outPath, JSON.stringify(payload, null, 2) + "\n", "utf8");

const refused = items.filter((it) => it.refused.zh).length;
console.log(
  `\n已生成 ${items.length} 条问答（${items.length - refused} 条带来源 / ${refused} 条拒答）→ data/qa-${verticalId}.json` +
    `（${llmCfg.model}，${calls} 次调用，${tokens} tokens）`
);
