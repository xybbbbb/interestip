/**
 * build-rag-corpus.mjs
 *
 * 把原型里的地点数据（含证据链）导出成 RAG 用的语料：data/rag-corpus.jsonl
 * 每行一个 JSON 文档，字段：
 *   id / name / nameLocal / type / pool / district / confidence / text / sources / lat / lng
 *
 * 用法：node scripts/build-rag-corpus.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PREVIEW = path.join(ROOT, "web-preview", "index.html");
const OUT = path.join(ROOT, "data", "rag-corpus.jsonl");

const TYPE_CN = {
  venue: "演唱会场地",
  cafe: "咖啡馆",
  restaurant: "餐厅",
  shop: "同款店铺",
  company: "公司",
  ad_spot: "广告/快闪",
  filming_location: "拍摄地",
  photo_spot: "打卡点",
  sightseeing: "观光点",
};

async function readPlaces() {
  const html = await fs.readFile(PREVIEW, "utf8");
  const start = html.indexOf("const PLACES = [");
  if (start < 0) throw new Error("在 index.html 里找不到 const PLACES = [");
  const end = html.indexOf("\n];", start);
  const literal = html.slice(start + "const PLACES = ".length, end + 3);
  return new Function(`return ${literal};`)();
}

const places = await readPlaces();
const docs = [];

for (const p of places) {
  const typeCn = TYPE_CN[p.type] ?? p.type ?? "地点";
  const evidence = Array.isArray(p.evidence) ? p.evidence : [];

  // claim 与 summary 常常重复，这里去重，避免同一句话把检索分数刷高
  const evidenceText = [...new Set(
    evidence
      .flatMap((ev) => [ev.claim, ev.summary].filter(Boolean).map((s) => String(s).trim()))
      .filter(Boolean),
  )].join(" ｜ ");

  const text = [
    p.name,
    p.nameLocal,
    typeCn,
    p.district ? `${p.district}` : "",
    p.pool === "fan" ? "粉丝关联地点 CORTIS 同款" : "首尔官方观光点",
    p.why ?? "",
    p.note ?? "",
    p.address ? `地址：${p.address}` : "",
    p.hours ? `时间：${p.hours}` : "",
    evidenceText ? `证据：${evidenceText}` : "",
  ]
    .filter(Boolean)
    .join("。");

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
    sources: evidence
      .filter((ev) => ev?.url)
      .map((ev) => ({ label: ev.src || ev.srcType || "来源", url: ev.url })),
  });
}

await fs.writeFile(OUT, docs.map((d) => JSON.stringify(d)).join("\n") + "\n", "utf8");

const fanCount = docs.filter((d) => d.pool === "fan").length;
const chars = docs.reduce((s, d) => s + d.text.length, 0);
console.log(
  `语料已生成：${docs.length} 个地点（粉丝 ${fanCount} / 观光 ${docs.length - fanCount}）｜` +
    `总文本 ${chars} 字｜输出 ${path.relative(ROOT, OUT)}`,
);
