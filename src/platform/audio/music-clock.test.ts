import test from 'node:test';
import assert from 'node:assert/strict';
import { createMusicPlayer, musicBudgets, musicTimeoutMs, MUSIC_COMPRESSED_RATIO, MUSIC_START_MARGIN, type MusicHost } from './music-clock';
import { createAudioOutput } from './audio-output';
import { createAudioTimeline } from './audio-timeline';
import type { SoundFiles } from './sound-files';

/** A fake context clock with recording buffer sources. */
function fakeContext(now = 10) {
  const sources: { when?: number; offset?: number; stops: (number | undefined)[]; loop: boolean; loopStart: number; loopEnd: number; onended: (() => void) | null; disconnected: boolean; buffer: unknown }[] = [];
  const gains: { gain: { value: number }; disconnected: boolean }[] = [];
  const ctx = {
    currentTime: now, state: 'running' as AudioContextState, sampleRate: 48000, destination: {},
    resume: async () => {}, suspend: async () => {}, close: async () => {},
    createGain: () => { const g = { gain: { value: 1 }, disconnected: false, connect() {}, disconnect() { g.disconnected = true; } }; gains.push(g); return g; },
    createBufferSource: () => {
      const s = { when: undefined as number | undefined, offset: undefined as number | undefined, stops: [] as (number | undefined)[], loop: false, loopStart: 0, loopEnd: 0, onended: null as (() => void) | null, disconnected: false, buffer: null as unknown,
        connect() {}, disconnect() { s.disconnected = true; },
        start(when?: number, offset?: number) { s.when = when; s.offset = offset; },
        stop(when?: number) { s.stops.push(when); } };
      sources.push(s); return s;
    },
  };
  return { ctx: ctx as unknown as AudioContext & { currentTime: number; state: AudioContextState }, sources, gains };
}
const song = (duration: number) => ({ duration, length: Math.round(duration * 48000), numberOfChannels: 2 }) as unknown as AudioBuffer;
/** A sound-file store whose decodes the test resolves or rejects. */
function fakeFiles(ready: Record<string, AudioBuffer> = {}) {
  const waiting = new Map<string, { resolve(b: AudioBuffer): void; reject(e: Error): void }>();
  let retries = 0, disposed = 0;
  const files = {
    buffer: (id: string) => ready[id],
    decode: (id: string) => ready[id] ? Promise.resolve(ready[id]) : new Promise<AudioBuffer>((resolve, reject) => { waiting.set(id, { resolve, reject }); }),
    fetch: async () => true, undecoded: () => [], retry: () => { retries++; }, failed: () => false,
    stats: { files: 0, encodedBytes: 0, decodedBytes: 0, reservedBytes: 0, fetches: 0, decodes: 0, failures: 0, refusals: 0 },
    dispose: () => { disposed++; },
  } as unknown as SoundFiles;
  return { files, waiting, ready, get retries() { return retries; }, get disposed() { return disposed; } };
}
function rig(o: { ready?: Record<string, AudioBuffer>; running?: boolean; maxVoices?: number } = {}) {
  const { ctx, sources, gains } = fakeContext();
  const store = fakeFiles(o.ready ?? { song: song(120) });
  const reports: string[] = [];
  let running = o.running ?? true;
  const host: MusicHost = {
    running: () => running ? ctx : null, existing: () => ctx, bus: () => ({}) as AudioNode, files: store.files,
    url: id => id === 'broken' ? (() => { throw Error('bad row'); })() : id === 'missing' ? undefined : `/music/${id}.ogg`,
    report: m => reports.push(m), maxVoices: o.maxVoices ?? 2, maxStartAhead: 10,
  };
  const player = createMusicPlayer(host);
  return { player, ctx, sources, gains, store, reports, setRunning: (v: boolean) => { running = v; } };
}
const tick = () => new Promise(r => setImmediate(r));

