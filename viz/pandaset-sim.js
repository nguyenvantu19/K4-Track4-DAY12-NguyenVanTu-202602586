/* Replay real actor tracks and run the lab's local trajectory planner against them. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./sim.js"));
  else root.PandaSetSim = factory(root.ReplaySim);
})(this, function (sim) {
  "use strict";

  function tracksFor(scene) {
    var tracks = scene.actors.map(function (a) {
      return { label: a[0], kind: a[1], len: a[2], wid: a[3], height: a[4], samples: [] };
    });
    var ego = { label: "Xe ta", kind: "car", len: sim.CAR.len, wid: sim.CAR.wid, height: 1.55, samples: [] };
    scene.frames.forEach(function (frame) {
      ego.samples.push([frame.t].concat(frame.ego));
      frame.actors.forEach(function (a) { tracks[a[0]].samples.push([frame.t].concat(a.slice(1))); });
    });
    return [ego].concat(tracks);
  }

  function trackAt(track, t) {
    var samples = track.samples;
    if (!samples.length || t < samples[0][0] - 1e-6 || t > samples[samples.length - 1][0] + 1e-6) return null;
    var lo = 0, hi = samples.length - 1;
    while (hi - lo > 1) {
      var mid = (lo + hi) >> 1;
      if (samples[mid][0] <= t) lo = mid; else hi = mid;
    }
    var a = samples[lo], b = samples[hi], dt = b[0] - a[0];
    if (dt > .22 && t > a[0] + .001 && t < b[0] - .001) return null;
    var u = dt > 0 ? Math.max(0, Math.min(1, (t - a[0]) / dt)) : 0;
    var angle = b[3] - a[3], yaw = a[3] + Math.atan2(Math.sin(angle), Math.cos(angle)) * u;
    var dx = b[1] - a[1], dz = b[2] - a[2];
    return { x: a[1] + u * dx, z: a[2] + u * dz, th: yaw,
      hx: Math.cos(yaw), hz: Math.sin(yaw), v: dt > 0 ? Math.hypot(dx, dz) / dt : 0,
      len: track.len, wid: track.wid, kind: track.kind };
  }

  function minCornerDistance(a, b) {
    var result = Infinity;
    [-1, 1].forEach(function (i) {
      [-1, 1].forEach(function (j) {
        var x = a.x + i * a.l * a.hx - j * a.w * a.hz - b.x;
        var z = a.z + i * a.l * a.hz + j * a.w * a.hx - b.z;
        var longitudinal = Math.max(0, Math.abs(x * b.hx + z * b.hz) - b.l);
        var lateral = Math.max(0, Math.abs(-x * b.hz + z * b.hx) - b.w);
        result = Math.min(result, Math.hypot(longitudinal, lateral));
      });
    });
    return result;
  }

  function measure(states, metrics, t) {
    var ego = states[0], box = sim.obb(ego, ego);
    states.forEach(function (actor, i) {
      if (!actor || !i || Math.abs(actor.x - ego.x) > 35 || Math.abs(actor.z - ego.z) > 20) return;
      var other = sim.obb(actor, actor);
      if (sim.overlap(box, other)) {
        metrics.contacts.add(i);
        metrics.clearance = 0;
      } else {
        metrics.clearance = Math.min(metrics.clearance, minCornerDistance(box, other), minCornerDistance(other, box));
      }
    });
    if (metrics.brakeAt == null && ego.acc < -1) metrics.brakeAt = t;
  }

  function run(scene) {
    var tracks = tracksFor(scene), end = scene.frames[scene.frames.length - 1].t;
    var world = new sim.World({ ego: "trajectory" });
    var initial = trackAt(tracks[0], 0);
    Object.assign(world.ego, { x: initial.x, z: initial.z, th: initial.th, v: initial.v });
    var clocks = tracks.map(function () { return 0; }), slowed = new Set(), frames = [];
    var replayMetrics = { clearance: Infinity, contacts: new Set(), brakeAt: null };
    var simulationMetrics = { clearance: Infinity, contacts: new Set(), brakeAt: null };
    var previous = [], priorSpeed = initial.v;

    for (var f = 0; f <= Math.floor(end / sim.DT + 1e-6); f++) {
      var t = f * sim.DT;
      var replay = tracks.map(function (track) { return trackAt(track, t); });
      var states = [Object.assign({}, world.ego, { idx: 0, hx: Math.cos(world.ego.th), hz: Math.sin(world.ego.th),
        len: sim.CAR.len, wid: sim.CAR.wid, kind: "car" })];
      for (var i = 1; i < tracks.length; i++) {
        if (!replay[i]) { clocks[i] = t + sim.DT; continue; }
        var track = tracks[i], actor = trackAt(track, clocks[i]) || replay[i];
        var gap = states[0].x - actor.x - (track.len + sim.CAR.len) / 2;
        var moving = actor.v;
        if (track.kind === "car" && actor.hx > .75 && gap > 0 &&
            Math.abs(actor.z - states[0].z) < (track.wid + sim.CAR.wid) / 2 + .35) {
          moving = Math.min(actor.v, Math.max(0, states[0].v + .6 * (gap - Math.max(6, actor.v))));
          if (moving < actor.v - .1) slowed.add(i);
        }
        clocks[i] = Math.min(t + sim.DT, clocks[i] + (actor.v > .1 ? moving / actor.v : 1) * sim.DT);
        states[i] = Object.assign({}, actor, { v: moving, idx: i });
      }
      world.f = f;
      // A track may first enter the view on this step. Its first observation
      // is also its history until a previous pose is available.
      world.hist = [states, states.map(function (actor, i) { return previous[i] || actor; })];
      var acceleration = world.planTrajectory(states, t);
      states[0].acc = acceleration;
      replay[0].acc = (replay[0].v - priorSpeed) / sim.DT;
      priorSpeed = replay[0].v;
      measure(replay, replayMetrics, t);
      measure(states, simulationMetrics, t);
      frames.push({ t: t, replay: replay, simulation: states, decision: world.decisions[f] });
      previous = states;
      world.advanceEgo(states[0], acceleration, "trajectory");
    }
    return { tracks: tracks, frames: frames, replay: replayMetrics, simulation: simulationMetrics, slowed: slowed.size };
  }

  return { run: run };
});
