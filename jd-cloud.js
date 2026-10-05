/* =====================================================================
 * 정도 클라우드 저장 (jd-cloud.js)
 * 각 앱 index.html의 <head> 맨 위에 한 줄만 넣으면,
 * 그 앱이 기기에 저장하던 내용을 Firebase에도 자동으로 저장하고
 * 다른 기기에서 열어도 같은 내용이 나오게 해 준다.
 *
 * 넣는 줄 예)
 * <script src="https://yujongho0714.github.io/cloud/jd-cloud.js" data-app="jumprope" data-keys="jumprope_"></script>
 *
 *  data-app  : 앱 이름(영문). Firebase의 apps/<이름> 칸에 저장된다.
 *              pub_ 로 시작하면 로그인 없이도 저장(아이들 게임용),
 *              그 밖에는 관장님 계정으로 로그인해야 저장·읽기 가능.
 *  data-keys : 이 앱이 쓰는 저장 이름의 앞부분(쉼표로 여러 개).
 *  data-mode : "storage"   → window.storage 방식 앱(출석부·줄넘기 최신판)을 Firebase로 연결
 *              "claude-db" → Claude 아티팩트 db 방식 앱
 *              (없으면)    → localStorage 방식 앱
 *  data-skip : 클라우드에 올리지 않을 저장 이름 앞부분(자동 백업 등)
 *  data-idb  : 사진·영상처럼 IndexedDB에 따로 저장하는 것도 클라우드에 맞추기 ("DB이름/칸;DB이름/칸")
 *              사진은 줄여서 올리고, 영상은 잘게 나눠서 올린다. 다른 기기는 처음 한 번만 받아서 기기에 넣어 둔다.
 *  data-legacy-idb / data-legacy-ls : storage 방식에서 예전 기기 저장소(이름/칸, 앞부분)에서 처음 한 번 옮겨 올 곳
 * ===================================================================== */
