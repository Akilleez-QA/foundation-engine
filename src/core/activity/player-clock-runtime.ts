import type {GameClock} from '../clock';
import {createPlayerClock, type PlayerClockOptions} from '../player-clock';
import type {SaveStore} from '../save/section';
import type {FrameLoop} from './loop';

declare module '../probe' {
  interface EngineProbes {
    clock: {ut: number; warp: number; paused: boolean};
  }
}

declare module '../services' {
  interface Services {
    readonly clock: GameClock;
  }
}

let installed: GameClock | undefined;
/** Legacy calendar consumers read the same service; this never creates a stand-in clock. */
export function appClock(): GameClock {
  if (!installed) throw new Error('core.clock is not installed');
  return installed;
}

/** One save-backed clock on the app's existing loop. Simulation consumers never receive its driver. */
export function installPlayerClockRuntime(
  store: SaveStore,
  loop: FrameLoop,
  options: PlayerClockOptions & {beforeAdvance?: () => void} = {},
) {
  if (installed) throw new Error('core.clock already has an installed owner');
  const player = createPlayerClock(store, options);
  player.clock.pause('core.boot');
  let detach: () => void;
  try {
    detach = loop.attachClock({
      advance(dt) {
        options.beforeAdvance?.();
        return player.driver.advance(dt);
      },
      resumeFromAway: reason => player.driver.resumeFromAway(reason),
    });
  } catch (error) {
    player.dispose();
    throw error;
  }
  installed = player.clock;
  let disposed = false,
    started = false;
  return {
    clock: player.clock,
    /** Called at app.started, after subscribers install; boot work never advances the player's UT. */
    start() {
      if (disposed || started) return;
      started = true;
      player.clock.resume('core.boot');
      player.driver.resumeFromAway('load');
    },
    record() {
      if (!disposed) player.record();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (installed === player.clock) installed = undefined;
      detach();
      player.record();
      player.dispose();
      store.flush('clock-dispose');
    },
  };
}
