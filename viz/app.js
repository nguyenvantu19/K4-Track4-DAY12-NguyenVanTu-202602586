/* app.js — controls and playback for the Day 12 closed-loop simulator.
   One panel only: pick a planner, a training seed and a scene (lead car brakes, the lab's cut-in, or a real Argoverse log),
   see all five planners side by side, the gap over time, and the release gate of the lab. Models and data come from
   lab_models.js / lab_data.js (scripts/export_viz.py). */
(function () {
  "use strict";
  var S = window.ReplaySim, pose = S.poseAt;
  var DT = S.DT, NF = S.NF;
  var REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var $ = function (id) { return document.getElementById(id); };
  function fmt(x, d) { return (+x).toFixed(d == null ? 1 : d).replace(".", ","); }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  // ================================================================== palette (CSS tokens -> three colours and canvas strings)
  var KEYS = ["sc-bg", "sc-ground", "sc-road", "sc-mark", "sc-walk", "sc-yel", "sc-bldg", "sc-bldg2", "sc-edge", "sc-glass", "sc-tree", "sc-trunk", "sc-sky",
    "sc-gnd-light", "sc-cab", "sc-wheel", "sc-off", "car-1", "car-2", "car-3", "car-4", "car-dark", "bus", "ego", "adv", "ped", "scan", "scan-live", "plan",
    "blue", "teal", "purple", "gold", "green", "grey", "hit", "amber", "ink", "ink-2", "ink-3", "line", "chip", "panel-solid"];
  var CSS = {};
  function readPal() {
    var cs = getComputedStyle(document.documentElement);
    KEYS.forEach(function (key) { CSS[key] = cs.getPropertyValue("--" + key).trim() || "#888"; });
  }
  function applyPal() {
    readPal();
    view.applyPalette(st.t);
    plotDirty = true;
  }
  readPal();

  var stage = $("stage");
  var LOG = S.run({ ego: "human", others: "reactive" });          // the drive we "recorded" on the street
  var ACT = LOG.actors, IDX = {}; ACT.forEach(function (a, i) { IDX[a.id] = i; });
  var wants3D = new URLSearchParams(location.search).get("view") === "3d", view;
  if (wants3D && window.THREE) {
    try {
      view = window.createStreetView(stage, ACT, IDX, CSS, REDUCED);
    } catch (error) {
      console.warn("Không khởi tạo được góc nhìn 3D.", error);
    }
  }
  if (view) {
    $("app").classList.add("view-3d");
    stage.setAttribute("aria-label", "Mô phỏng 3D. Kéo để xoay, cuộn để phóng to.");
    $("viewSwitch").href = location.pathname;
    $("viewSwitch").textContent = "Trở về góc nhìn 2D BEV";
  } else {
    view = window.createBevView(stage, CSS);
    if (wants3D) $("viewSwitch").textContent = "Thử tải lại góc nhìn 3D";
  }
  var CACHE = {};
  function cached(key, fn) { if (!CACHE[key]) CACHE[key] = fn(); return CACHE[key]; }
  // ================================================================== app state
  var st = { ch: 0, t: 0, playing: !REDUCED, speed: 1, labels: true };
  var drive = new window.KeyboardDrive(), manualWorld = null, manualRecord = null, manualAcc = 0;
  st.manual = false;
  // the lab: which planner drives, in which scene
  st.lab = { pl: "labperc", seed: 0, scene: "brake", decel: 6, gap: 10, dv: 11, v0: 14, log: 0, rear: "reactive" };
  var plotDirty = true, lastPlotT = -1;

  // ================================================================== plots (one canvas per chapter, redrawn on change)
  var MONO = "", PB = { cv: null, off: document.createElement("canvas"), A: null, P: null, t: 0, drawn: 0 };
  function plotSetup(cv) {
    var dpr = Math.min(2, window.devicePixelRatio || 1), W = cv.clientWidth || 360, H = Math.round(W * 200 / 380);
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    var g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    return { g: g, W: W, H: H, dpr: dpr, cv: cv };
  }
  function axes(P, x0, x1, y0, y1, xt, yt, xl, yl) {
    var g = P.g, L = 40, Rm = 10, Tm = 10, B = 26, w = P.W - L - Rm, h = P.H - Tm - B;
    var fx = function (x) { return L + (x - x0) / (x1 - x0) * w; }, fy = function (y) { return Tm + (1 - (clamp(y, y0, y1) - y0) / (y1 - y0)) * h; };
    g.font = "600 10px " + (MONO || (MONO = getComputedStyle(document.body).getPropertyValue("--f-mono"))); g.lineWidth = 1;
    g.strokeStyle = CSS.line; g.fillStyle = CSS["ink-3"]; g.textAlign = "right"; g.textBaseline = "middle";
    yt.forEach(function (y) { g.beginPath(); g.moveTo(L, fy(y)); g.lineTo(L + w, fy(y)); g.stroke(); g.fillText(fmt(y, Math.abs(y) < 10 && y % 1 ? 1 : 0), L - 5, fy(y)); });
    g.textAlign = "center"; g.textBaseline = "top";
    xt.forEach(function (x) { g.fillText(fmt(x, 0), fx(x), Tm + h + 4); });
    g.textAlign = "left"; g.fillText(xl, L, Tm + h + 15); g.save(); g.translate(10, Tm + h / 2); g.rotate(-Math.PI / 2); g.textAlign = "center"; g.textBaseline = "top"; g.fillText(yl, 0, -6); g.restore();
    return { fx: fx, fy: fy, L: L, T: Tm, w: w, h: h };
  }
  function series(P, A, xs, ys, color, width, dash, n) {
    var g = P.g; g.strokeStyle = color; g.lineWidth = width || 1.5; g.setLineDash(dash || []); g.beginPath();
    var first = true, m = n == null ? xs.length : n;
    for (var i = 0; i < m; i++) { var y = ys[i]; if (y == null || isNaN(y)) { first = true; continue; } var X = A.fx(xs[i]), Y = A.fy(y); if (first) { g.moveTo(X, Y); first = false; } else g.lineTo(X, Y); }
    g.stroke(); g.setLineDash([]);
  }
  function playhead(P, A, t) { var g = P.g; g.strokeStyle = CSS.ink; g.globalAlpha = 0.5; g.lineWidth = 1; g.beginPath(); g.moveTo(A.fx(t), A.T); g.lineTo(A.fx(t), A.T + A.h); g.stroke(); g.globalAlpha = 1; }
  function xMark(P, A, x, y, color) { var g = P.g, X = A.fx(x), Y = A.fy(y); g.strokeStyle = color; g.lineWidth = 2; g.beginPath(); g.moveTo(X - 4, Y - 4); g.lineTo(X + 4, Y + 4); g.moveTo(X + 4, Y - 4); g.lineTo(X - 4, Y + 4); g.stroke(); }
  var TT = []; for (var tf = 0; tf < NF; tf++) TT.push(tf * DT);
  function colOf(R, i, k) { var out = new Array(R.nf || NF), N = R.N; for (var f = 0; f < out.length; f++) out[f] = R.F[(f * N + i) * 8 + k]; return out; }
  // x–t (space–time) diagram of everyone on the main road
  // ================================================================== chapters
  function seg(id, opts, cur, aria) { return '<div class="seg" id="' + id + '" role="group" aria-label="' + aria + '">' + opts.map(function (o) { return '<button type="button" data-v="' + o[0] + '" aria-pressed="' + (o[0] === cur) + '"' + (o[2] ? " disabled" : "") + ">" + o[1] + "</button>"; }).join("") + "</div>"; }
  // ================================================================== chapter 8 support: the models of the Day 12 lab, driving in this street
  var LD = window.LAB_DATA || null;
  var LABPL = [["labidm", "IDM"], ["labcv", "CV"], ["labego", "EgoMLP"], ["labperc", "PercMLP"], ["labfix", "PercMLP+"]];
  var LABLEARN = { labego: 1, labperc: 1, labfix: 1 };
  var LABCOL = { labidm: "teal", labcv: "ink-3", labego: "purple", labperc: "blue", labfix: "green" };
  var LABSCENE = { brake: "xe dẫn phanh gấp", cutin: "xe cắt vào", log: "log Argoverse thật" };
  var merges = window.MergeScenes;
  merges.forEach(function (scene) { LABSCENE[scene.id] = scene.title.toLowerCase(); });
  var mergeOptions = merges.map(function (scene) { return [scene.id, scene.title]; });
  var passStages = { "ego-right": "Chuyển sang làn phải", "ego-pass": "Vượt xe ở làn phải", "ego-left": "Trở về làn trái", "ego-done": "Đã vượt và về làn trái" };
  var requestedScene = new URLSearchParams(location.search).get("scene");
  st.lab.trajectory = new URLSearchParams(location.search).get("driver") !== "baseline";
  if ((labReady() && Object.prototype.hasOwnProperty.call(LABSCENE, requestedScene)) ||
      merges.some(function (scene) { return scene.id === requestedScene; })) st.lab.scene = requestedScene;
  if (!labReady()) st.lab.pl = "labidm";
  var LAB_T = 14;
  function labSeeds(pl) { return LABLEARN[pl] ? LD.seeds.map(function (_, i) { return i; }) : [0]; }   // one run per training seed for the learned planners
  function labReady() { return !!(LD && S.hasLab()); }
  function streetScenario() { return merges.find(function (scene) { return scene.id === st.lab.scene; }); }
  function usesTrajectory() { return st.lab.trajectory && !!streetScenario(); }
  function currentMerge() { var scene = streetScenario(); return scene && !scene.kind ? scene : null; }
  function isOvertake() { var scene = streetScenario(); return !!(scene && scene.kind === "overtake"); }
  function isJourney() { var scene = streetScenario(); return !!(scene && scene.kind === "journey"); }
  function isStreetDemo() { return isOvertake() || isJourney(); }
  function sceneDuration() { return isJourney() ? streetScenario().duration : LAB_T; }
  function markLabel(mark) {
    return mark.title || passStages[mark.k] || (isJourney() && mark.k === "ped" ? "Người đi bộ qua đường" : "");
  }
  function sceneReady() { return labReady() || !!streetScenario(); }
  function labParams() {
    var s = st.lab, p = { pedT0: 1e9, busGo: 1e9, cutT0: 99, tgMode: s.rear === "replay" ? "const" : "idm", react: s.rear === "reactive" ? 0.6 : 0, tgT: 1.4 }, v0 = 11.2;
    p.labTrajectory = usesTrajectory();
    var merge = currentMerge();
    if (isStreetDemo()) {
      v0 = p.egoV0 = 11;
      var demo = streetScenario();
      p.labOvertake = isJourney() ? demo.overtake : demo;
      if (isJourney()) {
        p.labJourney = demo;
        p.pedT0 = demo.pedestrianAt;
        p.pedGap = null;
        p.pedV = 1.8;
      }
    }
    else if (merge) { v0 = 14; p.egoV0 = v0; p.labMerge = merge; }
    else if (s.scene === "brake") { p.brkDecel = s.decel; p.brkDur = 2.4; }
    else if (s.scene === "cutin") { v0 = s.v0; p.brkT0 = 99; p.egoV0 = v0; p.labCut = { gap: s.gap, dv: Math.min(s.dv, v0 - 0.5) }; }
    else { var L = LD.logs[s.log]; v0 = L.ego[0]; p.brkT0 = 99; p.egoV0 = v0; p.leadProf = L.lead; p.egoProf = L.ego; p.leadGap0 = L.gap0; }
    p.rearGap = 2 + v0 * 1.4;
    return p;
  }
  function labKey() { var s = st.lab; return [s.scene, s.decel, s.gap, s.dv, s.v0, s.log, s.rear, usesTrajectory()].join("|"); }
  var LABORDER = [];
  function labExec(pl, seed, params) {
    var R = S.run({ params: params, ego: params.labTrajectory ? "trajectory" : params.labOvertake ? "overtake" : "planner", planner: pl, policy: { labSeed: LD ? LD.seeds[seed] : undefined }, others: "reactive", tEnd: params.labJourney ? params.labJourney.duration : LAB_T });
    R.m = S.egoMetrics(R, null); return R;
  }
  function labRun(pl, seed, rerun) {
    var key = "lab|" + (isStreetDemo() || usesTrajectory() ? "demo" : pl + "|" + (LABLEARN[pl] ? seed : 0)) + "|" + labKey();
    if (rerun || !CACHE[key]) {
      if (!CACHE[key]) LABORDER.push(key);
      CACHE[key] = labExec(pl, seed, labParams());
      if (LABORDER.length > 90) LABORDER.splice(0, 40).forEach(function (k) { delete CACHE[k]; });     // a run record is ~0.7 MB: keep memory bounded while a slider is dragged
    }
    return CACHE[key];
  }
  function labAllRun() {
    var el = $("labAll"), n = LD.logs.length, i = 0, res = {}, keep = st.lab.scene;
    if (!el) return; var btn = $("bLabAll"); if (btn) btn.disabled = true;
    LABPL.forEach(function (p) { res[p[0]] = labSeeds(p[0]).map(function () { return [0, 0]; }); });
    function one() {
      if (st.ch !== CH.length - 1) return;
      if (i < n) {
        var L = LD.logs[i], saved = st.lab.log, scene = st.lab.scene; st.lab.scene = "log"; st.lab.log = i;
        LABPL.forEach(function (p) { labSeeds(p[0]).forEach(function (sd, k) {
          var o = labOutcome(labExec(p[0], sd, labParams())); if (o.front) { res[p[0]][k][0]++; if (L.brake) res[p[0]][k][1]++; } }); });
        st.lab.log = saved; st.lab.scene = scene; i++;
        el.innerHTML = '<span class="note">đang chạy ' + i + " / " + n + " log…</span>"; setTimeout(one, 0); return;
      }
      var nb = LD.logs.filter(function (l) { return l.brake; }).length;
      el.innerHTML = '<table class="tbl"><tr><th>Bộ điều khiển</th><th>log bị đâm (trên ' + n + ")</th><th>trong số " + nb + " log có phanh</th></tr>" + LABPL.map(function (p) {
        var a = res[p[0]], tot = a.map(function (x) { return x[0]; }), br = a.map(function (x) { return x[1]; }), r = function (v) { var lo = Math.min.apply(null, v), hi = Math.max.apply(null, v); return lo === hi ? lo : lo + " … " + hi; };
        return "<tr><td>" + p[1] + "</td><td" + (Math.max.apply(null, tot) ? ' style="color:var(--hit);font-weight:700"' : "") + ">" + r(tot) + (a.length > 1 ? " (qua 5 seed)" : "") + "</td><td>" + r(br) + "</td></tr>";
      }).join("") + "</table>";
      if (btn) btn.disabled = false;
    }
    setTimeout(one, 20);
  }
  function labOutcome(R) {
    // (only for a REPLAYED rear car) it drives THROUGH the ego after its (fake) hit and then looks like a car ahead: whatever happens after that is not the planner's doing, so only count what happens before it
    var front = false, rear = false, tRear = Infinity, replayed = !!(R.opts && R.opts.params && R.opts.params.tgMode === "const");
    R.m.hits.forEach(function (h) { if ((h.a === "ego" ? h.b : h.a) === "TG") { rear = true; if (replayed) tRear = Math.min(tRear, h.t); } });
    R.m.hits.forEach(function (h) { if ((h.a === "ego" ? h.b : h.a) !== "TG" && h.t < tRear) front = true; });
    var gaps = labFrontGap(R).filter(function (x, f) { return x != null && f * DT < tRear; });
    return { front: front, rear: rear, gap: gaps.length ? Math.min.apply(null, gaps) : null, ttc: R.m.ttcMin, dec: R.m.decMax };
  }
  function labSummary() {
    return cached("labsum|" + labKey(), function () {
      return LABPL.map(function (p) {
        var seeds = labSeeds(p[0]), os = seeds.map(function (sd) { return labOutcome(labRun(p[0], sd)); });
        var gs = os.map(function (o) { return o.gap == null ? 99 : o.gap; });
        return { pl: p[0], name: p[1], n: os.length, front: os.filter(function (o) { return o.front; }).length, rear: os.filter(function (o) { return o.rear; }).length,
                 gmin: Math.min.apply(null, gs), gmax: Math.max.apply(null, gs) };
      });
    });
  }
  function labFrontGap(R) {
    var out = new Array(R.nf || NF), N = R.N;
    for (var f = 0; f < out.length; f++) {
      var ke = f * N * 8, ex = R.F[ke], ez = R.F[ke + 1], hx = R.F[ke + 2], hz = R.F[ke + 3], best = null;
      for (var i = 1; i < N; i++) {
        if (R.actors[i].kind === "ped" || R.actors[i].id === "TG") continue;      // the rear car is not "ahead", even after it drove through us
        var kb = (f * N + i) * 8, rx = R.F[kb] - ex, rz = R.F[kb + 1] - ez, lon = rx * hx + rz * hz, lat = -rx * hz + rz * hx;
        if (lon > 0 && lon < 60 && Math.abs(lat) < 2.0) { var g = lon - R.actors[i].dims.len / 2 - S.CAR.len / 2; if (best == null || g < best) best = g; }
      }
      out[f] = best;
    }
    return out;
  }
  function fmtGap(x) { return x == null ? "–" : x <= 0 ? "đâm" : fmt(x); }
  function labTable() {
    var el = $("labTbl"); if (!el) return; var rows = labSummary();
    var hitLabel = currentMerge() ? "va chạm xe khác" : "đâm xe trước";
    el.innerHTML = "<tr><th>Bộ điều khiển</th><th>" + hitLabel + "</th><th>xe sau đâm ta</th><th>cách xe trước, nhỏ nhất (m)</th></tr>" + rows.map(function (r) {
      var cnt = function (k) { return r.n > 1 ? k + " / " + r.n + " seed" : (k ? "có" : "không"); }, hot = function (k) { return k ? ' style="color:var(--hit);font-weight:700"' : ""; };
      var g = r.n > 1 && Math.abs(r.gmax - r.gmin) > 0.05 ? fmtGap(r.gmin) + " … " + fmtGap(r.gmax) : fmtGap(r.gmin);
      return '<tr' + (r.pl === st.lab.pl ? ' class="sel"' : "") + "><td>" + r.name + "</td><td" + hot(r.front) + ">" + cnt(r.front) + "</td><td" + hot(r.rear) + ">" + cnt(r.rear) + "</td><td>" + g + "</td></tr>";
    }).join("");
  }
  function labRead() {
    var el = $("labRead"); if (!el) return; var s = st.lab, R = labRun(s.pl, s.seed);
    if (isJourney() || usesTrajectory()) {
      el.innerHTML = '<span class="h">' + (usesTrajectory() ? "Kết quả tự lập quỹ đạo" : "Kết quả chuyến lái") + '</span><span>Thời lượng</span><b>' + fmt(sceneDuration()) +
        ' s</b><span>Va chạm liên quan đến xe ta</span><b>' + R.m.hits.length + '</b>';
      return;
    }
    if (isOvertake()) {
      var completed = R.marks.find(function (mark) { return mark.k === "ego-done"; });
      el.innerHTML = '<span class="h">Kết quả lượt mẫu</span><span>Về giữa làn trái</span><b>' +
        (completed ? fmt(completed.t) + " s" : "Chưa hoàn tất") + "</b><span>Va chạm liên quan đến xe ta</span><b>" + R.m.hits.length + "</b>";
      return;
    }
    var o = labOutcome(R), tg = tgGap(R).filter(function (x) { return x != null; });
    var first = R.m.hits[0], res = '<span class="c-green">không va chạm</span>';
    if (first) {
      var actor = R.actors[first.ib];
      var who = actor.id === "TG" ? "xe sau đâm ta" : currentMerge() ? "va chạm với " + actor.name : "ta đâm xe phía trước";
      res = '<span class="c-hit">' + who + " ở " + fmt(first.t) + " s</span>";
    }
    el.innerHTML = '<span class="h">' + S.PLANNERS[s.pl].name + (LABLEARN[s.pl] ? " · seed " + (s.seed + 1) : "") + "</span>" +
      "<span>kết quả</span><b>" + res + "</b><span>cách xe trước, nhỏ nhất</span><b>" + fmtGap(o.gap) + (o.gap != null && o.gap > 0 ? " m" : "") + "</b>" +
      "<span>TTC nhỏ nhất</span><b>" + (o.ttc > 1e8 ? "–" : fmt(o.ttc) + " s") + "</b><span>phanh mạnh nhất</span><b>" + fmt(o.dec) + " m/s²</b>" +
      "<span>cách xe sau, nhỏ nhất</span><b>" + (tg.length ? (Math.min.apply(null, tg) <= 0 ? "đâm" : fmt(Math.min.apply(null, tg)) + " m") : "–") + "</b>";
  }
  var nvidiaReview;
  function createNvidiaReview() {
    var panel = $("nvidiaReviewTemplate").content.firstElementChild.cloneNode(true);
    var videoInput = panel.querySelector("[data-review-video]"), player = panel.querySelector("[data-review-player]");
    var metricsInput = panel.querySelector("[data-review-metrics]"), report = panel.querySelector("[data-review-report]");
    var videoStatus = panel.querySelector("[data-review-status]"), metricsStatus = panel.querySelector("[data-review-metrics-status]");
    var clear = panel.querySelector("[data-review-clear]"), videoUrl = null;
    function removeVideo() {
      if (!videoUrl) return;
      player.removeAttribute("src");
      player.load();
      URL.revokeObjectURL(videoUrl);
      videoUrl = null;
      player.hidden = true;
    }
    videoInput.onchange = function () {
      removeVideo();
      var file = videoInput.files[0];
      if (!file) { videoStatus.textContent = ""; return; }
      clear.hidden = false;
      if (!/\.mp4$/i.test(file.name)) { videoStatus.textContent = "Hãy chọn video MP4 xuất từ AlpaSim."; return; }
      videoUrl = URL.createObjectURL(file);
      player.src = videoUrl;
      player.hidden = false;
      videoStatus.textContent = file.name;
    };
    player.onerror = function () {
      if (videoUrl) videoStatus.textContent = "Trình duyệt không đọc được video. Hãy chọn tệp MP4 hợp lệ.";
    };
    metricsInput.onchange = async function () {
      var file = metricsInput.files[0];
      report.hidden = true;
      report.textContent = "";
      metricsStatus.textContent = "";
      if (!file) return;
      clear.hidden = false;
      if (!/\.txt$/i.test(file.name) || file.size > 2 * 1024 * 1024) {
        metricsStatus.textContent = "Hãy chọn báo cáo TXT có dung lượng tối đa 2 MB.";
        return;
      }
      try {
        var content = await file.text();
        if (metricsInput.files[0] !== file) return;
        report.textContent = content;
        report.hidden = false;
        metricsStatus.textContent = file.name;
      } catch (error) {
        if (metricsInput.files[0] === file) metricsStatus.textContent = "Không đọc được báo cáo.";
      }
    };
    clear.onclick = function () {
      videoInput.value = metricsInput.value = "";
      removeVideo();
      report.textContent = videoStatus.textContent = metricsStatus.textContent = "";
      report.hidden = clear.hidden = true;
    };
    return panel;
  }
  function labInsight() {
    var el = $("labInsight"); if (!el) return;
    if (isJourney()) {
      var R = labRun(st.lab.pl, st.lab.seed);
      var milestones = R.marks.filter(function (mark) { return markLabel(mark); });
      var wasOpen = journeyArchitecture && journeyArchitecture.open;
      el.innerHTML = '<p>' + (usesTrajectory() ? 'Ô tô ưu tiên làn trái, xe máy chen sang làn phải. Xe dự báo chuyển động trong 2,4 giây và chọn lệnh lái. Mũi tên chỉ hiện đoạn quỹ đạo còn trống trước xe. Các mốc thay đổi theo quyết định của xe.' :
        'Chuyến lái mẫu đi qua các tình huống vượt xe, chen làn và nhường đường. Chọn một mốc để xem lại.') + '</p><div class="journey-stages">' +
        milestones.map(function (mark) {
          return '<button type="button" data-jump="' + mark.t + '"><span>' + fmt(mark.t) + ' s</span> ' + markLabel(mark) + '</button>';
        }).join('') + '</div>';
      el.querySelectorAll("[data-jump]").forEach(function (button) {
        button.onclick = function () { jumpTo(Number(button.dataset.jump)); };
      });
      journeyArchitecture = $("journeyArchitectureTemplate").content.firstElementChild.cloneNode(true);
      journeyArchitecture.open = !!wasOpen;
      if (!nvidiaReview) nvidiaReview = createNvidiaReview();
      nvidiaReview.querySelector("[data-review-local]").textContent = "Tham chiếu lab · " + fmt(sceneDuration()) +
        " s · " + R.m.hits.length + " va chạm liên quan đến xe ta.";
      journeyArchitecture.append(nvidiaReview);
      el.prepend(journeyArchitecture);
      architectureAction = journeyArchitecture.querySelector("[data-arch-action]");
      architectureReason = journeyArchitecture.querySelector("[data-arch-reason]");
      architectureState = journeyArchitecture.querySelector("[data-arch-state]");
      architectureFrame = null;
      architectureJumps = journeyArchitecture.querySelectorAll("[data-arch-mark]");
      architectureJumps.forEach(function (button) {
        var key = button.dataset.archMark;
        if (usesTrajectory() && key === "ped-avoid") button.textContent = "Người đi bộ bước xuống đường";
        var mark = milestones.find(function (m) {
          return m.k === key || (usesTrajectory() && key === "ped-avoid" && m.k === "ped-step-out");
        });
        button.hidden = !mark;
        if (mark) button.onclick = function () { jumpTo(mark.t); };
      });
      return;
    }
    journeyArchitecture = null;
    if (isOvertake()) {
      el.textContent = usesTrajectory() ? "Xe tự chọn theo xe dẫn, giảm tốc hoặc đổi làn theo khoảng trống dự báo." :
        "Lượt mẫu chuyển sang làn phải, tăng tốc vượt xe chạy chậm rồi trở về làn trái khi đã tạo đủ khoảng cách.";
      return;
    }
    var merge = currentMerge();
    if (merge) {
      el.innerHTML = "<b>" + merge.title + ".</b> Xe bên cạnh bắt đầu chuyển làn ở " + fmt(merge.start) + " s và vào giữa làn xe ta ở " + fmt(merge.start + merge.duration) + " s." + (merge.brake ? " Sau đó xe phanh " + fmt(merge.brake) + " m/s²." : "") + " Mốc màu xanh trên thanh thời gian đánh dấu lúc bắt đầu và kết thúc chuyển làn.";
      return;
    }
    var s = st.lab, rows = labSummary(), by = {}; rows.forEach(function (r) { by[r.pl] = r; });
    var k = function (p) { return by[p].front + "/" + by[p].n; }, t;
    var n = by.labperc.n;
    if (s.scene === "brake") t = "<b>Xe dẫn phanh " + fmt(s.decel) + " m/s²:</b> EgoMLP đâm " + k("labego") + " seed, PercMLP " + k("labperc") + ", PercMLP+ " + k("labfix") + ", IDM " + k("labidm") + ". EgoMLP chỉ nhìn quá khứ tốc độ của chính nó, không thấy xe dẫn; các bộ còn lại có nhìn xe dẫn. Đổi xe sau sang “phát lại”: xe sau không biết ta vừa phanh nên đâm vào đuôi, một “va chạm giả” (cột “xe sau đâm ta”). Sau cú đâm giả đó, các va chạm về sau không được tính vào cột “đâm xe trước”.";
    else if (s.scene === "cutin") t = "<b>Xe cắt vào:</b> một xe chậm hơn xuất hiện cách " + fmt(s.gap) + " m, tiến gần " + fmt(Math.min(s.dv, s.v0 - 0.5)) + " m/s (họ kịch bản của bài lab: khoảng cách × tốc độ tiến gần). Kết quả trên " + n + " seed: PercMLP đâm " + k("labperc") + ", PercMLP+ đâm " + k("labfix") + ", EgoMLP " + k("labego") + ", IDM " + k("labidm") + ". Log thật không chứa ca nào gắt như vậy; PercMLP+ được huấn luyện thêm trên họ kịch bản này rồi học ở các trạng thái tự đi vào (bước 7).";
    else t = "<b>Log thật #" + LD.logs[s.log].id + ":</b> xe dẫn lái đúng tốc độ của một quỹ đạo Argoverse" + (LD.logs[s.log].brake ? " (có đoạn xe dẫn phanh " + fmt(-LD.logs[s.log].peak_decel) + " m/s²)" : "") + ". Hai giây đầu xe ta lặp lại người lái, rồi bộ điều khiển cầm lái, giống bước 4 của bài lab. Ở log đang chọn: EgoMLP đâm " + k("labego") + " seed, PercMLP " + k("labperc") + ", PercMLP+ " + k("labfix") + ", IDM " + k("labidm") + ". Bấm “Chạy cả log” để thử trên toàn bộ.";
    el.innerHTML = t;
  }
  function labGateTable() {
    var G = LD.gate, names = ["const-vel", "EgoMLP", "PercMLP", "PercMLP+"], rules = Object.keys(G["PercMLP"].rules);
    return '<table class="tbl"><tr><th>Ứng viên</th>' + rules.map(function (r) { return "<th>" + r.split("_")[0] + "</th>"; }).join("") + "<th>Cổng</th></tr>" + names.map(function (n) {
      var d = G[n]; return "<tr><td>" + n + "</td>" + rules.map(function (r) { var ok = d.rules[r].pass; return '<td style="color:var(--' + (ok ? "green" : "hit") + ')" title="' + d.rules[r].detail.replace(/"/g, "'") + '">' + (ok ? "✓" : "✗") + "</td>"; }).join("") +
        '<td style="font-weight:700;color:var(--' + (d.release ? "green" : "hit") + ')">' + (d.release ? "PHÁT HÀNH" : "CHẶN") + "</td></tr>";
    }).join("") + "</table>";
  }
  function labRefresh(restart) {
    var s = st.lab;
    Array.prototype.forEach.call(bodyEl.querySelectorAll("[data-scene]"), function (el) { el.hidden = el.dataset.scene !== s.scene; });
    bodyEl.querySelectorAll("[data-follow-only]").forEach(function (el) { el.hidden = isStreetDemo() || usesTrajectory(); });
    var trajectoryToggle = $("trajectoryToggle");
    trajectoryToggle.hidden = !streetScenario() || st.manual;
    $("runLocalTrial").hidden = trajectoryToggle.hidden;
    trajectoryToggle.setAttribute("aria-pressed", usesTrajectory());
    trajectoryToggle.textContent = usesTrajectory() ? "Tự lập quỹ đạo · đổi sang lượt mẫu" : "Lượt mẫu · bật tự lập quỹ đạo";
    var seedButtons = $("sLabSeed");
    if (seedButtons) Array.prototype.forEach.call(seedButtons.children, function (b) { b.disabled = !LABLEARN[s.pl]; });
    var merge = currentMerge();
    $("mergeLegend").hidden = !merge;
    var viewUrl = new URL(location.pathname, location.origin);
    if (!wants3D || !$("app").classList.contains("view-3d")) viewUrl.searchParams.set("view", "3d");
    if (streetScenario()) viewUrl.searchParams.set("scene", s.scene);
    if (streetScenario() && !usesTrajectory()) viewUrl.searchParams.set("driver", "baseline");
    $("viewSwitch").href = viewUrl;
    if (sceneReady()) { if (!isStreetDemo() && !usesTrajectory()) labTable(); labRead(); labInsight(); }
    timeEl.max = sceneDuration();
    var lg = $("oLabLg"); if (lg) { var L = LD.logs[s.log]; lg.textContent = "#" + L.id + (L.brake ? " · phanh " + fmt(-L.peak_decel) + " m/s²" : " · êm"); }
    if (restart) { st.t = 0; st.playing = !REDUCED; syncPlay(); resetToasts(); }
    plotDirty = true; drawTicks();
  }

  var CH = [
    { key: "lab", short: "8", cam: { dist: 34, yaw: 3.45, pitch: 0.78, lead: 10 }, mode: function () {
      if (usesTrajectory()) return "Driver mô phỏng · tự lập quỹ đạo";
      if (isStreetDemo()) {
        var mark = curRun().marks.filter(function (m) { return m.t <= st.t && markLabel(m); }).pop();
        return mark ? markLabel(mark) : isJourney() ? "Xe ta đang ở làn phải" : "Tiếp cận xe chạy chậm";
      }
      return "Bài lab · " + S.PLANNERS[st.lab.pl].short + " · " + LABSCENE[st.lab.scene];
    },
      html: function () {
        var s = st.lab;
        if (!labReady()) return '<div class="eyebrow">Mô phỏng</div><h2>Chuyển làn và vượt xe</h2>' +
          seg("sLabScene", mergeOptions, s.scene, "Cảnh") + '<div id="labInsight"></div><div class="read" id="labRead"></div>' +
          '<p>Để so thêm các model bài lab, chạy xong các bước 3, 4, 6, 7 rồi chạy <span class="k">python scripts/export_viz.py</span> và tải lại trang.</p>';
        return '<div class="follow-only" data-follow-only><div class="eyebrow">Chương 8 · Bài lab</div><h2>Các model của bài lab lái trong phố này</h2>' +
          '<p>Các model ở đây được huấn luyện trên <b>log lái xe thật</b> (Argoverse 2: ' + "9.610 cặp xe dẫn và xe theo sau, 10 Hz) bằng bài lab Day 12. Chúng chỉ biết <b>bám xe</b>; đèn đỏ và người qua đường do một lớp luật lo, vì log không có hai thứ đó. Cảnh mô phỏng hiển thị bộ điều khiển đang chọn; bảng so cả năm bộ cùng lúc.</p>" +
          '<div class="lab">Bộ điều khiển</div>' + seg("sLabPl", LABPL, s.pl, "Bộ điều khiển") +
          '<div class="lab">Seed huấn luyện (mỗi seed là một lần huấn luyện khác của cùng model)</div>' + seg("sLabSeed", LD.seeds.map(function (_, i) { return [i, String(i + 1)]; }), s.seed, "Seed") + '</div>' +
          '<div class="lab">Cảnh</div>' + seg("sLabScene", [["brake", "Xe dẫn phanh gấp"], ["cutin", "Xe cắt vào"], ["log", "Log thật"]].concat(mergeOptions), s.scene, "Cảnh") +
          '<div class="ctl" data-scene="brake"><div class="sl"><span>Xe dẫn phanh</span><output id="oLabDc">' + fmt(s.decel) + ' m/s²</output><input type="range" id="sLabDc" min="3" max="9" step="0.5" value="' + s.decel + '"></div></div>' +
          '<div class="ctl" data-scene="cutin"><div class="sl"><span>Tốc độ xe ta</span><output id="oLabV0">' + fmt(s.v0) + ' m/s</output><input type="range" id="sLabV0" min="8" max="15" step="1" value="' + s.v0 + '"></div>' +
          '<div class="sl"><span>Khoảng cách tới xe cắt vào</span><output id="oLabGp">' + fmt(s.gap) + ' m</output><input type="range" id="sLabGp" min="3" max="40" step="1" value="' + s.gap + '"></div>' +
          '<div class="sl"><span>Tốc độ tiến gần (xe ta nhanh hơn xe cắt vào)</span><output id="oLabDv">' + fmt(s.dv) + ' m/s</output><input type="range" id="sLabDv" min="2" max="14" step="1" value="' + s.dv + '"></div></div>' +
          '<div class="ctl" data-scene="log"><div class="sl"><span>Log Argoverse làm xe dẫn</span><output id="oLabLg">–</output><input type="range" id="sLabLg" min="0" max="' + (LD.logs.length - 1) + '" step="1" value="' + s.log + '"></div></div>' +
          '<div class="ctl" data-scene="log"><div class="row"><button class="btn" type="button" id="bLabAll">Chạy cả ' + LD.logs.length + ' log, cả năm bộ</button></div><div id="labAll"></div></div>' +
          '<div class="lab">Xe bám đuôi (xe ngay sau xe ta)</div>' + seg("sLabRear", [["replay", "Phát lại (không phản ứng)"], ["reactive", "Phản ứng (IDM, trễ 0,6 s)"]], s.rear, "Xe sau") +
          '<div class="follow-only" data-follow-only><div class="lab">Cả năm bộ điều khiển, cùng cảnh</div><table class="tbl" id="labTbl"></table></div>' +
          '<div class="read" id="labRead"></div><div class="insight" id="labInsight"></div>' +
          '<div class="follow-only" data-follow-only><canvas class="plot" id="plot" aria-label="Khoảng cách tới xe phía trước theo thời gian"></canvas><div class="legend" id="labLeg"></div>' +
          '<div class="lab">Cổng phát hành của bài lab (mã sinh viên ' + LD.student.student_id + ')</div>' + labGateTable() +
          '<p class="note">R1 phát lại tái lập · R2 va chạm trên log · R3 lát cắt xe dẫn phanh · R4 lưới cắt vào · R5 ổn định giữa seed · R6 xe sau phản ứng · R7 độ phủ. Rê chuột lên một dấu để xem số đo. PercMLP+ qua cổng nghĩa là không kém IDM, chưa phải tốt hơn.</p>' +
          '<div class="try"><b>Thử:</b> cảnh “Xe cắt vào”, 14 m/s, cách 10 m, tiến gần 11 m/s: bộ nào đâm, bộ nào không? Rồi so PercMLP với PercMLP+ ở từng seed. Kết quả là của các model bạn đã huấn luyện, nên có thể khác ví dụ trong lời giảng.</div></div>';
      },
      plot: function (P, t) {
        var A = axes(P, 0, LAB_T, -5, 40, [0, 4, 8, 12], [0, 10, 20, 30, 40], "thời gian (s)", "cách xe trước (m)"), g = P.g;
        g.strokeStyle = CSS.hit; g.globalAlpha = 0.5; g.beginPath(); g.moveTo(A.L, A.fy(0)); g.lineTo(A.L + A.w, A.fy(0)); g.stroke(); g.globalAlpha = 1;
        LABPL.forEach(function (p) {
          var R = labRun(p[0], st.lab.seed); series(P, A, TT, labFrontGap(R), CSS[LABCOL[p[0]]], p[0] === st.lab.pl ? 2.6 : 1.1, p[0] === "labcv" ? [3, 3] : null, R.nf || NF);
          R.m.hits.filter(function (e) { return e.a !== "TG" && e.b !== "TG"; }).slice(0, 1).forEach(function (e) { xMark(P, A, e.t, 0, CSS.hit); });
        });
        return A;
      } }
  ];

  // ---------------------------------------------------------------- which run is on screen
  function curRun() { return st.manual ? manualRecord : sceneReady() ? labRun(st.lab.pl, st.lab.seed) : LOG; }
  function tMax() { var R = curRun(); return ((R.nf || NF) - 1) * DT; }
  function tgGap(R) {
    var out = new Array(R.nf || NF), it = IDX.TG, N = R.N;
    for (var f = 0; f < out.length; f++) {
      var ke = f * N * 8, kt = (f * N + it) * 8, dz = Math.abs(R.F[ke + 1] - R.F[kt + 1]), dx = R.F[ke] - R.F[kt];
      out[f] = dz < 2.2 && dx > -4.6 && dx < 60 ? dx - 4.6 : null;
    }
    return out;
  }

  // ---------------------------------------------------------------- what is on screen: one view
  function viewsFor() {
    if (st.manual) return [{ R: manualRecord }];
    return sceneReady() ? [{ R: curRun(), attention: true, egoAttention: true, gapBar: st.lab.rear === "reactive" }] : [{ R: LOG }];
  }
  // ---------------------------------------------------------------- binding
  var bodyEl = $("body");
  function go() {
    var c = CH[0]; st.ch = 0;
    bodyEl.innerHTML = c.html(); bodyEl.scrollTop = 0;
    bind(c);
    view.reset("follow", c.cam);
    st.t = 0; st.playing = !REDUCED;
    resetToasts(); plotDirty = true; drawTicks(); syncPlay();
  }
  function bind() {
    function segBind(id, fn) { var el = $(id); if (!el) return; Array.prototype.forEach.call(el.querySelectorAll("button"), function (b) { b.onclick = function () { Array.prototype.forEach.call(el.querySelectorAll("button"), function (x) { x.setAttribute("aria-pressed", x === b); }); fn(b.dataset.v); plotDirty = true; drawTicks(); }; }); }
    segBind("sLabScene", function (v) { st.lab.scene = v; labRefresh(true); });
    if (!labReady()) { labRefresh(false); return; }
    segBind("sLabPl", function (v) { st.lab.pl = v; labRefresh(true); });
    segBind("sLabSeed", function (v) { st.lab.seed = +v; labRefresh(true); });
    segBind("sLabRear", function (v) { st.lab.rear = v; labRefresh(true); });
    [["sLabDc", "decel", "oLabDc", " m/s²"], ["sLabV0", "v0", "oLabV0", " m/s"], ["sLabGp", "gap", "oLabGp", " m"], ["sLabDv", "dv", "oLabDv", " m/s"], ["sLabLg", "log", null, ""]].forEach(function (c3) {
      $(c3[0]).oninput = function () { st.lab[c3[1]] = +this.value; if (c3[2]) $(c3[2]).textContent = fmt(st.lab[c3[1]]) + c3[3]; clearTimeout(st.lbT); st.lbT = setTimeout(function () { labRefresh(true); }, 200); };
    });
    $("bLabAll").onclick = labAllRun;
    labRefresh(false);
  }

  // ---------------------------------------------------------------- transport bar
  var playBtn = $("play"), timeEl = $("time"), treadEl = $("tread");
  $("trajectoryToggle").onclick = function () { st.lab.trajectory = !st.lab.trajectory; labRefresh(true); };
  $("runLocalTrial").onclick = function () {
    st.lab.trajectory = true;
    labRun(st.lab.pl, st.lab.seed, true);
    labRefresh(false);
    restartRun();
  };
  function jumpTo(t) {
    if (st.manual) return;
    st.t = t; st.playing = false; resetToasts(); syncPlay();
  }
  function syncPlay() {
    playBtn.textContent = st.playing ? "❚❚" : "▶"; playBtn.setAttribute("aria-label", st.playing ? "Dừng" : "Chạy");
    if (st.manual) $("driveStatus").textContent = manualWorld.done ? "Hết lượt lái. Nhấn R để chạy lại." : st.playing ? "Đang lái · Giữ W hoặc ↑ để tăng tốc" : "Đã tạm dừng · Nhấn P để tiếp tục";
  }
  function restartManual() {
    drive.clear(); manualAcc = 0;
    manualWorld = new S.World({ params: sceneReady() ? labParams() : {}, ego: "manual", others: "reactive", tEnd: sceneDuration() });
    manualWorld.step({ acc: 0, steer: 0 });
    manualRecord = manualWorld.record();
    st.t = 0; st.playing = true;
    resetToasts(); $("toast").hidden = true; drawTicks(); syncPlay();
  }
  function restartRun() {
    if (st.manual) { restartManual(); return; }
    st.t = 0; loopStartedAt = null; resetToasts(); st.playing = true; syncPlay();
  }
  function togglePlay() {
    drive.clear();
    if (st.manual) {
      if (manualWorld.done) { restartManual(); return; }
      st.playing = !st.playing; syncPlay(); return;
    }
    if (!st.playing && st.t >= tMax() - 0.01) st.t = 0;
    st.playing = !st.playing; syncPlay();
  }
  playBtn.onclick = togglePlay;
  $("restart").onclick = restartRun;
  view.canvas.tabIndex = 0;
  view.canvas.setAttribute("aria-label", "Vùng lái xe: W A S D hoặc phím mũi tên, Space phanh, P tạm dừng, R chạy lại");
  $("driveToggle").onclick = function () {
    st.manual = !st.manual; drive.clear();
    this.setAttribute("aria-pressed", String(st.manual));
    this.textContent = st.manual ? "Trở về chế độ model tự lái" : "Tự lái bằng bàn phím";
    $("manualHelp").hidden = !st.manual; bodyEl.hidden = st.manual;
    $("trajectoryToggle").hidden = st.manual || !streetScenario();
    $("runLocalTrial").hidden = $("trajectoryToggle").hidden;
    timeEl.disabled = st.manual; $("speed").disabled = st.manual;
    if (st.manual) {
      st.speed = 1; $("speed").textContent = "1×";
      restartManual(); view.reset("chase"); view.canvas.focus({ preventScroll: true });
    } else {
      manualWorld = manualRecord = null; go();
    }
  };
  function editing(target) { return target && target.closest && target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])"); }
  document.addEventListener("keydown", function (e) {
    if (!st.manual || editing(e.target) || e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return;
    if (e.code === "Space" && e.target.closest("button")) return;
    if (e.code === "KeyP" || e.code === "KeyR") {
      e.preventDefault(); if (!e.repeat) { if (e.code === "KeyP") togglePlay(); else restartRun(); } return;
    }
    if (drive.set(e.code, st.playing && !manualWorld.done)) e.preventDefault();
  });
  document.addEventListener("keyup", function (e) { drive.set(e.code, false); });
  function pauseManual() { drive.clear(); if (st.manual && st.playing) { st.playing = false; syncPlay(); } }
  window.addEventListener("blur", pauseManual);
  document.addEventListener("visibilitychange", function () { if (document.hidden) pauseManual(); });
  document.addEventListener("focusin", function (e) { if (editing(e.target)) pauseManual(); });
  var SPEEDS = [0.5, 1, 2, 4];
  $("speed").onclick = function () { st.speed = SPEEDS[(SPEEDS.indexOf(st.speed) + 1) % SPEEDS.length]; this.textContent = String(st.speed).replace(".", ",") + "×"; };
  timeEl.addEventListener("input", function () { st.t = clamp(+timeEl.value, 0, tMax()); loopStartedAt = null; resetToasts(); });
  $("camBtn").onclick = function () { view.cycle(CH[st.ch].cam); };
  $("themeBtn").onclick = function () { var r = document.documentElement, cur = r.getAttribute("data-theme"); var dark = cur ? cur === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches; r.setAttribute("data-theme", dark ? "light" : "dark"); applyPal(); };
  if (window.matchMedia) { var mq = window.matchMedia("(prefers-color-scheme: dark)"); if (mq.addEventListener) mq.addEventListener("change", applyPal); }
  new MutationObserver(function () { applyPal(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  function drawTicks() {
    var el = $("ticks"), VS = viewsFor(), out = [], T_RUN = sceneDuration();
    var merge = currentMerge();
    if (merge) {
      out.push([merge.start, "var(--teal)", "Bắt đầu chen làn"], [merge.start + merge.duration, "var(--teal)", "Vào giữa làn đích"]);
    }
    VS.forEach(function (v) {
      v.R.marks.forEach(function (mark) { var title = markLabel(mark); if (title) out.push([mark.t, "var(--teal)", title]); });
      (v.R.events || []).forEach(function (e) { if (e.ego) out.push([e.t, "var(--hit)"]); });
    });
    el.innerHTML = out.map(function (o) { return '<i style="left:' + (o[0] / T_RUN * 100).toFixed(2) + "%;background:" + o[1] + '" title="' + (o[2] || "Sự kiện xe ta") + '"></i>'; }).join("");
  }

  // ---------------------------------------------------------------- toasts for ego events during playback
  var toastT = 0, lastT = 0, seen = {};
  function resetToasts() { seen = {}; lastT = st.t; }
  function toast(msg) { var el = $("toast"); el.textContent = msg; el.hidden = false; toastT = performance.now() + 3400; }
  function eventToasts(VIEWS) {
    if (st.t < lastT) { seen = {}; }
    VIEWS.forEach(function (v, vi) {
      (v.R.events || []).forEach(function (e, i) {
        var k = vi + ":" + i; if (!e.ego || seen[k] || e.t > st.t || e.t < lastT - 0.001) return; seen[k] = 1;
        var pre = VIEWS.length > 1 ? (vi === 0 ? "Bên trái: " : "Bên phải: ") : "", replay = v.R.opts && v.R.opts.others === "replay";
        if (e.type === "hit") toast(pre + "va chạm xe ta – " + v.R.actors[e.ib].name + " lúc " + fmt(e.t) + " s" + (replay ? " (xe phát lại không phanh: va chạm ảo)" : ""));
        else if (e.type === "red") toast(pre + "xe ta vượt đèn đỏ lúc " + fmt(e.t) + " s");
        else if (e.type === "off") toast(pre + "xe ta ra khỏi lòng đường lúc " + fmt(e.t) + " s");
      });
    });
    lastT = st.t;
  }

  // ---------------------------------------------------------------- frame loop
  var decisionCard = $("decisionCard"), decisionSource = $("decisionSource"), decisionLane = $("decisionLane"), decisionAction = $("decisionAction"), decisionReason = $("decisionReason"), decisionRear = $("decisionRear"), decisionTraffic = $("decisionTraffic");
  var loopButtons = $("decisionLoop").querySelectorAll("button"), loopStep = $("decisionLoopStep"), loopDetail = $("decisionLoopDetail");
  var selectedLoopStep = null, activeLoopStep = -1, loopStartedAt = null;
  loopButtons.forEach(function (button, index) {
    button.onclick = function () {
      jumpTo(st.t);
      selectedLoopStep = { frame: Math.floor(st.t / DT + 1e-9), index: index };
    };
  });
  var journeyArchitecture, architectureAction, architectureReason, architectureState, architectureFrame, architectureJumps;
  $("openJourneyArchitecture").onclick = function () {
    if (!journeyArchitecture) return;
    journeyArchitecture.open = true;
    journeyArchitecture.querySelector("summary").focus({ preventScroll: true });
    journeyArchitecture.scrollIntoView({ block: "nearest" });
  };
  var decisions = {
    "plan-left": ["Chọn hướng sang trái", "Bộ lập kế hoạch chọn hoặc tiếp tục đổi sang làn trái theo khoảng trống dự báo."],
    "plan-right": ["Chọn hướng sang phải", "Bộ lập kế hoạch chọn hoặc tiếp tục đổi sang làn phải theo khoảng trống dự báo."],
    "plan-keep": ["Giữ làn", "Duy trì làn đang chọn và điều chỉnh tốc độ theo dự báo."],
    "plan-brake": ["Giảm tốc, giữ hướng", "Giảm tốc cho kết quả tốt hơn trong dự báo khoảng cách."],
    "plan-intersection": ["Giảm tốc khi tới ngã tư", "Hạ tốc độ trước vạch và giữ tốc độ thấp khi qua giao lộ."],
    "plan-yellow": ["Giảm tốc khi đèn vàng", "Xe chọn quỹ đạo dừng trước vạch và chờ đèn xanh."],
    "plan-signal": ["Dừng trước vạch trắng", "Xe chờ trước vạch cho đến khi đèn xanh."],
    "plan-caution": ["Giảm tốc trước vạch qua đường", "Có người chờ sát mép đường. Xe giảm tốc để sẵn sàng nhường."],
    "plan-yield": ["Nhường người đi bộ", "Chừa khoảng dừng vì người đi bộ có thể đổi hướng."],
    "plan-emergency": ["Phanh khẩn cấp", "Các phương án đều có xung đột dự báo. Chọn phanh mạnh để giảm rủi ro."],
    approach: ["Giữ làn phải", "Theo dõi xe phía trước trước khi bắt đầu vượt."],
    "wait-pass": ["Chờ khoảng trống", "Làn trái chưa đủ khoảng hở để chuyển làn."],
    "ego-left": ["Chuyển sang trái", "Làn trái đủ khoảng hở để vượt xe phía trước."],
    "ego-pass": ["Vượt bên trái", "Giữ làn trái cho đến khi đủ khoảng cách để về phải."],
    "ego-right": ["Về làn phải", "Đã vượt xe phía trước và làn phải đủ khoảng hở."],
    "ego-done": ["Ổn định ở làn phải", "Đã hoàn tất thao tác vượt."],
    cruise: ["Tiếp tục đi thẳng", "Bộ điều khiển giữ làn và điều chỉnh về tốc độ mục tiêu."],
    follow: ["Giữ khoảng cách", "Điều chỉnh tốc độ theo xe phía trước."],
    caution: ["Giảm tốc quan sát", "Tầm nhìn ở vạch qua đường bị che khuất."],
    yield: ["Nhường người đi bộ", "Giảm tốc trước vùng người đi bộ có thể cắt qua."],
    red: ["Phanh trước đèn đỏ", "Giữ làn và giảm tốc trước vạch dừng."],
    "ped-approach": ["Đi tiếp ở làn phải", "Làn phải đủ khoảng hở để tiếp cận vạch qua đường."],
    "ped-watch": ["Quan sát người đi bộ", "Người đi bộ đã bước xuống đường. Xe ta đang giữ làn phải."],
    "ped-wait": ["Giảm tốc trước người đi bộ", "Người đi bộ ở gần đường xe chạy. Bộ điều khiển chưa chọn chuyển làn."],
    "ped-avoid": ["Né người đi bộ sang trái", "Người đi bộ đang lùi về vỉa hè. Xe ta chọn làn trái khi đủ khoảng hở."],
    "ped-returned": ["Giữ làn trái để đi qua", "Người đi bộ đã lên vỉa hè. Xe ta tiếp tục theo hướng vừa chọn."],
    "ped-clear": ["Đi tiếp ở làn trái", "Xe ta đã đi qua vị trí người đi bộ."],
  };
  function showDecision(guide, record) {
    if (decisionCard.hidden !== !guide) decisionCard.hidden = !guide;
    if (!guide) return;
    $("openJourneyArchitecture").hidden = !isJourney();
    var d = guide.decision, text = decisions[d.action], reason = text[1];
    var source = d.path ? "Driver mô phỏng" : "Quyết định của xe ta";
    if (decisionSource.textContent !== source) decisionSource.textContent = source;
    if (d.action === "approach") {
      var leadState = record.LS[(guide.frame * record.N + d.lead) * 2 + 1];
      if (guide.braking) {
        text = ["Giảm tốc, giữ làn phải"];
        reason = "Khoảng hở với xe phía trước đang ngắn. Xe ta điều chỉnh tốc độ trước khi vượt.";
      } else if (leadState === 5) {
        reason = "Ô tô đang chen sang phải. Xe ta giữ hướng trong khi theo dõi xe đó.";
      } else if (record.F[(guide.frame * record.N + d.lead) * 8 + 5] < -4) {
        reason = "Ô tô vừa chen vào đang phanh gấp. Xe ta giữ làn trước khi bắt đầu vượt.";
      }
    } else if (d.action === "follow" && record.actors[d.lead]) {
      reason = "Điều chỉnh tốc độ theo " + record.actors[d.lead].name + " phía trước.";
    } else if (d.action === "plan-yellow" || d.action === "plan-signal") {
      reason = record.F[guide.frame * record.N * 8 + 4] < .05 ?
        "Xe đã dừng và đang chờ đèn xanh." : "Xe chủ động giảm tốc về điểm dừng trước vạch trắng.";
      reason += " Cách vạch trắng " + fmt(d.stopGap) + " m.";
    }
    if (d.path) reason += " Đã loại " + d.rejected + "/" + d.total + " phương án trong dự báo " + fmt(d.horizon) + " s.";
    if (decisionCard.dataset.tone !== guide.color) decisionCard.dataset.tone = guide.color;
    var lane = (d.targetZ < S.LANES.E2.pts[0][1] ? "Làn trái" : "Làn phải") + (guide.braking ? " · Giảm tốc" : "");
    if (decisionLane.textContent !== lane) decisionLane.textContent = lane;
    if (decisionAction.textContent !== text[0]) decisionAction.textContent = text[0];
    if (decisionReason.textContent !== reason) decisionReason.textContent = reason;
    var rearPass = record.params.labJourney && record.params.labJourney.rearPass;
    decisionTraffic.hidden = !rearPass || !(record.F[(guide.frame * record.N + IDX[rearPass.actor]) * 8 + 7] & 2);
    var rear = d.rear;
    decisionRear.hidden = !rear;
    if (rear) {
      var rearText = rear.index < 0 ? "Phía sau cùng làn: trống trong 40 m." :
        "Phía sau cùng làn: có " + record.actors[rear.index].name + " cách " + fmt(rear.gap) + " m." +
          (rear.close ? " Ưu tiên giảm tốc sớm và êm." : "");
      if (decisionRear.textContent !== rearText) decisionRear.textContent = rearText;
    }
  }
  function trafficLoopDetail(record, frame, ego) {
    var stateText = { 5: "đang chuyển làn", 6: "đang phanh gấp", 7: "đang di chuyển" };
    var distance = 45, detail = "";
    for (var i = 1; i < record.N; i++) {
      var actorFrame = frame * record.N + i, state = stateText[record.LS[actorFrame * 2 + 1]];
      if (!state) continue;
      var k = actorFrame * 8, d = Math.hypot(record.F[k] - ego.x, record.F[k + 1] - ego.z);
      if (d >= distance) continue;
      distance = d;
      detail = record.actors[i].name + " " + state + ".";
    }
    return detail ? "Gần xe ta: " + detail + " Cập nhật cảnh cho bước sau." :
      "Cập nhật vị trí xe khác và người đi bộ cho bước sau.";
  }
  function showDecisionLoop(guide, record, ego, now) {
    if (st.playing || !guide || (selectedLoopStep && selectedLoopStep.frame !== guide.frame)) selectedLoopStep = null;
    var animate = !!guide && st.playing && !REDUCED;
    if (!animate) loopStartedAt = null;
    if (!guide) return;
    // Each recorded frame has already gone through all phases. Use a separate UI clock.
    if (animate && loopStartedAt == null) loopStartedAt = now;
    var step = animate ? Math.floor((now - loopStartedAt) / 1800) % loopButtons.length :
      selectedLoopStep ? selectedLoopStep.index : 1;
    if (step !== activeLoopStep) {
      if (activeLoopStep >= 0) loopButtons[activeLoopStep].removeAttribute("aria-current");
      loopButtons[step].setAttribute("aria-current", "step");
      loopStep.textContent = (step + 1) + "/" + loopButtons.length;
      activeLoopStep = step;
    }
    var detail;
    switch (step) {
      case 0:
        detail = "Khung " + fmt(guide.frame * DT, 2) + " s · xe ta " + Math.round(ego.v * 3.6) + " km/h · " + (record.N - 1) + " tác nhân.";
        break;
      case 1:
        detail = decisionAction.textContent + " · lệnh gia tốc " + fmt(record.F[guide.frame * record.N * 8 + 5]) + " m/s².";
        break;
      case 2:
        detail = trafficLoopDetail(record, guide.frame, ego);
        break;
      case 3:
        if (guide.frame + 1 < record.nf) {
          var next = pose(record, 0, (guide.frame + 1) * DT);
          detail = "Áp dụng ga/phanh và góc lái · khung kế " + fmt((guide.frame + 1) * DT, 2) +
            " s · xe ta " + fmt(next.v * 3.6) + " km/h.";
        } else {
          detail = "Đã tới khung cuối của lượt chạy.";
        }
        break;
    }
    if (loopDetail.textContent !== detail) loopDetail.textContent = detail;
  }
  function showArchitecture(guide, record) {
    if (!journeyArchitecture || !journeyArchitecture.open) return;
    architectureJumps.forEach(function (button) { if (button.disabled !== !guide) button.disabled = !guide; });
    var action = guide ? fmt(guide.frame * DT, 2) + " s · " + decisionAction.textContent : "Đang tự lái bằng bàn phím";
    var reason = guide ? decisionLane.textContent + " — " + decisionReason.textContent :
      "Thoát chế độ tự lái để xem lại quyết định của bộ điều khiển tại từng mốc.";
    if (architectureAction.textContent !== action) architectureAction.textContent = action;
    if (architectureReason.textContent !== reason) architectureReason.textContent = reason;
    var frame = guide ? guide.frame : null;
    if (architectureFrame === frame) return;
    architectureFrame = frame;
    if (!guide) {
      architectureState.textContent = "";
      return;
    }
    var sample = S.rendererFrame(record, frame);
    architectureState.textContent = "Pose tham chiếu cho renderer tại " + sample.timestampUs +
      " µs · x " + fmt(sample.ego.x) + " m, z " + fmt(sample.ego.z) + " m · " + sample.actors.length + " tác nhân khác.";
  }
  function resize() { view.resize(); plotDirty = true; }
  window.addEventListener("resize", resize);
  var last = performance.now(), uiT = 0;
  function frame(now) {
    var dtReal = Math.min(0.1, (now - last) / 1000); last = now;
    var c = CH[0];
    if (st.playing && st.manual) {
      manualAcc += dtReal;
      while (manualAcc >= DT && !manualWorld.done) { manualWorld.step(drive.command()); manualAcc -= DT; }
      manualRecord = manualWorld.record(); st.t = (manualRecord.nf - 1) * DT;
      if (manualWorld.done) { st.playing = false; drive.clear(); syncPlay(); }
    } else if (st.playing) { var tm = tMax(); st.t += dtReal * st.speed; if (st.t >= tm) { st.t = tm; st.playing = false; syncPlay(); } }
    var t = st.t, VIEWS = viewsFor(), record = VIEWS[0].R, ego = pose(record, 0, t);
    VIEWS[0].guide = S.guidanceAt(record, t, ego);
    showDecision(VIEWS[0].guide, record);
    showDecisionLoop(VIEWS[0].guide, record, ego, now);
    showArchitecture(VIEWS[0].guide, record);
    view.draw(VIEWS[0], t, dtReal, st.labels, now);
    // HUD + transport (throttled)
    if (now - uiT > 80) {
      uiT = now;
      $("hudV").textContent = Math.round(ego.v * 3.6);
      $("hudAcc").textContent = fmt(ego.acc) + " m/s²";
      var mh = st.manual ? "<b>Bàn phím</b> · " + (sceneReady() ? LABSCENE[st.lab.scene] : "Lái trong phố") : sceneReady() ? c.mode() : "Bài lab"; if (mh !== st.lastMode) { $("hudMode").innerHTML = mh; st.lastMode = mh; }
      timeEl.value = t; treadEl.textContent = fmt(t) + " s";
      if (toastT && now > toastT) { $("toast").hidden = true; toastT = 0; }
    }
    eventToasts(VIEWS);
    var cv = $("plot");
    if (cv && c.plot && !isStreetDemo() && !usesTrajectory()) {
      var rebuild = plotDirty || PB.cv !== cv;
      if (rebuild) {   // data changed: draw the series once and keep a copy
        var P = plotSetup(cv), A = c.plot(P, t);
        PB.off.width = cv.width; PB.off.height = cv.height; PB.off.getContext("2d").drawImage(cv, 0, 0);
        PB.cv = cv; PB.P = P; PB.A = A; PB.t = now; plotDirty = false;
      }
      if (PB.A && (rebuild || (Math.abs(t - lastPlotT) > 0.04 && now - PB.drawn > 60))) {   // time moved: blit + playhead only
        var g2 = cv.getContext("2d"); g2.setTransform(1, 0, 0, 1, 0, 0); g2.clearRect(0, 0, cv.width, cv.height); g2.drawImage(PB.off, 0, 0);
        g2.setTransform(PB.P.dpr, 0, 0, PB.P.dpr, 0, 0); playhead(PB.P, PB.A, t); lastPlotT = t; PB.drawn = now;
      }
    }
    requestAnimationFrame(frame);
  }
  // ---------------------------------------------------------------- boot
  applyPal(); resize();
  timeEl.max = LAB_T;
  go();
  window.__replayLab = { egoX: function () { return pose(curRun(), 0, st.t).x; }, pr: function () { return view.pixelRatio(); }, driving: function () { return { manual: st.manual, playing: st.playing, t: st.t, ego: manualWorld ? Object.assign({}, manualWorld.ego) : null, command: drive.command() }; } };   // read-only probe for automated checks
  requestAnimationFrame(frame);
})();
