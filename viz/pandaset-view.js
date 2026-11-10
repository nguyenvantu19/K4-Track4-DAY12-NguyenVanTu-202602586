(async function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var format = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 });
  var asset = "../data/pandaset/", status = $("status");
  var T = window.THREE;
  var renderer, world, camera3d, cameraBev, actors, lines, forecast, ground;
  var dataset, source, run, play = false, last = 0, time = 0, overhead = false;
  var labels = {
    "plan-left": "Chọn hướng sang trái", "plan-right": "Chọn hướng sang phải",
    "plan-keep": "Giữ làn", "plan-brake": "Giảm tốc", "plan-yield": "Nhường người đi bộ",
    "plan-caution": "Giảm tốc trước người chờ", "plan-emergency": "Phanh khẩn cấp"
  };

  function line(points, color, y) {
    return new T.Line(new T.BufferGeometry().setFromPoints(points.map(function (p) {
      return new T.Vector3(p.x, y, p.z);
    })), new T.LineBasicMaterial({ color: color }));
  }

  function initialize() {
    renderer = new T.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    $("world").appendChild(renderer.domElement);
    world = new T.Scene();
    world.background = new T.Color(0xdce7ee);
    world.add(new T.HemisphereLight(0xffffff, 0x526774, 2));
    camera3d = new T.PerspectiveCamera(47, 1, .2, 250);
    cameraBev = new T.OrthographicCamera(-20, 20, 15, -15, .2, 180);
    cameraBev.up.set(1, 0, 0);
    ground = new T.Mesh(new T.PlaneGeometry(225, 55), new T.MeshBasicMaterial({ color: 0xb6c9d3 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.x = 65;
    world.add(ground);
    var road = new T.Mesh(new T.PlaneGeometry(225, 14), new T.MeshBasicMaterial({ color: 0x8997a5 }));
    road.rotation.x = -Math.PI / 2; road.position.set(65, .01, 0); world.add(road);
    [-7, 0, 3.5, 7].forEach(function (z) {
      world.add(line([{ x: -45, z: z }, { x: 175, z: z }], z === 0 ? 0xffd675 : 0xf2f5fa, .025));
    });
    actors = new T.Group(); lines = new T.Group();
    world.add(actors, lines);
  }

  function removeChildren(group) {
    while (group.children.length) {
      var item = group.children[0];
      group.remove(item); item.geometry.dispose(); item.material.dispose();
    }
  }

  function metrics() {
    var rows = [
      ["Khoảng hở nhỏ nhất", "clearance", function (n) { return Number.isFinite(n) ? format.format(n) + " m" : "—"; }],
      ["Đối tượng chạm hộp xe ta", "contacts", function (value) { return value.size; }],
      ["Mốc giảm tốc trên 1 m/s²", "brakeAt", function (n) { return n == null ? "—" : format.format(n) + " s"; }]
    ];
    $("metrics").replaceChildren();
    rows.forEach(function (row) {
      var tr = document.createElement("tr");
      tr.insertCell().textContent = row[0];
      tr.insertCell().textContent = row[2](run.replay[row[1]]);
      tr.insertCell().textContent = row[2](run.simulation[row[1]]);
      $("metrics").appendChild(tr);
    });
  }

  function selectScene() {
    source = dataset.scenes.find(function (s) { return s.id === $("scene").value; });
    run = PandaSetSim.run(source);
    removeChildren(actors); removeChildren(lines);
    forecast = null;
    run.tracks.forEach(function (actor, i) {
      var color = i === 0 ? 0x0f8873 : actor.kind === "ped" ? 0xe79c38 : actor.kind === "bike" ? 0x935dd3 : 0x40698e;
      actors.add(new T.Mesh(new T.BoxGeometry(actor.len, actor.height, actor.wid),
        new T.MeshLambertMaterial({ color: color })));
    });
    lines.add(line(run.frames.map(function (f) { return f.replay[0]; }), 0x0770aa, .065));
    lines.add(line(run.frames.map(function (f) { return f.simulation[0]; }), 0x008b69, .085));
    $("time").max = run.frames.length - 1;
    status.textContent = "Cảnh " + source.id + " · " + source.frames.length + " ảnh đồng bộ · " + run.slowed + " xe phía sau đã phản ứng trong mô phỏng.";
    metrics(); seek(0);
  }

  function draw() {
    var index = Math.min(run.frames.length - 1, Math.round(time / ReplaySim.DT)), frame = run.frames[index];
    var states = frame[$("mode").value], ego = states[0];
    actors.children.forEach(function (mesh, i) {
      var actor = states[i];
      mesh.visible = !!actor;
      if (!actor) return;
      mesh.position.set(actor.x, run.tracks[i].height / 2 + .02, actor.z);
      mesh.rotation.y = -actor.th;
      if (!i) mesh.material.color.setHex($("mode").value === "replay" ? 0x146fa3 : 0x087c67);
    });
    if (forecast) { lines.remove(forecast); forecast.geometry.dispose(); forecast.material.dispose(); forecast = null; }
    if ($("mode").value === "simulation") {
      forecast = line([ego].concat(frame.decision.path), 0xf8a324, .15); lines.add(forecast);
      $("decision").textContent = (labels[frame.decision.action] || frame.decision.action) +
        " · " + format.format(ego.v * 3.6) + " km/h · " + format.format(ego.acc) + " m/s²";
    } else {
      $("decision").textContent = "Xe trong bản ghi · " + format.format(ego.v * 3.6) + " km/h";
    }
    var cameraFrame = source.frames.reduce(function (closest, candidate) {
      return Math.abs(candidate.t - frame.t) < Math.abs(closest.t - frame.t) ? candidate : closest;
    });
    var picture = asset + source.id + "/camera/front_camera/" + cameraFrame.camera;
    if ($("camera").getAttribute("src") !== picture) $("camera").src = picture;
    $("time").value = index; $("clock").textContent = format.format(frame.t) + " s";

    var w = $("world").clientWidth, h = $("world").clientHeight;
    renderer.setSize(w, h, false);
    camera3d.aspect = w / h; camera3d.updateProjectionMatrix();
    camera3d.position.set(ego.x - 20, 23, ego.z + 16);
    camera3d.lookAt(ego.x + 8, 0, ego.z);
    cameraBev.left = -16 * w / h; cameraBev.right = 16 * w / h; cameraBev.updateProjectionMatrix();
    cameraBev.position.set(ego.x + 7, 50, ego.z);
    cameraBev.lookAt(ego.x + 7, 0, ego.z);
    renderer.render(world, overhead ? cameraBev : camera3d);
  }

  function seek(value) { time = value; play = false; $("play").textContent = "Phát"; draw(); }
  function animation(now) {
    if (play) {
      time += Math.min(.1, (now - last) / 1000);
      var end = run.frames[run.frames.length - 1].t;
      if (time >= end) seek(end); else draw();
    }
    last = now;
    requestAnimationFrame(animation);
  }

  try {
    if (!T) throw new Error("Không tải được trình vẽ Three.js.");
    var response = await fetch(asset + "scenes.json");
    if (!response.ok) throw new Error("Chưa tìm thấy data/pandaset/scenes.json.");
    dataset = await response.json();
    initialize();
    dataset.scenes.forEach(function (scene) { $("scene").add(new Option("PandaSet " + scene.id, scene.id)); });
    if (dataset.scenes.some(function (scene) { return scene.id === "002"; })) $("scene").value = "002";
    $("scene").onchange = selectScene; $("mode").onchange = draw;
    ["three", "bev"].forEach(function (id) {
      $(id).onclick = function () {
        overhead = id === "bev";
        $("three").setAttribute("aria-pressed", !overhead);
        $("bev").setAttribute("aria-pressed", overhead);
        draw();
      };
    });
    $("time").oninput = function () { seek(Number(this.value) * ReplaySim.DT); };
    $("restart").onclick = function () { seek(0); };
    $("play").onclick = function () {
      if (time >= run.frames[run.frames.length - 1].t) time = 0;
      play = !play; $("play").textContent = play ? "Dừng" : "Phát";
    };
    window.addEventListener("resize", draw);
    selectScene();
    requestAnimationFrame(animation);
  } catch (error) {
    status.textContent = error.message;
  }
})();
