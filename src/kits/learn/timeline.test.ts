import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TimelinePlayer } from './timeline';
import { kidSafeProblems, scriptedProvider } from './provider';
import type { Action } from './lesson';
import { must } from '../../testing/must';

const script: Action[] = [
  { do: 'say', who: 'teacher', text: 'one two three four' },
  { do: 'draw', target: 'earth' },
  { do: 'wait-for', event: 'next' },
  { do: 'branch', if: { answer: 'q1', is: 'a' }, then: [{ do: 'say', who: 'teacher', text: 'yes' }], else: [{ do: 'say', who: 'teacher', text: 'look again' }] },
  { do: 'reveal', target: 'sun' },
];

test('timeline: deterministic, gated, scrubbable and replayable', () => {
  const answers: Record<string, string> = {};
  const p = new TimelinePlayer(script, { answers: () => answers });
  p.tick(0.5);
  assert.deepEqual(p.state().caption, { who: 'teacher', text: 'one two three four' });
  assert.equal(p.state().items.earth, undefined, 'the drawing has not started');
  p.tick(10);
  assert.ok(Math.abs(p.time - 2.48) < 1e-9, 'time stops at the gate');
  assert.equal(p.state().waiting?.event, 'next');
  assert.equal(must(p.state().items.earth).progress, 1);
  p.scrub(1.88);
  assert.ok(Math.abs(must(p.state().items.earth).progress - 0.5) < 1e-9, 'half drawn half-way');
  assert.equal(p.satisfy('next'), false, 'the gate is ahead of a scrubbed time');
  p.skip(); answers.q1 = 'a';
  assert.ok(p.satisfy('next'));
  p.tick(10);
  assert.equal(p.state().caption?.text, 'yes', 'the branch was decided when reached');
  answers.q1 = 'b';
  p.again(); p.tick(10);
  assert.equal(p.state().caption?.text, 'yes', 'a decided branch never changes');
  assert.ok(must(p.state().items.sun).visible && p.state().done);
});

test('timeline: reduced motion draws at once; pause holds time', () => {
  const p = new TimelinePlayer([{ do: 'draw', target: 'x' }, { do: 'wait-for', event: 'next' }], { reducedMotion: true });
  assert.equal(p.limit, 0);
  assert.equal(must(p.state().items.x).progress, 1);
  const q = new TimelinePlayer(script); q.pause(); q.tick(1); assert.equal(q.time, 0); q.resume(); q.tick(1); assert.equal(q.time, 1);
});

test('provider: the scripted provider answers by prompt; the kid-safe check rejects links, personal data and violence', async () => {
  const p = scriptedProvider({ why: [{ do: 'say', who: 'teacher', text: 'Because the Earth spins.' }] });
  assert.equal((await p.respond('why', { lesson: 'l', scene: 's', text: k => k })).length, 1);
  assert.deepEqual(await p.respond('nope', { lesson: 'l', scene: 's', text: k => k }), []);
  const id = (k: string) => k;
  assert.deepEqual(kidSafeProblems([{ do: 'say', who: 't', text: 'The Earth turns once a day.' }], id), []);
  assert.equal(kidSafeProblems([{ do: 'say', who: 't', text: 'see https://example.com' }], id).length, 1);
  assert.equal(kidSafeProblems([{ do: 'say', who: 't', text: 'what is your address?' }], id).length, 1);
});

test('timeline: the objectives card is up from the objectives action until the next gate is passed, then never again', () => {
  const p = new TimelinePlayer([
    { do: 'objectives' }, { do: 'say', who: 'teacher', text: 'hello' }, { do: 'wait-for', event: 'next' },
    { do: 'draw', target: 'sun' }, { do: 'wait-for', event: 'next' },
  ]);
  p.tick(0.1);
  assert.equal(p.state().objectives, true, 'stated at the start, before the first gate');
  p.tick(10);
  assert.equal(p.state().waiting?.event, 'next');
  assert.equal(p.state().objectives, true);
  assert.ok(p.satisfy('next'));
  assert.equal(p.state().objectives, false, 'Next puts the card away at once');
  p.tick(10);
  assert.equal(must(p.state().items.sun).progress, 1);
  assert.equal(p.state().objectives, false, 'it does not come back over the drawing at the next gate');
});
