const assert = require('node:assert/strict');
const test = require('node:test');
const sim = require('../viz/sim.js');
const scenes = require('../viz/merge-scenes.js');

function options(scene, tEnd = scene.duration || 14) {
  const params = {
    pedT0: 1e9, busGo: 1e9, cutT0: 99, tgMode: 'idm', react: 0.6, tgT: 1.4,
    egoV0: scene.kind ? 11 : 14, rearGap: scene.kind ? 17.4 : 21.6
  };
  if (scene.kind === 'journey') {
    Object.assign(params, { labJourney: scene, labOvertake: scene.overtake,
      pedT0: scene.pedestrianAt, pedGap: null, pedV: 1.8 });
  } else if (scene.kind === 'overtake') {
    params.labOvertake = scene;
  } else {
    params.labMerge = scene;
  }
  return { params, ego: 'trajectory', others: 'reactive', tEnd };
}

test('a one-frame run already has a predicted trajectory and an arrow', () => {
  const scene = scenes[0];
  const short = sim.run(options(scene, 0.001));
  const longer = sim.run(options(scene, 0.2));
  assert.equal(short.nf, 1);
  assert.deepEqual(short.decisions[0], longer.decisions[0]);
  assert.ok(Math.abs(short.decisions[0].horizon - 2.4) < 1e-9);
  assert.equal(sim.guidanceAt(short, 0).head.length, 3);
});

test('the same cut-in yields a different lane decision when a car occupies the left lane', () => {
  const scene = { ...scenes[0], preferredCarLane: undefined };
  const open = new sim.World(options(scene, 2));
  const blocked = new sim.World(options(scene, 2));
  const laneStart = sim.LANES.E1.pts[0];
  for (let i = 0; i < 31; i++) {
    open.step();
    blocked.step();
  }
  const other = blocked.A.find(actor => actor.id === 'C2');
  Object.assign(other, { lane: 'E1', s: blocked.ego.x - laneStart[0], d: 0,
    v: blocked.ego.v, ctl: 'const', cut: null, travelPath: null });
  open.step();
  blocked.step();
  assert.equal(open.decisions[31].targetZ, laneStart[1]);
  assert.equal(blocked.decisions[31].targetZ, sim.LANES.E2.pts[0][1]);
  assert.ok(blocked.ego.a < 0);
});

test('the visible arrow ends before an actor in the current view', () => {
  const record = sim.run(options(scenes[0], 0.001));
  const unobstructed = sim.guidanceAt(record, 0);
  const index = record.actors.findIndex(actor => actor.id === 'L1');
  record.F[index * 8] = 11;
  record.F[index * 8 + 1] = record.F[1];
  const obstructed = sim.guidanceAt(record, 0);
  assert.ok(unobstructed.head[1][0] > 11);
  assert.ok(obstructed.head[1][0] < 11 - record.actors[index].dims.len / 2);
  assert.strictEqual(obstructed.decision, unobstructed.decision);
});

test('a close following car makes the planner slow earlier for a waiting pedestrian', () => {
  function approach(crossingX, withFollower) {
    const world = new sim.World({ ego: 'trajectory', params: { egoV0: 13.9 } });
    const states = [
      { ...world.ego, ...sim.CAR, hx: 1, hz: 0, idx: 0, kind: 'car' },
      { x: crossingX, z: 9.2, hx: 0, hz: -1, v: 0, idx: 1, kind: 'ped', len: .6, wid: .6 }
    ];
    if (withFollower) {
      states.push({ ...sim.CAR, x: -14, z: world.ego.z, hx: 1, hz: 0, v: 13.9, idx: 2, kind: 'car' });
    }
    world.hist = [states];
    return { acceleration: world.planTrajectory(states, 0), decision: world.decisions[0] };
  }

  const clear = approach(84, false);
  const withFollower = approach(84, true);
  assert.equal(clear.decision.rear.index, -1);
  assert.equal(withFollower.decision.rear.index, 2);
  assert.equal(withFollower.decision.rear.close, true);
  assert.equal(withFollower.decision.action, 'plan-caution');
  assert.ok(withFollower.acceleration < clear.acceleration);
  assert.ok(approach(40, true).acceleration > approach(40, false).acceleration);
});

