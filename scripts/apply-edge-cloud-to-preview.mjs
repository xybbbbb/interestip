/**
 * apply-edge-cloud-to-preview.mjs —— 往首页注入一张「端云协同」说明卡
 *
 * 数字从 data/rag-eval-vector-report.json 读（不手写，避免和评估结果对不上），
 * 语料规模从 rag-corpus*.jsonl 数行得来。
 * 用标记 `<!-- >>> EC_HTML -->` / `<!-- >>> EC_JS -->` 定位，重复运行幂等。
 *
 * 用法：node scripts/apply-edge-cloud-to-preview.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PREVIEW = path.join(ROOT, "web-preview", "index.html");

const HTML_START = "<!-- >>> EC_HTML -->";
const HTML_END = "<!-- <<< EC_HTML -->";
const JS_START = "<!-- >>> EC_JS -->";
const JS_END = "<!-- <<< EC_JS -->";

async function countLines(file) {
  try {
    const raw = await fs.readFile(path.join(ROOT, "data", file), "utf8");
    return raw.split(/\r?\n/).filter((l) => l.trim()).length;
  } catch {
    return 0;
  }
}

const report = JSON.parse(await fs.readFile(path.join(ROOT, "data", "rag-eval-vector-report.json"), "utf8"));
const run = Array.isArray(report.runs) ? report.runs[0] : (report.runs ?? report);
const modes = ["bm25", "vector", "hybrid"].filter((m) => run[m]?.summary);
const sum = (m) => run[m].summary;
const pct = (x) => `${Math.round(Number(x) * 100)}%`;

const corpus = {
  cortis: await countLines("rag-corpus.jsonl"),
  nyc: await countLines("rag-corpus-nyc.jsonl"),
  shanghai: await countLines("rag-corpus-shanghai.jsonl"),
};
const corpusTotal = corpus.cortis + corpus.nyc + corpus.shanghai;

const stats = {
  cases: sum(modes[0]).cases,
  pass: modes.map((m) => `${m === "bm25" ? "BM25" : m === "vector" ? "向量" : "混合"} ${sum(m).passed}/${sum(m).cases}`),
  passNum: modes.map((m) => `${sum(m).passed}/${sum(m).cases}`),
  citeMin: pct(Math.min(...modes.map((m) => sum(m).citationPrecisionAnswerable))),
  citeMax: pct(Math.max(...modes.map((m) => sum(m).citationPrecisionAnswerable))),
  fabricated: modes.reduce((n, m) => n + (sum(m).fabricatedCitations || 0), 0),
  refusePassed: sum("hybrid").negativeRefused,
  refuseTotal: sum("hybrid").negative,
  generatedAt: String(report.generatedAt || "").slice(0, 10),
  corpus,
  corpusTotal,
};

const CSS = [
  ".ec{margin-top:22px;background:linear-gradient(150deg,#F4F2FF 0%,#EDF4FF 100%);border:1px solid var(--line);border-radius:var(--radius);padding:16px 18px}",
  ".ec-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
  ".ec-head h3{margin:0;font-size:16px}",
  ".ec-body{margin:12px 0 0;font-size:13.5px;line-height:1.75;color:var(--ink)}",
  ".ec-body em{font-style:normal;color:var(--brand-ink);font-weight:600}",
  ".ec-note{margin:10px 0 0;font-size:12px;color:var(--muted);line-height:1.6}",
].join("\n");

const htmlBlock =
  `${HTML_START}\n` +
  `<style id="ec-css">\n${CSS}\n</style>\n` +
  `<section class="ec" id="edge-cloud" hidden></section>\n` +
  `${HTML_END}`;

const EC_JS = String.raw`(function(){
  if(typeof I18N==="undefined"||typeof t!=="function") return;
  var STATS = __STATS__;
  Object.assign(I18N.zh, {
    ecTitle:"这套「带来源的推荐」是怎么做出来的",
    ecLabel:"端云协同",
    ecBody:"答案由本机检索、云端成文：本机（Ollama + BGE-M3，1024 维）把 {total} 条地点语料在本机向量化，再做 BM25 + 向量混合检索，<em>证据不过闸门就直接在本机拒答</em>、不发起任何云端请求；云端（DeepSeek）只接收检索出的 Top-5 证据，负责写成带 [来源n] 的人话，资料不足必须拒答。评估 {cases} 个用例 × 3 种检索（BM25 {n0}、向量 {n1}、混合 {n2}）：引用精度 {min}–{max}、编造引用 {fab} 条、「资料里没有」的 {refusePassed}/{refuseTotal} 个用例全部正确拒答。",
    ecNote:"问答在开发机（AI PC）上构建期生成；页面本身不发起模型请求，也不含密钥。"
  });
  Object.assign(I18N.en, {
    ecTitle:"How these sourced recommendations are made",
    ecLabel:"Edge + cloud",
    ecBody:"Answers are retrieved on this machine and written by the cloud: the local model (Ollama + BGE-M3, 1024-d) embeds all {total} place documents here and runs BM25 + vector hybrid retrieval — <em>if the evidence fails the relevance gate, the refusal happens on-device and no cloud request is made at all</em>. The cloud (DeepSeek) only receives the retrieved top-5 snippets and turns them into prose with a [来源n] marker on every claim, refusing when the evidence is insufficient. Evaluation: {cases} cases × 3 retrievers (BM25 {n0}, vector {n1}, hybrid {n2}); citation precision {min}–{max}, {fab} fabricated citations, and {refusePassed}/{refuseTotal} “not in the sources” cases correctly refused.",
    ecNote:"The Q&A is pre-generated on the developer's AI PC; the page itself makes no model calls and holds no API keys."
  });

  function fillTpl(s,params){ return String(s).replace(/\{(\w+)\}/g, function(m,k){ return params[k]!=null?params[k]:m; }); }

  function renderEC(){
    var box=document.getElementById("edge-cloud");
    if(!box) return;
    var p={ total: STATS.corpusTotal, cases: STATS.cases, n0: STATS.passNum[0], n1: STATS.passNum[1], n2: STATS.passNum[2],
            min: STATS.citeMin, max: STATS.citeMax, fab: STATS.fabricated, date: STATS.generatedAt,
            refusePassed: STATS.refusePassed, refuseTotal: STATS.refuseTotal };
    box.innerHTML =
      '<div class="ec-head"><span class="step-label green">'+esc(t("ecLabel"))+'</span><h3>'+esc(t("ecTitle"))+'</h3></div>'+
      '<p class="ec-body">'+fillTpl(t("ecBody"),p)+'</p>'+
      '<p class="ec-note">'+esc(fillTpl(t("ecNote"),p))+'</p>';
    box.hidden=false;
  }

  var _setLang = setLang;
  setLang = function(l){ _setLang(l); renderEC(); };
  renderEC();
})();`;

const json = JSON.stringify(stats).replace(/</g, "\\u003c");
const jsBlock = `${JS_START}\n<script>\nconst EC_STATS = ${json};\n${EC_JS.replace("__STATS__", "EC_STATS")}\n</script>\n${JS_END}`;

const html = await fs.readFile(PREVIEW, "utf8");
function inject(source, start, end, block) {
  const s = source.indexOf(start);
  const e = source.indexOf(end);
  if (s < 0 || e < 0 || e <= s) throw new Error(`index.html 里找不到标记 ${start} / ${end}`);
  return source.slice(0, s) + block + source.slice(e + end.length);
}
const updated = inject(inject(html, HTML_START, HTML_END, htmlBlock), JS_START, JS_END, jsBlock);
await fs.writeFile(PREVIEW, updated, "utf8");

console.log(
  `已注入「端云协同」说明卡 → ${path.relative(ROOT, PREVIEW)}\n` +
    `  用例 ${stats.cases} · ${stats.pass.join(" · ")} · 引用精度 ${stats.citeMin}–${stats.citeMax} · 编造引用 ${stats.fabricated} · 拒答 ${stats.refusePassed}/${stats.refuseTotal}\n` +
    `  语料：首尔 ${corpus.cortis} / 纽约 ${corpus.nyc} / 上海 ${corpus.shanghai} = ${corpusTotal} 条`,
);
