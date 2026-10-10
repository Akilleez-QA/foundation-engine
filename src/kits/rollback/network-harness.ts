/**
 * Test support: N rollback peers plus spectators over the seeded lossy link, using the exchange (redundant resend,
 * acknowledgements, departures), agreed delay changes, a peer that disconnects and a spectator that joins late from
 * a confirmed state. Records everything a reference replay needs.
 */
import {createRng} from '../../core/rng';
import {createLossyLink, type LossyLinkOptions, type LossyLinkStats} from './lossy-link';
import {createRollbackExchange, type RollbackExchange, type RollbackMessage} from './exchange';
import {createRollbackSession} from './session';
import {createRollbackSpectator, type RollbackSpectator} from './spectator';
import {recommendInputDelay} from './pacing';
import {rollbackChecksum} from './limits';
import {baseLimits, INPUTS, toyPorts, toyStart, toyStep, type ToyPorts} from './test-harness';
import type {RollbackDelayPolicy, RollbackLimits, RollbackSession} from './types';

type Wire = {kind: 'msg'; body: RollbackMessage} | {kind: 'ack'; spectator: number; ack: readonly number[]};

export interface NetworkRunOptions {
  seed: number;
  players: number;
  ticks: number;
  link: Omit<LossyLinkOptions, 'seed'>;
  limits?: Partial<RollbackLimits>;
  delay?: RollbackDelayPolicy;
  /** Peers in `group` cannot exchange messages with the others between ticks `from` and `to` (then it heals). */
  partition?: {group: readonly number[]; from: number; to: number};
  /** Departure quorum (default: the session default, a strict majority). */
  quorum?: number;
  /** Peers that stop at a tick. */
  disconnect?: readonly {player: number; at: number}[];
  /** Spectators: join tick (0 = from the start, otherwise from peer `feed`'s confirmed state). */
  spectators?: readonly {join: number; feed: number}[];
  /** Silence before a peer is declared gone. */
  timeout?: number;
  /** Ticks between delay proposals by the authority. */
  delayEvery?: number;
}
export interface NetworkRun {
  sessions: RollbackSession[];
  exchanges: RollbackExchange[];
  spectators: (RollbackSpectator | null)[];
  /** Per player: frame -> input actually queued (including delay fills). */
  queued: Map<number, string>[];
  /** Every publisher's checksums: frame -> set of `publisher=checksum`. */
  published: Map<number, Map<string, number>>;
  delayLog: string[][];
  link: LossyLinkStats;
  ticks: number;
  proposals: number[];
  ports: ToyPorts[];
}