test('a decoded song starts at the exact context time and offset; songTime includes the lead-in', async () => {
  const { player, ctx, sources } = rig();
  const voice = player.play('song', { at: 12, offset: 3 })!;
  assert.equal(await voice.ready, true);
  assert.deepEqual([sources[0].when, sources[0].offset], [12, 3]);
  assert.equal(voice.state, 'scheduled'); assert.equal(voice.duration, 120);
  assert.equal(voice.songTime(11.5), 2.5, 'half a second of lead-in before the start');
  assert.equal(voice.songTime(14), 5);
  ctx.currentTime = 12.5; assert.equal(voice.state, 'playing');
  assert.equal(voice.songTime(200), 120, 'a song without a loop holds at its end');
});

test('native loop points repeat sample-accurately and songTime wraps with them', async () => {
  const { player, sources } = rig();
  const voice = player.play('song', { at: 10, loop: { start: 8, end: 16 } })!;
  await voice.ready;
  assert.deepEqual([sources[0].loop, sources[0].loopStart, sources[0].loopEnd], [true, 8, 16]);
  assert.equal(voice.songTime(10 + 15), 15);
  assert.equal(voice.songTime(10 + 17), 9, 'past the loop end it continues from the loop start');
  assert.equal(voice.songTime(10 + 16 + 8 * 3 + 1), 9);
  const open = player.play('song', { at: 10, loop: { start: 100 } })!;
  await open.ready;
  assert.equal(sources[1].loopEnd, 120, 'the loop end defaults to the song end');
});

test('a song decoded after its start time skips ahead to stay in sync, or is dropped when asked', async () => {
  const { player, ctx, sources, store } = rig({ ready: {} });
  const voice = player.play('song', { at: 10.5 })!;
  assert.equal(voice.state, 'loading'); assert.equal(voice.songTime(11), null);
  ctx.currentTime = 11.2; store.waiting.get('song')!.resolve(song(120));
  assert.equal(await voice.ready, true);
  const start = 11.2 + MUSIC_START_MARGIN;
  assert.ok(Math.abs(sources[0].when! - start) < 1e-9);
  assert.ok(Math.abs(sources[0].offset! - (start - 10.5)) < 1e-9, 'started where the song should be');
  for (const t of [start, 12, 30]) assert.ok(Math.abs(voice.songTime(t)! - (t - 10.5)) < 1e-9, 'the requested mapping holds');
  const late = rig({ ready: {} });
  const dropped = late.player.play('song', { at: 10.5, late: 'drop' })!;
  late.ctx.currentTime = 11; late.store.waiting.get('song')!.resolve(song(120));
  assert.equal(await dropped.ready, false); assert.equal(dropped.ended, true); assert.equal(late.player.stats.dropped, 1);
  assert.equal(late.sources.length, 0, 'nothing plays late');
});

test('seek hands over sample-accurately; songTime follows the old source until the hand-off', async () => {
  const { player, ctx, sources } = rig();
  const voice = player.play('song', { at: 10 })!;
  await voice.ready;
  ctx.currentTime = 11; // playing
  voice.seek(60, 15);
  assert.deepEqual(sources[0].stops, [15], 'the old source stops exactly at the hand-off');
  assert.deepEqual([sources[1].when, sources[1].offset], [15, 60]);
  assert.equal(voice.songTime(14), 4); assert.equal(voice.songTime(16), 61);
  sources[0].onended?.(); assert.equal(voice.ended, false, 'the replaced source ending does not end the voice');
  assert.throws(() => voice.seek(500), /beyond the song/); assert.throws(() => voice.seek(NaN), /offset/);
  assert.throws(() => voice.seek(1, 100), /horizon/);
});

test('stop at a future time freezes songTime there and ends on the source end; stop now ends at once', async () => {
  const { player, sources } = rig();
  let ended = 0;
  const voice = player.play('song', { at: 10, onEnded: () => { ended++; } })!;
  await voice.ready;
  voice.stop(20);
  assert.deepEqual(sources[0].stops, [20]); assert.equal(voice.ended, false);
  assert.equal(voice.songTime(25), 10, 'nothing plays after the scheduled stop');
  sources[0].onended?.(); assert.equal(voice.ended, true); assert.equal(ended, 1);
  voice.stop(); assert.equal(ended, 1, 'idempotent');
  const other = player.play('song', { at: 10 })!; await other.ready;
  other.stop(); assert.equal(other.ended, true); assert.equal(sources[1].disconnected, true);
  assert.equal(player.stats.active, 0);
});

