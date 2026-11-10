/* Optional three.js view of the same closed-loop record used by the BEV renderer. */
(function (root) {
  "use strict";
  root.createStreetView = function (stage, ACT, IDX, CSS, reducedMotion) {
    var S = root.ReplaySim, T = root.THREE, pose = S.poseAt;
    var NF = S.NF, DT = S.DT, ROAD = S.ROAD, CX = ROAD.crossX;
    var labelsEl = document.getElementById("labels"), camBtn = document.getElementById("camBtn");
    function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
    function ease(u) { u = clamp(u, 0, 1); return u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; }
    function fmt(x) { return (+x).toFixed(1).replace(".", ","); }
    function rng(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
    function hash(a, b, c) { var h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2246822519); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

    var PAL = {}, MATS = {}, onTheme = [];
    function isDark() { return PAL["sc-bg"].getHSL({}).l < .3; }
    function mat(key, opts, Type) { var m = new (Type || T.MeshLambertMaterial)(Object.assign({}, opts || {})); (MATS[key] = MATS[key] || []).push(m); if (PAL[key]) m.color.copy(PAL[key]); return m; }
    function applyPalette(t) {
      Object.keys(CSS).forEach(function (key) { PAL[key] = new T.Color(CSS[key]); });
      Object.keys(MATS).forEach(function (key) { MATS[key].forEach(function (m) { m.color.copy(PAL[key]); }); });
      onTheme.forEach(function (update) { update(); });
      paintLights(t, true);
    }
    Object.keys(CSS).forEach(function (key) { PAL[key] = new T.Color(CSS[key]); });

    // ================================================================== renderer, scene, lights
    var renderer = new T.WebGLRenderer({ antialias: true });
    var PR = Math.min(window.devicePixelRatio || 1, 1.5), slowAcc = 0;
    renderer.setPixelRatio(PR);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
    stage.insertBefore(renderer.domElement, labelsEl);
    var scene = new T.Scene(); scene.background = new T.Color(); scene.fog = new T.Fog(0xffffff, 150, 560);
    var camera = new T.PerspectiveCamera(38, 1, 0.3, 2500);
    var hemi = new T.HemisphereLight(0xffffff, 0x888888, 0.75); scene.add(hemi);
    var sun = new T.DirectionalLight(0xffffff, 0.75); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); var shc = sun.shadow.camera; shc.left = -70; shc.right = 70; shc.top = 70; shc.bottom = -70; shc.near = 10; shc.far = 400;
    sun.shadow.bias = -0.0008; scene.add(sun); scene.add(sun.target);
    function applyEnv() {
      var dark = isDark();
      scene.background.copy(PAL["sc-bg"]); scene.fog.color.copy(PAL["sc-bg"]); renderer.setClearColor(PAL["sc-bg"]);
      hemi.color.copy(PAL["sc-sky"]); hemi.groundColor.copy(PAL["sc-gnd-light"]); hemi.intensity = dark ? 0.62 : 0.52;
      sun.color.set(0xffffff); sun.intensity = dark ? 0.55 : 0.6;
    }
    onTheme.push(applyEnv);

    // ================================================================== camera rig: orbit around the ego, chase behind it, or free; one target per split view
    var rig = { tx: 0, tz: 2, dist: 70, yaw: 3.3, pitch: 0.62, mode: "follow", lead: 8 }, tween = null;
    var VT = [{ x: 0, z: 0, snap: true }, { x: 0, z: 0, snap: true }];
    function camTo(p, dur) {
      var from = { dist: rig.dist, yaw: rig.yaw, pitch: rig.pitch, lead: rig.lead }, to = Object.assign({}, from, p);
      var dy = to.yaw - from.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); to.yaw = from.yaw + dy;
      tween = { from: from, to: to, t0: performance.now(), dur: reducedMotion ? 1 : (dur || 1400) };
    }
    function stepTween() {
      if (!tween) return;
      var u = ease((performance.now() - tween.t0) / tween.dur);
      ["dist", "yaw", "pitch", "lead"].forEach(function (k) { rig[k] = tween.from[k] + (tween.to[k] - tween.from[k]) * u; });
      if (u >= 1) tween = null;
    }
    function placeCamera(dtReal, ego, vi) {
      var V = VT[vi];
      if (rig.mode === "free") { V.x = rig.tx; V.z = rig.tz; }
      else if (ego) {
        var gx = ego.x + ego.hx * rig.lead, gz = ego.z + ego.hz * rig.lead, k = V.snap ? 1 : 1 - Math.exp(-dtReal * 6);
        V.x += (gx - V.x) * k; V.z += (gz - V.z) * k; V.snap = false;
        if (rig.mode === "chase" && vi === 0 && !tween) { var want = Math.atan2(-ego.hz, -ego.hx), d = Math.atan2(Math.sin(want - rig.yaw), Math.cos(want - rig.yaw)); rig.yaw += d * (1 - Math.exp(-dtReal * 3)); }
      }
      var cp = Math.cos(rig.pitch);
      camera.position.set(V.x + rig.dist * cp * Math.cos(rig.yaw), rig.dist * Math.sin(rig.pitch), V.z + rig.dist * cp * Math.sin(rig.yaw));
      camera.lookAt(V.x, 1, V.z);
    }
    function setCam(m) {
      if (m === "free") { rig.tx = VT[0].x; rig.tz = VT[0].z; }
      rig.mode = m; camBtn.textContent = m === "follow" ? "theo xe" : m === "chase" ? "sau xe" : "tự do";
      if (m === "chase") camTo({ dist: 20, pitch: 0.3, lead: 6 }, 900);
    }
    (function pointer() {
      var el = renderer.domElement, ptrs = {}, last = null, pinch = 0;
      el.addEventListener("pointerdown", function (e) { ptrs[e.pointerId] = [e.clientX, e.clientY]; el.setPointerCapture(e.pointerId); last = [e.clientX, e.clientY]; tween = null; });
      el.addEventListener("pointermove", function (e) {
        if (!ptrs[e.pointerId]) return;
        var ids = Object.keys(ptrs);
        if (ids.length === 2) {
          ptrs[e.pointerId] = [e.clientX, e.clientY];
          var a = ptrs[ids[0]], b = ptrs[ids[1]], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
          if (pinch) rig.dist = clamp(rig.dist * pinch / d, 6, 420); pinch = d; return;
        }
        var dx = e.clientX - last[0], dy = e.clientY - last[1]; last = [e.clientX, e.clientY]; ptrs[e.pointerId] = last;
        if (e.shiftKey || e.buttons === 2) {
          if (rig.mode !== "free") setCam("free");
          var s = rig.dist * 0.0016, cy = Math.cos(rig.yaw), sy = Math.sin(rig.yaw);
          rig.tx += (sy * dx + cy * dy) * s; rig.tz += (-cy * dx + sy * dy) * s;
        } else { if (rig.mode === "chase") setCam("follow"); rig.yaw += dx * 0.006; rig.pitch = clamp(rig.pitch + dy * 0.004, 0.06, 1.48); }
      });
      function up(e) { delete ptrs[e.pointerId]; pinch = 0; }
      el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
      el.addEventListener("contextmenu", function (e) { e.preventDefault(); });
      el.addEventListener("wheel", function (e) { e.preventDefault(); tween = null; rig.dist = clamp(rig.dist * Math.exp(e.deltaY * 0.0012), 6, 420); }, { passive: false });
    })();

    // ================================================================== static world
    var BOX = new T.BoxGeometry(1, 1, 1), PLANE = new T.PlaneGeometry(1, 1); PLANE.rotateX(-Math.PI / 2);
    var world = new T.Group(); scene.add(world);
    var XA = -220, XB = 660;
    var ground = new T.Mesh(new T.PlaneGeometry(1800, 1200).rotateX(-Math.PI / 2), mat("sc-ground")); ground.receiveShadow = true; ground.position.x = 220; world.add(ground);
    var roadMat = mat("sc-road"), walkMat = mat("sc-walk");
    function flat(x0, x1, z0, z1, y, m) { var o = new T.Mesh(PLANE, m); o.scale.set(x1 - x0, 1, z1 - z0); o.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); o.receiveShadow = true; world.add(o); return o; }
    function walkBox(x0, x1, z0, z1) { var o = new T.Mesh(BOX, walkMat); o.scale.set(x1 - x0, 0.16, z1 - z0); o.position.set((x0 + x1) / 2, 0.08, (z0 + z1) / 2); o.receiveShadow = true; world.add(o); }
    flat(XA, XB, -ROAD.half, ROAD.half, 0.02, roadMat);
    flat(CX - 7, CX + 7, -320, 320, 0.021, roadMat);
    [[XA, CX - 10.5], [CX + 10.5, XB]].forEach(function (r) { walkBox(r[0], r[1], 7, 10.8); walkBox(r[0], r[1], -10.8, -7); });
    [[-320, -7], [7, 320]].forEach(function (r) { walkBox(CX - 10.5, CX - 7, r[0], r[1]); walkBox(CX + 7, CX + 10.5, r[0], r[1]); });
    var marks = [], ymarks = [];
    function dashes(x0, x1, z, len, gap, w, skip, out) { for (var x = x0; x < x1; x += len + gap) { if (skip && x + len > skip[0] && x < skip[1]) continue; (out || marks).push([x + len / 2, z, len, w]); } }
    var skipX = [CX - 9.5, CX + 9.5];
    dashes(XA, XB, 3.5, 3, 6, 0.15, skipX); dashes(XA, XB, -3.5, 3, 6, 0.15, skipX);
    dashes(XA, XB, 6.8, 9, 0.001, 0.16, skipX); dashes(XA, XB, -6.8, 9, 0.001, 0.16, skipX);
    dashes(XA, XB, 0.12, 9, 0.001, 0.12, skipX, ymarks); dashes(XA, XB, -0.12, 9, 0.001, 0.12, skipX, ymarks);
    for (var zz = -6.5; zz <= 6.6; zz += 1.0) marks.push([ROAD.walkX, zz, 3, 0.5]);                 // zebra
    marks.push([ROAD.stopE + 0.2, 3.5, 0.35, 7]); marks.push([ROAD.stopW - 0.2, -3.5, 0.35, 7]);    // stop lines on the main road
    marks.push([CX + 3.5, ROAD.stopN + 0.2, 7, 0.35]); marks.push([CX - 3.5, -ROAD.stopN - 0.2, 7, 0.35]);
    [[-320, -9], [9, 320]].forEach(function (r) { for (var z = r[0]; z < r[1]; z += 9) ymarks.push([CX, z + 1.5, 0.12, 3]); });
    // bus bay box
    [[ROAD.busX - 9, 6.95, 18, 0.12], [ROAD.busX - 9, 3.6, 18, 0.12]].forEach(function (b) { marks.push([b[0] + b[2] / 2, b[1], b[2], b[3]]); });
    function instStrips(list, m) {
      var im = new T.InstancedMesh(PLANE, m, list.length), o = new T.Object3D();
      list.forEach(function (d, i) { o.position.set(d[0], 0.035, d[1]); o.scale.set(d[2], 1, d[3]); o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
      im.receiveShadow = true; world.add(im); return im;
    }
    var roadMarkMaterial = mat("sc-mark", {}, T.MeshBasicMaterial);
    instStrips(marks, roadMarkMaterial);
    var retreatZebra = instStrips(Array.from({ length: 14 }, function (_, i) { return [0, i - 6.5, 3, .5]; }), roadMarkMaterial);
    retreatZebra.visible = false;
    instStrips(ymarks, mat("sc-yel", {}, T.MeshBasicMaterial));
    // the words "BUS" are left to the reader; a yellow kerb marks the stop
    flat(ROAD.busX - 9, ROAD.busX + 9, 7.0, 7.3, 0.17, mat("sc-yel", {}, T.MeshBasicMaterial));

    // buildings: deterministic blocks; they are LiDAR targets and appear in the scanned map
    var BLD = [];
    (function genBuildings() {
      var r = rng(23);
      [1, -1].forEach(function (side) {
        var x = XA + 10;
        while (x < XB - 10) {
          var w = 10 + r() * 22;
          if (x + w > CX - 14 && x < CX + 14) { x = CX + 14 + r() * 3; continue; }
          var depth = 12 + r() * 22, h = 6 + Math.pow(r(), 1.7) * 26, z0 = side > 0 ? 13 + r() * 3 : -13 - r() * 3 - depth;
          BLD.push({ x0: x, x1: x + w - 1.8, z0: z0, z1: z0 + depth, h: h, glass: r() < 0.2, tone: r() < 0.5 });
          x += w;
        }
      });
      [-42, -74, 44, 76, 108, -106].forEach(function (zc, i) {
        BLD.push({ x0: CX - 32, x1: CX - 13, z0: zc - 13, z1: zc + 13, h: 9 + 7 * (i % 2), glass: i === 1, tone: true });
        BLD.push({ x0: CX + 13, x1: CX + 33, z0: zc - 13, z1: zc + 13, h: 11 + 6 * (i % 3), glass: false, tone: false });
      });
    })();
    var bldMat = new T.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 1 });
    var bldMesh = new T.InstancedMesh(BOX, bldMat, BLD.length); bldMesh.castShadow = true; bldMesh.receiveShadow = true; world.add(bldMesh);
    (function () { var o = new T.Object3D(); BLD.forEach(function (b, i) { o.position.set((b.x0 + b.x1) / 2, b.h / 2, (b.z0 + b.z1) / 2); o.scale.set(b.x1 - b.x0, b.h, b.z1 - b.z0); o.updateMatrix(); bldMesh.setMatrixAt(i, o.matrix); }); })();
    function colorBuildings() { BLD.forEach(function (b, i) { bldMesh.setColorAt(i, b.glass ? PAL["sc-glass"] : b.tone ? PAL["sc-bldg"] : PAL["sc-bldg2"]); }); if (bldMesh.instanceColor) bldMesh.instanceColor.needsUpdate = true; }
    colorBuildings(); onTheme.push(colorBuildings);
    var edgeMat = mat("sc-edge", { transparent: true, opacity: 0.85 }, T.LineBasicMaterial), bldEdges;
    (function edges() {
      var p = [];
      BLD.forEach(function (b) {
        var X = [b.x0, b.x1], Z = [b.z0, b.z1], Y = [0, b.h];
        function L(a, c) { p.push(a[0], a[1], a[2], c[0], c[1], c[2]); }
        for (var i = 0; i < 2; i++) for (var j = 0; j < 2; j++) L([X[i], 0, Z[j]], [X[i], b.h, Z[j]]);
        Y.forEach(function (y) { L([X[0], y, Z[0]], [X[1], y, Z[0]]); L([X[0], y, Z[1]], [X[1], y, Z[1]]); L([X[0], y, Z[0]], [X[0], y, Z[1]]); L([X[1], y, Z[0]], [X[1], y, Z[1]]); });
        if (b.glass) for (var y = 3.5; y < b.h; y += 3.5) { L([X[0], y, Z[0]], [X[1], y, Z[0]]); L([X[0], y, Z[1]], [X[1], y, Z[1]]); }
      });
      var g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(p, 3));
      bldEdges = new T.LineSegments(g, edgeMat); world.add(bldEdges);
    })();
    var TREES = [];
    [9.8, -9.8].forEach(function (z) { for (var x = XA + 5; x < XB; x += 14) {
      if (Math.abs(x - CX) < 16 || Math.abs(x - ROAD.walkX) < 7 || (z > 0 && x > ROAD.busX - 12 && x < ROAD.busX + 12)) continue; TREES.push([x + (z > 0 ? 5 : 0), z]); } });
    var crown = new T.InstancedMesh(new T.IcosahedronGeometry(1.7, 0), mat("sc-tree"), TREES.length);
    var trunk = new T.InstancedMesh(new T.CylinderGeometry(0.16, 0.2, 2.6, 6), mat("sc-trunk"), TREES.length);
    function placeTrees() {
      var o = new T.Object3D(), r = rng(5);
      TREES.forEach(function (tree, i) {
        var s = 0.8 + r() * 0.5;
        o.position.set(tree[0], 3.4 * s + 0.4, tree[1]);
        o.scale.set(s, s * 1.15, s);
        o.rotation.y = r() * 6;
        o.updateMatrix(); crown.setMatrixAt(i, o.matrix);
        o.position.y = 1.3;
        o.scale.set(1, 1, 1);
        o.updateMatrix(); trunk.setMatrixAt(i, o.matrix);
      });
      crown.instanceMatrix.needsUpdate = trunk.instanceMatrix.needsUpdate = true;
    }
    placeTrees();
    crown.castShadow = trunk.castShadow = true; world.add(crown); world.add(trunk);
    (function shelter() { var m = mat("sc-edge"), g = new T.Group(); [[ROAD.busX - 4, 10.1], [ROAD.busX + 4, 10.1]].forEach(function (p) { var post = new T.Mesh(BOX, m); post.scale.set(0.12, 2.6, 0.12); post.position.set(p[0], 1.3, p[1]); g.add(post); });
      var roof = new T.Mesh(BOX, mat("sc-bldg2")); roof.scale.set(9, 0.15, 1.8); roof.position.set(ROAD.busX, 2.65, 9.8); roof.castShadow = true; g.add(roof);
      var sign = new T.Mesh(BOX, mat("sc-yel")); sign.scale.set(0.5, 0.5, 0.08); sign.position.set(ROAD.busX - 6, 2.6, 8.0); g.add(sign);
      var sp = new T.Mesh(BOX, m); sp.scale.set(0.08, 2.4, 0.08); sp.position.set(ROAD.busX - 6, 1.2, 8.0); g.add(sp); world.add(g); })();

    // traffic lights: one pole per approach, three lamps that follow the signal plan
    var TL = [];
    (function lights() {
      var poleMat = mat("sc-cab"), defs = [
        { sig: "main", x: CX - 9.6, z: 8.4, face: [-1, 0] }, { sig: "main", x: CX + 9.6, z: -8.4, face: [1, 0] },
        { sig: "cross", x: CX + 8.4, z: 9.6, face: [0, 1] }, { sig: "cross", x: CX - 8.4, z: -9.6, face: [0, -1] }];
      var lampG = new T.SphereGeometry(0.15, 12, 8);
      defs.forEach(function (d) {
        var g = new T.Group(), pole = new T.Mesh(new T.CylinderGeometry(0.09, 0.11, 4.6, 8), poleMat); pole.position.y = 2.3; g.add(pole);
        var head = new T.Mesh(BOX, poleMat); head.scale.set(0.42, 1.25, 0.42); head.position.y = 4.9; g.add(head);
        var lamps = {};
        [["R", 5.3], ["Y", 4.9], ["G", 4.5]].forEach(function (l) {
          var m = new T.MeshBasicMaterial({ color: 0x333333 }), s = new T.Mesh(lampG, m);
          s.position.set(d.face[0] * 0.22, l[1], d.face[1] * 0.22); g.add(s); lamps[l[0]] = m;
        });
        g.position.set(d.x, 0, d.z); g.traverse(function (o) { if (o.isMesh) o.castShadow = true; }); world.add(g);
        TL.push({ sig: d.sig, lamps: lamps, state: null });
      });
    })();
    function paintLights(t, force) {
      TL.forEach(function (L) {
        var s = S.light(L.sig, t); if (s === L.state && !force) return; L.state = s;
        L.lamps.R.color.copy(s === "R" ? PAL.ego : PAL["sc-off"]); L.lamps.Y.color.copy(s === "Y" ? PAL.amber : PAL["sc-off"]); L.lamps.G.color.copy(s === "G" ? PAL.green : PAL["sc-off"]);
      });
    }

    // ================================================================== actor meshes
    var WHEEL = new T.CylinderGeometry(0.34, 0.34, 0.26, 14); WHEEL.rotateX(Math.PI / 2);
    var colorKey = { ego: "ego", c1: "car-1", c2: "car-2", c3: "car-3", c4: "car-4", adv: "adv", bus: "bus", ped: "ped" };
    function carMesh(key, kind) {
      var g = new T.Group(), body, cab, L = kind === "bus" ? 12 : 4.5, W = kind === "bus" ? 2.5 : 1.86;
      if (kind === "bus") {
        body = new T.Mesh(BOX, mat(key)); body.scale.set(L, 2.5, W); body.position.y = 1.65; g.add(body);
        cab = new T.Mesh(BOX, mat("sc-cab")); cab.scale.set(L - 1.2, 0.8, W + 0.02); cab.position.set(0.2, 2.15, 0); g.add(cab);
      } else {
        body = new T.Mesh(BOX, mat(key)); body.scale.set(L, 0.72, W); body.position.y = 0.66; g.add(body);
        cab = new T.Mesh(BOX, mat("sc-cab")); cab.scale.set(2.3, 0.6, W - 0.2); cab.position.set(-0.3, 1.32, 0); g.add(cab);
        var top = new T.Mesh(BOX, mat(key)); top.scale.set(2.0, 0.08, W - 0.26); top.position.set(-0.35, 1.66, 0); g.add(top);
      }
      var wx = kind === "bus" ? [4.2, -3.8] : [1.45, -1.45], wz = W / 2 - 0.12;
      wx.forEach(function (x) { [-1, 1].forEach(function (s) { var w = new T.Mesh(WHEEL, mat("sc-wheel")); w.position.set(x, 0.34, s * wz); w.userData.noShadow = true; g.add(w); }); });
      var blM = new T.MeshBasicMaterial({ color: 0x40191a });
      [-1, 1].forEach(function (s) { var bl = new T.Mesh(BOX, blM); bl.scale.set(0.08, kind === "bus" ? 0.3 : 0.16, 0.4); bl.position.set(-L / 2 - 0.03, kind === "bus" ? 1.0 : 0.8, s * (W / 2 - 0.32)); bl.userData.noShadow = true; g.add(bl); });
      g.userData.brake = blM;
      if (kind === "car") {
        var indicator = new T.Group(), indicatorMaterial = new T.MeshBasicMaterial({ color: 0xffae21 });
        [-1, 1].forEach(function (side) {
          var lamp = new T.Mesh(BOX, indicatorMaterial);
          lamp.scale.set(.22, .18, .32);
          lamp.position.set(side * (L / 2 + .03), .77, W / 2 - .12);
          lamp.userData.noShadow = true;
          indicator.add(lamp);
        });
        indicator.visible = false;
        g.userData.rightIndicator = indicator;
        g.add(indicator);
      }
      if (key === "ego") {
        var puck = new T.Mesh(new T.CylinderGeometry(0.32, 0.36, 0.3, 20), mat("sc-cab")); puck.position.set(-0.25, 1.86, 0); g.add(puck);
        var ring = new T.Mesh(new T.TorusGeometry(0.34, 0.035, 6, 24).rotateX(Math.PI / 2), mat("scan-live", {}, T.MeshBasicMaterial)); ring.position.set(-0.25, 1.9, 0); g.add(ring);
      }
      g.traverse(function (o) { if (o.isMesh) o.castShadow = !o.userData.noShadow; });
      return g;
    }
    function motoMesh(key) {
      var g = new T.Group();
      var b = new T.Mesh(BOX, mat(key)); b.scale.set(1.7, 0.5, 0.45); b.position.y = 0.55; g.add(b);
      [0.65, -0.65].forEach(function (x) { var w = new T.Mesh(new T.CylinderGeometry(0.3, 0.3, 0.12, 12).rotateX(Math.PI / 2), mat("sc-wheel")); w.position.set(x, 0.3, 0); g.add(w); });
      var r = new T.Mesh(new T.CylinderGeometry(0.18, 0.22, 0.75, 8), mat("sc-cab")); r.position.set(-0.15, 1.15, 0); g.add(r);
      var h = new T.Mesh(new T.SphereGeometry(0.2, 10, 8), mat("gold")); h.position.set(-0.1, 1.68, 0); g.add(h);
      g.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
      return g;
    }
    function pedMesh() {
      var g = new T.Group(), m = mat("ped");
      var b = new T.Mesh(new T.CylinderGeometry(0.2, 0.24, 1.05, 10), m); b.position.y = 0.95; g.add(b);
      var h = new T.Mesh(new T.SphereGeometry(0.17, 12, 10), m); h.position.y = 1.62; g.add(h);
      var l1 = new T.Mesh(BOX, mat("sc-cab")); l1.scale.set(0.14, 0.5, 0.14); l1.position.set(0, 0.25, 0.1); g.add(l1);
      var l2 = l1.clone(); l2.position.z = -0.1; g.add(l2); g.userData.legs = [l1, l2];
      g.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
      return g;
    }
    function meshFor(a) { return a.kind === "ped" ? pedMesh() : a.kind === "moto" ? motoMesh(colorKey[a.color]) : carMesh(a.kind === "ego" ? "ego" : a.dark ? "car-dark" : colorKey[a.color], a.kind); }

    // ================================================================== the recorded drive and the runs derived from it
    var actorObj = ACT.map(function (a) { var o = meshFor(a); scene.add(o); return o; });
    S.PARKED.forEach(function (p) { var o = carMesh(p.dark ? "car-dark" : colorKey[p.color], "car"); o.position.set(p.x, 0, p.z); o.rotation.y = Math.atan2(-p.hz, p.hx); scene.add(o); });
    function place(o, a, p, t) {
      o.position.set(p.x, 0, p.z); o.rotation.y = Math.atan2(-p.hz, p.hx);
      if (o.userData.brake) { var on = p.acc < -1.2; if (o.userData.bOn !== on) { o.userData.brake.color.setHex(on ? 0xff2a1f : 0x40191a); o.userData.bOn = on; } }
      if (o.userData.rightIndicator) o.userData.rightIndicator.visible = p.rightIndicator && (reducedMotion || Math.floor(t * 4) % 2 === 0);
      if (a.kind === "ped" && o.userData.legs) { var sw = p.v > 0.05 ? Math.sin(t * 9 + a.id.length) * 0.35 : 0; o.userData.legs[0].rotation.z = sw; o.userData.legs[1].rotation.z = -sw; }
    }

    // ================================================================== trails (tracks), plan ribbon, hit rings
    function makeTrail(key, opacity, dashed) {
      var g = new T.BufferGeometry(); g.setAttribute("position", new T.BufferAttribute(new Float32Array(NF * 3), 3)); g.setDrawRange(0, 0);
      var m = dashed ? mat(key, { dashSize: 1.2, gapSize: 0.9, transparent: true, opacity: opacity }, T.LineDashedMaterial) : mat(key, { transparent: true, opacity: opacity }, T.LineBasicMaterial);
      var l = new T.Line(g, m); l.frustumCulled = false; l.visible = false; scene.add(l); return { line: l, R: null, n: 0, dashed: dashed };
    }
    function fillTrail(tr, R, i, y) {
      var geometry = tr.line.geometry, nf = R.nf || NF;
      if (geometry.attributes.position.count < nf) {
        geometry.dispose();
        geometry.setAttribute("position", new T.BufferAttribute(new Float32Array(R.F.length / (R.N * 8) * 3), 3));
      }
      var a = geometry.attributes.position.array;
      for (var f = 0; f < nf; f++) { var k = (f * R.N + i) * 8; a[f * 3] = R.F[k]; a[f * 3 + 1] = y; a[f * 3 + 2] = R.F[k + 1]; }
      geometry.attributes.position.needsUpdate = true; if (tr.dashed) tr.line.computeLineDistances();
      tr.R = R; tr.nfFilled = nf;
    }
    function showTrail(tr, R, i, y, t) {
      if (!R) { tr.line.visible = false; return; }
      if (tr.R !== R || tr.nfFilled !== (R.nf || NF)) fillTrail(tr, R, i, y);
      tr.line.geometry.setDrawRange(0, Math.max(0, Math.min(R.nf || NF, Math.floor(t / DT) + 1))); tr.line.visible = true;
    }
    var trEgo = makeTrail("ego", 0.95);
    var ringG = new T.TorusGeometry(2.4, 0.16, 8, 40).rotateX(Math.PI / 2), hitRings = [];
    for (var hr = 0; hr < 8; hr++) { var rm = new T.Mesh(ringG, mat("hit", { transparent: true, opacity: 0.9 }, T.MeshBasicMaterial)); rm.visible = false; scene.add(rm); hitRings.push(rm); }
    // attention: what each reactive driver is reacting to right now (a line from its bumper to the thing), coloured by why
    var ATT_N = 48, attGeo = new T.BufferGeometry();
    attGeo.setAttribute("position", new T.BufferAttribute(new Float32Array(ATT_N * 6), 3)); attGeo.setAttribute("color", new T.BufferAttribute(new Float32Array(ATT_N * 6), 3));
    var attLines = new T.LineSegments(attGeo, new T.LineBasicMaterial({ vertexColors: true })); attLines.frustumCulled = false; attLines.visible = false; scene.add(attLines);
    var ATT_COL = { 1: "teal", 2: "ego", 3: "gold", 4: "purple", 5: "purple" };
    // the safe gap the reactive tailgater wants to keep (IDM s*), painted on the road ahead of it
    var gapBar = new T.Mesh(PLANE, new T.MeshBasicMaterial({ transparent: true, opacity: 0.4, depthWrite: false })); gapBar.visible = false; scene.add(gapBar);

    // ================================================================== labels overlay (projected per view)
    var LBL = [], lblPool = [], lblUsed = 0;
    function label(x, y, z, text, cls) { LBL.push([x, y, z, text, cls]); }
    function flushLabels(rect) {
      var v = new T.Vector3();
      LBL.forEach(function (L) {
        v.set(L[0], L[1], L[2]).project(camera);
        if (v.z > 1 || v.z < -1 || Math.abs(v.x) > 1.02 || Math.abs(v.y) > 1.05) return;
        var el = lblPool[lblUsed]; if (!el) { el = document.createElement("div"); labelsEl.appendChild(el); lblPool.push(el); }
        lblUsed++;
        var cn = "lbl" + (L[4] ? " " + L[4] : ""); if (el.className !== cn) el.className = cn; if (el.textContent !== L[3]) el.textContent = L[3];
        el.style.left = (rect.x + (v.x + 1) / 2 * rect.w).toFixed(1) + "px"; el.style.top = (rect.y + (1 - v.y) / 2 * rect.h).toFixed(1) + "px"; el.style.display = "";
      });
      LBL = [];
    }
    function endLabels() { for (var i = lblUsed; i < lblPool.length; i++) lblPool[i].style.display = "none"; lblUsed = 0; }

    // ---------------------------------------------------------------- reactive agents: attention lines, state labels, the tailgater's safe gap
    function drawAttention(R, t, ego, egoToo) {
      var f = clamp(Math.round(t / DT), 0, (R.nf || NF) - 1), N = R.N, pa = attGeo.attributes.position.array, ca = attGeo.attributes.color.array, n = 0;
      function seg2(x0, z0, x1, z1, col) { if (n >= ATT_N) return; pa.set([x0, 1.2, z0, x1, 1.2, z1], n * 6); ca.set([col.r, col.g, col.b, col.r, col.g, col.b], n * 6); n++; }
      function target(i, lead, p) {
        if (lead >= 0) { var q = pose(R, lead, t); return [q.x, q.z]; }
        var ln = ACT[i].lane.charAt(0);
        return ln === "E" ? [ROAD.stopE, p.z] : ln === "W" ? [ROAD.stopW, p.z] : [p.x, ACT[i].lane === "SB" ? -ROAD.stopN : ROAD.stopN];
      }
      if (R.LS) for (var i = 1; i < N; i++) {
        var k = (f * N + i) * 2, lead = R.LS[k], code = R.LS[k + 1]; if (!ATT_COL[code] || (lead < 0 && lead !== -2)) continue;
        var p = pose(R, i, t); if (Math.abs(p.x - ego.x) > 80 || Math.abs(p.z - ego.z) > 60) continue;
        var a = ACT[i], tg = target(i, lead, p);
        seg2(p.x + p.hx * a.dims.len / 2, p.z + p.hz * a.dims.len / 2, tg[0], tg[1], PAL[ATT_COL[code]]);
      }
      if (egoToo && R.EGO) { var le = R.EGO[f * 4 + 2]; if (le >= 0 || le === -2) { var tg2 = le >= 0 ? (function () { var q = pose(R, le, t); return [q.x, q.z]; })() : [ROAD.stopE, ego.z]; seg2(ego.x + ego.hx * 2.3, ego.z + ego.hz * 2.3, tg2[0], tg2[1], PAL.ego); } }
      attGeo.setDrawRange(0, n * 2); attGeo.attributes.position.needsUpdate = true; attGeo.attributes.color.needsUpdate = true; attLines.visible = n > 0;
    }
    function stateLabels(R, t, ego) {
      var f = clamp(Math.round(t / DT), 0, (R.nf || NF) - 1), N = R.N, n = 0;
      for (var i = 1; i < N && n < 7; i++) {
        var a = ACT[i], code = R.LS ? R.LS[(f * N + i) * 2 + 1] : 0, p = pose(R, i, t), txt = null;
        if (Math.hypot(p.x - ego.x, p.z - ego.z) > 55) continue;
        if (code === 4) txt = a.kind === "ped" ? "chờ qua đường" : a.id === "BUS" ? "chờ người đi bộ" : "chờ khe hở";
        else if (code === 7 && a.id === "P1") txt = "đang qua đường";
        else if (code === 3) txt = "nhường người đi bộ";
        else if (code === 5) txt = "đang chen làn";
        else if (code === 2 && p.v > 0.3) txt = "dừng vì đèn";
        if (a.kind !== "ped" && p.acc < -2) txt = (txt ? txt + " · " : "") + "phanh " + fmt(-p.acc) + " m/s²";
        if (txt) { label(p.x, heightOf(a) + 1.1, p.z, (a.id === "TG" ? "bám đuôi: " : "") + txt, "state"); n++; }
      }
    }
    function heightOf(a) { return a.kind === "bus" ? 3.0 : a.kind === "ped" ? 1.8 : a.kind === "moto" ? 1.8 : 1.7; }
    function drawGapBar(R, t, ego) {
      var p = pose(R, IDX.TG, t), gap = ego.x - p.x - S.CAR.len;
      if (Math.abs(p.z - ego.z) > 2 || gap < -S.CAR.len || gap > 50) { gapBar.visible = false; return; }
      var P = { T: 1.4, a: 2.0, b: 3.2, s0: 1.4 };   // the rear driver of the lab scenes (see labParams: tgT = 1.4 s, calibrated on the logs)
      var sStar = P.s0 + Math.max(0, p.v * P.T + p.v * (p.v - ego.v) / (2 * Math.sqrt(P.a * P.b))), ok = gap >= sStar;
      gapBar.scale.set(Math.max(0.3, sStar), 1, 1.7); gapBar.position.set(p.x + S.CAR.len / 2 + sStar / 2, 0.07, p.z); gapBar.material.color.copy(ok ? PAL.teal : PAL.hit); gapBar.visible = true;
      label(p.x + S.CAR.len / 2 + sStar / 2, 0.6, p.z + 2.6, "muốn ≥ " + fmt(sStar) + " m · đang " + fmt(Math.max(0, gap)) + " m", ok ? "plan" : "hit");
    }

    function resize() { renderer.setSize(stage.clientWidth, stage.clientHeight, false); }
    var guideGeometry = new T.BufferGeometry();
    var guideVertices = new T.BufferAttribute(new Float32Array(240 * 3), 3);
    guideVertices.setUsage(T.DynamicDrawUsage);
    guideGeometry.setAttribute("position", guideVertices);
    var guideArrow = new T.Mesh(guideGeometry, new T.MeshBasicMaterial({ side: T.DoubleSide }));
    guideArrow.frustumCulled = false;
    scene.add(guideArrow);
    function drawGuide(guide) {
      guideArrow.visible = !!guide && guide.strip.length > 0;
      if (!guideArrow.visible) return;
      var n = 0, strip = guide.strip;
      function vertex(p) { guideVertices.setXYZ(n++, p[0], .19, p[1]); }
      for (var i = 2; i < strip.length; i += 2) {
        vertex(strip[i - 2]); vertex(strip[i - 1]); vertex(strip[i]);
        vertex(strip[i]); vertex(strip[i - 1]); vertex(strip[i + 1]);
      }
      guide.head.forEach(vertex);
      guideGeometry.setDrawRange(0, n);
      guideVertices.needsUpdate = true;
      guideArrow.material.color.copy(PAL[guide.color]);
    }
    function reset(mode, preset) {
      setCam(mode);
      if (mode === "follow") camTo(preset, 1300);
      VT[0].snap = true;
    }
    function draw(v, t, dtReal, labels, now) {
      if (dtReal > 0.025) slowAcc += dtReal; else slowAcc = Math.max(0, slowAcc - dtReal * 0.5);
      if (slowAcc > 1 && PR > 1) { PR = Math.max(1, PR - 0.25); renderer.setPixelRatio(PR); resize(); slowAcc = 0; }
      var Wc = stage.clientWidth, Hc = stage.clientHeight;
      var rect = { x: 0, y: 0, w: Wc, h: Hc }, R = v.R, ego = pose(R, 0, t);
      var rearPass = R.params.labJourney && R.params.labJourney.rearPass;
      var retreat = R.params.labJourney && R.params.labJourney.pedestrianRetreat;
      retreatZebra.visible = !!retreat;
      if (retreat) retreatZebra.position.x = retreat.x;
      stepTween(); paintLights(t);
      renderer.setScissorTest(false); renderer.setViewport(0, 0, Wc, Hc); renderer.clear();
      for (var i = 0; i < ACT.length; i++) place(actorObj[i], ACT[i], pose(R, i, t), t);
      showTrail(trEgo, R, 0, 0.12, t);
      drawGuide(v.guide);
      if (v.attention) { drawAttention(R, t, ego, v.egoAttention); stateLabels(R, t, ego); } else attLines.visible = false;
      if (v.gapBar) drawGapBar(R, t, ego); else gapBar.visible = false;
      var hits = (R.events || []).filter(function (e) { return e.type === "hit" && e.ego && e.t <= t + 1e-6; });
      hitRings.forEach(function (rm, n) { var e = hits[n]; rm.visible = !!e; if (e) { rm.position.set(e.x, 0.3, e.z); var s = 1 + 0.15 * Math.sin(now / 160); rm.scale.set(s, 1, s); } });
      hits.forEach(function (e) { label(e.x, 4.6, e.z, "va chạm", "hit"); });
      label(ego.x, 2.6, ego.z, "xe ta", "ego");
      if (labels) {
        var labelIds = R.params.labJourney ? ["L1", "C2", "E5", "MB", "P1", "N1"] : ["L1", "TG", "C2", "BUS", "P1", "NR", "MB"];
        if (rearPass) labelIds.push(rearPass.actor);
        if (retreat) labelIds.push(retreat.actor);
        labelIds.forEach(function (id) {
          var i = IDX[id], q = pose(R, i, t), actor = R.actors[i];
          if (Math.hypot(q.x - ego.x, q.z - ego.z) < 60) label(q.x, actor.kind === "bus" ? 3.6 : 2.4, q.z,
            actor.name + (q.rightIndicator ? " · xi nhan phải" : ""), q.rightIndicator ? "plan" : "");
        });
      }
      sun.position.set(ego.x + 40, 90, ego.z + 30); sun.target.position.set(ego.x, 0, ego.z);
      placeCamera(dtReal, ego, 0);
      camera.aspect = rect.w / Math.max(1, rect.h); camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      flushLabels(rect);
      endLabels();
    }
    return {
      canvas: renderer.domElement, resize: resize, reset: reset, draw: draw, applyPalette: applyPalette,
      cycle: function (preset) {
        setCam(rig.mode === "follow" ? "chase" : rig.mode === "chase" ? "free" : "follow");
        if (rig.mode === "follow") camTo(preset, 900);
      },
      pixelRatio: function () { return PR; }
    };
  };
})(window);
