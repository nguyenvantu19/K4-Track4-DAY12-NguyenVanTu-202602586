(function () {
  "use strict";

  const { maps, crossingGeometry, RouteSimulation } = window.RouteSim;
  const $ = id => document.getElementById(id);
  const scenario = $("scenario"), destination = $("destination"), svg = $("streetMap");
  const play = $("play"), speed = $("speed"), repeat = $("repeat");
  const roadList = $("roads"), directions = $("directions"), status = $("status");
  const elapsed = $("elapsed"), eta = $("eta"), distance = $("distance");
  const timeline = $("timeline"), speedHud = $("speedHud"), egoSpeed = $("egoSpeed");
  const view3d = $("view3d"), overview = $("overview3d"), view2d = $("view2d");
  const stage3d = $("street3d"), viewNote = $("viewNote");
  const decimal = new Intl.NumberFormat("vi-VN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const integer = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });

  let simulation, running = false, repeatAt = 0, previousTime;
  let drawnRoute, drawnSegment, routeLayer, car, crossingActor, currentLine, renderer3d, viewRequest = 0;
  let checkpoints = [];

  function line(a, b, className, attrs = "") {
    return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="${className}" ${attrs}/>`;
  }

  function drawNetwork() {
    const { map, closed } = simulation;
    const base = [], signs = [], targets = [];
    for (const road of map.roads) {
      const a = map.nodes[road.from], b = map.nodes[road.to];
      const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const angle = simulation.angle(road), radians = angle * Math.PI / 180;
      const labelX = middle.x + Math.sin(radians) * 19, labelY = middle.y - Math.cos(radians) * 19;
      const isClosed = closed.has(road.id);
      const modifier = isClosed ? " closed" : road.congested ? " congested" : "";
      base.push(line(a, b, "road-base"), line(a, b, "road-center" + modifier));
      signs.push(`<g class="road-number" transform="translate(${labelX} ${labelY})"><rect x="-11" y="-8" width="22" height="16" rx="4"/><text text-anchor="middle" dominant-baseline="central">${road.id}</text></g>`);
      if (isClosed) {
        signs.push(`<circle cx="${middle.x}" cy="${middle.y}" r="10" class="road-closure"/><text x="${middle.x}" y="${middle.y}" text-anchor="middle" dominant-baseline="central" class="road-closure-mark">×</text>`);
      } else if (road.oneWay) {
        signs.push(`<text x="${middle.x}" y="${middle.y}" text-anchor="middle" dominant-baseline="central" transform="rotate(${angle} ${middle.x} ${middle.y})" class="road-direction">→</text>`);
      }
      targets.push(line(a, b, "road-hit", `data-road="${road.id}"`));
    }

    const nodes = Object.entries(map.nodes).map(([id, node]) => {
      const isGoal = id === simulation.destination, isStart = id === map.start;
      const marker = isGoal ? "destination" : isStart ? "start" : "intersection";
      const radius = isGoal || isStart ? 8 : 5;
      return `<circle cx="${node.x}" cy="${node.y}" r="${radius}" class="${marker}"/><text x="${node.x}" y="${node.y - 18}" text-anchor="middle" class="node-label">${node.name}</text>`;
    });

    const center = crossingGeometry(map);
    let crossingMark = "", actorMark = "";
    if (center) {
      const angle = Math.atan2(-center.nx, center.ny) * 180 / Math.PI;
      const { kind, span } = map.crossing;
      const sideRoad = `<line x1="0" y1="${-span}" x2="0" y2="${span}" class="road-base"/>`;
      const stripes = Array.from({ length: 7 }, (_, i) => `<rect x="-5.5" y="${-9 + i * 3}" width="11" height="1.5" class="crosswalk"/>`).join("");
      crossingMark = `<g transform="translate(${center.x} ${center.y}) rotate(${angle})">${kind === "car" ? sideRoad : ""}</g>`;
      signs.push(`<g transform="translate(${center.x} ${center.y}) rotate(${angle})">${kind === "pedestrian" ? stripes : ""}<path class="stop-line" d="M-18 -10v20 M18 -10v20"/></g>`);
      actorMark = kind === "car"
        ? '<rect x="-12" y="-6" width="24" height="12" rx="3" fill="#75489f" stroke="#2f243e" stroke-width="2"/><path d="M2 -3 L7 0 L2 3 Z" fill="#fff"/>'
        : '<circle r="7" fill="#75489f" stroke="#2f243e" stroke-width="2"/><path d="M0 -4v8m-4-4h8" stroke="#fff" stroke-width="1.5"/>';
    }

    svg.innerHTML = `<rect width="720" height="420" fill="#e7edf3"/>
      <g>${crossingMark}${base.join("")}</g><g id="routeLayer"></g><g>${signs.join("")}</g>
      <g>${targets.join("")}</g><g pointer-events="none">${nodes.join("")}</g>
      <g id="car" pointer-events="none"><rect x="-12" y="-6" width="24" height="12" rx="3" fill="#b72737" stroke="#531821" stroke-width="2"/>
      <path d="M2 -3 L7 0 L2 3 Z" fill="#fff"/></g>
      <g id="crossingActor" pointer-events="none">${actorMark}</g>`;
    routeLayer = $("routeLayer");
    car = $("car");
    crossingActor = $("crossingActor");
    drawnRoute = undefined;
  }

  function updateRoadList() {
    for (const button of roadList.querySelectorAll("button")) {
      const road = simulation.map.roads.find(road => road.id === button.dataset.road);
      const closed = simulation.closed.has(road.id);
      button.setAttribute("aria-pressed", String(closed));
      button.querySelector("small").textContent = closed ? "Đóng" : road.congested ? "Ùn tắc" : road.oneWay ? "Một chiều" : "Mở";
    }
  }

  function drawRoute() {
    const { map, route, active } = simulation;
    if (route === drawnRoute && active === drawnSegment) return;
    drawnRoute = route;
    drawnSegment = active;
    const steps = route?.steps ?? [];
    routeLayer.innerHTML = (active ? line(map.nodes[active.from], map.nodes[active.to], "route-line current", 'id="currentLine"') : "") +
      steps.map(step => line(map.nodes[step.from], map.nodes[step.to], "route-line")).join("");
    currentLine = $("currentLine");
    directions.replaceChildren(...(active ? [active, ...steps] : steps).map((step, index) => {
      const item = document.createElement("li");
      item.textContent = `${step.road.name} → ${map.nodes[step.to].name}${active && index === 0 ? " (đang đi)" : ""}`;
      return item;
    }));
  }

  function setText(element, value) {
    if (element.textContent !== value) element.textContent = value;
  }

  function rememberState() {
    checkpoints = checkpoints.filter(state => state.elapsed < simulation.elapsed);
    checkpoints.push(simulation.copy());
    const remaining = simulation.active ? simulation.active.seconds - simulation.active.elapsed : 0;
    const end = simulation.elapsed + remaining + (simulation.route?.seconds ?? 0);
    timeline.disabled = end === 0;
    timeline.max = Math.max(end, .01);
    const crossing = simulation.map.crossing;
    $("timelineMarks").innerHTML = crossing ? [crossing.start, crossing.start + crossing.duration]
      .filter(time => time <= end).map(time => `<i style="left:${time / end * 100}%"></i>`).join("") : "";
  }

  function advanceTo(time, seek = false) {
    const point = checkpoints.findLast(state => state.elapsed <= time);
    if (point && (seek || point.elapsed > simulation.elapsed)) {
      simulation = point.copy();
      destination.value = simulation.destination;
      updateRoadList();
      drawNetwork();
    }
    simulation.advance(Math.max(0, time - simulation.elapsed));
  }

  function drawState() {
    drawRoute();
    const { active, route, arrived, canMove, waiting } = simulation;
    const { x, y } = simulation.position();
    car.setAttribute("transform", `translate(${x} ${y}) rotate(${simulation.heading})`);
    const actor = simulation.crossingPosition();
    if (actor) crossingActor.setAttribute("transform", `translate(${actor.x} ${actor.y}) rotate(${actor.angle})`);
    if (currentLine) {
      currentLine.setAttribute("x1", x);
      currentLine.setAttribute("y1", y);
    }

    const remaining = active ? active.seconds - active.elapsed : 0;
    const activeDistance = active ? active.metres * (1 - simulation.progress) : 0;
    setText(eta, route ? decimal.format(route.seconds + remaining) + " s" : "—");
    setText(distance, route ? integer.format(route.metres + activeDistance) + " m" : "—");
    setText(elapsed, decimal.format(simulation.elapsed) + " s");
    timeline.value = simulation.elapsed;
    setText(egoSpeed, String(active && !waiting ? Math.round(active.road.speed * 3.6) : 0));
    setText(status, arrived ? "Đã tới đích" : !route ? (active ? "Đi tới giao lộ kế tiếp · Chưa có tuyến tiếp" : "Không có đường tới đích")
      : running ? (waiting ? (actor.kind === "car" ? "Đang nhường xe cắt ngang" : "Đang nhường người đi bộ") : "Đang chạy theo tuyến đề xuất")
      : simulation.elapsed > 0 ? "Đã tạm dừng" : "Sẵn sàng chạy");
    const playLabel = running ? "Tạm dừng" : arrived ? "Chạy lại" : simulation.elapsed > 0 ? "Tiếp tục" : "Chạy xe";
    play.setAttribute("aria-label", playLabel);
    play.title = playLabel;
    setText(play, running ? "Ⅱ" : "▶");
    play.disabled = !canMove && !(arrived && simulation.elapsed > 0);
  }

  function loadMap(map) {
    simulation = new RouteSimulation(map);
    rememberState();
    running = false;
    repeatAt = 0;
    setText($("mapTitle"), map.name);
    setText($("mapDescription"), map.description);
    const legend = $("crossingLegend");
    legend.hidden = !map.crossing;
    if (map.crossing) setText(legend, map.crossing.kind === "car" ? "Xe cắt ngang" : "Người đi bộ");
    destination.replaceChildren(...Object.entries(map.nodes).map(([id, node]) => new Option(node.name, id)));
    destination.value = simulation.destination;
    roadList.innerHTML = map.roads.map(road => `<button type="button" data-road="${road.id}" data-congested="${!!road.congested}" title="Tốc độ ${road.speed} m/s"><span>${road.id}</span><span>${road.name}</span><small></small></button>`).join("");
    updateRoadList();
    drawNetwork();
    drawState();
  }

  function toggleRoad(id) {
    simulation.toggleRoad(id);
    rememberState();
    if (!simulation.canMove && !simulation.arrived) running = false;
    repeatAt = 0;
    updateRoadList();
    drawNetwork();
    drawState();
  }

  function roadClick(event) {
    const hit = event.target.closest("[data-road]");
    if (hit) toggleRoad(hit.dataset.road);
  }

  async function setView(mode, remember = true) {
    const request = ++viewRequest;
    if (remember) {
      const url = new URL(location.href);
      url.searchParams.set("view", mode);
      history.replaceState(null, "", url);
    }
    viewNote.hidden = mode === "2d";
    if (mode !== "2d") {
      setText(viewNote, "Đang tải góc nhìn 3D…");
      try {
        const three = await window.loadRoute3D();
        if (request !== viewRequest) return;
        if (!renderer3d) renderer3d = window.createRoute3D(three, stage3d, toggleRoad);
        renderer3d.setMode(mode);
        setText(viewNote, mode === "3d" ? "Camera bám sau xe và xoay theo hướng chạy. Kéo để đổi góc, cuộn để thu phóng." : "Kéo để xoay bản đồ, cuộn để thu phóng.");
      } catch {
        if (request !== viewRequest) return;
        setText(viewNote, "Không tải được góc nhìn 3D. Bản đồ đang hiển thị ở chế độ 2D BEV.");
        mode = "2d";
      }
    }
    svg.toggleAttribute("hidden", mode !== "2d");
    stage3d.hidden = mode === "2d";
    speedHud.hidden = mode === "2d";
    view3d.setAttribute("aria-pressed", String(mode === "3d"));
    overview.setAttribute("aria-pressed", String(mode === "overview"));
    view2d.setAttribute("aria-pressed", String(mode === "2d"));
  }

  function frame(now) {
    const dt = previousTime === undefined ? 0 : Math.min((now - previousTime) / 1000, 0.1);
    previousTime = now;
    if (running) {
      if (simulation.arrived && repeat.checked && now >= repeatAt) {
        simulation.restart();
        rememberState();
        repeatAt = 0;
      }
      advanceTo(simulation.elapsed + dt * Number(speed.value));
      if (simulation.arrived && repeat.checked && simulation.elapsed > 0) {
        if (!repeatAt) repeatAt = now + 900;
      } else if (!simulation.canMove) {
        running = false;
      }
      drawState();
    }
    if (!stage3d.hidden) renderer3d.draw(simulation, dt);
    requestAnimationFrame(frame);
  }

  const groups = [["Tình huống nhường đường", maps.filter(map => map.crossing)], ["Kịch bản định tuyến", maps.filter(map => !map.crossing)]];
  for (const [label, entries] of groups) {
    const group = document.createElement("optgroup");
    group.label = label;
    group.append(...entries.map(map => new Option(map.name, map.id)));
    scenario.append(group);
  }
  scenario.addEventListener("change", () => {
    const url = new URL(location.href);
    url.searchParams.set("scene", scenario.value);
    history.replaceState(null, "", url);
    loadMap(maps.find(map => map.id === scenario.value));
  });
  destination.addEventListener("change", () => {
    simulation.setDestination(destination.value);
    rememberState();
    if (!simulation.canMove) running = false;
    repeatAt = 0;
    drawNetwork();
    drawState();
  });
  play.addEventListener("click", () => {
    if (!running && simulation.arrived) {
      simulation.restart();
      rememberState();
    }
    running = !running && simulation.canMove;
    repeatAt = 0;
    drawState();
  });
  timeline.addEventListener("input", () => {
    running = false;
    repeatAt = 0;
    advanceTo(timeline.valueAsNumber, true);
    drawState();
  });
  $("reset").addEventListener("click", () => {
    running = false;
    repeatAt = 0;
    simulation.reset();
    rememberState();
    destination.value = simulation.destination;
    updateRoadList();
    drawNetwork();
    drawState();
  });
  svg.addEventListener("click", roadClick);
  roadList.addEventListener("click", roadClick);
  view3d.addEventListener("click", () => setView("3d"));
  overview.addEventListener("click", () => setView("overview"));
  view2d.addEventListener("click", () => setView("2d"));

  const query = new URLSearchParams(location.search);
  const requested = query.get("scene");
  const firstMap = maps.find(map => map.id === requested) ?? maps[0];
  scenario.value = firstMap.id;
  loadMap(firstMap);
  const requestedView = query.get("view");
  if (requestedView !== "2d") setView(requestedView === "overview" ? "overview" : "3d", false);
  requestAnimationFrame(frame);
})();