export function runNetwork(o: NetworkRunOptions): NetworkRun {
  const n = o.players;
  const limits: RollbackLimits = {...baseLimits, players: n, maxChecksumHistory: 256, ...o.limits};
  const delay: RollbackDelayPolicy = o.delay ?? {minDelay: 1, maxDelay: 6, maxStep: 2, minSpacing: 24, authority: 0};
  const rng = createRng(o.seed);
  const link = createLossyLink<string>({seed: o.seed ^ 0x5eed, ...o.link});
  const ports = Array.from({length: n}, () => toyPorts(n));
  const sessions = ports.map((p, i) =>
    createRollbackSession({
      local: i,
      neutralInput: 'n',
      limits,
      ports: p,
      adaptiveDelay: delay,
      departure: o.quorum === undefined ? {input: 'repeat'} : {input: 'repeat', quorum: o.quorum},
      retainInputFrames: 160,
      evidence: {frames: 4, maxBytes: 4096, chunkBytes: 256},
    }),
  );
  const exchanges = sessions.map(session =>
    createRollbackExchange({
      session,
      limits: {maxInputsPerMessage: 64, maxChecksumsPerMessage: 4, roundTripSamples: 16},
      pacingThreshold: 1,
      timeout: o.timeout ?? 40,
    }),
  );
  const specs = o.spectators ?? [];
  const spectators: (RollbackSpectator | null)[] = specs.map(() => null);
  const specPorts: (ToyPorts | null)[] = specs.map(() => null);
  const feeds = specs.map(s => s.feed);
  const queued = Array.from({length: n}, () => new Map<number, string>());
  const published = new Map<number, Map<string, number>>();
  const delayLog: string[][] = Array.from({length: n}, () => []);
  const proposals: number[] = [];
  const publish = (who: string, frame: number, checksum: number) => {
    let row = published.get(frame);
    if (!row) published.set(frame, (row = new Map()));
    row.set(who, checksum);
  };
  const parted = (a: number, b: number, tick: number) =>
    !!o.partition &&
    tick >= o.partition.from &&
    tick < o.partition.to &&
    o.partition.group.includes(a) !== o.partition.group.includes(b);
  const alive = (i: number) => !o.disconnect?.some(d => d.player === i);
  const gone = (i: number, tick: number) => !!o.disconnect?.some(d => d.player === i && tick >= d.at);
  const makeSpectator = (k: number, tick: number) => {
    const p = toyPorts(n);
    let join;
    if (tick > 0) {
      const c = sessions[feeds[k]!]!.confirmedState()!;
      join = {frame: c.frame, state: c.state, checksum: c.checksum};
    }
    specPorts[k] = p;
    spectators[k] = createRollbackSpectator({
      limits,
      neutralInput: 'n',
      ports: p,
      maxBufferedFrames: 120,
      catchUpThreshold: 4,
      catchUpFrames: 8,
      ...(join ? {join} : {}),
    });
  };
  const target = o.ticks;
  const done = () =>
    sessions.every((s, i) => !alive(i) || s.read().status !== 'running' || s.read().confirmedFrame >= target + 8) &&
    spectators.every(s => s === null || s.read().status !== 'running' || s.read().frame >= target);
  let tick = 0;
  for (; tick < target * 6 + 600 && !done(); tick++) {
    for (let k = 0; k < specs.length; k++) if (spectators[k] === null && tick >= specs[k]!.join) makeSpectator(k, tick);
    for (let i = 0; i < n; i++) {
      if (gone(i, tick)) {
        link.cut(i);
        continue;
      }
      const s = sessions[i]!,
        x = exchanges[i]!;
      for (const raw of link.receive(i, tick)) {
        const w = JSON.parse(raw) as Wire;
        if (w.kind === 'msg') x.receive(w.body, tick);
        else {
          const reply = x.toSpectator(w.ack, tick);
          if (!('status' in reply)) {
            const text = JSON.stringify({kind: 'msg', body: reply} satisfies Wire);
            link.send(i, `s${w.spectator}`, text, tick, text.length);
          }
        }
      }
      x.expire(tick);
      if (s.read().status !== 'running') continue;
      if (i === delay.authority && tick > 0 && tick % (o.delayEvery ?? 37) === 0 && tick < target) {
        // A synthetic round trip that wanders, so the recommendation moves both ways.
        const rtt = rng.int(0, 2 * (delay.maxDelay + 1)) * 2;
        const snap = s.read();
        const current = snap.delayChanges.length ? snap.delayChanges[snap.delayChanges.length - 1]!.delay : snap.delay;
        const next = recommendInputDelay({roundTrip: rtt, frameTime: 2, current, policy: delay, margin: 0});
        if (next !== current && s.proposeDelay(next).status === 'pending') proposals.push(next);
      }
      if (!x.read().pacing.skip) {
        const input = tick < target ? INPUTS[rng.int(0, 3)]! : 'n'; // rng.int(0, 3) indexes the four INPUTS
        const l = s.local(input);
        if (l.status === 'queued') for (let f = l.frame; f <= (l.through ?? l.frame); f++) queued[i]!.set(f, l.input);
        const a = s.advance();
        if ('checksums' in a) for (const c of a.checksums) publish(`p${i}`, c.frame, c.checksum);
      }
      for (const c of s.read().delayChanges) {
        const key = `${c.from}:${c.delay}`;
        if (!delayLog[i]!.includes(key)) delayLog[i]!.push(key);
      }
      for (let j = 0; j < n; j++) {
        // Departed peers still get the (input-free) departure notice, so a partitioned one fails closed.
        if (j === i || gone(j, tick)) continue;
        const text = JSON.stringify({kind: 'msg', body: x.outgoing(j, tick)} satisfies Wire);
        if (!parted(i, j, tick)) link.send(i, j, text, tick, text.length);
      }
    }
    for (let k = 0; k < specs.length; k++) {
      const sp = spectators[k];
      if (!sp) continue;
      for (const raw of link.receive(`s${k}`, tick)) {
        const w = JSON.parse(raw) as Wire;
        if (w.kind === 'msg') sp.receive(w.body);
      }
      const a = sp.advance();
      if (a.status === 'advanced') for (const c of a.checksums) publish(`s${k}`, c.frame, c.checksum);
      if (gone(feeds[k]!, tick)) feeds[k] = (feeds[k]! + 1) % n;
      const text = JSON.stringify({kind: 'ack', spectator: k, ack: sp.ack()} satisfies Wire);
      link.send(`s${k}`, feeds[k]!, text, tick, text.length);
    }
  }
  return {
    sessions,
    exchanges,
    spectators,
    queued,
    published,
    delayLog,
    link: link.read(),
    ticks: tick,
    proposals,
    ports,
  };
}

/** Replay the agreed inputs with no network: the checksum of the state at the start of each frame. */
export function networkReference(run: NetworkRun, frames: number, inputDelay: number): Map<number, number> {
  const n = run.queued.length,
    state = toyStart(n),
    out = new Map<number, number>();
  const survivor = run.sessions.findIndex(s => s.read().status === 'running');
  const departures = survivor < 0 ? [] : run.sessions[survivor]!.read().departures;
  for (let f = 0; f <= frames; f++) {
    out.set(f, rollbackChecksum(JSON.stringify(state)));
    const row: string[] = [];
    for (let p = 0; p < n; p++) {
      const d = departures.find(x => x.player === p);
      let input: string | undefined;
      if (f < inputDelay) input = 'n';
      else if (d && d.decided !== null && f > d.decided) input = d.input ?? undefined;
      else input = run.queued[p]!.get(f);
      if (input === undefined) return out;
      row.push(input);
    }
    toyStep(state, row, f);
  }
  return out;
}
