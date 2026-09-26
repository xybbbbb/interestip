/**
 * rag-play.mjs —— 交互式检索小工具（边问边看）
 *
 * 用法：node scripts/rag-play.mjs
 *   然后直接输入问题回车；输入 :fan / :sight 可限定范围，:all 取消限定，:q 退出
 */

import readline from "node:readline";
import { loadCorpus, search } from "./lib/rag.mjs";

const docs = await loadCorpus();
let pool = null;

const EXAMPLES = [
  "不想跑太远的小众同款打卡地",
  "同款 餐厅 吃饭",
  "咖啡 甜点 冰沙",
  "演唱会 场地 晚上",
  "购物 美妆 逛街",
  "汉江 夜景 散步",
  "米其林三星 求婚 直升机（故意问语料里没有的东西）",
];

console.log("=== 兴趣地点检索（RAG 的 Retrieval 环节）===");
console.log(`语料：${docs.length} 个地点｜粉丝 ${docs.filter((d) => d.pool === "fan").length} 个，观光 ${docs.filter((d) => d.pool === "sight").length} 个`);
console.log("直接输入问题回车即可。命令： :fan 只看粉丝点  :sight 只看观光点  :all 取消限定  :q 退出\n");
console.log("可以试试这几句：");
for (const e of EXAMPLES) console.log("  · " + e);
console.log("");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

function scopeLabel() {
  return pool === "fan" ? "（只看粉丝点）" : pool === "sight" ? "（只看观光点）" : "";
}

function show(query) {
  const { hits, dropped } = search(query, docs, { k: 3, pool });
  console.log("");
  if (!hits.length) {
    console.log("→ 没有命中任何地点。");
    console.log("  这正是我们要的行为：宁可为空，也不要拿不相关的资料去硬答。\n");
    return;
  }
  if (dropped > 0) console.log(`（另有 ${dropped} 条相关度太低已丢弃）`);
  hits.forEach((h, i) => {
    const d = h.doc;
    const badge = d.pool === "fan" ? `粉丝·${d.confidence}` : "观光";
    console.log(`${i + 1}. [${h.score.toFixed(2)}] ${d.name}（${d.district} · ${d.typeCn} · ${badge}）`);
    console.log(`   ${d.text.slice(0, 120).replace(/\s+/g, " ")}…`);
    if (d.sources.length) console.log(`   来源：${d.sources[0].url.slice(0, 70)}…`);
  });
  console.log("");
}

rl.on("line", (line) => {
  const input = line.trim();
  if (!input) return;
  if (input === ":q" || input === ":quit" || input === "退出") {
    rl.close();
    return;
  }
  if (input === ":fan") { pool = "fan"; console.log("已限定：只看粉丝地点\n"); return; }
  if (input === ":sight") { pool = "sight"; console.log("已限定：只看观光地点\n"); return; }
  if (input === ":all") { pool = null; console.log("已取消范围限定\n"); return; }
  console.log(`\n问题：${input} ${scopeLabel()}`);
  show(input);
});

rl.on("close", () => {
  console.log("再见 👋");
  process.exit(0);
});
