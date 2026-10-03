/**
 * core/save/test-sections.ts: example save sections for the store's tests (test support, not shipped). They cover
 * every binding shape a game uses: envelope-only, a JSON import, a raw import with mirror, a multi-key merge, a live
 * binding that keeps a pre-store format in place, a device section, and a legacy profile-file adapter.
 * Legacy keys use the default namespace's `game-` prefix, so reset clears them.
 */
import type { SaveSection } from './section';
import type { LegacyFileAdapter } from './store';
import { importJson, importRaw } from './bindings';

export interface Look { theme: 'light' | 'dark'; playerName: string; color: string }
const THEMES = ['light', 'dark'];
export const look: SaveSection<Look> = {
  id: 'demo.look', scope: 'player', version: 1,
  initial: () => ({ theme: 'light', playerName: '', color: '#888888' }),
  parse: raw => {
    const o = raw as Look;
    if (!o || !THEMES.includes(o.theme) || typeof o.playerName !== 'string' || typeof o.color !== 'string') throw Error('Invalid look');
    return { theme: o.theme, playerName: o.playerName, color: o.color };
  },
  legacy: importJson(p => 'game-look-' + p),
};

export type Voice = 'calm' | 'brave' | 'dramatic';
export const voice: SaveSection<Voice> = {
  id: 'demo.voice', scope: 'player', version: 1, initial: () => 'calm',
  parse: raw => { if (raw === null) return 'calm'; if (raw !== 'calm' && raw !== 'brave' && raw !== 'dramatic') throw Error('Invalid voice'); return raw; },
  legacy: importRaw(p => 'game-voice-' + p, { mirror: true }),
};

export interface Journal { version: 1; entries: Record<string, { completed?: boolean; assisted?: boolean }> }
export const journal: SaveSection<Journal> = {
  id: 'demo.journal', scope: 'player', version: 1, initial: () => ({ version: 1, entries: {} }),
  parse: raw => {
    const o = raw as Journal;
    if (!o || o.version !== 1 || typeof o.entries !== 'object') throw Error('Invalid journal');
    return { version: 1, entries: { ...o.entries } };
  },
  merge: (a, b) => {
    const entries = { ...a.entries };
    for (const [k, v] of Object.entries(b.entries)) entries[k] = { ...entries[k], ...v, completed: !!(entries[k]?.completed || v.completed) || undefined };
    for (const e of Object.values(entries)) if (e.completed === undefined) delete e.completed;
    return { version: 1, entries };
  },
  legacy: importJson(p => 'game-journal-' + p),
};

export interface Wallet { balance: number; owned: string[]; awards: string[] }
/** Progress never un-happens: the larger balance and the union of everything owned or awarded. */
export function mergeWallet(a: Wallet, b: Wallet): Wallet {
  return { balance: Math.max(a.balance, b.balance), owned: [...new Set([...a.owned, ...b.owned])], awards: [...new Set([...a.awards, ...b.awards])] };
}
export const wallet: SaveSection<Wallet> = {
  id: 'demo.wallet', scope: 'player', version: 1, initial: () => ({ balance: 0, owned: [], awards: [] }),
  parse: raw => {
    const o = raw as Wallet;
    if (!o || !Number.isFinite(o.balance) || !Array.isArray(o.owned) || !Array.isArray(o.awards)) throw Error('Invalid wallet');
    return { balance: o.balance, owned: [...o.owned], awards: [...o.awards] };
  },
  merge: mergeWallet,
  legacy: importJson(p => 'game-wallet-' + p),
};

export interface Records { v: 1; slots: Record<string, { at: number; from: string }>; unlocked: boolean }
export const records: SaveSection<Records> = {
  id: 'demo.records', scope: 'player', version: 1, initial: () => ({ v: 1, slots: {}, unlocked: false }),
  parse: raw => {
    const o = raw as Records;
    if (!o || o.v !== 1 || typeof o.slots !== 'object') throw Error('Invalid records');
    return { v: 1, slots: { ...o.slots }, unlocked: !!o.unlocked };
  },
  merge: (a, b) => ({ v: 1, slots: { ...b.slots, ...a.slots }, unlocked: a.unlocked || b.unlocked }),
  legacy: importJson(p => 'game-records-' + p),
};

