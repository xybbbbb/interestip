/* ===== Interest Hub 运行时 =====
   依赖首页脚本暴露的全局：DEMO_COMMUNITY / I18N / t / esc / LANG / state / PLACES /
   EN_PLACES / TYPE_EMOJI / CONTRIB / cityCenter / setVertical / openDrawer / toast /
   renderHome / startFlow / renderContrib。 */
(function(){
  var D = window.DEMO_COMMUNITY;
  if (!D || typeof t !== "function") return;

  /* ---------- 收藏（想去）：独立于“加入行程” ---------- */
  if (!state.saved) state.saved = new Set();
  var SAVED_KEY = "interestip.saved.v1";
  var savedMeta = {};
  try {
    var rawSaved = localStorage.getItem(SAVED_KEY);
    if (rawSaved) (JSON.parse(rawSaved)||[]).forEach(function(x){ if(x&&x.id){ state.saved.add(x.id); savedMeta[x.id]=x; } });
  } catch(e0) {}
  function persistSaved(){
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(Array.from(state.saved).map(function(id){ return savedMeta[id]||{id:id,name:id}; })));
    } catch(e1) {}
  }
  function pById(id){ for (var i=0;i<PLACES.length;i++) if (PLACES[i].id===id) return PLACES[i]; return null; }
  function metaOf(p){
    var ev = (p.evidence && p.evidence[0]) || null;
    return { id:p.id, name:p.name, nameEn:(EN_PLACES[p.id]||null), type:p.type||"", district:p.district||"",
      conf:p.conf||null, pool:p.pool||"", lat:p.lat, lng:p.lng,
      url:(ev&&ev.url)||p.source||p.officialUrl||"", label:(ev&&ev.srcType)||(p.pool==="fan"?"community":"official") };
  }

  var TYPES = {
    discussion:{zh:"讨论",en:"Discussion"}, discovery:{zh:"地点发现",en:"Place find"},
    question:{zh:"问题",en:"Question"}, route:{zh:"路线分享",en:"Route"},
    experience:{zh:"体验",en:"Experience"}, newplace:{zh:"新地点",en:"New place"}
  };
  var TABS = [
    {k:"feed",zh:"动态",en:"Feed"}, {k:"places",zh:"地点",en:"Places"},
    {k:"map",zh:"地图",en:"Map"}, {k:"saved",zh:"我的收藏",en:"Saved"}, {k:"journey",zh:"Journey",en:"Journey"}
  ];
  var TXT = {
    back:{zh:"← 返回首页",en:"← Back"},
    members:{zh:"成员",en:"members"}, places:{zh:"地点",en:"places"}, discussions:{zh:"讨论",en:"discussions"},
    joined:{zh:"已加入 ✓",en:"Joined ✓"},
    save:{zh:"♡ 想去",en:"♡ Want to go"}, saved:{zh:"❤️ 想去",en:"❤️ Saved"},
    details:{zh:"详情",en:"Details"}, remove:{zh:"取消收藏",en:"Remove"},
    pending:{zh:"◌ 待核验",en:"◌ Pending"},
    savedTitle:{zh:"我想去的地方",en:"Places I want to go"},
    savedEmpty:{zh:"还没有收藏。去【地点】标签看看，点 ♡ 想去 就会出现在这里。",en:"Nothing saved yet. Open the Places tab and tap ♡ Want to go."},
    toJourney:{zh:"把收藏变成一次旅行 →",en:"Turn saved places into a trip →"},
    journeyTitle:{zh:"把你的兴趣变成一次旅行",en:"Turn your interest into a trip"},
    journeySub:{zh:"从这个兴趣圈里选择你真正想去的地点，再加入城市景点与个人偏好。",en:"Pick the places you really want from this circle, then add city sights and your preferences."},
    savedCount:{zh:"你收藏了 {n} 个地点",en:"You saved {n} places"},
    addAll:{zh:"全部加入 Journey →",en:"Add all to Journey →"},
    noSavedJourney:{zh:"还没有收藏地点，先去【地点】看看。",en:"No saved places yet — check the Places tab first."},
    goPlaces:{zh:"去【地点】",en:"Go to Places"},
    hubEmptyPlaces:{zh:"这个圈子还没有整理好的地点——你可以在下面投稿一个。",en:"No curated places yet in this circle — submit one below."},
    savedToast:{zh:"已加入我的收藏",en:"Saved"}, unsavedToast:{zh:"已取消收藏",en:"Removed"},
    pendingPlaces:{zh:"待核验投稿",en:"Pending submissions"},
    submitTitle:{zh:"＋ 分享一个新发现",en:"＋ Share a discovery"},
    phTitle:{zh:"标题（例如：某家咖啡馆）",en:"Title (e.g. a cafe)"},
    phSrc:{zh:"来源链接（可选，越具体越可信）",en:"Source link (optional)"},
    phDesc:{zh:"描述你发现了什么",en:"Describe what you found"},
    submitBtn:{zh:"提交（待核验）",en:"Submit (Pending)"},
    submitted:{zh:"已提交，状态：待核验。核验通过后才会进入地点池。",en:"Submitted — status: Pending. It enters the place pool only after verification."},
    needInput:{zh:"请填写标题或描述",en:"Please add a title or description"},
    pendingNote:{zh:"这个地点还未核验，暂不进入地点池。",en:"This place is not verified yet and is not in the place pool."},
    legendVerified:{zh:"已核验",en:"Verified"}, legendPending:{zh:"待核验",en:"Pending"},
    conceptNote:{zh:"社区形态示意 · 内容为演示数据（真实社区需要后端：账号 / 帖子 / 评论 / 图片上传）",
                 en:"Community concept · demo content (a real community needs a backend: accounts, posts, comments, uploads)"}
  };
  function tx(k){ var v=TXT[k]; return v ? (LANG==="en"?v.en:v.zh) : k; }
  function withN(s,n){ return String(s).replace("{n}", n); }
  function typeLabel(ty){ var v=TYPES[ty]; return v ? (LANG==="en"?v.en:v.zh) : ""; }
  function confLabel2(p){
    if (!p.conf) return LANG==="en" ? "official sight" : "官方观光点";
    if (p.conf==="high") return LANG==="en" ? "high confidence" : "高置信度";
    if (p.conf==="medium") return LANG==="en" ? "medium · unverified" : "中置信度 · 未核验";
    return LANG==="en" ? "low · unverified" : "低置信度 · 未核验";
  }

  var HUB = { circle:null, tab:"feed" };
  function interestOf(id){ for (var i=0;i<D.interests.length;i++) if (D.interests[i].id===id) return D.interests[i]; return null; }

  window.enterHub = function(id){
    var it = interestOf(id);
    if (!it){ if (typeof toast==="function") toast(t("interestSoon")); return; }
    HUB.circle = id; window.__circle = id;
    if (it.vertical){ setVertical(it.vertical); }
    var hv = document.getElementById("home-view"), hub = document.getElementById("hub-view");
    if (hv) hv.hidden = true;
    if (hub) hub.hidden = false;
    HUB.tab = "feed";
    renderHub();
    try { window.scrollTo({top:0,behavior:"smooth"}); } catch(e2) {}
  };
  window.exitHub = function(){
    var hv = document.getElementById("home-view"), hub = document.getElementById("hub-view");
    if (window.__hubMap){ try{ window.__hubMap.remove(); }catch(e3){} window.__hubMap = null; }
    if (hub) hub.hidden = true;
    if (hv) hv.hidden = false;
    HUB.circle = null;
    if (typeof renderHome==="function") renderHome();
    try { window.scrollTo({top:0,behavior:"smooth"}); } catch(e4) {}
  };
  window.openHubTab = function(k){ HUB.tab = k; renderHub(); };

  function renderHub(){
    var it = interestOf(HUB.circle); var hub = document.getElementById("hub-view");
    if (!it || !hub) return;
    var posts = (D.feedByCircle && D.feedByCircle[HUB.circle]) || [];
    hub.innerHTML =
      '<div class="hub-head">'
      + '<div class="hub-head-top"><button type="button" class="hub-back" data-hub-back>'+esc(tx("back"))+'</button>'
      + '<span class="hub-joined">'+esc(tx("joined"))+'</span></div>'
      + '<h1 class="hub-title">'+esc(it.name)+'</h1>'
      + '<p class="hub-tag">'+esc(LANG==="en"?it.en:it.zh)+'</p>'
      + '<div class="hub-stats"><span><b>'+esc(it.members)+'</b> '+esc(tx("members"))+'</span>'
      + '<span><b>'+PLACES.length+'</b> '+esc(tx("places"))+'</span>'
      + '<span><b>'+posts.length+'</b> '+esc(tx("discussions"))+'</span>'
      + '<span class="demo-tag">'+esc(t("demoTag"))+'</span></div>'
      + '</div>'
      + '<div class="hub-tabs" id="hub-tabs"></div>'
      + '<div class="hub-panel" id="hub-panel"></div>';
    hub.querySelector("[data-hub-back]").addEventListener("click", window.exitHub);
    renderTabs(); renderPanel(); renderHubRail();
  }
  /* Hub 里的右栏：这个圈子的信息，而不是首页的今日热门 */
  function renderHubRail(){
    var rail = document.getElementById("rail"); if (!rail) return;
    var it = interestOf(HUB.circle); if (!it) return;
    var posts = (D.feedByCircle && D.feedByCircle[HUB.circle]) || [];
    var top = PLACES.slice(0, 5);
    var S = function(zh, en){ return LANG==="en" ? en : zh; };
    rail.innerHTML =
      '<div class="rail-card"><h3>'+esc(S("圈子概览","Circle overview"))+'</h3>'
      + '<div class="hub-rail-stats"><span><b>'+esc(it.members)+'</b> '+esc(tx("members"))+'</span>'
      + '<span><b>'+PLACES.length+'</b> '+esc(tx("places"))+'</span>'
      + '<span><b>'+posts.length+'</b> '+esc(tx("discussions"))+'</span>'
      + '<span class="demo-tag">'+esc(t("demoTag"))+'</span></div>'
      + '<p class="hub-rail-note">'+esc(LANG==="en"?it.en:it.zh)+'</p></div>'
      + '<div class="rail-card"><h3>'+esc(S("热门地点","Top places"))+'</h3>'
      + top.map(function(p){
          var emoji = (typeof TYPE_EMOJI!=="undefined" && TYPE_EMOJI[p.type]) || "📍";
          return '<div class="rail-item" data-rail-place="'+esc(p.id)+'"><div class="ri-ico">'+emoji+'</div>'
            + '<div><div class="ri-t">'+esc(LANG==="en"?(EN_PLACES[p.id]||p.name):p.name)+'</div>'
            + '<div class="ri-s">'+esc(p.district||"")+'</div></div></div>';
        }).join("")
      + '</div>'
      + '<div class="rail-card"><h3>'+esc(S("快捷入口","Quick links"))+'</h3>'
      + '<div class="rail-link" data-rail-goto="map">'+esc(S("圈子地图 →","Circle map →"))+'</div>'
      + '<div class="rail-link" data-rail-goto="saved">'+esc(S("我的收藏（"+state.saved.size+"）→","My saved ("+state.saved.size+") →"))+'</div>'
      + '<div class="rail-link" data-rail-goto="journey">'+esc(S("规划一次行程 →","Plan a Journey →"))+'</div></div>';
    rail.querySelectorAll("[data-rail-place]").forEach(function(el){
      el.addEventListener("click", function(){ openPlace(el.getAttribute("data-rail-place")); });
    });
    rail.querySelectorAll("[data-rail-goto]").forEach(function(el){
      el.addEventListener("click", function(){
        HUB.tab = el.getAttribute("data-rail-goto");
        renderTabs(); renderPanel(); renderHubRail();
      });
    });
  }
  function renderTabs(){
    var el = document.getElementById("hub-tabs"); if (!el) return;
    el.innerHTML = TABS.map(function(x){
      return '<button type="button" class="hub-tab'+(HUB.tab===x.k?" on":"")+'" data-hub-tab="'+x.k+'">'+esc(LANG==="en"?x.en:x.zh)+'</button>';
    }).join("");
    el.querySelectorAll("[data-hub-tab]").forEach(function(b){
      b.addEventListener("click", function(){ HUB.tab = b.getAttribute("data-hub-tab"); renderTabs(); renderPanel(); });
    });
  }
  function renderPanel(){
    var p = document.getElementById("hub-panel"); if (!p) return;
    if (window.__hubMap && HUB.tab!=="map"){ try{ window.__hubMap.remove(); }catch(e5){} window.__hubMap = null; }
    if (HUB.tab==="feed") p.innerHTML = panelFeed();
    else if (HUB.tab==="places") p.innerHTML = panelPlaces();
    else if (HUB.tab==="map"){ p.innerHTML = panelMap(); initHubMap(); }
    else if (HUB.tab==="saved") p.innerHTML = panelSaved();
    else p.innerHTML = panelJourney();
    bindPanel();
  }

  function hubPostCard(x){
    var pl = x.placeId ? pById(x.placeId) : null;
    var media = (pl && typeof placeMediaHtml==="function")
      ? placeMediaHtml(pl, "wf-media")
      : '<div class="wf-media">'+(x.emoji||"📌")+'</div>';
    var tags = (LANG==="en" ? x.tagsEn : x.tags) || [];
    var on = x.placeId && state.saved.has(x.placeId);
    var nm = pl ? (LANG==="en" ? (EN_PLACES[pl.id]||pl.name) : pl.name) : "";
    return '<article class="wf-card"'+(x.placeId?' data-place="'+esc(x.placeId)+'"':'')+'>'
      + media
      + '<div class="wf-body">'
      + '<div class="wf-title">'+esc(LANG==="en"?(x.tEn||x.en):(x.tZh||x.zh))+'</div>'
      + '<p class="wf-text">'+esc(LANG==="en"?x.en:x.zh)+'</p>'
      + '<div class="wf-tags">'
      + (typeLabel(x.type) ? '<span class="wf-type">'+esc(typeLabel(x.type))+'</span>' : '')
      + tags.map(function(tg){ return '<span class="wf-tag">#'+esc(tg)+'</span>'; }).join("")
      + '</div>'
      + '<div class="wf-foot"><span class="wf-user">'+esc(LANG==="en"?x.userEn:x.user)+'</span>'
      + (x.placeId ? '<button type="button" class="hub-save'+(on?" on":"")+'" data-save="'+esc(x.placeId)+'">'+esc(on?tx("saved"):tx("save"))+'</button>' : '')
      + '</div>'
      + (nm ? '<div class="wf-place">📍 '+esc(nm)+'</div>' : '')
      + '</div></article>';
  }
  function panelFeed(){
    var posts = (D.feedByCircle && D.feedByCircle[HUB.circle]) || [];
    if (!posts.length) return '<div class="feed-empty">'+esc(t("feedEmpty"))+'</div>';
    return '<div class="wf-note">'+esc(tx("conceptNote"))+'</div>'
      + '<div class="wf">' + posts.map(hubPostCard).join("") + '</div>';
  }
  function placeCardHub(p){
    var nm = LANG==="en" ? (EN_PLACES[p.id]||p.name) : p.name;
    var on = state.saved.has(p.id);
    var media = (typeof placeMediaHtml==="function")
      ? placeMediaHtml(p, "hplace-media")
      : '<div class="hplace-media">'+(((typeof TYPE_EMOJI!=="undefined" && TYPE_EMOJI[p.type]) || "📍"))+'</div>';
    return '<article class="hplace">' + media
      + '<div class="hplace-body"><div class="hplace-name">'+esc(nm)+'</div>'
      + '<div class="hplace-meta">'+esc(p.district||"")+' · '+esc(confLabel2(p))+'</div>'
      + '<div class="hplace-foot"><button type="button" class="hub-save'+(on?" on":"")+'" data-save="'+esc(p.id)+'">'+esc(on?tx("saved"):tx("save"))+'</button>'
      + '<button type="button" class="hub-mini" data-open="'+esc(p.id)+'">'+esc(tx("details"))+'</button></div></div></article>';
  }
  function pendingCard(s){
    return '<article class="hplace pending"><div class="hplace-media">📥</div>'
      + '<div class="hplace-body"><div class="hplace-name">'+esc(s.name)+'</div>'
      + '<div class="hplace-meta">'+esc(tx("pending"))+' · '+esc(s.district||"")+'</div>'
      + '<div class="hplace-foot"><button type="button" class="hub-mini" data-open="'+esc(s.id)+'">'+esc(tx("details"))+'</button></div></div></article>';
  }
  function pendings(){ return ((typeof CONTRIB!=="undefined"?CONTRIB:[])||[]).filter(function(s){ return s.verticalId===state.vertical && s.status==="pending"; }); }
  function panelPlaces(){
    var cards = PLACES.length ? PLACES.map(placeCardHub).join("") : '<div class="feed-empty">'+esc(tx("hubEmptyPlaces"))+'</div>';
    var pend = pendings();
    var pendHtml = pend.length ? ('<h3 class="hub-sub">'+esc(tx("pendingPlaces"))+'</h3><div class="hub-places">'+pend.map(pendingCard).join("")+'</div>') : "";
    return '<div class="hub-places">'+cards+'</div>' + pendHtml + submitForm();
  }
  function submitForm(){
    return '<div class="hub-submit"><h3 class="hub-sub">'+esc(tx("submitTitle"))+'</h3>'
      + '<input id="hub-sub-title" type="text" placeholder="'+esc(tx("phTitle"))+'"/>'
      + '<input id="hub-sub-src" type="text" placeholder="'+esc(tx("phSrc"))+'"/>'
      + '<textarea id="hub-sub-desc" rows="2" placeholder="'+esc(tx("phDesc"))+'"></textarea>'
      + '<button type="button" class="primary-btn" data-hub-submit>'+esc(tx("submitBtn"))+'</button></div>';
  }
  function panelMap(){
    return '<div class="hub-mapwrap"><div class="hub-map" id="hub-map"></div>'
      + '<div class="hub-maplegend"><span class="lg-verified">'+esc(tx("legendVerified"))+'</span>'
      + '<span class="lg-pending">'+esc(tx("legendPending"))+'</span></div></div>';
  }
  function panelSaved(){
    var ids = Array.from(state.saved);
    if (!ids.length) return '<div class="feed-empty">'+esc(tx("savedEmpty"))+'</div>';
    var rows = ids.map(function(id){
      var m = savedMeta[id] || {id:id,name:id,district:""};
      var nm = LANG==="en" ? (m.nameEn||m.name) : m.name;
      return '<div class="saved-row"><div><div class="saved-name">❤️ '+esc(nm)+'</div>'
        + '<div class="saved-meta">'+esc(m.district||"")+'</div></div>'
        + '<div class="saved-actions"><button type="button" class="hub-mini" data-open="'+esc(id)+'">'+esc(tx("details"))+'</button>'
        + '<button type="button" class="hub-mini" data-unsave="'+esc(id)+'">'+esc(tx("remove"))+'</button></div></div>';
    }).join("");
    return '<h3 class="hub-sub">'+esc(tx("savedTitle"))+'</h3><div class="saved-list">'+rows+'</div>'
      + '<button type="button" class="primary-btn hub-cta" data-go-journey>'+esc(tx("toJourney"))+'</button>';
  }
  function panelJourney(){
    var ids = Array.from(state.saved);
    var chips = ids.map(function(id){ var m=savedMeta[id]||{id:id,name:id}; return '<span class="chip-i">'+esc(LANG==="en"?(m.nameEn||m.name):m.name)+'</span>'; }).join("");
    return '<div class="journey-gate"><h2>'+esc(tx("journeyTitle"))+'</h2><p>'+esc(tx("journeySub"))+'</p>'
      + (ids.length
        ? ('<div class="journey-saved"><b>'+esc(withN(tx("savedCount"), ids.length))+'</b><div class="chips">'+chips+'</div>'
           + '<button type="button" class="primary-btn hub-cta" data-add-all>'+esc(tx("addAll"))+'</button></div>')
        : ('<div class="feed-empty" style="margin-top:12px">'+esc(tx("noSavedJourney"))+'</div>'
           + '<button type="button" class="ghost-btn hub-cta" data-goto-places>'+esc(tx("goPlaces"))+'</button>'))
      + '</div>';
  }

  function toggleSave(id){
    if (state.saved.has(id)){ state.saved.delete(id); delete savedMeta[id]; if (typeof toast==="function") toast(tx("unsavedToast")); }
    else { state.saved.add(id); var p=pById(id); if (p) savedMeta[id]=metaOf(p); if (typeof toast==="function") toast(tx("savedToast")); }
    persistSaved();
    var hub = document.getElementById("hub-view");
    if (hub && !hub.hidden) renderPanel(); else if (typeof renderHome==="function") renderHome();
  }
  function openPlace(id){
    if (pById(id)){ if (typeof openDrawer==="function") openDrawer(id); }
    else if (typeof toast==="function") toast(tx("pendingNote"));
  }
  /* 进入规划流程时，先放一条“你从哪个圈子、带了多少收藏过来”的过渡横幅 */
  function showJourneyBanner(circleId){
    var pools = document.getElementById("pools"); if (!pools) return;
    var old = document.getElementById("journey-banner"); if (old && old.parentNode) old.parentNode.removeChild(old);
    var it = interestOf(circleId) || interestOf(window.__circle);
    var n = state.saved.size;
    var el = document.createElement("div");
    el.id = "journey-banner"; el.className = "journey-banner";
    el.innerHTML = '<div><b>'+esc(((it?it.name:"") + " · " + (LANG==="en"?"Journey":"行程")))+'</b>'
      + '<span>'+esc(LANG==="en"
          ? ("You brought " + n + " saved places — added as must-go")
          : ("你带来了 " + n + " 个收藏地点，已设为必去"))+'</span></div>'
      + '<button type="button" data-back-hub>'+esc(LANG==="en"?"Back to circle":"返回圈子")+'</button>';
    pools.insertBefore(el, pools.firstChild);
    var b = el.querySelector("[data-back-hub]");
    if (b) b.addEventListener("click", function(){ window.enterHub(circleId || window.__circle || "cortis"); });
  }
  function addAllToJourney(){
    var circleId = HUB.circle || window.__circle;
    state.saved.forEach(function(id){
      var p = pById(id); if (!p) return;
      if (p.pool==="sight") state.sight.add(id); else { state.fan.add(id); state.must.add(id); }
    });
    window.exitHub();
    showJourneyBanner(circleId);
    if (typeof startFlow==="function") startFlow();
  }
  function doSubmit(){
    var ti=document.getElementById("hub-sub-title"), ds=document.getElementById("hub-sub-desc"), sr=document.getElementById("hub-sub-src");
    var title=(ti&&ti.value||"").trim(), desc=(ds&&ds.value||"").trim(), src=(sr&&sr.value||"").trim();
    if (!title && !desc){ if (typeof toast==="function") toast(tx("needInput")); return; }
    var name = title || desc.slice(0,24);
    var c = (typeof cityCenter==="function") ? cityCenter() : {lat:37.5665,lng:126.978};
    CONTRIB.push({ id:"sub-"+Date.now()+"-"+Math.random().toString(36).slice(2,7), verticalId:state.vertical,
      name:name, nameLocal:"", type:"photo_spot", pool:"fan", district:(LANG==="en"?"City centre":"市中心"),
      lat:c.lat, lng:c.lng, hours:"待核验", conf:"low", why:desc, note:desc,
      evidence:[{ srcType:"community", src:src||"community submission", claim:desc||name,
        date:new Date().toISOString().slice(0,10), url:src||"", summary:desc, conf:"low" }],
      status:"pending", reviewedAt:null });
    if (typeof renderContrib==="function"){ try{ renderContrib(); }catch(e6){} }
    if (typeof toast==="function") toast(tx("submitted"));
    renderPanel();
  }
  function bindPanel(){
    var p = document.getElementById("hub-panel"); if (!p) return;
    p.querySelectorAll("[data-save]").forEach(function(b){ b.addEventListener("click", function(ev){ ev.stopPropagation(); toggleSave(b.getAttribute("data-save")); }); });
    p.querySelectorAll("[data-unsave]").forEach(function(b){ b.addEventListener("click", function(ev){ ev.stopPropagation(); toggleSave(b.getAttribute("data-unsave")); }); });
    p.querySelectorAll("[data-open]").forEach(function(b){ b.addEventListener("click", function(ev){ ev.stopPropagation(); openPlace(b.getAttribute("data-open")); }); });
    p.querySelectorAll("[data-go-journey]").forEach(function(b){ b.addEventListener("click", function(){ HUB.tab="journey"; renderTabs(); renderPanel(); }); });
    p.querySelectorAll("[data-goto-places]").forEach(function(b){ b.addEventListener("click", function(){ HUB.tab="places"; renderTabs(); renderPanel(); }); });
    p.querySelectorAll("[data-add-all]").forEach(function(b){ b.addEventListener("click", addAllToJourney); });
    p.querySelectorAll(".wf-card[data-place]").forEach(function(el){
      el.addEventListener("click", function(){ openPlace(el.getAttribute("data-place")); });
    });
    var sb = p.querySelector("[data-hub-submit]"); if (sb) sb.addEventListener("click", doSubmit);
  }

  function initHubMap(){
    if (typeof L==="undefined" || !L.map) return;
    var el = document.getElementById("hub-map"); if (!el) return;
    if (el.offsetWidth<=0){ el.__tries=(el.__tries||0)+1; if (el.__tries<25) setTimeout(initHubMap, 60); return; }
    if (window.__hubMap){ try{ window.__hubMap.remove(); }catch(e7){} window.__hubMap=null; }
    var nyc = state.vertical==="nyc";
    var m = L.map(el, {zoomControl:true, attributionControl:false, scrollWheelZoom:false})
             .setView(nyc?[40.72,-73.99]:[37.55,126.98], 11);
    var srcs = ["https://tile.openstreetmap.de/{z}/{x}/{y}.png","https://a.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png","https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"];
    var idx=0, errs=0;
    var tl = L.tileLayer(srcs[0], {attribution:"© OpenStreetMap", maxZoom:18}).addTo(m);
    tl.on("tileerror", function(){ errs++; if(errs>=4 && idx<srcs.length-1){ idx++; errs=0; tl.setUrl(srcs[idx]); } });
    var pts=[];
    PLACES.forEach(function(p){
      if (typeof p.lat!=="number" || typeof p.lng!=="number") return;
      pts.push([p.lat,p.lng]);
      L.circleMarker([p.lat,p.lng], {radius:6,color:"#fff",weight:1.5,fillColor:(p.pool==="fan"?"#5B5FEF":"#3D8BFF"),fillOpacity:1})
        .addTo(m).on("click", function(){ openPlace(p.id); });
    });
    pendings().forEach(function(s){
      L.circleMarker([s.lat,s.lng], {radius:6,color:"#C4831A",weight:2,fillColor:"#FDF3E2",fillOpacity:1,dashArray:"3"})
        .addTo(m).on("click", function(){ if (typeof toast==="function") toast(tx("pendingNote")); });
    });
    if (pts.length) m.fitBounds(pts, {padding:[26,26]});
    setTimeout(function(){ try{ m.invalidateSize(); }catch(e8){} }, 60);
    window.__hubMap = m;
  }

  /* 抽屉里也放 ❤️ 想去 */
  if (typeof openDrawer==="function"){
    var _od = openDrawer;
    openDrawer = function(id){
      _od(id);
      var body = document.getElementById("drawer-body"); if (!body) return;
      var p = pById(id); if (!p) return;
      var old = body.querySelector(".drawer-save"); if (old) old.parentNode.removeChild(old);
      var on = state.saved.has(id);
      var wrap = document.createElement("div"); wrap.className = "drawer-save";
      wrap.innerHTML = '<button type="button" class="hub-save'+(on?" on":"")+'" data-dsave="'+esc(id)+'">'+esc(on?tx("saved"):tx("save"))+'</button>';
      body.appendChild(wrap);
      wrap.querySelector("[data-dsave]").addEventListener("click", function(){ toggleSave(id); });
    };
  }

  /* 侧栏导航：接进新的 IA（首页 / 兴趣社区 / 地点探索 / 地图 / 行程规划） */
  Object.assign(I18N.zh, { navCommunity:"兴趣社区", navPlaces:"地点探索", navMap:"地图", navJourney:"行程规划" });
  Object.assign(I18N.en, { navCommunity:"Community", navPlaces:"Places", navMap:"Map", navJourney:"Journey" });
  function renderNavLabels(){
    document.querySelectorAll("header.nav .nav-links a[data-i18n]").forEach(function(a){
      a.textContent = t(a.getAttribute("data-i18n"));
    });
  }
  function routeNav(k){
    if (k === "home"){
      var hubHome = document.getElementById("hub-view");
      if (hubHome && !hubHome.hidden) window.exitHub();
      try { window.scrollTo({top:0,behavior:"smooth"}); } catch(eN) {}
      return;
    }
    var hubEl = document.getElementById("hub-view");
    if (!hubEl || hubEl.hidden) window.enterHub(window.__circle || "cortis");
    HUB.tab = (k === "community") ? "feed" : k;
    renderTabs(); renderPanel(); renderHubRail();
  }
  function bindNav(){
    document.querySelectorAll("header.nav .nav-links a[data-nav]").forEach(function(a){
      if (a.__navBound) return;
      a.__navBound = true;
      a.addEventListener("click", function(ev){ ev.preventDefault(); routeNav(a.getAttribute("data-nav")); });
    });
    renderNavLabels();
  }
  bindNav();
  if (typeof renderHome==="function"){
    var _rh = renderHome;
    renderHome = function(){ _rh(); bindNav(); renderNavLabels(); };
  }

  /* 捕获阶段拦截首页点击：兴趣卡 / 分类 chips → 进 Hub（而不是滚到 feed 或开始规划） */
  document.addEventListener("click", function(ev){
    var target = ev.target;
    if (!target || !target.closest) return;
    var cat = target.closest("#cat-row .cat");
    if (cat){
      ev.preventDefault(); ev.stopPropagation();
      document.querySelectorAll("#cat-row .cat").forEach(function(x){ x.classList.toggle("on", x===cat); });
      if (cat.getAttribute("data-cat")==="fandom"){ window.enterHub("cortis"); }
      else if (typeof toast==="function"){ toast(t("interestSoon")); }
      return;
    }
    var card = target.closest("[data-interest]");
    if (card){
      ev.preventDefault(); ev.stopPropagation();
      window.enterHub(card.getAttribute("data-interest"));
    }
  }, true);
})();