test('bounds: voice limit, start horizon, invalid options, out-of-range offsets and loops', async () => {
  const { player, reports, ctx } = rig({ maxVoices: 1 });
  const first = player.play('song', { at: 10 })!;
  assert.equal(player.play('song'), null, 'over the voice limit'); assert.equal(player.stats.skipped, 1);
  first.stop();
  assert.equal(player.play('song', { at: ctx.currentTime + 11 }), null); assert.equal(player.play('song', { at: ctx.currentTime + 12 }), null);
  assert.deepEqual(reports, ['music start beyond the schedule horizon'], 'reported once');
  for (const bad of [{ at: -1 }, { offset: NaN }, { gain: 2 }, { late: 'never' as 'drop' }, { loop: { start: 5, end: 5 } }, { loop: { start: -1 } }]) assert.throws(() => player.play('song', bad));
  const beyond = player.play('song', { offset: 500 })!;
  assert.equal(await beyond.ready, false); assert.match(reports.at(-1)!, /outside the song/);
  const badLoop = player.play('song', { loop: { start: 130 } })!;
  assert.equal(await badLoop.ready, false);
});

test('silent, locked or hidden output, unknown or broken ids and failed decodes play nothing', async () => {
  const locked = rig(); locked.setRunning(false);
  assert.equal(locked.player.play('song'), null);
  const { player, reports, store } = rig({ ready: {} });
  assert.equal(player.play('missing'), null); assert.equal(player.play('missing'), null);
  assert.equal(player.play('broken'), null);
  assert.deepEqual(reports, ["no music 'missing'", "music 'broken' cannot be resolved: Error: bad row"]);
  const failing = player.play('song', { at: 11 })!;
  store.waiting.get('song')!.reject(Error('decode failed'));
  assert.equal(await failing.ready, false); assert.equal(failing.ended, true); assert.equal(player.stats.dropped, 1);
});

test('load decodes ahead on an existing context, forgets an earlier failure, and is false without one', async () => {
  const { player, store } = rig();
  assert.equal(await player.load('song'), true); assert.equal(store.retries, 1);
  assert.equal(await player.load('missing'), false);
  const none = createMusicPlayer({ running: () => null, existing: () => null, bus: () => null, files: fakeFiles().files, url: () => '/m.ogg', report: () => {}, maxVoices: 2, maxStartAhead: 10 });
  assert.equal(await none.load('song'), false);
  assert.throws(() => createMusicPlayer({ running: () => null, existing: () => null, bus: () => null, files: fakeFiles().files, url: () => undefined, report: () => {}, maxVoices: 0, maxStartAhead: 10 }));
  player.dispose(); assert.equal(store.disposed, 1);
});

test('a chart on the audio timeline lines up with a song started at the timeline origin', async () => {
  const { player, ctx } = rig();
  let pageMs = 1000;
  const read = () => ({ currentTime: ctx.currentTime, performanceTime: pageMs, outputLatency: 0, baseLatency: 0, output: null });
  const timeline = createAudioTimeline({ read, now: () => pageMs, dispatch: () => {} });
  timeline.start(.2);
  const voice = player.play('song', { at: timeline.contextTime(0)! })!;
  await voice.ready;
  for (let i = 0; i < 300; i++) {
    pageMs += 16; ctx.currentTime += .016; timeline.pump();
    assert.ok(Math.abs(voice.songTime(timeline.contextTime(timeline.position)!)! - timeline.position) < 1e-9, 'song seconds equal timeline seconds');
  }
});

