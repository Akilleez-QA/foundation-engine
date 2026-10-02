import test from 'node:test';
import assert from 'node:assert/strict';
import { defineScene, defineSystem } from '../../author';
import { testScene } from '../../author/testing';
import { createRollbackSession } from './session';
import { baseLimits, toyPorts } from './test-harness';
import type { RollbackSession } from './types';

/**
 * Representative consumer: two sessions owned by one scene visit and driven from the stock fixed lane, with a
 * one-tick loopback link. The scene's own signal retires both sessions on exit.
 */
test('ROLLBACK sessions advance once per fixed tick from a scene system and retire with the visit', async () => {
  const controller = new AbortController();
  const ports = [toyPorts(), toyPorts()];
  const sessions: RollbackSession[] = ports.map((p, local) =>
    createRollbackSession({ local, neutralInput: 'n', limits: baseLimits, ports: p, signal: controller.signal }));
  let wire: { to: number; frame: number; input: string }[] = [];
  const counts = { advanced: 0, other: 0 };
  const netplay = defineSystem({ id: 'rollback-netplay', run(ctx) {
    const delivering = wire; wire = [];
    for (const m of delivering) sessions[m.to].remote(1 - m.to, m.frame, m.input);
    for (const [i, s] of sessions.entries()) {
      const l = s.local(ctx.random() < 0.5 ? 'r' : 'l');
      if (l.status === 'queued') wire.push({ to: 1 - i, frame: l.frame, input: l.input });
      if (s.advance().status === 'advanced') counts.advanced++; else counts.other++;
    }
  } });
  const scene = defineScene({ id: 'rollback-consumer', title: 'Rollback consumer', systems: [netplay], exit: () => controller.abort() });
  const t = await testScene(scene, { seed: 5 });
  t.run(2);
  assert.equal(counts.advanced + counts.other, 240, 'one advance per session per fixed tick (2 s at 60 Hz)');
  assert.equal(counts.other, 0, 'a one-tick link never exhausts an 8-frame window');
  assert.deepEqual(sessions.map(s => s.read().frame), [120, 120]);
  const a = sessions[0].confirmedState()!, b = sessions[1].confirmedState()!;
  assert.equal(a.frame, b.frame);
  assert.equal(a.checksum, b.checksum);
  t.dispose();
  assert.deepEqual(sessions.map(s => s.read().status), ['retired', 'retired']);
});