export interface Story { id: string; name: string; date: string }
export const stories: SaveSection<Story[]> = {
  id: 'demo.stories', scope: 'player', version: 1, initial: () => [],
  parse: raw => {
    if (!Array.isArray(raw) || raw.some(r => !r || typeof r.id !== 'string')) throw Error('Invalid stories');
    return raw.map(r => ({ id: r.id, name: String(r.name), date: String(r.date) }));
  },
  merge: (a, b) => { const byId = new Map(a.map(r => [r.id, r])); for (const r of b) if (!byId.has(r.id)) byId.set(r.id, r); return [...byId.values()]; },
  legacy: importJson(p => 'game-stories-' + p),
};

/** A best time: lower is better, so a merge keeps the minimum. */
export const best: SaveSection<number | null> = {
  id: 'demo.best', scope: 'player', version: 1, initial: () => null,
  parse: raw => { if (raw === null) return null; const n = typeof raw === 'string' ? Number(raw) : raw; if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) throw Error('Invalid best'); return n; },
  merge: (a, b) => (a === null ? b : b === null ? a : Math.min(a, b)),
  legacy: { ...importRaw(p => 'game-best-' + p, { mirror: true }), encode: v => [v === null ? null : String(v)] },
};

/** A record kept in its pre-store format, in place (a live binding): other code still reads the old key. */
export interface LiveRecord { version: 4; progress: number[] }
export const liveRecord: SaveSection<LiveRecord | null> = {
  id: 'demo.live', scope: 'player', version: 1, initial: () => null, export: true,
  parse: raw => {
    if (raw === null) return null;
    const o = raw as LiveRecord;
    if (!o || o.version !== 4 || !Array.isArray(o.progress)) throw Error('Invalid live record');
    return { version: 4, progress: [...o.progress] };
  },
  legacy: { mode: 'live', keys: p => ['game-live-' + p], fromVersion: 1, decode: ([raw]) => (raw === null ? null : JSON.parse(raw!)) /* one raw per key; one key */, encode: v => [v === null ? null : JSON.stringify(v)] },
};

export type Settings = Record<string, boolean | number | string>;
export const settings: SaveSection<Settings> = {
  id: 'demo.settings', scope: 'device', version: 1, initial: () => ({}),
  parse: raw => { if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('Invalid settings'); return { ...(raw as Settings) }; },
  legacy: {
    keys: () => ['game-audio', 'game-comfort'], fromVersion: 1,
    decode: ([audio, comfort]) => { // one raw per key: both exist
      const a = audio === null ? {} : JSON.parse(audio!) as { muted?: boolean; music?: number };
      const c = comfort === null ? {} : JSON.parse(comfort!) as { still?: boolean };
      return {
        ...(a.muted === undefined ? {} : { 'sound.muted': a.muted }), ...(a.music === undefined ? {} : { 'sound.music': a.music }),
        ...(c.still === undefined ? {} : { 'comfort.calm': c.still }),
      };
    },
  },
};

export const allSections: SaveSection<unknown>[] = [look, voice, journal, wallet, records, stories, best, liveRecord, settings];

/** A pre-store export format ({format: 'game-legacy-file', version: 1, …}) converted to sections. */
export const legacyProfileFile: LegacyFileAdapter = {
  name: 'game-legacy-file',
  test: v => !!v && typeof v === 'object' && (v as { format?: unknown }).format === 'game-legacy-file',
  convert(value) {
    const f = value as { version: number; voice: unknown; journal: unknown; best?: unknown; extra?: unknown };
    if (f.version !== 1) throw Error('Unsupported legacy file version');
    const out: Record<string, { v: number; data: unknown }> = {
      'demo.voice': { v: 1, data: voice.parse(f.voice) },
      'demo.journal': { v: 1, data: journal.parse(f.journal) },
    };
    if (f.best !== undefined) out['demo.best'] = { v: 1, data: best.parse(f.best) };
    if (f.extra !== undefined) out['demo.unknown-extra'] = { v: 1, data: f.extra };
    return out;
  },
};