test('the planner runs the street presets and yields to the crossing pedestrian', () => {
  for (const scene of scenes) {
    const record = sim.run(options(scene));
    assert.deepEqual(record.events.filter(event => event.ego), [], scene.id);
    assert.equal(record.decisions.length, record.nf, scene.id);
    if (scene.kind === 'journey') {
      assert.deepEqual(record.events, []);
      assert.ok(record.marks.some(mark => mark.k === 'ped-step-out'));
      const earlyCaution = record.marks.find(mark => mark.k === 'plan-caution');
      assert.ok(earlyCaution.t < record.marks.find(mark => mark.k === 'ped').t);
      const intersectionCaution = record.marks.find(mark => mark.k === 'plan-intersection');
      assert.ok(intersectionCaution.t < sim.SIG.mY);
      assert.ok(record.marks.some(mark => mark.k === 'plan-yellow'));
      const atYellow = sim.poseAt(record, 0, sim.SIG.mY);
      assert.ok(atYellow.acc < 0 && atYellow.acc > -2);
      assert.ok(sim.poseAt(record, 0, sim.SIG.mY + 1).v < atYellow.v);
      const stopMark = record.marks.find(mark => mark.k === 'plan-stop-line');
      assert.ok(stopMark.t >= sim.SIG.mY && stopMark.t < sim.SIG.mG);
      const stopped = sim.poseAt(record, 0, stopMark.t);
      assert.ok(stopped.v < 1e-6);
      const lineGap = sim.ROAD.stopE - stopped.x - sim.CAR.len / 2;
      assert.ok(lineGap >= .5 && lineGap <= 1.2);
      assert.equal(sim.poseAt(record, 0, sim.SIG.mG).x, stopped.x);
      assert.ok(sim.poseAt(record, 0, sim.SIG.mG + .5).x > stopped.x);
      const signal = record.marks.find(mark => mark.k === 'rear-pass-signal');
      const shift = record.marks.find(mark => mark.k === 'rear-pass-right');
      const passed = record.marks.find(mark => mark.k === 'rear-pass-complete');
      const passingCar = record.actors.findIndex(actor => actor.id === scene.rearPass.actor);
      const signalling = sim.poseAt(record, passingCar, signal.t + sim.DT);
      const passedPose = sim.poseAt(record, passingCar, passed.t + sim.DT);
      assert.ok(shift.t >= signal.t + scene.rearPass.signalLead - 1e-6 && passed.t > shift.t);
      assert.ok(signalling.rightIndicator && signalling.x < sim.poseAt(record, 0, signal.t + sim.DT).x);
      assert.equal(passedPose.z, sim.LANES.E2.pts[0][1]);
      assert.ok(!passedPose.rightIndicator && passedPose.x > sim.poseAt(record, 0, passed.t + sim.DT).x);
      assert.ok(record.decisions.some(decision => decision.action === 'plan-yield'));
      assert.equal(record.decisions[Math.round(4 / sim.DT)].targetZ, sim.LANES.E1.pts[0][1]);
      const motorcycle = record.actors.findIndex(actor => actor.id === 'MB');
      const cut = scene.cuts.find(item => item.actor === 'MB');
      assert.ok(sim.poseAt(record, motorcycle, cut.at).z < sim.poseAt(record, motorcycle, cut.at + cut.scene.duration).z);
      assert.equal(sim.poseAt(record, motorcycle, cut.at + cut.scene.duration).z, sim.LANES.E2.pts[0][1]);
      assert.ok(sim.poseAt(record, 0, scene.duration).x > scene.pedestrianRetreat.x);
    }
  }
});