(function(){
  "use strict";
  if (window.__jdCloud) return;
  var me = document.currentScript || {};
  var CFG = window.JDC_CONFIG || {};
  function attr(n, d){ var v = me.getAttribute && me.getAttribute("data-" + n); return v != null ? v : (CFG[n] != null ? CFG[n] : d); }

  var APP = String(attr("app", "app")).replace(/[^A-Za-z0-9_-]/g, "_");
  var MODE = attr("mode", "local");
  var KEYS = String(attr("keys", "")).split(",").map(function(s){ return s.trim(); }).filter(Boolean);
  var SKIP = String(attr("skip", "")).split(",").map(function(s){ return s.trim(); }).filter(Boolean);
  var LEG_IDB = String(attr("legacy-idb", "")), LEG_LS = String(attr("legacy-ls", ""));
  var IDBS = String(attr("idb", "")).split(";").map(function(s){ s = s.trim(); var p = s.split("/"); return p.length === 2 ? { db: p[0], st: p[1] } : null; }).filter(Boolean);
  var PUBLIC = APP.indexOf("pub_") === 0;
  var ADMIN = "schp2223@gmail.com";
  var ROOT = "apps/" + APP;
  var FB = {
    apiKey: "AIzaSyBhQaR8YuG4CovQgFBaPKd2nZSO7ZjP0PY",
    authDomain: "taekwondo-wordgame.firebaseapp.com",
    databaseURL: "https://taekwondo-wordgame-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "taekwondo-wordgame",
    appId: "1:376591184218:web:d4a4ee50773e787e300363"
  };
  var SDK = "https://www.gstatic.com/firebasejs/10.12.2/";

  var api = window.__jdCloud = { app: APP, mode: MODE, state: "loading" };
  var fapp = null, db = null, auth = null, user = null, allowed = false;
  var ls = window.localStorage;

  /* ---------- 공통 도구 ---------- */
  function enc(k){ return encodeURIComponent(k).replace(/\./g, "%2E").replace(/\*/g, "%2A"); }
  function dec(k){ try { return decodeURIComponent(k); } catch(e){ return k; } }
  function match(k){
    if (!k || k.indexOf("__jdc") === 0) return false;
    for (var j = 0; j < SKIP.length; j++){ if (k.indexOf(SKIP[j]) === 0) return false; }
    for (var i = 0; i < KEYS.length; i++){ if (k.indexOf(KEYS[i]) === 0) return true; }
    return false;
  }
  function lsGet(k){ try { return ls.getItem(k); } catch(e){ return null; } }
  function lsKeys(){ var a = []; try { for (var i = 0; i < ls.length; i++){ var k = ls.key(i); if (match(k)) a.push(k); } } catch(e){} return a; }
  function timeout(p, ms, failValue){
    return new Promise(function(res, rej){
      var done = false;
      p.then(function(v){ if (!done){ done = true; res(v); } }, function(e){ if (!done){ done = true; rej(e); } });
      setTimeout(function(){ if (!done){ done = true; if (failValue === "__reject") rej(new Error("timeout")); else res(failValue); } }, ms);
    });
  }
  function loadScript(src){
    return new Promise(function(res, rej){ var s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }

  /* ---------- 화면 표시(작은 버튼 + 창) ---------- */
  var ui = {};
  function css(){
    var st = document.createElement("style");
    st.textContent =
      "#jdc-pill{position:fixed;left:10px;bottom:calc(10px + env(safe-area-inset-bottom,0px));z-index:2147483000;display:flex;align-items:center;gap:6px;border:0;border-radius:999px;background:rgba(17,18,22,.82);color:#fff;font:700 12px/1 'Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',sans-serif;padding:7px 11px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.25);transition:transform 120ms ease-out}" +
      "#jdc-pill:active{transform:scale(.94)}" +
      "#jdc-pill i{width:8px;height:8px;border-radius:50%;background:#9aa0ad;display:block}" +
      "#jdc-pill.mini{padding:7px;opacity:.75}#jdc-pill.mini span{display:none}" +
      "#jdc-pill.ok i{background:#3ccf6b}#jdc-pill.warn i{background:#ffbf3c}#jdc-pill.err i{background:#ff5a5a}" +
      "#jdc-panel{position:fixed;left:10px;bottom:calc(52px + env(safe-area-inset-bottom,0px));z-index:2147483001;width:min(330px,calc(100vw - 20px));background:#fff;color:#111216;border-radius:12px;box-shadow:0 12px 36px rgba(0,0,0,.3);padding:16px;font:14px/1.55 'Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',sans-serif}" +
      "#jdc-panel b.t{display:block;font-size:16px;margin-bottom:4px}" +
      "#jdc-panel p{margin:0 0 12px;color:#4b5060;word-break:keep-all}" +
      "#jdc-panel .r{display:flex;flex-wrap:wrap;gap:6px}" +
      "#jdc-panel button{flex:1 1 45%;border:1.5px solid #d9dce5;background:#fff;color:#111216;border-radius:8px;padding:10px 8px;font:700 13px 'Noto Sans KR',sans-serif;cursor:pointer}" +
      "#jdc-panel button.main{background:#d7262b;border-color:#d7262b;color:#fff}" +
      "#jdc-panel button:active{transform:translateY(1px)}" +
      "#jdc-bar{position:fixed;left:50%;top:calc(10px + env(safe-area-inset-top,0px));transform:translateX(-50%);z-index:2147483002;background:#111216;color:#fff;border-radius:10px;padding:10px 14px;font:700 14px 'Noto Sans KR',sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.3);display:flex;gap:10px;align-items:center;max-width:calc(100vw - 20px)}" +
      "#jdc-bar button{border:0;border-radius:6px;background:#ffd65a;color:#111;font:700 13px 'Noto Sans KR',sans-serif;padding:7px 10px;cursor:pointer}" +
      ".jdc-hide{display:none!important}";
    document.head.appendChild(st);
  }
  function buildUI(){
    if (ui.pill) return;
    css();
    ui.pill = document.createElement("button"); ui.pill.id = "jdc-pill"; ui.pill.type = "button";
    ui.pill.innerHTML = "<i></i><span>클라우드 연결 중</span>";
    ui.pill.addEventListener("click", function(){ ui.panel.classList.toggle("jdc-hide"); renderPanel(); });
    ui.panel = document.createElement("div"); ui.panel.id = "jdc-panel"; ui.panel.className = "jdc-hide";
    ui.file = document.createElement("input"); ui.file.type = "file"; ui.file.accept = "application/json,.json"; ui.file.style.display = "none";
    ui.file.addEventListener("change", importBackup);
    document.body.appendChild(ui.pill); document.body.appendChild(ui.panel); document.body.appendChild(ui.file);
    setPill(api.state, api.msg);
  }
  function setPill(state, msg){
    api.state = state; api.msg = msg;
    if (!ui.pill) return;
    ui.pill.className = state === "ok" ? "ok" : state === "warn" ? "warn" : state === "err" ? "err" : "";
    ui.pill.querySelector("span").textContent = msg || "클라우드";
    clearTimeout(setPill.mt); ui.pill.classList.remove("mini");
    if (state !== "warn" || /로그인/.test(msg || "")) setPill.mt = setTimeout(function(){ if (ui.panel.classList.contains("jdc-hide")) ui.pill.classList.add("mini"); }, 6000);
    if (ui.panel && !ui.panel.classList.contains("jdc-hide")) renderPanel();
  }
  function flash(msg){ setPill("ok", msg); clearTimeout(flash.t); flash.t = setTimeout(function(){ if (api.state === "ok") setPill("ok", "클라우드 저장 켜짐"); }, 2200); }
  function renderPanel(){
    var p = ui.panel; p.innerHTML = "";
    var t = document.createElement("b"); t.className = "t"; t.textContent = "클라우드 저장"; p.appendChild(t);
    var d = document.createElement("p");
    if (!db) d.textContent = "인터넷에 연결되지 않았거나 클라우드를 불러오지 못했어요. 이 기기에는 계속 저장돼요.";
    else if (allowed) d.textContent = (user ? user.email + "로 로그인됨. " : "") + "바꾼 내용이 자동으로 저장되고, 다른 기기에서 열어도 그대로 나와요.";
    else d.textContent = "관장님 계정(" + ADMIN + ")으로 로그인하면 이 앱 내용이 클라우드에 저장돼요. 로그인 전에는 이 기기에만 저장돼요.";
    p.appendChild(d);
    var r = document.createElement("div"); r.className = "r"; p.appendChild(r);
    function btn(label, fn, main){ var b = document.createElement("button"); b.type = "button"; b.textContent = label; if (main) b.className = "main"; b.addEventListener("click", fn); r.appendChild(b); }
    if (db && !PUBLIC){ if (user) btn("로그아웃", function(){ auth.signOut().then(function(){ location.reload(); }); }); else btn("관장님 로그인", login, true); }
    if (allowed) btn("지금 저장", function(){ saveNow(true); }, !!user);
    btn("백업 받기", exportBackup);
    if (MODE === "storage") btn("덮어쓰기 전으로", sRestoreSnapshot);
    else if (MODE !== "claude-db") btn("덮어쓰기 전으로", restoreSnapshot);
    btn("백업 불러오기", function(){ ui.file.click(); });
    btn("닫기", function(){ p.classList.add("jdc-hide"); });
  }
  function bar(msg, label, fn){
    var old = document.getElementById("jdc-bar"); if (old) old.remove();
    var b = document.createElement("div"); b.id = "jdc-bar";
    var s = document.createElement("span"); s.textContent = msg; b.appendChild(s);
    if (label){ var x = document.createElement("button"); x.type = "button"; x.textContent = label; x.addEventListener("click", function(){ b.remove(); fn(); }); b.appendChild(x); }
    var c = document.createElement("button"); c.type = "button"; c.textContent = "닫기"; c.style.background = "#444"; c.style.color = "#fff"; c.addEventListener("click", function(){ b.remove(); }); b.appendChild(c);
    document.body.appendChild(b);
  }

  /* ---------- 로그인 ---------- */
  function login(){
    // [2026-10-05] 폰 저장소의 파일(content://, file://)로 연 화면에서는 구글 로그인이 구조적으로 안 돼서
    // 눌러도 아무 반응이 없었음 → 이유를 알려주고, 정식 주소로 바로 열 수 있게 함
    var HOME = "https://yujongho0714.github.io/index3/";
    if (!/^https?:$/.test(location.protocol)){
      bar("이 화면은 폰 파일로 열려 있어서 로그인이 안 돼요. 인터넷 주소로 열어 주세요", "주소로 열기", function(){ location.href = HOME; });
      return;
    }
    if (!auth){ bar("클라우드를 아직 불러오지 못했어요. 잠시 뒤 다시 눌러 주세요"); return; }
    var p = new firebase.auth.GoogleAuthProvider();
    p.setCustomParameters({ prompt: "select_account" });
    function fail(e){
      var c = (e && e.code) || "";
      if (c === "auth/popup-closed-by-user" || c === "auth/cancelled-popup-request") return;
      if (c === "auth/unauthorized-domain") bar("이 주소는 로그인이 허용되지 않았어요 (" + location.host + "). Firebase 승인된 도메인에 추가가 필요해요");
      else if (c === "auth/network-request-failed") bar("인터넷 연결을 확인해 주세요");
      else bar("로그인하지 못했어요" + (c ? " (" + c + ")" : ""));
    }
    auth.signInWithPopup(p).catch(function(e){
      var c = e && e.code;
      if (c === "auth/popup-blocked" || c === "auth/operation-not-supported-in-this-environment"){
        try { return auth.signInWithRedirect(p).catch(fail); } catch(x){ return fail(x); }
      }
      fail(e);
    });
  }

  /* ---------- 다시 불러오기(한 번만) ---------- */
  function reloadOnce(){
    var k = "__jdc_reload_" + APP, last = 0;
    try { last = +sessionStorage.getItem(k) || 0; } catch(e){}
    if (Date.now() - last < 15000) return false;
    try { sessionStorage.setItem(k, String(Date.now())); } catch(e){}
    location.reload(); return true;
  }

  /* =================== 일반 앱: 기기 저장(localStorage) 같이 맞추기 =================== */
  var dirty = {}, syncing = false, pushT = null, lastPush = 0, pulled = false;
  try { dirty = JSON.parse(ls.getItem("__jdc_dirty_" + APP) || "{}") || {}; } catch(e){ dirty = {}; }
  function saveDirty(){ try { Storage.prototype.setItem.call(ls, "__jdc_dirty_" + APP, JSON.stringify(dirty)); } catch(e){} }

  if (MODE !== "claude-db" && KEYS.length){
    var origSet = Storage.prototype.setItem, origRemove = Storage.prototype.removeItem, origClear = Storage.prototype.clear;
    Storage.prototype.setItem = function(k, v){
      origSet.call(this, k, v);
      if (this === ls && !syncing && match(String(k))){ dirty[String(k)] = 1; saveDirty(); schedulePush(); }
    };
    Storage.prototype.removeItem = function(k){
      origRemove.call(this, k);
      if (this === ls && !syncing && match(String(k))){ dirty[String(k)] = 1; saveDirty(); schedulePush(); }
    };
    Storage.prototype.clear = function(){
      if (this === ls && !syncing){ lsKeys().forEach(function(k){ dirty[k] = 1; }); }
      origClear.call(this);
      if (this === ls && !syncing){ saveDirty(); schedulePush(); }
    };
  }
  var localAtStart = (MODE !== "claude-db" && KEYS.length) ? lsKeys().length > 0 : false;
  function schedulePush(){ clearTimeout(pushT); pushT = setTimeout(function(){ saveNow(false); }, 1200); if (allowed) setPill("warn", "저장 중"); }
  function saveNow(manual){
    if (MODE === "storage") return saveNowS(manual);
    if (MODE === "claude-db"){ if (manual) flash("클라우드에 저장되어 있어요"); return Promise.resolve(); }
    if (!db || !allowed){ if (manual) bar("관장님 로그인 후에 클라우드에 저장돼요"); return Promise.resolve(); }
    if (!pulled){ if (manual) bar("클라우드 내용을 먼저 확인하는 중이에요. 잠시 뒤 다시 눌러 주세요"); return Promise.resolve(); }
    var keys = Object.keys(dirty);
    if (manual) lsKeys().forEach(function(k){ if (keys.indexOf(k) < 0) keys.push(k); });
    if (!keys.length){ if (manual) flash("클라우드에 저장됨"); return Promise.resolve(); }
    var up = {};
    keys.forEach(function(k){ var v = lsGet(k); up[ROOT + "/data/" + enc(k)] = v == null ? null : v; });
    up[ROOT + "/updatedAt"] = firebase.database.ServerValue.TIMESTAMP;
    lastPush = Date.now();
    return timeout(db.ref().update(up), 8000, "slow").then(function(r){
      keys.forEach(function(k){ delete dirty[k]; }); saveDirty();
      flash(r === "slow" ? "인터넷이 느려요. 연결되면 저장돼요" : "클라우드에 저장됨");
    }).catch(function(){ setPill("err", "저장 실패. 다시 시도해요"); setTimeout(function(){ saveNow(false); }, 5000); });
  }
  function pullLocal(first){
    return timeout(db.ref(ROOT + "/data").once("value"), 9000, "__reject").then(function(s){
      var remote = s.val();
      if (!remote){
        // 클라우드가 비어 있으면: 이 기기 내용을 처음으로 올린다
        pulled = true;
        lsKeys().forEach(function(k){ dirty[k] = 1; }); saveDirty();
        return saveNow(false).then(function(){ markSynced(); flash("이 기기 내용을 클라우드에 올렸어요"); });
      }
      var synced = false; try { synced = !!ls.getItem("__jdc_synced_" + APP); } catch(e){}
      // 한 번도 맞춘 적 없는 기기는 앱이 막 만든 기본값(dirty)도 클라우드와 비교 대상으로 본다
      var diff = [];
      Object.keys(remote).forEach(function(ek){ var k = dec(ek); if (match(k) && (!synced || !dirty[k]) && lsGet(k) !== remote[ek]) diff.push(k); });
      var hasLocal = localAtStart;
      function applyRemote(){
        snapshot();
        syncing = true;
        try { diff.forEach(function(k){ try { Storage.prototype.setItem.call(ls, k, remote[enc(k)]); } catch(e){} delete dirty[k]; }); } finally { syncing = false; }
        saveDirty(); markSynced(); pulled = true;
      }
      function uploadMissing(){
        lsKeys().forEach(function(k){ if (!(enc(k) in remote)) dirty[k] = 1; }); saveDirty();
        return Object.keys(dirty).length ? saveNow(false) : Promise.resolve();
      }
      if (diff.length && !synced && hasLocal){
        // 이 기기를 처음 연결할 때 내용이 다르면 관장님이 고르게 한다
        setPill("warn", "어느 내용을 쓸지 골라 주세요");
        chooser(function(){ pulled = true; diff.forEach(function(k){ dirty[k] = 1; }); saveDirty(); uploadMissing().then(function(){ markSynced(); flash("이 기기 내용을 클라우드에 올렸어요"); }); },
                function(){ applyRemote(); uploadMissing().then(function(){ location.reload(); }); });
        return;
      }
      if (diff.length) applyRemote(); else { markSynced(); pulled = true; }
      return uploadMissing().then(function(){
        if (diff.length && first){ if (!reloadOnce()) flash("클라우드 내용과 맞췄어요"); }
        else if (diff.length){ bar("다른 기기에서 바뀐 내용을 받았어요", "화면 새로 보기", function(){ location.reload(); }); }
        else setPill("ok", "클라우드 저장 켜짐");
      });
    }).catch(function(){ setPill("err", "클라우드에 연결하지 못했어요"); });
  }
  function markSynced(){ try { Storage.prototype.setItem.call(ls, "__jdc_synced_" + APP, "1"); } catch(e){} }
  function snapshot(){
    var data = {}; lsKeys().forEach(function(k){ data[k] = lsGet(k); });
    try { Storage.prototype.setItem.call(ls, "__jdc_snap_" + APP, JSON.stringify({ at: Date.now(), data: data })); } catch(e){}
  }
  function restoreSnapshot(){
    var s; try { s = JSON.parse(ls.getItem("__jdc_snap_" + APP) || "null"); } catch(e){}
    if (!s || !s.data){ bar("되살릴 이전 내용이 없어요"); return; }
    if (!confirm(new Date(s.at).toLocaleString("ko-KR") + "에 덮어쓰기 전 내용으로 되돌릴까요?")) return;
    Object.keys(s.data).forEach(function(k){ try { ls.setItem(k, s.data[k]); } catch(e){} });
    saveNow(false).then(function(){ location.reload(); });
  }
  function chooser(useLocal, useCloud){
    var old = document.getElementById("jdc-bar"); if (old) old.remove();
    var b = document.createElement("div"); b.id = "jdc-bar"; b.style.flexWrap = "wrap"; b.style.maxWidth = "min(520px,calc(100vw - 20px))";
    var s = document.createElement("span"); s.style.width = "100%";
    s.textContent = "이 기기에 저장된 내용과 클라우드 내용이 달라요. 어느 쪽을 쓸까요? (고르지 않은 쪽은 자동으로 보관돼요)";
    b.appendChild(s);
    var x = document.createElement("button"); x.type = "button"; x.textContent = "이 기기 내용 쓰기"; x.addEventListener("click", function(){ b.remove(); useLocal(); });
    var y = document.createElement("button"); y.type = "button"; y.textContent = "클라우드 내용 쓰기"; y.addEventListener("click", function(){ b.remove(); useCloud(); });
    b.appendChild(x); b.appendChild(y); document.body.appendChild(b);
  }
  function watchLocal(){
    db.ref(ROOT + "/updatedAt").on("value", function(s){
      var t = s.val(); if (!t || Date.now() - lastPush < 6000) return;
      if (watchLocal.first){ watchLocal.first = false; return; }
      pullLocal(false).then(function(){ return xSync(false); });
    });
    watchLocal.first = true;
  }

  /* =================== window.storage 방식 앱 (출석부·줄넘기 최신판) =================== */
  var S = { db: null, mem: {}, dirty: {}, pulled: false, localAtStart: false, firstPull: null };
  function idbReq(r){ return new Promise(function(res){ r.onsuccess = function(){ res(r.result); }; r.onerror = function(){ res(null); }; }); }
  function sOpen(){
    return new Promise(function(res){
      var done = false, fin = function(v){ if (!done){ done = true; res(v); } };
      try {
        var r = indexedDB.open("jdc-" + APP, 1);
        r.onupgradeneeded = function(){ var d = r.result; if (!d.objectStoreNames.contains("kv")) d.createObjectStore("kv"); if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta"); };
        r.onsuccess = function(){ fin(r.result); }; r.onerror = function(){ fin(null); }; r.onblocked = function(){ fin(null); };
        setTimeout(function(){ fin(null); }, 4000);
      } catch(e){ fin(null); }
    });
  }
  function readAll(db, store){
    return new Promise(function(res){
      var out = {};
      try {
        var q = db.transaction(store, "readonly").objectStore(store).openCursor();
        q.onsuccess = function(){ var c = q.result; if (c){ out[c.key] = c.value; c.continue(); } else res(out); };
        q.onerror = function(){ res(out); };
      } catch(e){ res(out); }
    });
  }
  function sWrite(store, k, v){
    if (!S.db){ try { var lk = "__jdcs_" + APP + "_" + store + "_" + k; if (v == null) ls.removeItem(lk); else Storage.prototype.setItem.call(ls, lk, typeof v === "string" ? v : JSON.stringify(v)); } catch(e){} return Promise.resolve(); }
    return new Promise(function(res){
      try {
        var tx = S.db.transaction(store, "readwrite");
        if (v == null) tx.objectStore(store).delete(k); else tx.objectStore(store).put(v, k);
        tx.oncomplete = function(){ res(true); }; tx.onerror = function(){ res(false); }; tx.onabort = function(){ res(false); };
      } catch(e){ res(false); }
    });
  }
  function legacyIdb(){
    if (!LEG_IDB) return Promise.resolve({});
    var p = LEG_IDB.split("/");
    return new Promise(function(res){
      var done = false, fin = function(v){ if (!done){ done = true; res(v); } };
      try {
        var r = indexedDB.open(p[0]);
        r.onupgradeneeded = function(){ try { r.transaction.abort(); } catch(e){} };
        r.onsuccess = function(){ var d = r.result; if (!d.objectStoreNames.contains(p[1])){ d.close(); fin({}); return; } readAll(d, p[1]).then(function(o){ d.close(); fin(o); }); };
        r.onerror = function(){ fin({}); };
        setTimeout(function(){ fin({}); }, 5000);
      } catch(e){ fin({}); }
    });
  }
  function sSaveDirty(){ return sWrite("meta", "dirty", JSON.stringify(S.dirty)); }
  var sInit = (MODE === "storage") ? (function(){
    return sOpen().then(function(d){
      S.db = d;
      if (!d){ // IndexedDB를 못 쓰면 localStorage에 보관
        var pre = "__jdcs_" + APP + "_kv_";
        try { for (var i = 0; i < ls.length; i++){ var k = ls.key(i); if (k && k.indexOf(pre) === 0) S.mem[k.slice(pre.length)] = ls.getItem(k); } } catch(e){}
        return;
      }
      return Promise.all([readAll(d, "kv"), readAll(d, "meta")]).then(function(r){
        S.mem = r[0] || {};
        try { S.dirty = JSON.parse((r[1] || {}).dirty || "{}") || {}; } catch(e){ S.dirty = {}; }
      });
    }).then(function(){
      var mk = "__jdc_mig_" + APP, migrated = false;
      try { migrated = !!ls.getItem(mk); } catch(e){}
      if (migrated) return;
      return legacyIdb().then(function(old){
        var add = {};
        Object.keys(old).forEach(function(k){ if (String(k).indexOf("__") === 0) return; var v = old[k]; if (v == null) return; add[k] = typeof v === "string" ? v : JSON.stringify(v); });
        if (LEG_LS){ try { for (var i = 0; i < ls.length; i++){ var k = ls.key(i); if (k && k.indexOf(LEG_LS) === 0){ var kk = k.slice(LEG_LS.length); if (!(kk in add)) add[kk] = ls.getItem(k); } } } catch(e){} }
        var ps = [];
        Object.keys(add).forEach(function(k){ if (!(k in S.mem)){ S.mem[k] = add[k]; ps.push(sWrite("kv", k, add[k])); } });
        return Promise.all(ps).then(function(){ try { Storage.prototype.setItem.call(ls, mk, String(Date.now())); } catch(e){} });
      });
    }).then(function(){ S.localAtStart = Object.keys(S.mem).length > 0; });
  })() : null;
  function sGate(){
    return sInit.then(function(){ return S.firstPull ? timeout(S.firstPull, 3500, null) : null; });
  }
  if (MODE === "storage"){
    S.firstPull = new Promise(function(res){ S._pullDone = res; });
    window.storage = {
      get: function(k){ return sGate().then(function(){ k = String(k); if (!(k in S.mem)) throw new Error("not found"); return { key: k, value: S.mem[k], shared: false }; }); },
      set: function(k, v){ return sInit.then(function(){ k = String(k); v = String(v); S.mem[k] = v; S.dirty[k] = 1; sSaveDirty(); return sWrite("kv", k, v).then(function(){ schedulePushS(); return { key: k, value: v, shared: false }; }); }); },
      "delete": function(k){ return sInit.then(function(){ k = String(k); delete S.mem[k]; S.dirty[k] = 1; sSaveDirty(); return sWrite("kv", k, null).then(function(){ schedulePushS(); return { key: k, deleted: true, shared: false }; }); }); },
      list: function(prefix){ return sGate().then(function(){ prefix = prefix || ""; return { keys: Object.keys(S.mem).filter(function(k){ return k.indexOf(prefix) === 0; }), prefix: prefix, shared: false }; }); }
    };
  }
  var pushTS = null;
  function schedulePushS(){ clearTimeout(pushTS); pushTS = setTimeout(function(){ saveNowS(false); }, 1200); if (allowed) setPill("warn", "저장 중"); }
  function saveNowS(manual){
    if (!db || !allowed){ if (manual) bar("관장님 로그인 후에 클라우드에 저장돼요"); return Promise.resolve(); }
    if (!S.pulled){ if (manual) bar("클라우드 내용을 먼저 확인하는 중이에요"); return Promise.resolve(); }
    var keys = Object.keys(S.dirty);
    if (manual) Object.keys(S.mem).forEach(function(k){ if (keys.indexOf(k) < 0) keys.push(k); });
    if (!keys.length){ if (manual) flash("클라우드에 저장됨"); return Promise.resolve(); }
    var up = {};
    keys.forEach(function(k){ up[ROOT + "/kv/" + enc(k)] = (k in S.mem) ? S.mem[k] : null; });
    up[ROOT + "/updatedAt"] = firebase.database.ServerValue.TIMESTAMP;
    lastPush = Date.now();
    return timeout(db.ref().update(up), 15000, "slow").then(function(r){
      keys.forEach(function(k){ delete S.dirty[k]; }); sSaveDirty();
      flash(r === "slow" ? "인터넷이 느려요. 연결되면 저장돼요" : "클라우드에 저장됨");
    }).catch(function(){ setPill("err", "저장 실패. 다시 시도해요"); setTimeout(function(){ saveNowS(false); }, 5000); });
  }
  function sSnapshot(){ return sWrite("meta", "snap", JSON.stringify({ at: Date.now(), data: S.mem })); }
  function sRestoreSnapshot(){
    if (!S.db){ bar("되살릴 이전 내용이 없어요"); return; }
    readAll(S.db, "meta").then(function(m){
      var s; try { s = JSON.parse(m.snap || "null"); } catch(e){}
      if (!s || !s.data){ bar("되살릴 이전 내용이 없어요"); return; }
      if (!confirm(new Date(s.at).toLocaleString("ko-KR") + "에 덮어쓰기 전 내용으로 되돌릴까요?")) return;
      var ps = [];
      Object.keys(S.mem).forEach(function(k){ if (!(k in s.data)){ delete S.mem[k]; S.dirty[k] = 1; ps.push(sWrite("kv", k, null)); } });
      Object.keys(s.data).forEach(function(k){ S.mem[k] = s.data[k]; S.dirty[k] = 1; ps.push(sWrite("kv", k, s.data[k])); });
      Promise.all(ps).then(sSaveDirty).then(function(){ return saveNowS(false); }).then(function(){ location.reload(); });
    });
  }
  function pullS(first){
    return timeout(db.ref(ROOT + "/kv").once("value"), 20000, "__reject").then(function(s){
      var remote = s.val() || {};
      var synced = false; try { synced = !!ls.getItem("__jdc_synced_" + APP); } catch(e){}
      var rkeys = Object.keys(remote);
      if (!rkeys.length){
        S.pulled = true;
        Object.keys(S.mem).forEach(function(k){ S.dirty[k] = 1; }); sSaveDirty();
        return saveNowS(false).then(function(){ markSynced(); if (S.localAtStart) flash("이 기기 내용을 클라우드에 올렸어요"); });
      }
      var diff = [];
      rkeys.forEach(function(ek){ var k = dec(ek); if ((!synced || !S.dirty[k]) && S.mem[k] !== remote[ek]) diff.push(k); });
      function applyRemote(){
        return sSnapshot().then(function(){
          var ps = [];
          diff.forEach(function(k){ S.mem[k] = remote[enc(k)]; delete S.dirty[k]; ps.push(sWrite("kv", k, S.mem[k])); });
          return Promise.all(ps);
        }).then(function(){ sSaveDirty(); markSynced(); S.pulled = true; });
      }
      function uploadMissing(){
        Object.keys(S.mem).forEach(function(k){ if (!(enc(k) in remote)) S.dirty[k] = 1; }); sSaveDirty();
        return Object.keys(S.dirty).length ? saveNowS(false) : Promise.resolve();
      }
      if (diff.length && !synced && S.localAtStart){
        setPill("warn", "어느 내용을 쓸지 골라 주세요");
        chooser(function(){ S.pulled = true; diff.forEach(function(k){ S.dirty[k] = 1; }); sSaveDirty(); uploadMissing().then(function(){ markSynced(); flash("이 기기 내용을 클라우드에 올렸어요"); }); },
                function(){ applyRemote().then(uploadMissing).then(function(){ location.reload(); }); });
        return;
      }
      var p = diff.length ? applyRemote() : Promise.resolve().then(function(){ markSynced(); S.pulled = true; });
      return p.then(uploadMissing).then(function(){
        if (diff.length && first){ if (!reloadOnce()) flash("클라우드 내용과 맞췄어요"); }
        else if (diff.length){ bar("다른 기기에서 바뀐 내용을 받았어요", "화면 새로 보기", function(){ location.reload(); }); }
        else setPill("ok", "클라우드 저장 켜짐");
      });
    }).catch(function(){ S.pulled = true; setPill("err", "클라우드에 연결하지 못했어요"); })
      .then(function(){ if (S._pullDone) S._pullDone(); });
  }
  function watchS(){
    var firstEv = true;
    db.ref(ROOT + "/updatedAt").on("value", function(s){
      if (firstEv){ firstEv = false; return; }
      if (!s.val() || Date.now() - lastPush < 6000) return;
      pullS(false);
    });
  }

  /* =================== 사진·영상 (IndexedDB) 같이 맞추기 =================== */
  var X = { syncing: false, pending: {}, timer: null, sig: {}, busy: false, ready: false };
  try { X.sig = JSON.parse(ls.getItem("__jdc_idbsig_" + APP) || "{}") || {}; } catch(e){ X.sig = {}; }
  function xSaveSig(){ try { Storage.prototype.setItem.call(ls, "__jdc_idbsig_" + APP, JSON.stringify(X.sig)); } catch(e){} }
  function xId(db, st, k){ return enc(db) + "/" + enc(st) + "/" + enc(String(k)); }
  function isBlob(v){ return typeof Blob !== "undefined" && v instanceof Blob; }
  function strSig(s){ var hsh = 5381, n = s.length, step = Math.max(1, Math.floor(n / 4000)); for (var i = 0; i < n; i += step){ hsh = ((hsh << 5) + hsh + s.charCodeAt(i)) | 0; } return "s" + n + ":" + hsh; }
  function sigOf(v){ if (v == null) return "x"; if (isBlob(v)) return "b" + v.size + ":" + (v.type || ""); if (typeof v === "string") return strSig(v); try { return strSig(JSON.stringify(v)); } catch(e){ return "?"; } }
  function xWatched(store){ try { var dn = store.transaction.db.name, sn = store.name; for (var i = 0; i < IDBS.length; i++){ if (IDBS[i].db === dn && IDBS[i].st === sn) return IDBS[i]; } } catch(e){} return null; }
  if (IDBS.length && typeof IDBObjectStore !== "undefined"){
    var oPut = IDBObjectStore.prototype.put, oDel = IDBObjectStore.prototype["delete"];
    IDBObjectStore.prototype.put = function(v, k){
      var r = oPut.apply(this, arguments);
      if (!X.syncing){ var w = xWatched(this); if (w){ var key = k !== undefined ? k : (this.keyPath && v ? v[this.keyPath] : undefined); if (key !== undefined){ X.pending[xId(w.db, w.st, key)] = { w: w, k: key, v: v }; xSchedule(); } } }
      return r;
    };
    IDBObjectStore.prototype["delete"] = function(k){
      var r = oDel.apply(this, arguments);
      if (!X.syncing){ var w = xWatched(this); if (w && (typeof k === "string" || typeof k === "number")){ X.pending[xId(w.db, w.st, k)] = { w: w, k: k, v: null, del: true }; xSchedule(); } }
      return r;
    };
  }
  function xSchedule(){ clearTimeout(X.timer); X.timer = setTimeout(xFlush, 1500); }
  function xOpen(w){
    return new Promise(function(res){
      var done = false, fin = function(v){ if (!done){ done = true; res(v); } };
      try {
        var r = indexedDB.open(w.db);
        r.onupgradeneeded = function(){ try { if (!r.result.objectStoreNames.contains(w.st)) r.result.createObjectStore(w.st); } catch(e){} };
        r.onsuccess = function(){ var d = r.result; if (!d.objectStoreNames.contains(w.st)){ d.close(); fin(null); return; } fin(d); };
        r.onerror = function(){ fin(null); }; setTimeout(function(){ fin(null); }, 6000);
      } catch(e){ fin(null); }
    });
  }
  function xPutLocal(w, k, v){
    return xOpen(w).then(function(d){
      if (!d) return false;
      return new Promise(function(res){
        try { X.syncing = true; var tx = d.transaction(w.st, "readwrite"); if (v == null) tx.objectStore(w.st)["delete"](k); else tx.objectStore(w.st).put(v, k); X.syncing = false;
          tx.oncomplete = function(){ d.close(); res(true); }; tx.onerror = function(){ d.close(); res(false); };
        } catch(e){ X.syncing = false; try { d.close(); } catch(_){} res(false); }
      });
    });
  }
  function shrinkImage(s){
    return new Promise(function(res){
      if (typeof s !== "string" || s.indexOf("data:image/") !== 0 || s.length < 350000) { res(s); return; }
      var im = new Image();
      im.onload = function(){ try { var m = 1280, sc = Math.min(1, m / Math.max(im.naturalWidth, im.naturalHeight)); var c = document.createElement("canvas"); c.width = Math.round(im.naturalWidth * sc); c.height = Math.round(im.naturalHeight * sc); c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); var o = c.toDataURL("image/jpeg", 0.8); res(o.length < s.length ? o : s); } catch(e){ res(s); } };
      im.onerror = function(){ res(s); }; im.src = s;
    });
  }
  function blobToData(b){ return new Promise(function(res, rej){ var r = new FileReader(); r.onload = function(){ res(r.result); }; r.onerror = rej; r.readAsDataURL(b); }); }
  function xUpload(id, w, k, v){
    var base = ROOT + "/idb/" + id, sg = sigOf(v);
    if (v == null){
      var up = {}; up[base] = { t: "x", ts: Date.now() }; up[ROOT + "/idbblob/" + id] = null; up[ROOT + "/updatedAt"] = firebase.database.ServerValue.TIMESTAMP;
      lastPush = Date.now(); return db.ref().update(up).then(function(){ X.sig[id] = "x"; xSaveSig(); });
    }
    if (X.sig[id] === sg) return Promise.resolve();
    if (isBlob(v)){
      if (v.size > 60 * 1024 * 1024){ bar("영상이 60MB가 넘어서 클라우드에 올리지 않았어요. 더 짧게 잘라서 넣어 주세요"); return Promise.resolve(); }
      return blobToData(v).then(function(du){
        var CH = 900000, n = Math.ceil(du.length / CH), i = 0;
        var next = function(){
          if (i >= n) return Promise.resolve();
          setPill("warn", "영상 올리는 중 " + Math.round(i / n * 100) + "%");
          return db.ref(ROOT + "/idbblob/" + id + "/c" + i).set(du.slice(i * CH, (i + 1) * CH)).then(function(){ i++; return next(); });
        };
        return db.ref(ROOT + "/idbblob/" + id).remove().then(next).then(function(){
          var up = {}; up[base] = { t: "b", type: v.type || "", name: v.name || "", size: v.size, n: n, sig: sg, ts: Date.now() }; up[ROOT + "/updatedAt"] = firebase.database.ServerValue.TIMESTAMP;
          lastPush = Date.now(); return db.ref().update(up);
        }).then(function(){ X.sig[id] = sg; xSaveSig(); flash("영상을 클라우드에 올렸어요"); });
      });
    }
    return shrinkImage(typeof v === "string" ? v : JSON.stringify(v)).then(function(s){
      var up = {}; up[base] = { t: typeof v === "string" ? "s" : "j", v: s, sig: sg, ts: Date.now() }; up[ROOT + "/updatedAt"] = firebase.database.ServerValue.TIMESTAMP;
      lastPush = Date.now(); return db.ref().update(up).then(function(){ X.sig[id] = sg; xSaveSig(); });
    });
  }
  function xFlush(){
    if (!db || !allowed || !X.ready || X.busy){ if (Object.keys(X.pending).length) X.timer = setTimeout(xFlush, 4000); return; }
    var ids = Object.keys(X.pending); if (!ids.length) return;
    X.busy = true; var jobs = ids.map(function(id){ var p = X.pending[id]; delete X.pending[id]; return function(){ return xUpload(id, p.w, p.k, p.v); }; });
    jobs.reduce(function(pr, fn){ return pr.then(fn); }, Promise.resolve())
      .then(function(){ flash("사진·영상까지 클라우드에 저장됨"); })
      .catch(function(){ setPill("err", "사진·영상 저장 실패. 다시 시도해요"); })
      .then(function(){ X.busy = false; if (Object.keys(X.pending).length) xSchedule(); });
  }
  function xReadAll(w){
    return xOpen(w).then(function(d){
      if (!d) return {};
      return new Promise(function(res){ var out = {}; try { var q = d.transaction(w.st, "readonly").objectStore(w.st).openCursor(); q.onsuccess = function(){ var c = q.result; if (c){ out[c.key] = c.value; c.continue(); } else { d.close(); res(out); } }; q.onerror = function(){ d.close(); res(out); }; } catch(e){ d.close(); res(out); } });
    });
  }
  function xDownloadBlob(id, meta){
    var parts = [], i = 0;
    var next = function(){
      if (i >= meta.n) return Promise.resolve();
      setPill("warn", "영상 받는 중 " + Math.round(i / meta.n * 100) + "%");
      return db.ref(ROOT + "/idbblob/" + id + "/c" + i).once("value").then(function(s){ parts.push(s.val() || ""); i++; return next(); });
    };
    return next().then(function(){ return fetch(parts.join("")); }).then(function(r){ return r.blob(); }).then(function(b){
      try { if (meta.name && typeof File === "function") return new File([b], meta.name, { type: meta.type || b.type }); } catch(e){}
      return b;
    });
  }
  function xSync(first){
    if (!IDBS.length || !db || !allowed) return Promise.resolve(0);
    var changed = 0;
    return IDBS.reduce(function(pr, w){
      return pr.then(function(){
        var pre = enc(w.db) + "/" + enc(w.st);
        return Promise.all([timeout(db.ref(ROOT + "/idb/" + pre).once("value"), 20000, "__reject"), xReadAll(w)]).then(function(r){
          var remote = r[0].val() || {}, local = r[1], jobs = [];
          Object.keys(remote).forEach(function(ek){
            var k = dec(ek), m = remote[ek] || {}, id = pre + "/" + ek, lv = local[k];
            if (m.t === "x"){ if (lv != null){ jobs.push(function(){ return xPutLocal(w, k, null).then(function(){ changed++; X.sig[id] = "x"; }); }); } return; }
            var lsig = lv == null ? null : sigOf(lv);
            if (lsig === m.sig || (lsig && X.sig[id] === lsig && lsig !== m.sig && false)) { X.sig[id] = m.sig; return; }
            if (lv != null && X.sig[id] === lsig){ /* 이 기기에서 바꾸지 않았는데 클라우드가 바뀜 → 받기 */ }
            else if (lv != null && X.sig[id] !== lsig && X.sig[id] !== undefined){ X.pending[id] = { w: w, k: k, v: lv }; return; } // 이 기기에서 새로 바꾼 것 → 올리기
            jobs.push(function(){
              var get = m.t === "b" ? xDownloadBlob(id, m) : Promise.resolve(m.t === "j" ? JSON.parse(m.v) : m.v);
              return get.then(function(v){ return xPutLocal(w, k, v).then(function(ok){ if (ok){ changed++; X.sig[id] = m.sig; } }); });
            });
          });
          Object.keys(local).forEach(function(k){ var id = pre + "/" + enc(String(k)); if (!(enc(String(k)) in remote)) X.pending[id] = { w: w, k: k, v: local[k] }; });
          return jobs.reduce(function(p2, fn){ return p2.then(fn); }, Promise.resolve());
        });
      });
    }, Promise.resolve()).then(function(){
      xSaveSig(); X.ready = true; if (Object.keys(X.pending).length) xSchedule();
      if (changed){ if (first){ if (!reloadOnce()) flash("사진·영상을 받아 왔어요"); } else bar("다른 기기에서 사진·영상을 받았어요", "화면 새로 보기", function(){ location.reload(); }); }
      return changed;
    }).catch(function(){ X.ready = true; setPill("err", "사진·영상을 맞추지 못했어요"); return 0; });
  }

  /* =================== 출석부처럼 db 방식으로 만든 앱 =================== */
  var ready = new Promise(function(res){ api._ready = res; });
  function rtdbStore(){
    function docRef(id){ return db.ref(ROOT + "/kv/" + enc(id)); }
    return {
      collection: function(){
        return {
          doc: function(id){
            return {
              get: function(){
                return timeout(docRef(id).once("value"), 7000, "__reject").then(function(s){
                  var v = s.val();
                  return { exists: v != null, id: id, data: function(){ try { return JSON.parse(v); } catch(e){ return null; } } };
                });
              },
              set: function(obj){
                var up = {}; up[ROOT + "/kv/" + enc(id)] = JSON.stringify(obj); up[ROOT + "/ids/" + enc(id)] = true; up[ROOT + "/updatedAt"] = firebase.database.ServerValue.TIMESTAMP;
                lastPush = Date.now();
                return timeout(db.ref().update(up), 4000, "slow").then(function(r){ flash(r === "slow" ? "인터넷이 느려요. 연결되면 저장돼요" : "클라우드에 저장됨"); });
              },
              delete: function(){
                var up = {}; up[ROOT + "/kv/" + enc(id)] = null; up[ROOT + "/ids/" + enc(id)] = null;
                return timeout(db.ref().update(up), 4000, "slow");
              }
            };
          },
          limit: function(){ return this; },
          get: function(){
            return timeout(db.ref(ROOT + "/ids").once("value"), 7000, "__reject").then(function(s){
              var ids = Object.keys(s.val() || {});
              return { docs: ids.map(function(k){ return { id: dec(k) }; }), size: ids.length };
            });
          }
        };
      }
    };
  }
  if (MODE === "claude-db"){
    window.claude = window.claude || {};
    var prevUse = window.claude.use;
    window.claude.use = function(name){
      if (name !== "db") return prevUse ? prevUse.apply(this, arguments) : Promise.reject(new Error("unsupported"));
      return timeout(ready, 6500, null).then(function(ok){ if (ok) return rtdbStore(); throw new Error("cloud not ready"); });
    };
  }
  function watchDb(){
    db.ref(ROOT + "/updatedAt").on("value", function(s){
      if (watchDb.first){ watchDb.first = false; return; }
      if (!s.val() || Date.now() - lastPush < 6000) return;
      bar("다른 기기에서 출석 내용이 바뀌었어요", "새로 보기", function(){ location.reload(); });
    });
    watchDb.first = true;
  }

  /* =================== 백업 =================== */
  function download(name, text){
    var blob = new Blob([text], { type: "application/json" });
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function(){ URL.revokeObjectURL(a.href); }, 3000);
  }
  function stamp(){ var d = new Date(); function p(n){ return (n < 10 ? "0" : "") + n; } return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "_" + p(d.getHours()) + p(d.getMinutes()); }
  function exportBackup(){
    if (MODE === "claude-db"){
      if (!db || !allowed){ bar("관장님 로그인 후에 백업을 받을 수 있어요"); return; }
      db.ref(ROOT + "/kv").once("value").then(function(s){
        download("정도_" + APP + "_백업_" + stamp() + ".json", JSON.stringify({ app: APP, mode: MODE, at: Date.now(), kv: s.val() || {} }));
        flash("백업 파일을 받았어요");
      });
      return;
    }
    var data = {};
    if (MODE === "storage"){ sInit.then(function(){ download("정도_" + APP + "_백업_" + stamp() + ".json", JSON.stringify({ app: APP, mode: MODE, at: Date.now(), data: S.mem })); flash("백업 파일을 받았어요"); }); return; }
    lsKeys().forEach(function(k){ data[k] = lsGet(k); });
    download("정도_" + APP + "_백업_" + stamp() + ".json", JSON.stringify({ app: APP, mode: MODE, at: Date.now(), data: data }));
    flash("백업 파일을 받았어요");
  }
  function importBackup(){
    var f = ui.file.files && ui.file.files[0]; ui.file.value = ""; if (!f) return;
    var r = new FileReader();
    r.onload = function(){
      var j; try { j = JSON.parse(r.result); } catch(e){ bar("백업 파일을 읽지 못했어요"); return; }
      if (j.app && j.app !== APP && !confirm("다른 앱(" + j.app + ")의 백업이에요. 그래도 불러올까요?")) return;
      if (!confirm("백업 내용으로 덮어쓸까요? 지금 내용은 사라져요.")) return;
      if (MODE === "claude-db"){
        if (!db || !allowed){ bar("관장님 로그인 후에 불러올 수 있어요"); return; }
        var up = {}; Object.keys(j.kv || {}).forEach(function(ek){ up[ROOT + "/kv/" + ek] = j.kv[ek]; up[ROOT + "/ids/" + ek] = true; });
        up[ROOT + "/updatedAt"] = firebase.database.ServerValue.TIMESTAMP;
        db.ref().update(up).then(function(){ location.reload(); });
        return;
      }
      var data = j.data || {};
      if (MODE === "storage"){
        sInit.then(function(){ var ps = []; Object.keys(data).forEach(function(k){ S.mem[k] = String(data[k]); S.dirty[k] = 1; ps.push(sWrite("kv", k, S.mem[k])); }); return Promise.all(ps); })
          .then(sSaveDirty).then(function(){ return saveNowS(false); }).then(function(){ location.reload(); });
        return;
      }
      Object.keys(data).forEach(function(k){ if (!match(k)) return; try { ls.setItem(k, data[k]); } catch(e){} });
      saveNow(false).then(function(){ location.reload(); });
    };
    r.readAsText(f);
  }

  /* =================== 시작 =================== */
  function start(){
    buildUI();
    if (!window.Promise){ setPill("err", "이 브라우저는 클라우드를 못 써요"); return; }
    var hasApp = typeof window.firebase !== "undefined" && typeof window.firebase.initializeApp === "function";
    // 앱이 이미 Firebase를 쓰고 있으면(끝말잇기 대전 등) 같은 버전으로 맞춰서 불러온다
    if (hasApp && window.firebase.SDK_VERSION) SDK = "https://www.gstatic.com/firebasejs/" + window.firebase.SDK_VERSION + "/";
    var p = (hasApp ? Promise.resolve() : loadScript(SDK + "firebase-app-compat.js")).then(function(){
      var need = [];
      if (typeof firebase.auth !== "function") need.push(loadScript(SDK + "firebase-auth-compat.js"));
      if (typeof firebase.database !== "function") need.push(loadScript(SDK + "firebase-database-compat.js"));
      return Promise.all(need);
    });
    p.then(function(){
      try { fapp = firebase.app("jdcloud"); } catch(e){ fapp = firebase.initializeApp(FB, "jdcloud"); }
      db = fapp.database(); auth = fapp.auth();
      auth.onAuthStateChanged(function(u){
        user = u;
        if (u && u.email !== ADMIN){ bar(u.email + " 계정은 관리자 권한이 없어요"); auth.signOut(); return; }
        var was = allowed;
        allowed = PUBLIC || !!(u && u.email === ADMIN);
        api.isAdmin = !!(u && u.email === ADMIN);
        try { window.dispatchEvent(new CustomEvent("jdcloud-auth", { detail: { admin: api.isAdmin } })); } catch(e){}
        if (MODE === "claude-db"){
          if (allowed){ api._ready(true); setPill("ok", "클라우드 저장 켜짐"); if (!was) watchDb(); if (!was && api.started) { if (!reloadOnce()) {} } }
          else { api._ready(false); setPill("warn", "로그인하면 클라우드 저장"); }
          api.started = true;
          return;
        }
        if (!allowed && !PUBLIC){
          var nk = "__jdc_nudge_" + APP, off = false; try { off = !!sessionStorage.getItem(nk); } catch(e){}
          if (!off) setTimeout(function(){ if (allowed) return; bar("관장님 로그인하면 이 기록이 클라우드에 저장돼서 다른 기기에서도 그대로 보여요", "로그인", login); try { sessionStorage.setItem(nk, "1"); } catch(e){} }, 1500);
        }
        if (MODE === "storage"){
          if (allowed){ setPill("warn", "클라우드와 맞추는 중"); sInit.then(function(){ return pullS(true); }).then(function(){ return xSync(true); }); if (!was) watchS(); }
          else { setPill("warn", "로그인하면 클라우드 저장"); if (S._pullDone) S._pullDone(); }
          return;
        }
        if (!KEYS.length){ setPill("err", "저장 이름(data-keys)이 없어요"); return; }
        if (allowed){ setPill("warn", "클라우드와 맞추는 중"); pullLocal(true).then(function(){ return xSync(true); }); if (!was) watchLocal(); }
        else setPill("warn", "로그인하면 클라우드 저장");
      });
    }).catch(function(){
      api._ready(false); if (S._pullDone) S._pullDone();
      setPill("err", "클라우드 연결 안 됨 (기기에만 저장)");
    });
  }
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
  api.saveNow = function(){ return saveNow(true); };
  api.login = login;
})();