test('the output: silent never creates a context; the music bus follows music volume and mute; dispose stops songs', async () => {
  let made = 0;
  const silent = createAudioOutput({ silent: () => true, muted: () => false, effects: () => 1, music: () => 1, createContext: () => { made++; return fakeContext().ctx; }, sound: () => '/m.ogg' });
  assert.equal(silent.playMusic('song'), null); assert.equal(await silent.loadMusic('song'), false); assert.equal(made, 0);
  const { ctx, gains, sources } = fakeContext();
  let muted = false, music = .4; const listeners: (() => void)[] = [];
  Object.assign(ctx, { decodeAudioData: async () => song(60) });
  const out = createAudioOutput({ silent: () => false, muted: () => muted, effects: () => 1, music: () => music, onChange: fn => { listeners.push(fn); return () => {}; },
    createContext: () => ctx, sound: id => id === 'song' ? '/music/song.wav' : undefined,
    musicFiles: { fetchBytes: async () => new ArrayBuffer(64) } });
  out.unlock();
  assert.equal(gains.length, 1, 'no music bus until a song plays');
  const voice = out.playMusic('song', { at: 11 })!;
  const bus = gains[1];
  assert.equal(bus.gain.value, .4, 'music volume');
  assert.equal(await voice.ready, true); assert.equal(sources[0].when, 11);
  muted = true; listeners.forEach(f => f());
  assert.equal(bus.gain.value, 0); assert.equal(voice.ended, false, 'muting silences without stopping, so sync holds');
  assert.equal(out.musicStats.active, 1); assert.equal(out.musicStats.played, 1);
  out.dispose(); assert.equal(voice.ended, true); assert.equal(out.playMusic('song'), null);
});

test('music budgets: a compressed file that downloads in full also fits decoded; the timeout scales with the file', () => {
  for (const device of ['phone', 'tablet', 'laptop', 'desktop'] as const) {
    const b = musicBudgets(device);
    assert.ok(b.maxFileBytes * MUSIC_COMPRESSED_RATIO <= b.maxDecodedBytes, device + ': no full download refused at decode by its estimate');
    assert.equal(b.timeoutMs, musicTimeoutMs(b.maxFileBytes)); assert.ok(b.timeoutMs >= 10_000);
  }
  const seconds = (bytes: number) => bytes / (48000 * 2 * 4);
  assert.ok(Math.abs(seconds(musicBudgets('phone').maxDecodedBytes) - 131) < 1, 'a phone keeps about 2 min 11 s of 48 kHz stereo');
  assert.ok(musicTimeoutMs(4 * 1024 * 1024) === 32_000, '1 s per 128 KiB');
});

test('review: a second seek before the first hand-off keeps the audible source playing and re-times its hand-off', async () => {
  const { player, ctx, sources } = rig();
  const voice = player.play('song', { at: 10 })!; await voice.ready;
  ctx.currentTime = 11;
  voice.seek(60, 15); voice.seek(30, 14);
  assert.deepEqual(sources[0].stops, [15, 14], 'the playing source now hands over at 14, not at once');
  assert.equal(sources[1].disconnected, true, 'the unstarted hand-off is released');
  assert.deepEqual([sources[2].when, sources[2].offset], [14, 30]);
  assert.equal(voice.songTime(12), 2, 'still playing the original between 11 and 14');
  assert.equal(voice.songTime(14.5), 30.5);
  assert.equal(voice.state, 'playing');
});

test('review: stop during a pending seek also stops the audible source; a seek cannot pass a scheduled stop', async () => {
  const { player, ctx, sources } = rig();
  const voice = player.play('song', { at: 10 })!; await voice.ready;
  ctx.currentTime = 11;
  voice.seek(60, 15); voice.stop(13);
  assert.deepEqual(sources[0].stops, [15, 13], 'the original stops at 13, before its hand-off');
  assert.equal(sources[1].disconnected, true, 'the hand-off target is released at once: it never plays');
  assert.equal(voice.songTime(14), 3, 'frozen at the stop');
  assert.throws(() => voice.seek(20, 13.5), /after the scheduled stop/);
  const other = rig(); const kept = other.player.play('song', { at: 10 })!; await kept.ready;
  other.ctx.currentTime = 11; kept.stop(20); kept.seek(50, 12);
  assert.deepEqual(other.sources[1].stops, [20], 'a seek before the stop carries the stop to the new source');
  assert.equal(kept.songTime(25), 58);
});

