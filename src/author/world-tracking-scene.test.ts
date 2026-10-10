import {test} from 'node:test';
import assert from 'node:assert/strict';
import {changed, defineComponent, defineScene, defineSystem, sinceLastRun, type Entity, type Observer} from './index';
import {testScene} from './testing';

const Heat = defineComponent('heat', {level: 0});

test('scene: observers are delivered after each system and sinceLastRun sees the earlier system changes', async () => {
  const log: string[] = [];
  let observer: Observer | undefined;
  let hot: Entity = 0,
    cold: Entity = 0;
  const scene = defineScene({
    id: 'tracking',
    title: 'Tracking',
    enter(ctx) {
      ctx.world.trackChanges(Heat);
      hot = ctx.world.spawn(Heat());
      cold = ctx.world.spawn(Heat());
      observer = ctx.world.observe({on: 'change', type: Heat, run: ev => log.push(`observed ${ev.entity}`)});
    },
    systems: [
      defineSystem({
        id: 'warm',
        run(ctx) {
          ctx.world.get(hot, Heat)!.level++;
          ctx.world.markChanged(hot, Heat);
          log.push('warm');
        },
      }),
      defineSystem(
        sinceLastRun({
          id: 'watch',
          world: ctx => ctx.world,
          run(ctx, _dt, since) {
            for (const [e, heat] of ctx.world.queryFiltered(since, [changed(Heat)], Heat))
              log.push(`watch ${e}=${heat.level}`);
          },
        }),
      ),
    ],
  });
  const t = await testScene(scene);
  t.run(1 / 60);
  t.run(1 / 60);
  assert.deepEqual(log, [
    'warm',
    `observed ${hot}`, // flushed at the end of the system that changed it, before the next system
    `watch ${hot}=1`,
    `watch ${cold}=0`, // the first run of a sinceLastRun system sees every tracked component
    'warm',
    `observed ${hot}`,
    `watch ${hot}=2`,
  ]);
  assert.equal(observer?.active, true);
});

test('scene: an observer error is reported as a failure of the system whose changes it observed', async () => {
  const scene = defineScene({
    id: 'tracking-failure',
    title: 'Tracking failure',
    enter(ctx) {
      ctx.world.observe({
        on: 'despawn',
        run: () => {
          throw Error('observer broke');
        },
      });
    },
    systems: [
      defineSystem({
        id: 'reaper',
        run(ctx) {
          ctx.world.despawn(ctx.world.spawn());
        },
      }),
    ],
  });
  const t = await testScene(scene);
  assert.throws(() => t.run(1 / 60), /system reaper failed/);
});
