const test = require('node:test');
const assert = require('node:assert/strict');
const KeyboardDrive = require('../viz/keyboard.js');
const S = require('../viz/sim.js');

test('WASD and arrows accelerate, brake and steer with simultaneous inputs', () => {
  for (const [gas, left, right, brake] of [
    ['KeyW', 'KeyA', 'KeyD', 'KeyS'],
    ['ArrowUp', 'ArrowLeft', 'ArrowRight', 'ArrowDown'],
  ]) {
    const input = new KeyboardDrive();
    input.set(gas, true); input.set(left, true);
    assert.deepEqual(input.command(), { acc: 3, steer: -1 });
    input.set(right, true);
    assert.equal(input.command().steer, 0);
    input.set(left, false);
    assert.equal(input.command().steer, 1);
    input.set(brake, true);
    assert.equal(input.command().acc, -6);
    input.set('Space', true);
    assert.equal(input.command().acc, -9);
    input.clear();
    assert.deepEqual(input.command(), { acc: -0.3, steer: 0 });
  }
});

test('releasing one alias preserves the other, repeat and unrelated keys are safe', () => {
  const input = new KeyboardDrive();
  input.set('KeyW', true); input.set('KeyW', true);
  input.set('ArrowUp', true); input.set('KeyW', false);
  assert.equal(input.command().acc, 3);
  input.set('ArrowUp', false);
  assert.equal(input.command().acc, -0.3);
  assert.equal(input.set('Tab', true), false);
});

test('manual physics accelerates, turns both ways, brakes to zero without reversing', () => {
  for (const [key, sign] of [['KeyA', -1], ['KeyD', 1]]) {
    const world = new S.World({ ego: 'manual', tEnd: 14 });
    const input = new KeyboardDrive(), v0 = world.ego.v, z0 = world.ego.z;
    input.set('KeyW', true); input.set(key, true);
    for (let i = 0; i < 10; i++) world.step(input.command());
    assert.ok(world.ego.v > v0);
    assert.ok((world.ego.z - z0) * sign > 0);
    input.set('Space', true);
    for (let i = 0; i < 60; i++) world.step(input.command());
    assert.equal(world.ego.v, 0);
    assert.ok(Number.isFinite(world.ego.x));
  }
});

test('a live record ends at 14 seconds and restart restores the initial state', () => {
  const input = new KeyboardDrive(); input.set('KeyW', true);
  const world = new S.World({ ego: 'manual', tEnd: 14 });
  while (!world.done) world.step(input.command());
  const record = world.record();
  assert.equal((record.nf - 1) * S.DT, 14);
  const endFrame = world.f; world.step(input.command());
  assert.equal(world.f, endFrame);
  const restarted = new S.World({ ego: 'manual', tEnd: 14 });
  assert.equal(restarted.f, 0);
  assert.equal(restarted.ego.x, 0);
  assert.equal(restarted.events.length, 0);
});
