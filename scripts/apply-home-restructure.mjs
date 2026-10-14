/**
 * apply-home-restructure.mjs —— 首页「产品定位 + 信息架构」重构（一次性）
 *
 * 目标：首页第一视觉层级从「旅行规划」改成「兴趣社区」。
 *   - 顶部导航 → 左侧 Sidebar（logo / 导航 / 我的兴趣 / Journey CTA）
 *   - 主列：Hero → 热门兴趣圈子 → 兴趣社区·最新动态 →（保留原有流程）
 *   - 右侧辅助栏：今日热门 / 加入兴趣社区 / 发现地图
 *   - 配色向蓝紫（#5B5FEF 一族）靠拢
 *
 * 原则：不换技术栈、不引入框架、保持单文件；不动地图 / Journey / place drawer /
 * 路线优化 / i18n / 现有数据。社区相关的新数据一律标注为 DEMO。
 *
 * 带 guard：重复运行会直接退出（避免二次包裹 DOM）。
 * 用法：node scripts/apply-home-restructure.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PREVIEW = path.join(ROOT, "web-preview", "index.html");

const GUARD = "<!-- interestip-home-restructure v1 -->";

const CSS = String.raw`
/* ============ 首页重构：左 Sidebar + 主列 + 右栏（兴趣社区优先） ============ */
header.nav{
  position:fixed;left:0;top:0;bottom:0;width:248px;height:100vh;z-index:1000;
  background:#fff;border-right:1px solid var(--line);border-bottom:0;backdrop-filter:none;
  overflow-y:auto;padding:0;
}
header.nav .nav-inner{display:flex;flex-direction:column;align-items:stretch;gap:0;max-width:none;margin:0;padding:16px 14px;height:auto}
header.nav .brand{padding:6px 8px 12px}
header.nav .nav-links{display:flex;flex-direction:column;gap:2px;margin:8px 0 0}
header.nav .nav-links a{display:block;padding:9px 12px;border-radius:12px;font-size:14px}
header.nav .nav-right{margin:14px 0 0;padding:12px 0 0;border-top:1px solid var(--line);display:flex;gap:8px}
.side-sec{margin-top:12px;padding-top:12px;border-top:1px solid var(--line)}
.side-label{font-size:11.5px;letter-spacing:.05em;color:var(--muted);padding:0 12px 6px;font-weight:700}
.side-item{display:flex;align-items:center;gap:9px;padding:8px 12px;border-radius:11px;font-size:13.5px;color:var(--ink-2);cursor:pointer;text-decoration:none}
.side-item:hover{background:var(--brand-soft);color:var(--brand-ink)}
.side-item .si-dot{width:7px;height:7px;border-radius:50%;background:var(--brand-2);flex:0 0 auto}
.side-journey{margin-top:18px;background:linear-gradient(150deg,#EEF0FF,#E7EBFF);border:1px solid #E0E3FB;border-radius:16px;padding:14px}
.side-journey b{display:block;font-size:13px;color:var(--ink);line-height:1.5;margin-bottom:10px;font-weight:700}
.side-journey button{width:100%;border:0;background:var(--brand);color:#fff;border-radius:11px;padding:9px 10px;font:inherit;font-size:13px;font-weight:600;cursor:pointer}

.app-content{margin-left:248px;display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:22px;align-items:start;max-width:1320px;margin-right:auto;padding:24px 24px 44px}
.app-main{min-width:0}
.app-main main{max-width:none;margin:0;padding:0}
.app-main #about{max-width:none;margin:0;padding:34px 0 0}
.rail{position:sticky;top:24px;display:flex;flex-direction:column;gap:16px}
.rail-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-md);padding:16px;box-shadow:var(--shadow-1)}
.rail-card h3{margin:0 0 10px;font-size:14.5px;display:flex;align-items:center;gap:8px}
.rail-item{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px dashed var(--line);cursor:pointer}
.rail-item:first-of-type{border-top:0}
.rail-item .ri-ico{width:30px;height:30px;border-radius:9px;background:var(--brand-soft);display:grid;place-items:center;font-size:15px;flex:0 0 auto}
.rail-item .ri-t{font-size:13px;color:var(--ink);font-weight:600;line-height:1.35}
.rail-item .ri-s{font-size:11.5px;color:var(--muted)}
.rail-cta{background:linear-gradient(150deg,#5B5FEF,#8B8FF7);color:#fff;border-radius:var(--r-md);padding:18px;box-shadow:0 14px 34px rgba(91,95,239,.28)}
.rail-cta b{display:block;font-size:15px;margin-bottom:6px}
.rail-cta p{margin:0 0 12px;font-size:12.5px;opacity:.92;line-height:1.55}
.rail-cta button{width:100%;border:0;background:#fff;color:var(--brand-ink);border-radius:11px;padding:9px;font:inherit;font-size:13px;font-weight:700;cursor:pointer}
.rail-map{height:150px;border-radius:12px;background:linear-gradient(150deg,#EEF0FF,#E4F0FF);border:1px solid var(--line);display:grid;place-items:center;color:var(--brand-ink);font-size:12.5px;font-weight:600;cursor:pointer}

.demo-tag{display:inline-block;font-size:11px;font-weight:700;color:var(--medium);background:var(--medium-bg);border-radius:999px;padding:2px 9px;margin-left:8px;vertical-align:middle}

/* Hero → 蓝紫渐变面板（保留旅行视觉，降低高度） */
.app-main .hero{
  background:linear-gradient(135deg,#5B5FEF 0%,#6E6BF6 46%,#8B8FF7 100%);
  border-radius:var(--r-lg);padding:30px 28px;color:#fff;margin-top:4px;
  grid-template-columns:minmax(0,1fr) minmax(0,.82fr);gap:24px;align-items:center;
  box-shadow:0 18px 44px rgba(91,95,239,.28);
}
.app-main .hero h1{color:#fff}
.app-main .hero .eyebrow{color:#fff;background:rgba(255,255,255,.18);border-color:transparent}
.app-main .hero .hero-sub,.app-main .hero .explore-sub{color:rgba(255,255,255,.92)}
.app-main .hero .explore-hint{color:rgba(255,255,255,.85)}
.app-main .hero .explore-box{background:rgba(255,255,255,.97);border-color:transparent}
.app-main .hero .explore-box input{background:#F1F2FB}
.app-main .hero .note,.app-main .hero #cat-note{color:rgba(255,255,255,.82)}
.app-main .hero .chip-btn{background:rgba(255,255,255,.18);border-color:rgba(255,255,255,.38);color:#fff}
.app-main .hero .ghost-btn{background:rgba(255,255,255,.14);border-color:rgba(255,255,255,.38);color:#fff}
.app-main .hero .search-box{background:rgba(255,255,255,.97);border-radius:var(--r-lg);padding:12px}
.app-main .hero .search-box textarea{background:#F1F2FB}
.app-main .hero .cat{background:rgba(255,255,255,.16);border-color:rgba(255,255,255,.3);color:#fff}
.app-main .hero .cat.on{background:#fff;color:var(--brand-ink)}
.app-main .hero-media{border-radius:var(--r-md);overflow:hidden;box-shadow:0 12px 30px rgba(20,20,50,.22)}

/* 热门兴趣圈子 */
.home-sec{margin-top:26px}
.ic-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:14px}
.ic-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-md);overflow:hidden;cursor:pointer;box-shadow:var(--shadow-1);transition:transform .18s ease,box-shadow .18s ease}
.ic-card:hover{transform:translateY(-3px);box-shadow:var(--shadow-2)}
.ic-media{height:84px;display:grid;place-items:center;font-size:30px;background:linear-gradient(140deg,#EEF0FF,#E3EBFF)}
.ic-body{padding:11px 12px 13px}
.ic-name{font-size:13.5px;font-weight:700;color:var(--ink);line-height:1.3}
.ic-meta{font-size:11.5px;color:var(--muted);margin-top:3px}
.ic-desc{font-size:11.5px;color:var(--muted);margin-top:6px;line-height:1.45;min-height:32px}
.ic-join{margin-top:9px;width:100%;border:1px solid var(--brand);background:var(--brand-soft);color:var(--brand-ink);border-radius:9px;padding:6px;font:inherit;font-size:12px;font-weight:700;cursor:pointer}
.ic-join:hover{background:var(--brand);color:#fff}

/* 兴趣社区 · 最新动态 */
.feed-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
.feed-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-md);padding:13px;box-shadow:var(--shadow-1);cursor:pointer}
.feed-card:hover{box-shadow:var(--shadow-2)}
.feed-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.feed-av{width:28px;height:28px;border-radius:50%;background:linear-gradient(140deg,#5B5FEF,#8B8FF7);color:#fff;display:grid;place-items:center;font-size:12px;font-weight:700;flex:0 0 auto}
.feed-name{font-size:12.5px;font-weight:600;color:var(--ink)}
.feed-time{font-size:11px;color:var(--muted)}
.feed-media{height:104px;border-radius:11px;background:linear-gradient(140deg,#EEF0FF,#E3EBFF);display:grid;place-items:center;font-size:28px;margin-bottom:9px}
.feed-text{font-size:12.5px;color:var(--ink-2);line-height:1.6;margin:0 0 10px}
.feed-place{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.chip-i{font-size:11px;background:var(--brand-soft);color:var(--brand-ink);border-radius:999px;padding:2px 9px;font-weight:600}
.feed-foot{display:flex;gap:14px;margin-top:11px;font-size:11.5px;color:var(--muted)}

@media(max-width:1240px){ .app-content{grid-template-columns:minmax(0,1fr)} .rail{display:none} }
@media(max-width:1080px){ .ic-grid{grid-template-columns:repeat(3,minmax(0,1fr))} .feed-grid{grid-template-columns:1fr 1fr} }
@media(max-width:900px){
  header.nav{position:sticky;top:0;bottom:auto;width:auto;height:auto;border-right:0;border-bottom:1px solid var(--line)}
  header.nav .nav-inner{flex-direction:row;align-items:center;gap:12px;padding:10px 14px}
  header.nav .nav-links{flex-direction:row;margin:0}
  header.nav .nav-links a{padding:7px 10px}
  header.nav .nav-right{margin:0 0 0 auto;border-top:0;padding:0}
  .side-sec,.side-journey{display:none}
  .app-content{margin-left:0;padding:14px}
  .app-main .hero{grid-template-columns:1fr;padding:22px 18px}
  .app-main .hero-media{order:-1;max-height:180px}
  .ic-grid{grid-template-columns:1fr 1fr}
  .feed-grid{grid-template-columns:1fr}
}
@media(max-width:560px){ .ic-grid{grid-template-columns:1fr} .app-content{padding:10px} }
`;

const SIDEBAR = String.raw`
    <div class="side-sec">
      <div class="side-label" data-home="sideMine">我的兴趣</div>
      <a class="side-item" data-interest="cortis"><span class="si-dot"></span>CORTIS × Seoul</a>
      <a class="side-item" data-interest="film"><span class="si-dot"></span>Film &amp; TV</a>
      <a class="side-item" data-interest="art"><span class="si-dot"></span>New York × Art &amp; Culture</a>
      <a class="side-item" data-interest="hiking"><span class="si-dot"></span>Hiking</a>
    </div>
    <div class="side-journey">
      <b data-home="sideJourney">让兴趣带你去更远的地方。</b>
      <button type="button" data-home-btn="journey">开始你的旅程 →</button>
    </div>`;

const SECTIONS = String.raw`
  <!-- ===== 首页重构：热门兴趣圈子 + 社区动态（位置：Hero 之后、原有流程之前） ===== -->
  <section class="home-sec" id="home-interests">
    <div class="section-head">
      <div>
        <h2 class="section-title"><span data-home="hiTitle">热门兴趣圈子</span><span class="demo-tag" data-home="demoTag">演示数据</span></h2>
        <p class="section-sub" data-home="hiSub">进入一个兴趣圈子，和同好一起发现真实地点。</p>
      </div>
    </div>
    <div class="ic-grid" id="ic-grid"></div>
  </section>
  <section class="home-sec" id="home-feed">
    <div class="section-head">
      <div>
        <h2 class="section-title"><span data-home="hfTitle">兴趣社区 · 最新动态</span><span class="demo-tag" data-home="demoTag2">演示数据</span></h2>
        <p class="section-sub" data-home="hfSub">圈友分享的地点，都连着真实的来源与核验状态。</p>
      </div>
    </div>
    <div class="feed-grid" id="feed-grid"></div>
  </section>
`;

const RAIL = String.raw`
  <div class="app-auto-rail"></div>`;

// ---- 注入的运行时脚本（demo 社区数据 + 渲染 + 交互）----
const HOME_JS = String.raw`<script>
/* =====================================================================
   DEMO COMMUNITY DATA —— 演示数据，不是真实用户、不是真实统计。
   作用：展示「兴趣社区」这一层的产品形态。
   其中「地点 / 来源 / 置信度」仍然使用真实的 PLACES 数据（卡片可点开抽屉）。
   ===================================================================== */
window.DEMO_COMMUNITY = {
  interests: [
    { id:"cortis", emoji:"🎤", name:"CORTIS × Seoul", members:"12.8K", vertical:"cortis",
      zh:"发现与 CORTIS 相关的首尔地点，和同好一起探索。", en:"CORTIS-related places in Seoul, discovered together." },
    { id:"film", emoji:"🎬", name:"Film & TV", members:"8.4K", vertical:null,
      zh:"影视取景地同好圈，交换真实拍摄地点。", en:"Film & TV location hunters swapping real spots." },
    { id:"art", emoji:"🎨", name:"New York × Art & Culture", members:"9.6K", vertical:"nyc",
      zh:"美术馆、画廊与城市的艺术现场。", en:"Museums, galleries and the city's art scene." },
    { id:"coffee", emoji:"☕", name:"Coffee", members:"7.4K", vertical:null,
      zh:"城市咖啡店清单与探店记录。", en:"City coffee lists and cafe logs." },
    { id:"hiking", emoji:"⛰", name:"Hiking", members:"6.9K", vertical:null,
      zh:"徒步路线、难度与到达方式。", en:"Trails, difficulty and how to get there." }
  ],
  feed: [
    { user:"圈友 · 首尔", interest:"CORTIS × Seoul", placeId:"cortis-004", emoji:"🧿", likes:832, comments:128,
      zh:"分享一下我在首尔找到的 CORTIS 同款手串购买地——资料里写的是奉恩寺，来源是一条粉丝帖子。",
      en:"Sharing the CORTIS bracelet spot I found in Seoul — the source says Bongeunsa, from a fan post." },
    { user:"圈友 · 汉江", interest:"CORTIS × Seoul", placeId:"vs-CNP012993", emoji:"🌃", likes:614, comments:96,
      zh:"晚上去汝矣岛汉江公园看夜景，官方观光点、24 小时开放，适合野餐和骑车。",
      en:"Yeouido Hangang Park at night — an official sightseeing spot, open 24h, good for picnics and cycling." },
    { user:"圈友 · 综艺", interest:"CORTIS × Seoul", placeId:"cortis-003", emoji:"🎡", likes:520, comments:74,
      zh:"团综两天一夜的拍摄地是首尔儿童公园，想去打卡的话可以顺路排半天。",
      en:"The two-day variety shoot location is Seoul Children's Grand Park — easy to slot in for half a day." }
  ],
  trending: [
    { icon:"🔥", zh:"CORTIS 首尔演唱会周边", en:"CORTIS Seoul concert area", views:"12.8K" },
    { icon:"🎨", zh:"纽约必去的 10 个艺术地点", en:"10 art spots in New York", views:"9.6K" },
    { icon:"☕", zh:"城市咖啡店清单", en:"City coffee list", views:"7.4K" },
    { icon:"🎬", zh:"影视取景地", en:"Film & TV locations", views:"8.5K" },
    { icon:"⛰", zh:"徒步路线", en:"Hiking routes", views:"6.9K" }
  ]
};
</script>
<script>
(function(){
  var D = window.DEMO_COMMUNITY;
  if (!D || typeof t !== "function") return;

  Object.assign(I18N.zh, {
    hiTitle:"热门兴趣圈子", hiSub:"进入一个兴趣圈子，和同好一起发现真实地点。",
    hfTitle:"兴趣社区 · 最新动态", hfSub:"圈友分享的地点，都连着真实的来源与核验状态。",
    demoTag:"演示数据", demoTag2:"演示数据",
    railTitle:"今日热门", railJoin:"加入兴趣社区",
    railJoinBody:"和同好一起发现更多真实地点，让你的兴趣延伸到现实世界。", railJoinBtn:"探索兴趣",
    railMap:"发现地图", railMapBtn:"在地图上探索 →",
    sideMine:"我的兴趣", sideJourney:"让兴趣带你去更远的地方。", sideJourneyBtn:"开始你的旅程 →",
    icJoin:"加入", icMembers:"成员", feedLikes:"赞", feedComments:"评论", feedShare:"分享",
    interestSoon:"这个兴趣圈子还在建设中。"
  });
  Object.assign(I18N.en, {
    hiTitle:"Trending interests", hiSub:"Join an interest circle and discover real places with like-minded people.",
    hfTitle:"Community feed", hfSub:"Every shared place links back to a real source and its verification status.",
    demoTag:"Demo data", demoTag2:"Demo data",
    railTitle:"Today's trending", railJoin:"Join the community",
    railJoinBody:"Discover more real places with people who share your interests.", railJoinBtn:"Explore interests",
    railMap:"Discover places", railMapBtn:"Explore on the map →",
    sideMine:"My interests", sideJourney:"Your interests can take you further.", sideJourneyBtn:"Start your journey →",
    icJoin:"Join", icMembers:"members", feedLikes:"likes", feedComments:"comments", feedShare:"Share",
    interestSoon:"This interest circle is still being built."
  });

  function place(id){
    for (var i=0;i<PLACES.length;i++) if (PLACES[i].id===id) return PLACES[i];
    return null;
  }

  function interestCard(it){
    return '<article class="ic-card" data-interest="'+esc(it.id)+'">'
      + '<div class="ic-media">'+it.emoji+'</div>'
      + '<div class="ic-body">'
      +   '<div class="ic-name">'+esc(it.name)+'</div>'
      +   '<div class="ic-meta">'+esc(it.members)+' '+esc(t("icMembers"))+'</div>'
      +   '<div class="ic-desc">'+esc(LANG==="en"?it.en:it.zh)+'</div>'
      +   '<button type="button" class="ic-join" data-interest="'+esc(it.id)+'">'+esc(t("icJoin"))+'</button>'
      + '</div></article>';
  }

  function feedCard(p){
    var pl = place(p.placeId);
    var nm = pl ? (LANG==="en" ? (EN_PLACES[pl.id]||pl.name) : pl.name) : p.placeId;
    var confCls = pl && pl.conf ? pl.conf : "plain";
    var confTxt = !pl ? "" : (!pl.conf ? (LANG==="en"?"official sight":"官方观光点")
      : pl.conf==="high" ? (LANG==="en"?"high confidence":"高置信度")
      : pl.conf==="medium" ? (LANG==="en"?"medium · unverified":"中置信度 · 未核验")
      : (LANG==="en"?"low · unverified":"低置信度 · 未核验"));
    return '<article class="feed-card" data-place="'+esc(p.placeId)+'">'
      + '<div class="feed-head"><div class="feed-av">'+esc(String(p.user).slice(0,1))
      + '</div><div><div class="feed-name">'+esc(p.user)+'</div><div class="feed-time">'+esc(p.interest)+' · '+esc(t("demoTag"))+'</div></div></div>'
      + '<div class="feed-media">'+p.emoji+'</div>'
      + '<p class="feed-text">'+esc(LANG==="en"?p.en:p.zh)+'</p>'
      + '<div class="feed-place"><span class="chip-i">'+esc(nm)+'</span>'
      + (confTxt?'<span class="badge '+confCls+'">'+esc(confTxt)+'</span>':'')+'</div>'
      + '<div class="feed-foot"><span>♡ '+p.likes+'</span><span>💬 '+p.comments+'</span><span>'+esc(t("feedShare"))+'</span></div>'
      + '</article>';
  }

  function railHtml(){
    var items = D.trending.map(function(x){
      return '<div class="rail-item"><div class="ri-ico">'+x.icon+'</div><div><div class="ri-t">'
        + esc(LANG==="en"?x.en:x.zh)+'</div><div class="ri-s">'+esc(x.views)+' '+(LANG==="en"?"viewing":"人在看")+'</div></div></div>';
    }).join("");
    return '<div class="rail-card"><h3>'+esc(t("railTitle"))+'</h3>'+items+'</div>'
      + '<div class="rail-cta"><b>'+esc(t("railJoin"))+'</b><p>'+esc(t("railJoinBody"))
      + '</p><button type="button" data-rail-join>'+esc(t("railJoinBtn"))+'</button></div>'
      + '<div class="rail-card"><h3>'+esc(t("railMap"))+'</h3><div class="rail-map" data-rail-map>'
      + esc(t("railMapBtn"))+'</div></div>';
  }

  function renderHome(){
    var ig = document.getElementById("ic-grid");
    if (ig) ig.innerHTML = D.interests.map(interestCard).join("");
    var fg = document.getElementById("feed-grid");
    if (fg) fg.innerHTML = D.feed.map(feedCard).join("");
    var rail = document.getElementById("rail");
    if (rail) rail.innerHTML = railHtml();

    document.querySelectorAll("[data-home]").forEach(function(el){
      var k = el.getAttribute("data-home");
      if (k && I18N.zh[k] !== undefined) el.textContent = t(k);
    });
    var sjb = document.querySelector("[data-home-btn='journey']");
    if (sjb) sjb.textContent = t("sideJourneyBtn");

    document.querySelectorAll("[data-interest]").forEach(function(el){
      el.addEventListener("click", function(ev){
        ev.preventDefault(); ev.stopPropagation();
        var id = el.getAttribute("data-interest");
        var it = null; for (var i=0;i<D.interests.length;i++) if (D.interests[i].id===id) it = D.interests[i];
        if (!it || !it.vertical) { if (typeof toast==="function") toast(t("interestSoon")); return; }
        setVertical(it.vertical);
        var sec = document.getElementById("create");
        if (sec) sec.scrollIntoView({behavior:"smooth",block:"start"});
        if (typeof startFlow==="function") startFlow();
      });
    });
    document.querySelectorAll("[data-place]").forEach(function(el){
      el.addEventListener("click", function(){
        var id = el.getAttribute("data-place");
        if (typeof openDrawer==="function") openDrawer(id);
      });
    });
    document.querySelectorAll("[data-home-btn='journey'], [data-rail-join]").forEach(function(el){
      el.addEventListener("click", function(){
        var sec = document.getElementById("create");
        if (sec) sec.scrollIntoView({behavior:"smooth",block:"start"});
        if (typeof startFlow==="function") startFlow();
      });
    });
    var rm = document.querySelector("[data-rail-map]");
    if (rm) rm.addEventListener("click", function(){
      var m = document.getElementById("itinerary") || document.getElementById("plan");
      if (m) m.scrollIntoView({behavior:"smooth",block:"start"});
    });
  }

  window.renderHome = renderHome;
  var _sl = setLang;  setLang = function(l){ _sl(l); renderHome(); };
  var _sv = setVertical; setVertical = function(id){ _sv(id); renderHome(); };
  renderHome();
})();
</script>`;

let html = await fs.readFile(PREVIEW, "utf8");
if (html.includes(GUARD)) {
  console.log("已经应用过首页重构（guard 存在），跳过。");
  process.exit(0);
}

function must(hay, needle, label) {
  if (!hay.includes(needle)) throw new Error("找不到锚点：" + label);
}

// 1) 配色向 #5B5FEF 一族靠拢
html = html.replace("--bg:#F5F6FD; --bg-soft:#EEF0FF;", "--bg:#F7F8FC; --bg-soft:#EEF0FF;");
html = html.replace(
  "--brand:#6B5BF6; --brand-2:#8C7CFF; --brand-soft:#EEF0FF; --brand-ink:#4B3FD1;",
  "--brand:#5B5FEF; --brand-2:#8B8FF7; --brand-soft:#EEF0FF; --brand-ink:#4044B8;",
);
html = html.replace(
  "--ink:#171A2E; --ink-2:#3B4060; --muted:#767C99; --muted-2:#9AA0BB;",
  "--ink:#1F2440; --ink-2:#3B4060; --muted:#737A99; --muted-2:#9AA0BB;",
);

// 2) 注入外壳样式
must(html, "<body>\n<header class=\"nav\">", "<body> + header");
html = html.replace(
  "<body>\n<header class=\"nav\">",
  "<body>\n" + GUARD + "\n<style id=\"home-restructure\">" + CSS + "</style>\n<header class=\"nav\">",
);

// 3) Sidebar 追加「我的兴趣 + Journey CTA」
const navRightAnchor = '      <button class="chip-btn" id="lang-toggle">EN</button>\n    </div>\n  </div>\n</header>';
must(html, navRightAnchor, "nav-right/lang-toggle");
html = html.replace(
  navRightAnchor,
  '      <button class="chip-btn" id="lang-toggle">EN</button>\n    </div>\n' + SIDEBAR + '\n  </div>\n</header>',
);

// 4) 包裹主内容：app-content + app-main；并在尾部加右栏
must(html, "</header>\n<main>", "</header> + <main>");
html = html.replace("</header>\n<main>", '</header>\n<div class="app-content">\n<div class="app-main">\n<main>');

const tailAnchor = '  </div>\n</section>\n<div class="drawer-mask" id="drawer-mask"></div>';
must(html, tailAnchor, "about 结束 + drawer-mask");
html = html.replace(
  tailAnchor,
  '  </div>\n</section>\n</div><!-- /app-main -->\n<aside class="rail" id="rail"></aside>\n</div><!-- /app-content -->\n<div class="drawer-mask" id="drawer-mask"></div>',
);

// 5) Hero 之后插入：热门兴趣圈子 + 社区动态
const heroAnchor = "  </section>\n\n  <!-- ===== Featured trips ===== -->";
must(html, heroAnchor, "hero 结束 + Featured trips");
html = html.replace(heroAnchor, "  </section>\n" + SECTIONS + "\n  <!-- ===== Featured trips ===== -->");

// 6) 运行时脚本
must(html, "<!-- <<< QA_JS -->\n</body>", "QA_JS 结束");
html = html.replace("<!-- <<< QA_JS -->\n</body>", "<!-- <<< QA_JS -->\n" + HOME_JS + "\n</body>");

await fs.writeFile(PREVIEW, html, "utf8");

const kb = (Buffer.byteLength(CSS + SIDEBAR + SECTIONS + HOME_JS, "utf8") / 1024).toFixed(1);
console.log(`首页重构已应用（+${kb} KB）→ ${path.relative(ROOT, PREVIEW)}`);
console.log("变动：左 Sidebar / Hero 蓝紫渐变 / 热门兴趣圈子 / 社区动态 / 右栏（今日热门·加入社区·发现地图）");
