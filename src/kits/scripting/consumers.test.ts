import test from 'node:test';
import assert from 'node:assert/strict';
import {defineScene, defineSystem, Name, testScene, Transform, type SceneContext} from '../../author';
import {createRollbackSyncTest} from '../rollback';
import {createScriptHost, loadScriptVm, scriptTickSystem, type ScriptHost} from './index';

const loadNodeVm = () => import('./lua-vm').then(m => m.createLuaVm());

const PATROL = `
  state.dir = state.dir or 1
  state.steps = state.steps or 0
  function step(input)
    if input == 'turn' then state.dir = -state.dir end
    state.steps = state.steps + 1
    host.move(state.dir * (1 + math.random(0, 2)))
  end
  function start() every(10, 'pause') end
  function pause() state.paused = (state.paused or 0) + 1 end
`;

test('SCRIPT consumer: a rollback sync test passes when all simulation state is in `state`', async () => {
  const vm = await loadScriptVm({load: loadNodeVm});
  let x = 0;
  const h = createScriptHost(vm, {seed: 99, api: {move: {cost: 5, run: ([dx]) => void (x += dx as number)}}});
  assert.equal(h.load('patrol', PATROL, {capabilities: ['move']}).status, 'loaded');
  assert.equal(h.call('patrol', 'start').status, 'ok');
  const sync = createRollbackSyncTest({
    checkDistance: 6,
    maxStateBytes: 65536,
    maxInputBytes: 8,
    players: 1,
    ports: {
      save: () => {
        const s = h.save();
        if (!s.ok) throw Error(s.message);
        return JSON.stringify({x, scripts: s.snapshot});
      },
      load: text => {
        const parsed = JSON.parse(text) as {x: number; scripts: unknown};
        x = parsed.x;
        const r = h.restore(parsed.scripts, {patrol: PATROL});
        if (!r.ok) throw Error(r.message);
      },
      step: inputs => {
        const r = h.call('patrol', 'step', [inputs[0] ?? '']);
        if (r.status !== 'ok') throw Error(JSON.stringify(r));
        h.tick();
      },
    },
  });
  for (let f = 0; f < 40; f++) {
    const r = sync.advance([f % 7 === 0 ? 'turn' : '']);
    assert.equal(r.status, 'checked', JSON.stringify(r));
  }
  sync.dispose();
  h.dispose();
});

test('SCRIPT consumer: state hidden in a Lua local is lost on restore, and the sync test finds it', async () => {
  const vm = await loadScriptVm({load: loadNodeVm});
  const HIDDEN = `local hidden = 0 function step() hidden = hidden + 1 state.seen = hidden end`;
  const h = createScriptHost(vm, {seed: 1});
  h.load('leaky', HIDDEN);
  const sync = createRollbackSyncTest({
    checkDistance: 3,
    maxStateBytes: 65536,
    maxInputBytes: 8,
    players: 1,
    ports: {
      save: () => JSON.stringify((h.save() as {snapshot: unknown}).snapshot),
      load: text => void h.restore(JSON.parse(text), {leaky: HIDDEN}),
      step: () => void h.call('leaky', 'step'),
    },
  });
  let result = sync.advance(['']);
  for (let f = 0; f < 10 && result.status === 'checked'; f++) result = sync.advance(['']);
  assert.equal(result.status, 'desynced');
  sync.dispose();
  h.dispose();
});

test('SCRIPT consumer: a scene loads the VM in prepare, ticks timers on the fixed step and moves an entity', async () => {
  let host: ScriptHost | null = null;
  const scene = defineScene({
    id: 'scripted',
    title: 'Scripted',
    entities: [[Name({name: 'walker'}), Transform({x: 0})]],
    async prepare(_ctx, signal) {
      const vm = await loadScriptVm({signal, load: loadNodeVm});
      host = createScriptHost(vm, {
        seed: 5,
        api: {
          move: {
            run: ([dx]) => {
              const ctx = current;
              const e = ctx?.named('walker');
              const t = e === undefined ? undefined : ctx?.world.get(e, Transform);
              if (t) t.x += dx as number;
              return undefined;
            },
          },
        },
      });
      host.load('walker', `function stride() host.move(0.5) end function start() every(15, 'stride') end`, {
        capabilities: ['move'],
      });
    },
    enter() {
      host?.call('walker', 'start');
    },
    exit() {
      host?.dispose();
      host = null;
    },
  });
  let current: SceneContext | null = null;
  const bind = defineSystem({id: 'bind-context', run: ctx => void (current = ctx)});
  const t = await testScene(scene, {systems: [bind, scriptTickSystem(() => host)]});
  t.run(1);
  const walker = t.ctx.named('walker');
  assert.ok(walker !== undefined);
  assert.equal(t.world.get(walker, Transform)?.x, 2);
  assert.equal(host!.now, 60);
  t.dispose();
  assert.equal(host, null);
});