test('review: a decode finishing while the tab is hidden schedules on the suspended clock instead of dropping', async () => {
  const { player, ctx, sources, store, setRunning } = rig({ ready: {} });
  const voice = player.play('song', { at: 10.5 })!;
  setRunning(false); // hidden: the context is suspended, its clock frozen at 10
  store.waiting.get('song')!.resolve(song(120));
  assert.equal(await voice.ready, true); assert.equal(player.stats.dropped, 0);
  assert.deepEqual([sources[0].when, sources[0].offset], [10.5, 0], 'scheduled as asked on the frozen clock');
  ctx.currentTime = 10.6; setRunning(true); assert.equal(voice.state, 'playing');
});

test('review: songTime freezes after the end; an ended voice keeps no PCM; a stop asked while loading applies later', async () => {
  const { player, ctx, sources, store } = rig({ ready: {} });
  const voice = player.play('song', { at: 10.5 })!;
  voice.stop(12);
  assert.equal(voice.ended, false, 'a future stop while loading waits for the schedule');
  store.waiting.get('song')!.resolve(song(120)); await voice.ready;
  assert.deepEqual(sources[0].stops, [12]);
  ctx.currentTime = 12; sources[0].onended?.();
  assert.equal(voice.ended, true);
  assert.equal(voice.songTime(30), 1.5, 'frozen where it ended');
  assert.equal(voice.duration, 120);
  const early = rig({ ready: {} }); const gone = early.player.play('song', { at: 10.5 })!;
  gone.stop(10.2); early.store.waiting.get('song')!.resolve(song(120));
  assert.equal(await gone.ready, false); assert.equal(early.sources.length, 0, 'a stop before the start: nothing plays');
});

test('re-review: a stop before a pending hand-off freezes on what was heard, after the old source ends and past the hand-off', async () => {
  const { player, ctx, sources } = rig();
  const voice = player.play('song', { at: 10 })!; await voice.ready;
  ctx.currentTime = 11; const start = sources[0].when!;
  voice.seek(60, 13); voice.stop(12);
  assert.equal(sources[1].disconnected, true, 'the unreached hand-off is released, not left waiting for an ended event');
  assert.equal(voice.state, 'playing');
  ctx.currentTime = 12; sources[0].onended?.();
  assert.equal(voice.ended, true, 'the audible source ending finishes the voice');
  // Song second 2 was the last heard (asked to start at 10; the skip-ahead start at `start` began at start - 10 s in).
  for (const t of [12, 12.5, 13, 14, 30]) assert.ok(Math.abs(voice.songTime(t)! - 2) < 1e-9, `songTime(${t}) holds where the audio stopped`);
  assert.ok(start > 10);
  assert.equal(voice.state, 'ended');
  assert.equal(player.stats.active, 0, 'the slot is free');
  // A stop before the first, still-pending start: nothing ever plays and the voice ends at once.
  const later = rig(); const queued = later.player.play('song', { at: 15 })!; await queued.ready;
  queued.stop(14); assert.equal(queued.ended, true); assert.equal(later.sources[0].disconnected, true); assert.equal(later.player.stats.active, 0);
});

test('re-review: a hand-off after the song ran out holds songTime at the song end and stays in progress until it', async () => {
  const { player, ctx, sources } = rig({ ready: { song: song(8) } });
  const voice = player.play('song', { at: 10 })!; await voice.ready;
  ctx.currentTime = 11; const start = sources[0].when!;
  voice.seek(5, 19); // the original runs out at about 18 (8 s song), the hand-off is at 19
  ctx.currentTime = start + 8.1; sources[0].onended?.();
  assert.equal(voice.ended, false);
  for (const t of [ctx.currentTime, 18.5, 18.99]) assert.equal(voice.songTime(t), 8, 'held at the song end, not the hand-off lead-in');
  assert.equal(voice.state, 'playing', 'in progress between the end and the hand-off');
  assert.equal(voice.songTime(20), 6, 'the hand-off continues from its offset');
  // A stop between the natural end and the hand-off: the old source already ended, so the voice ends at once.
  voice.stop(18.6);
  assert.equal(voice.ended, true); assert.equal(voice.songTime(40), 8);
});
