/** Test support: a tiny deterministic two-body simulation and a seeded, ordered, delayed in-memory link. */
import { createRng } from '../../core/rng';
import { createRollbackSession } from './session';
import type { RollbackChecksum, RollbackLimits, RollbackPorts, RollbackSession } from './types';

export interface Toy { x: number[]; v: number[]; hits: number; frame: number }
export const INPUTS = ['n', 'l', 'r', 'a'] as const;

/** Interactions between bodies make a wrong prediction visibly change later state. */
export function toyStep(state: Toy, inputs: readonly string[], frame: number): void {
  if (state.frame !== frame) throw Error(`toy: stepped frame ${frame} at ${state.frame}`);
  for (let i = 0; i < state.x.length; i++) {
    const input = inputs[i];
    if (input === 'l') state.v[i] -= 1; else if (input === 'r') state.v[i] += 1;
    else if (input === 'a' && Math.abs(state.x[i] - state.x[(i + 1) % state.x.length]) < 20) state.hits += i + 1;
    state.v[i] = Math.max(-4, Math.min(4, state.v[i]));
    state.x[i] = Math.max(-100, Math.min(100, state.x[i] + state.v[i]));
  }
  state.frame++;
}
export const toyStart = (players = 2): Toy => ({ x: Array.from({ length: players }, (_, i) => i * 30 - 15), v: new Array(players).fill(0), hits: 0, frame: 0 });

export interface ToyPorts extends RollbackPorts { state: Toy; calls: { save: number; load: number; step: number } }
export function toyPorts(players = 2, tamper?: (state: Toy, frame: number) => void): ToyPorts {
  const ports: ToyPorts = {
    state: toyStart(players), calls: { save: 0, load: 0, step: 0 },
    save: () => { ports.calls.save++; return JSON.stringify(ports.state); },
    load: text => { ports.calls.load++; ports.state = JSON.parse(text) as Toy; },
    step: (inputs, frame) => { ports.calls.step++; toyStep(ports.state, inputs, frame); tamper?.(ports.state, frame); },
    validateInput: input => (INPUTS as readonly string[]).includes(input),
  };
  return ports;
}

export const baseLimits: RollbackLimits = {
  players: 2, maxPredictionFrames: 8, inputDelay: 2, maxInputBytes: 8, maxStateBytes: 4096,
  checksumInterval: 4, maxChecksumHistory: 64, maxPendingChecksums: 64,
};

type Payload = { kind: 'input'; player: number; frame: number; input: string }
  | { kind: 'checksum'; player: number; frame: number; checksum: number };
type Message = Payload & { at: number };

export interface PeerRun {
  sessions: RollbackSession[];
  ports: ToyPorts[];
  /** Every input each player actually queued, by frame (what the reference simulation replays). */
  queued: Map<number, string>[];
  /** Checksums each session published, by frame. */
  published: Map<number, number>[];
  results: string[][];
  maxWorkPerAdvance: number;
}

/**
 * Drive N peers for `ticks` fixed ticks over ordered links whose one-way delay is drawn from [minDelay, maxDelay]
 * ticks (never reordering). Afterwards keeps ticking with neutral input until every peer has confirmed `ticks`.
 */
export function runPeers(o: { limits?: Partial<RollbackLimits>; ticks: number; seed: number; minDelay: number; maxDelay: number;
  tamper?: (peer: number) => ((state: Toy, frame: number) => void) | undefined;
  /** Peer 1 starts this many ticks late (a hitch or late join); it still receives messages. */
  late?: number;
  /** Pacing: a peer whose largest frame advantage exceeds this skips its tick (no input, no advance). */
  pace?: number;
  /** Called after every tick with the tick number. */
  observe?: (tick: number, sessions: readonly RollbackSession[]) => void }): PeerRun {
  const limits = { ...baseLimits, ...o.limits };
  const rng = createRng(o.seed), n = limits.players;
  const ports = Array.from({ length: n }, (_, i) => toyPorts(n, o.tamper?.(i)));
  const sessions = ports.map((p, i) => createRollbackSession({ local: i, neutralInput: 'n', limits, ports: p }));
  const inbox: Message[][] = Array.from({ length: n }, () => []);
  const lastAt = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const queued = Array.from({ length: n }, () => new Map<number, string>());
  const published = Array.from({ length: n }, () => new Map<number, number>());
  const results: string[][] = Array.from({ length: n }, () => []);
  let maxWorkPerAdvance = 0;
  const send = (from: number, tick: number, m: Payload) => {
    for (let to = 0; to < n; to++) if (to !== from) {
      const at = Math.max(lastAt[from][to], tick + rng.int(o.minDelay, o.maxDelay));
      lastAt[from][to] = at;
      inbox[to].push({ ...m, at });
    }
  };
  const done = () => sessions.every(s => s.read().status !== 'running' || s.read().confirmedFrame >= o.ticks + limits.inputDelay);
  for (let tick = 0; tick < o.ticks * 4 + 200 && !done(); tick++) {
    for (let i = 0; i < n; i++) {
      const s = sessions[i];
      const due = inbox[i].filter(m => m.at <= tick);
      inbox[i] = inbox[i].filter(m => m.at > tick);
      for (const m of due) {
        const r = m.kind === 'input' ? s.remote(m.player, m.frame, m.input) : s.remoteChecksum(m.player, m.frame, m.checksum);
        results[i].push(`${m.kind}:${r.status}`);
      }
      if (i === 1 && tick < (o.late ?? 0)) continue;
      if (o.pace !== undefined && Math.max(...s.read().frameAdvantage) > o.pace) continue;
      const input = tick < o.ticks ? INPUTS[rng.int(0, 3)] : 'n';
      const l = s.local(input);
      if (l.status === 'queued') { queued[i].set(l.frame, l.input); send(i, tick, { kind: 'input', player: i, frame: l.frame, input: l.input }); }
      const before = { ...ports[i].calls };
      const a = s.advance();
      const work = ports[i].calls.step - before.step;
      if (work > maxWorkPerAdvance) maxWorkPerAdvance = work;
      results[i].push(a.status);
      if ('checksums' in a) for (const c of a.checksums as readonly RollbackChecksum[]) {
        published[i].set(c.frame, c.checksum);
        send(i, tick, { kind: 'checksum', player: i, frame: c.frame, checksum: c.checksum });
      }
    }
    o.observe?.(tick, sessions);
  }
  return { sessions, ports, queued, published, results, maxWorkPerAdvance };
}

/** Replay the inputs the peers actually queued with no network: the state checksum at the start of each frame. */
export function referenceChecksums(run: PeerRun, frames: number, inputDelay: number, checksum: (text: string) => number): number[] {
  const n = run.queued.length, state = toyStart(n), out: number[] = [];
  for (let f = 0; f <= frames + 1000; f++) {
    out.push(checksum(JSON.stringify(state)));
    const inputs = Array.from({ length: n }, (_, p) => f < inputDelay ? 'n' : run.queued[p].get(f));
    if (inputs.some(i => i === undefined)) break;
    toyStep(state, inputs as string[], f);
  }
  return out;
}
