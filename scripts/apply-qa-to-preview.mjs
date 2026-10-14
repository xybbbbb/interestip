/**
 * apply-qa-to-preview.mjs —— 把「问一句」问答区注入 web-preview/index.html
 *
 * 数据来自 data/qa.json（scripts/build-qa.mjs 构建期生成，端侧检索 + 云端生成）。
 * 用标记 `<!-- >>> QA_HTML -->` / `<!-- >>> QA_JS -->` 定位，重复运行是幂等的。
 *
 * 用法：node scripts/apply-qa-to-preview.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const QA_DATA = path.join(ROOT, "data", "qa.json");
const PREVIEW = path.join(ROOT, "web-preview", "index.html");

const HTML_START = "<!-- >>> QA_HTML -->";
const HTML_END = "<!-- <<< QA_HTML -->";
const JS_START = "<!-- >>> QA_JS -->";
const JS_END = "<!-- <<< QA_JS -->";

/** 三条线各有一套问答：首尔线沿用 data/qa.json，纽约/上海线由 build-qa-vertical.mjs 生成 */
async function readSet(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

function normalize(raw) {
  const items = (raw.items ?? []).map((it) => ({
  id: it.id,
  q: { zh: it.q?.zh ?? "", en: it.q?.en ?? "" },
  a: { zh: it.a?.zh ?? "", en: it.a?.en ?? "" },
  refused: { zh: Boolean(it.refused?.zh), en: Boolean(it.refused?.en) },
  sources: (it.sources ?? []).map((s) => ({
    n: s.n,
    name: s.name,
    district: s.district,
    confidence: s.confidence,
    pool: s.pool,
    label: s.label || "",
    url: s.url || "",
  })),
  }));
  return {
    generatedAt: raw.generatedAt ?? null,
    mode: raw.mode ?? "hybrid",
    model: raw.model ?? null,
    corpusDocs: raw.corpusDocs ?? null,
    items,
  };
}

const cortis = normalize(await readSet(QA_DATA));
const nyc = await readSet(path.join(ROOT, "data", "qa-nyc.json"));
const shanghai = await readSet(path.join(ROOT, "data", "qa-shanghai.json"));

const payload = {
  cortis,
  ...(nyc ? { nyc: normalize(nyc) } : {}),
  ...(shanghai ? { shanghai: normalize(shanghai) } : {}),
};
const totalItems = Object.values(payload).reduce((n, s) => n + (s?.items?.length || 0), 0);

const CSS = [
  ".qa{margin-top:22px;background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:16px 18px}",
  ".qa-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
  ".qa-head h3{margin:0;font-size:16px}",
  ".qa-sub{flex-basis:100%;color:var(--muted);font-size:12.5px;line-height:1.55}",
  ".qa-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}",
  ".qa-lines{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}",
  ".qa-line{border:1px dashed var(--line);background:transparent;border-radius:999px;padding:4px 11px;cursor:pointer;font:inherit;font-size:12.5px;color:var(--muted)}",
  ".qa-line:hover{color:var(--brand-ink);border-color:rgba(107,91,246,.32)}",
  ".qa-line.on{background:var(--brand-soft);border-style:solid;border-color:rgba(107,91,246,.32);color:var(--brand-ink);font-weight:600}",
  ".qa-chip{border:1px solid var(--line);background:#fff;border-radius:999px;padding:7px 13px;cursor:pointer;font-size:13px;color:var(--ink)}",
  ".qa-chip:hover{background:var(--brand-soft);color:var(--brand-ink)}",
  ".qa-chip.on{background:var(--brand-soft);border-color:rgba(107,91,246,.32);color:var(--brand-ink);font-weight:600}",
  ".qa-answer{margin-top:14px;border-top:1px dashed var(--line);padding-top:12px}",
  ".qa-question{font-size:14px;font-weight:700;color:var(--ink);margin:0 0 8px}",
  ".qa-text{font-size:14px;line-height:1.7;color:var(--ink);margin:0 0 8px}",
  ".qa-cite{color:var(--brand-ink);font-weight:700;font-size:11px;background:var(--brand-soft);border-radius:6px;padding:0 5px;margin:0 1px;white-space:nowrap}",
  ".qa-sources{margin-top:10px;display:grid;gap:6px}",
  ".qa-src{font-size:12.5px;color:var(--muted);line-height:1.55}",
  ".qa-src b{color:var(--ink)}",
  ".qa-src a{color:var(--brand-ink);word-break:break-all}",
  ".qa-refuse{color:var(--muted);font-size:13px}",
].join("\n");

const htmlBlock =
  `${HTML_START}\n` +
  `<style id="qa-css">\n${CSS}\n</style>\n` +
  `<section class="qa" id="qa">\n` +
  `  <div class="qa-head">\n` +
  `    <span class="step-label green" data-qa-label>问一句</span>\n` +
  `    <h3 data-qa-title>常见问题 · 带来源的推荐</h3>\n` +
  `    <span class="qa-sub" data-qa-sub></span>\n` +
  `  </div>\n` +
  `  <div class="qa-lines" id="qa-lines"></div>\n` +
  `  <div class="qa-chips" id="qa-chips"></div>\n` +
  `  <div class="qa-answer" id="qa-answer" hidden></div>\n` +
  `</section>\n` +
  `${HTML_END}`;

// 用 String.raw 保留正则里的反斜杠（\s \d \r \n 等），生成到 HTML 里仍是合法正则
const QA_JS = String.raw`(function(){
  if(typeof QA==="undefined"||!QA) return;
  Object.assign(I18N.zh, {
    qaLabel:"问一句",
    qaTitle:"常见问题 · 带来源的推荐",
    qaSub:"构建期用端侧向量 + BM25 混合检索、云端生成；答案里的 [来源n] 都对应到下面的来源。",
    qaScope:"语料范围：{name} 的 {n} 条地点",
    qaNoData:"这条线还没有问答数据。"
  });
  Object.assign(I18N.en, {
    qaLabel:"Ask",
    qaTitle:"Common questions · sourced recommendations",
    qaSub:"Pre-generated: on-device vector + BM25 hybrid retrieval, cloud generation. Every [来源n] maps to a source below.",
    qaScope:"Corpus: {n} places from {name}",
    qaNoData:"No Q&A for this line yet."
  });

  var activeQaId = null;
  var activeQaLine = null; /* 用户在这块里手动选的圈子；跟着当前圈子走时为 null */

  function qaLines(){
    var out=[];
    for(var k in QA){ if(QA[k] && QA[k].items && QA[k].items.length) out.push(k); }
    return out;
  }
  function lineName(key){
    var v = (typeof VERTICALS!=="undefined" && VERTICALS[key]) || null;
    if(v && v.label){
      var l = LANG==="en" ? v.label.en : v.label.zh;
      return l || v.label.zh || v.label.en || key;
    }
    return key;
  }
  /* 默认显示「当前圈子」的那一套；当前圈子没有数据（或用户在块里手选了）就退到可用的第一套 */
  function qaSet(){
    if(!QA) return null;
    var key = (activeQaLine && QA[activeQaLine]) ? activeQaLine : state.vertical;
    if(!(QA[key] && QA[key].items && QA[key].items.length)) key = qaLines()[0];
    if(!key) return null;
    return { key: key, item: QA[key] };
  }
  function tpl(s,params){
    return String(s).replace(/\{(\w+)\}/g, function(m,k){ return params[k]!=null ? params[k] : m; });
  }

  function qaConf(c){
    if(c==="high") return LANG==="en" ? "high confidence" : "高置信度";
    if(c==="medium") return LANG==="en" ? "medium · not yet verified" : "中置信度 · 未核验";
    if(c==="low") return LANG==="en" ? "low · not yet verified" : "低置信度 · 未核验";
    return LANG==="en" ? "official sight" : "官方观光点";
  }

  function qaSourceLabel(s){
    if(s.label) return s.label;
    if(s.pool==="sight") return LANG==="en" ? "VisitSeoul official" : "VisitSeoul 官方";
    return "";
  }

  function renderQaAnswer(){
    var box=document.getElementById("qa-answer");
    if(!box) return;
    if(!activeQaId){ box.hidden=true; box.innerHTML=""; return; }
    var info=qaSet();
    if(!info){ box.hidden=true; box.innerHTML=""; return; }
    var set=info.item;
    var it=null;
    for(var i=0;i<set.items.length;i++){ if(set.items[i].id===activeQaId){ it=set.items[i]; break; } }
    if(!it){ box.hidden=true; box.innerHTML=""; return; }
    var refused = LANG==="en" ? it.refused.en : it.refused.zh;
    var text = LANG==="en" ? it.a.en : it.a.zh;
    var question = LANG==="en" ? it.q.en : it.q.zh;

    if(refused){
      box.innerHTML = '<p class="qa-question">'+esc(question)+'</p><div class="qa-refuse">'+esc(text)+'</div>';
    } else {
      var lines = String(text).split(/\r?\n/).filter(function(x){ return x.trim() !== ""; });
      var paras = lines.map(function(line){
        var html = esc(line).replace(/\[来源\s*(\d+)\]/g, '<span class="qa-cite">[来源$1]</span>');
        return '<p class="qa-text">'+html+'</p>';
      }).join("");
      var order=[]; var seen={};
      var re=/\[来源\s*(\d+)\]/g; var m;
      while((m=re.exec(String(text)))!==null){
        var n=Number(m[1]);
        if(!seen[n]){ seen[n]=1; order.push(n); }
      }
      var srcLines = order.map(function(n){
        var s=null;
        for(var j=0;j<it.sources.length;j++){ if(it.sources[j].n===n){ s=it.sources[j]; break; } }
        if(!s) return "";
        var meta=[s.district, qaConf(s.confidence)].filter(Boolean).join(" · ");
        var link="";
        if(s.url){
          var linkText = qaSourceLabel(s) || (LANG==="en" ? "source link" : "来源链接");
          link = ' <a href="'+esc(s.url)+'" target="_blank" rel="noreferrer">'+esc(linkText)+'</a>';
        } else if(qaSourceLabel(s)){
          link = ' <span style="color:var(--muted)">'+esc(qaSourceLabel(s))+'</span>';
        }
        return '<div class="qa-src"><b>[来源'+n+']</b> '+esc(s.name)+' · '+esc(meta)+link+'</div>';
      }).filter(Boolean).join("");
      box.innerHTML = '<p class="qa-question">'+esc(question)+'</p>'+paras+'<div class="qa-sources">'+srcLines+'</div>';
    }
    box.hidden=false;
  }

  function renderQA(){
    var box=document.getElementById("qa");
    if(!box) return;
    var info=qaSet();
    var show = !!info;
    box.style.display = show ? "" : "none";
    if(!show){ activeQaId=null; return; }
    var set=info.item;

    var label=box.querySelector("[data-qa-label]");
    var title=box.querySelector("[data-qa-title]");
    var sub=box.querySelector("[data-qa-sub]");
    if(label) label.textContent=t("qaLabel");
    if(title) title.textContent=t("qaTitle");
    if(sub) sub.textContent=t("qaSub")+"　·　"+tpl(t("qaScope"), {name: lineName(info.key), n: (set.corpusDocs || set.items.length)});

    /* 圈子切换：三条线的问答都做了，这里让它们都能点到 */
    var linesEl=document.getElementById("qa-lines");
    if(linesEl){
      var keys=qaLines();
      if(keys.length>1){
        linesEl.innerHTML = keys.map(function(k){
          return '<button type="button" class="qa-line'+(k===info.key?" on":"")+'" data-qa-line="'+esc(k)+'">'+esc(lineName(k))+'</button>';
        }).join("");
        var lbtns=linesEl.querySelectorAll("[data-qa-line]");
        for(var j=0;j<lbtns.length;j++){
          (function(b){
            b.addEventListener("click", function(){
              activeQaLine=b.getAttribute("data-qa-line");
              activeQaId=null;
              renderQA();
            });
          })(lbtns[j]);
        }
        linesEl.style.display="";
      } else {
        linesEl.innerHTML="";
        linesEl.style.display="none";
      }
    }

    var chips=document.getElementById("qa-chips");
    if(!chips) return;
    chips.innerHTML = set.items.map(function(it){
      var q = LANG==="en" ? it.q.en : it.q.zh;
      var on = it.id===activeQaId ? " on" : "";
      return '<button type="button" class="qa-chip'+on+'" data-qa="'+esc(it.id)+'">'+esc(q)+'</button>';
    }).join("");

    var nodes=chips.querySelectorAll("[data-qa]");
    for(var i=0;i<nodes.length;i++){
      (function(btn){
        btn.addEventListener("click", function(){
          var id=btn.getAttribute("data-qa");
          activeQaId = (activeQaId===id) ? null : id;
          renderQA();
        });
      })(nodes[i]);
    }
    renderQaAnswer();
  }

  window.renderQA = renderQA;

  var _setLang = setLang;
  setLang = function(l){ _setLang(l); renderQA(); };
  var _setVertical = setVertical;
  setVertical = function(id){
    var before=state.vertical;
    _setVertical(id);
    if(state.vertical!==before){ activeQaId=null; activeQaLine=null; }
    renderQA();
  };

  renderQA();
})();`;

// 把 < 转义成 \u003c，避免回答文本里万一出现 </script> 提前闭合脚本标签
const json = JSON.stringify(payload).replace(/</g, "\\u003c");
const jsBlock =
  `${JS_START}\n` +
  `<script>\n` +
  `const QA = ${json};\n` +
  `${QA_JS}\n` +
  `</script>\n` +
  `${JS_END}`;

const html = await fs.readFile(PREVIEW, "utf8");

function inject(source, start, end, block) {
  const s = source.indexOf(start);
  const e = source.indexOf(end);
  if (s < 0 || e < 0 || e <= s) throw new Error(`index.html 里找不到标记 ${start} / ${end}`);
  return source.slice(0, s) + block + source.slice(e + end.length);
}

const updated = inject(inject(html, HTML_START, HTML_END, htmlBlock), JS_START, JS_END, jsBlock);
await fs.writeFile(PREVIEW, updated, "utf8");

const sizeKb = ((Buffer.byteLength(htmlBlock, "utf8") + Buffer.byteLength(jsBlock, "utf8")) / 1024).toFixed(1);
console.log(
  `已注入「问一句」问答区：三条线共 ${totalItems} 条问答（${sizeKb} KB）→ ${path.relative(ROOT, PREVIEW)}\n` +
    Object.entries(payload)
      .map(([k, s]) => `  ${k.padEnd(9)} ${s.items.length} 条问答 · 语料 ${s.corpusDocs ?? "-"} 条 · ${s.model ?? "-"} · ${s.generatedAt ?? "-"}`)
      .join("\n"),
);
