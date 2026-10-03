import type {TickerHandle} from '../../core/activity/loop';
import type {ActivityContext} from '../../core/activity/activity';
import type {LayerPort} from '../../core/activity/ports';
import {appLayers} from './runtime';

/** Staged local frames: preparation draws at zero dt; coverage clears input immediately. */
export class VisitFrames {
  private ticker: TickerHandle | null = null;
  private running = false;
  private visible = true;
  constructor(
    private ctx: ActivityContext,
    private active: () => boolean,
    private frame: (dt: number) => void,
    private suspend: () => void,
    layers: Pick<LayerPort, 'onChange'> = appLayers(),
  ) {
    ctx.own(
      layers.onChange(() => {
        if (ctx.coverage() !== 'top') suspend();
      }),
    );
    ctx.own(() => this.stop());
  }
  start() {
    this.running = true;
    this.schedule();
  }
  stop() {
    this.running = false;
    this.ticker?.remove();
    this.ticker = null;
  }
  setVisible(visible: boolean) {
    if (this.visible === visible) return;
    this.visible = visible;
    this.ticker?.remove();
    this.ticker = null;
    if (!visible) this.suspend();
    this.schedule();
  }
  private schedule() {
    if (this.ctx.signal.aborted || !this.running || !this.visible || (this.ticker && !this.ticker.removed)) return;
    this.ticker = this.ctx.ticker({
      mode: 'continuous',
      whenCovered: 'pause',
      render: f => this.frame(this.active() ? f.dt : 0),
    });
  }
}
