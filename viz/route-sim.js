/* Small road graphs and a deterministic, time-based vehicle simulation. */
(function (root) {
  "use strict";

  function road(id, from, to, name, speed, options = {}) {
    return { id, from, to, name, speed, ...options };
  }

  const maps = [
    {
      id: "crossing-car", name: "Xe cắt ngang đầu", start: "A", goal: "D",
      description: "Xe từ đường nhánh cắt ngang trước đầu xe ta. Quan sát xe ta dừng trước giao cắt hoặc chọn tuyến vòng nếu nhanh hơn.",
      crossing: { kind: "car", road: "02", start: 14, duration: 14, span: 82, clearance: 26 },
      nodes: {
        A: { x: 75, y: 230, name: "Xuất phát" }, B: { x: 215, y: 230, name: "Ngã ba Tây" },
        C: { x: 505, y: 230, name: "Ngã ba Đông" }, D: { x: 645, y: 230, name: "Điểm đến" },
        E: { x: 245, y: 95, name: "Đường vòng Bắc" }, F: { x: 475, y: 95, name: "Lối ra phía Bắc" },
      },
      roads: [
        road("01", "A", "B", "Đường tiếp cận", 14), road("02", "B", "C", "Đường qua giao cắt", 16),
        road("03", "B", "E", "Lối lên phía Bắc", 15), road("04", "E", "F", "Đường vòng Bắc", 17),
        road("05", "F", "C", "Lối về đường chính", 15), road("06", "C", "D", "Đường tới đích", 14),
      ],
    },
    {
      id: "pedestrian", name: "Người đi bộ qua đường", start: "A", goal: "D",
      description: "Người đi bộ qua vạch kẻ trước trường. Xe ta phải chờ lối qua thông thoáng mới được đi tiếp.",
      crossing: { kind: "pedestrian", road: "02", start: 14, duration: 15, span: 33, clearance: 15 },
      nodes: {
        A: { x: 70, y: 165, name: "Xuất phát" }, B: { x: 212, y: 165, name: "Phố Trường học" },
        C: { x: 515, y: 165, name: "Ngã ba Đông" }, D: { x: 655, y: 165, name: "Điểm đến" },
        E: { x: 310, y: 340, name: "Công viên" }, F: { x: 510, y: 340, name: "Phố phía Nam" },
      },
      roads: [
        road("01", "A", "B", "Đường tiếp cận", 13), road("02", "B", "C", "Đường qua trường", 14),
        road("03", "B", "E", "Lối xuống Công viên", 13), road("04", "E", "F", "Đường vòng phía Nam", 16),
        road("05", "F", "C", "Lối lên Ngã ba Đông", 13), road("06", "C", "D", "Đường tới đích", 14),
      ],
    },
    {
      id: "roadworks", name: "Công trường", start: "A", goal: "H",
      description: "Đoạn trung tâm bị đóng do thi công. So sánh đường vòng phía bắc với đường vòng phía nam.",
      nodes: {
        A: { x: 75, y: 220, name: "Bến xe" }, B: { x: 230, y: 220, name: "Ngã tư Tây" },
        C: { x: 230, y: 90, name: "Công viên" }, D: { x: 480, y: 90, name: "Phố Bắc" },
        E: { x: 480, y: 220, name: "Ngã tư Đông" }, F: { x: 230, y: 345, name: "Phố Nam" },
        G: { x: 480, y: 345, name: "Nhà ga" }, H: { x: 645, y: 220, name: "Bệnh viện" },
      },
      roads: [
        road("01", "A", "B", "Đường Bến xe", 14), road("02", "B", "E", "Đường Trung tâm", 18, { closed: true }),
        road("03", "B", "C", "Lối lên Công viên", 12), road("04", "C", "D", "Đại lộ Bắc", 18),
        road("05", "D", "E", "Đường Phố Bắc", 14), road("06", "B", "F", "Lối xuống Phố Nam", 10),
        road("07", "F", "G", "Đường Nhà ga", 12), road("08", "G", "E", "Lối ra Nhà ga", 10),
        road("09", "E", "H", "Đường Bệnh viện", 14),
      ],
    },
    {
      id: "traffic", name: "Ùn tắc giờ cao điểm", start: "A", goal: "G",
      description: "Đường qua chợ ngắn hơn nhưng ùn tắc. Xe cân nhắc tuyến vành đai dài hơn có tốc độ cao hơn.",
      nodes: {
        A: { x: 75, y: 225, name: "Khu dân cư" }, B: { x: 230, y: 225, name: "Ngã ba Tây" },
        C: { x: 390, y: 225, name: "Chợ" }, D: { x: 540, y: 225, name: "Ngã ba Đông" },
        E: { x: 285, y: 95, name: "Vành đai Tây" }, F: { x: 520, y: 95, name: "Vành đai Đông" },
        G: { x: 650, y: 325, name: "Trường học" }, H: { x: 375, y: 345, name: "Sân vận động" },
      },
      roads: [
        road("01", "A", "B", "Đường Dân cư", 13), road("02", "B", "C", "Lối vào Chợ", 4, { congested: true }),
        road("03", "C", "D", "Đường Qua chợ", 4, { congested: true }), road("04", "B", "E", "Lối lên Vành đai", 14),
        road("05", "E", "F", "Đường Vành đai", 21), road("06", "F", "D", "Lối xuống Vành đai", 14),
        road("07", "B", "H", "Đường Sân vận động", 10), road("08", "H", "G", "Đường phía Nam", 10),
        road("09", "D", "G", "Đường Trường học", 14),
      ],
    },
    {
      id: "oneway", name: "Phố một chiều", start: "A", goal: "G",
      description: "Đoạn thẳng tới đích chỉ cho xe chạy chiều ngược lại. Xe phải tìm lộ trình đúng chiều qua các ngã rẽ.",
      nodes: {
        A: { x: 75, y: 225, name: "Bãi đỗ" }, B: { x: 235, y: 225, name: "Ngã tư Tây" },
        C: { x: 235, y: 85, name: "Phố Cao" }, D: { x: 510, y: 85, name: "Phố Cổ" },
        E: { x: 510, y: 225, name: "Ngã tư Đông" }, F: { x: 380, y: 345, name: "Quảng trường" },
        G: { x: 645, y: 225, name: "Bưu điện" },
      },
      roads: [
        road("01", "A", "B", "Đường Bãi đỗ", 14), road("02", "E", "B", "Phố Một chiều", 18, { oneWay: true }),
        road("03", "B", "C", "Lối lên Phố Cao", 14, { oneWay: true }), road("04", "C", "D", "Đường Phố Cổ", 16),
        road("05", "D", "E", "Lối xuống Ngã tư Đông", 14, { oneWay: true }), road("06", "B", "F", "Đường Quảng trường Tây", 10),
        road("07", "F", "E", "Đường Quảng trường Đông", 10), road("08", "E", "G", "Đường Bưu điện", 14),
      ],
    },
  ];

  function length(map, road) {
    const a = map.nodes[road.from], b = map.nodes[road.to];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function crossingGeometry(map) {
    if (!map.crossing) return null;
    const crossing = map.crossing, road = map.roads.find(road => road.id === crossing.road);
    const a = map.nodes[road.from], b = map.nodes[road.to], metres = length(map, road);
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, nx: (a.y - b.y) / metres, ny: (b.x - a.x) / metres };
  }

  function travel(map, road, departure, metres) {
    const driving = metres / road.speed, crossing = map.crossing;
    if (!crossing || crossing.road !== road.id) return { seconds: driving, driving, wait: 0, stopAfter: 0 };
    const halfWindow = crossing.duration * crossing.clearance / (2 * crossing.span);
    const begin = crossing.start + crossing.duration / 2 - halfWindow, end = begin + 2 * halfWindow;
    const stopAfter = (metres / 2 - 18) / road.speed;
    const enter = departure + stopAfter, exit = enter + 36 / road.speed;
    const wait = enter < end && exit > begin ? end - enter : 0;
    return { seconds: driving + wait, driving, wait, stopAfter };
  }

  function shortestRoute(map, from, to, closed, departure = 0) {
    const pending = new Set(Object.keys(map.nodes));
    const distance = new Map([[from, 0]]), previous = new Map();
    while (pending.size) {
      let node, best = Infinity;
      for (const candidate of pending) {
        const time = distance.get(candidate) ?? Infinity;
        if (time < best) { node = candidate; best = time; }
      }
      if (node === undefined) return null;
      if (node === to) break;
      pending.delete(node);
      for (const road of map.roads) {
        if (closed.has(road.id)) continue;
        const next = road.from === node ? road.to : !road.oneWay && road.to === node ? road.from : null;
        if (!pending.has(next)) continue;
        const metres = length(map, road), traversal = travel(map, road, departure + best, metres);
        if (best + traversal.seconds >= (distance.get(next) ?? Infinity)) continue;
        distance.set(next, best + traversal.seconds);
        previous.set(next, { from: node, to: next, road, metres, ...traversal });
      }
    }
    const steps = [];
    for (let node = to; node !== from;) {
      const step = previous.get(node);
      if (!step) return null;
      steps.unshift(step);
      node = step.from;
    }
    return { steps, seconds: distance.get(to), metres: steps.reduce((sum, step) => sum + step.metres, 0) };
  }

  class RouteSimulation {
    constructor(map) {
      this.map = map;
      this.reset();
    }

    copy() {
      return Object.assign(Object.create(RouteSimulation.prototype), this, {
        closed: new Set(this.closed),
        active: this.active ? { ...this.active } : null,
      });
    }

    reset() {
      this.destination = this.map.goal;
      this.closed = new Set(this.map.roads.filter(road => road.closed).map(road => road.id));
      this.restart();
    }

    restart() {
      this.node = this.map.start;
      this.active = null;
      this.heading = 0;
      this.elapsed = 0;
      this.plan();
      if (this.route?.steps.length) this.heading = this.angle(this.route.steps[0]);
    }

    plan() {
      const remaining = this.active ? this.active.seconds - this.active.elapsed : 0;
      this.route = shortestRoute(this.map, this.active?.to ?? this.node, this.destination, this.closed, this.elapsed + remaining);
    }

    setDestination(node) {
      this.destination = node;
      this.plan();
    }

    toggleRoad(id) {
      if (!this.closed.delete(id)) this.closed.add(id);
      this.plan();
    }

    get arrived() { return !this.active && this.node === this.destination; }
    get canMove() { return !!(this.active || this.route?.steps.length); }
    get waiting() {
      const step = this.active;
      return !!(step?.wait && step.elapsed >= step.stopAfter && step.elapsed < step.stopAfter + step.wait);
    }

    get progress() {
      const step = this.active;
      if (!step) return 0;
      const drivingTime = step.elapsed < step.stopAfter ? step.elapsed : Math.max(step.stopAfter, step.elapsed - step.wait);
      return drivingTime / step.driving;
    }

    advance(seconds) {
      while (seconds > 0 && this.canMove) {
        if (!this.active) {
          this.active = { ...this.route.steps[0], elapsed: 0 };
          this.heading = this.angle(this.active);
          this.plan();
        }
        const step = this.active, remaining = step.seconds - step.elapsed;
        const dt = Math.min(seconds, remaining);
        this.elapsed += dt;
        seconds -= dt;
        if (dt < remaining) {
          step.elapsed += dt;
        } else {
          this.node = step.to;
          this.active = null;
          this.plan();
        }
      }
    }

    angle(step) {
      const a = this.map.nodes[step.from], b = this.map.nodes[step.to];
      return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
    }

    position() {
      const a = this.map.nodes[this.node];
      if (!this.active) return a;
      const b = this.map.nodes[this.active.to], progress = this.progress;
      return { x: a.x + (b.x - a.x) * progress, y: a.y + (b.y - a.y) * progress };
    }

    crossingPosition() {
      const crossing = this.map.crossing, center = crossingGeometry(this.map);
      if (!crossing) return null;
      const progress = Math.max(0, Math.min(1, (this.elapsed - crossing.start) / crossing.duration));
      const offset = (2 * progress - 1) * crossing.span;
      return { x: center.x + center.nx * offset, y: center.y + center.ny * offset,
        angle: Math.atan2(center.ny, center.nx) * 180 / Math.PI, kind: crossing.kind,
        moving: progress > 0 && progress < 1 };
    }
  }

  const api = { maps, length, crossingGeometry, shortestRoute, RouteSimulation };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RouteSim = api;
})(this);
