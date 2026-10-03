import test from 'node:test';
import assert from 'node:assert/strict';
import {createAudioOutput, type AudioOutputOptions} from './audio-output';

const flush = () => new Promise(resolve => setImmediate(resolve));

/** A running fake context that decodes any bytes and records sources (rate, start, stop). */
function fakeContext(state: AudioContextState = 'running') {
  const sources: {buffer: unknown; rate: number; started: number; stops: number; onended: (() => void) | null}[] = [];
  const panners: {x: number}[] = [];
  let decodes = 0,
    hold: Promise<void> | null = null;
  const param = (value = 0) => ({
    value,
    cancelScheduledValues() {},
    setTargetAtTime(v: number) {
      this.value = v;
    },
    setValueAtTime(v: number) {
      this.value = v;
    },
  });
  const ctx = {
    state,
    sampleRate: 48000,
    currentTime: 0,
    destination: {},
    listener: {
      positionX: param(),
      positionY: param(),
      positionZ: param(),
      forwardX: param(),
      forwardY: param(),
      forwardZ: param(),
      upX: param(),
      upY: param(),
      upZ: param(),
    },
    createGain: () => ({gain: param(1), connect() {}, disconnect() {}}),
    createPanner: () => {
      const p = {
        x: 0,
        positionX: {
          set value(v: number) {
            p.x = v;
          },
          get value() {
            return p.x;
          },
        },
        positionY: param(),
        positionZ: param(),
        connect() {},
        disconnect() {},
      };
      panners.push(p);
      return p;
    },
    createBuffer: (_c: number, n: number) => ({length: n, copyToChannel() {}}),
    createBufferSource: () => {
      const s = {
        buffer: null as unknown,
        rate: 1,
        started: 0,
        stops: 0,
        onended: null as (() => void) | null,
        playbackRate: {
          set value(v: number) {
            s.rate = v;
          },
          get value() {
            return s.rate;
          },
        },
        connect() {},
        disconnect() {},
        start() {
          s.started++;
        },
        stop() {
          s.stops++;
        },
      };
      sources.push(s);
      return s;
    },
    decodeAudioData: async (bytes: ArrayBuffer) => {
      decodes++;
      if (hold) await hold;
      return {length: bytes.byteLength, numberOfChannels: 1, sampleRate: 48000};
    },
    resume: async () => {
      ctx.state = 'running';
    },
    suspend: async () => {},
    close: async () => {},
  };
  return {
    ctx: ctx as unknown as AudioContext,
    sources,
    panners,
    get decodes() {
      return decodes;
    },
    pause() {
      let open!: () => void;
      hold = new Promise(r => {
        open = r;
      });
      return () => {
        hold = null;
        open();
      };
    },
  };
}

function output(extra: Partial<AudioOutputOptions> = {}) {
  const fetched: string[] = [],
    reports: string[] = [];
  const fake = fakeContext();
  let muted = false,
    silent = false;
  const out = createAudioOutput({
    silent: () => silent,
    muted: () => muted,
    effects: () => 1,
    music: () => 1,
    createContext: () => fake.ctx,
    report: m => reports.push(m),
    sound: id => (id === 'chime' || id === 'gone' ? `/base/sounds/${id}.wav` : undefined),
    files: {
      fetchBytes: async url => {
        fetched.push(url);
        if (url.includes('gone')) throw Error('HTTP 404');
        return new ArrayBuffer(64);
      },
    },
    ...extra,
  });
  return {
    out,
    fake,
    fetched,
    reports,
    mute(v: boolean) {
      muted = v;
    },
    silence(v: boolean) {
      silent = v;
    },
  };
}

test('a sound id plays its decoded file with gain, rate and position through the same voices', async () => {
  const {out, fake, fetched} = output();
  assert.equal(await out.preload('chime'), true);
  assert.deepEqual(fetched, ['/base/sounds/chime.wav']);
  assert.equal(out.playVoice('chime'), null, 'decoding starts on first use; without wait that play is dropped');
  await flush();
  await flush();
  const voice = out.playVoice('chime', {gain: 0.5, rate: 1.5, spatial: {position: [3, 0, 0]}})!;
  assert.ok(voice);
  assert.equal(fake.sources.at(-1)!.rate, 1.5);
  assert.equal(fake.panners[0]!.x, 3);
  assert.equal(fake.decodes, 1);
  assert.deepEqual(fetched.length, 1);
  assert.equal(out.sounds.files, 1);
  assert.equal(out.stats.played, 1);
  voice.stop();
  assert.equal(voice.ended, true);
  out.dispose();
});

test('a play that may wait starts once the file is ready, with gain and position changed meanwhile', async () => {
  const {out, fake} = output();
  const open = fake.pause();
  let ended = 0;
  const voice = out.playVoice('chime', {
    wait: 1000,
    gain: 0.9,
    spatial: {position: [1, 0, 0]},
    onEnded: () => {
      ended++;
    },
  })!;
  assert.ok(voice);
  assert.equal(voice.ended, false);
  assert.equal(fake.sources.length, 0);
  voice.setGain(0.3);
  voice.setPosition!([5, 0, 0]);
  open();
  await flush();
  await flush();
  assert.equal(fake.sources.length, 1);
  assert.equal(fake.sources[0]!.started, 1);
  assert.equal(fake.panners[0]!.x, 5);
  fake.sources[0]!.onended!();
  assert.equal(voice.ended, true);
  assert.equal(ended, 1);
  out.dispose();
});

test('a waiting play is dropped when stopped, too late, muted meanwhile, or disposed', async () => {
  for (const scenario of ['stop', 'late', 'mute', 'dispose'] as const) {
    const o = output();
    const open = o.fake.pause();
    let ended = 0;
    const voice = o.out.playVoice('chime', {
      wait: scenario === 'late' ? 1 : 1000,
      onEnded: () => {
        ended++;
      },
    })!;
    if (scenario === 'stop') voice.stop();
    if (scenario === 'late') await new Promise(r => setTimeout(r, 5));
    if (scenario === 'mute') o.mute(true);
    if (scenario === 'dispose') o.out.dispose();
    open();
    await flush();
    await flush();
    assert.equal(o.fake.sources.length, 0, scenario);
    assert.equal(voice.ended, true, scenario);
    assert.equal(ended, 1, scenario);
    o.out.dispose();
  }
});

test('waiting plays hold voice slots, so maxVoices bounds them too', () => {
  const {out, fake} = output({maxVoices: 2});
  fake.pause();
  assert.ok(out.playVoice('chime', {wait: 100}));
  assert.ok(out.playVoice('chime', {wait: 100}));
  assert.equal(out.playVoice('chime', {wait: 100}), null);
  assert.equal(out.playVoice('ui.click'), null);
  out.dispose();
});

test('a missing file is reported once; later plays are skipped without refetching until a preload retries', async () => {
  const {out, fetched, reports} = output();
  assert.equal(await out.preload('gone'), false);
  assert.equal(out.playVoice('gone', {wait: 100}), null);
  out.play('gone');
  assert.deepEqual(fetched, ['/base/sounds/gone.wav']);
  assert.deepEqual(reports, ["sound 'gone' failed: HTTP 404"]);
  assert.equal(await out.preload('gone'), false);
  assert.equal(fetched.length, 2);
  assert.equal(out.preload('nothing') instanceof Promise, true);
  assert.equal(await out.preload('nothing'), false);
  out.dispose();
});

test('silent and muted outputs fetch on preload but never create a context or decode', async () => {
  for (const mode of ['silent', 'muted'] as const) {
    let made = 0;
    const o = output({
      createContext: () => {
        made++;
        return fakeContext().ctx;
      },
    });
    if (mode === 'silent') o.silence(true);
    else o.mute(true);
    assert.equal(await o.out.preload('chime'), true, mode);
    assert.equal(o.out.playVoice('chime', {wait: 100}), null, mode);
    o.out.play('chime');
    assert.equal(made, 0, mode);
    assert.equal(o.out.stats.played, 0, mode);
    o.out.dispose();
  }
});

test('rate and wait are validated; unresolvable ids are reported once, not thrown', () => {
  const {out, reports} = output({
    sound: id => {
      if (id === 'bad') throw Error('expected a local file');
      return undefined;
    },
  });
  assert.throws(() => out.playVoice('ui.click', {rate: 0}), /rate/);
  assert.throws(() => out.playVoice('ui.click', {rate: 5}), /rate/);
  assert.throws(() => out.playVoice('ui.click', {wait: -1}), /wait/);
  assert.throws(() => out.playVoice('ui.click', {wait: 6000}), /wait/);
  assert.equal(out.playVoice('bad'), null);
  assert.equal(out.playVoice('bad'), null);
  assert.equal(reports.length, 1);
  assert.match(reports[0]!, /sound 'bad' cannot be resolved/);
  out.playVoice('nope');
  assert.deepEqual(reports.slice(1), ["no cue or sound 'nope'"]);
  out.dispose();
});

test('a cue id always wins over a sound resolver', () => {
  let asked = 0;
  const {out, fake} = output({
    sound: () => {
      asked++;
      return '/x.wav';
    },
  });
  assert.ok(out.playVoice('ui.click', {rate: 2}));
  assert.equal(asked, 0);
  assert.equal(fake.sources[0]!.rate, 2);
  out.dispose();
});

test('files fetched before the context exists are decoded when it is unlocked, so the first play is on time', async () => {
  const {out, fake} = output();
  assert.equal(await out.preload('chime'), true);
  assert.equal(out.stats.contexts, 0);
  assert.equal(fake.decodes, 0);
  out.unlock();
  await flush();
  await flush();
  assert.equal(fake.decodes, 1);
  assert.ok(out.playVoice('chime'), 'decoded ahead: plays at once without waiting');
  out.dispose();
});

test('a scheduled play (`at`, a context time) of a file still decoding starts if ready before its time, past `wait`', async () => {
  const {out, fake} = output();
  const open = fake.pause();
  (fake.ctx as unknown as {currentTime: number}).currentTime = 1;
  const voice = out.playVoice('chime', {wait: 1, at: 3} as never)!;
  await new Promise(r => setTimeout(r, 5));
  open();
  await flush();
  await flush();
  assert.equal(fake.sources.length, 1, 'still before its start time: started (scheduled)');
  assert.equal(voice.ended, false);
  out.dispose();
});

test('a waiting voice replays its filter when it starts, and ends if the start is refused', async () => {
  const filters: {frequency: number; targets: number[]}[] = [];
  const {out, fake} = output();
  (fake.ctx as unknown as {createBiquadFilter(): unknown}).createBiquadFilter = () => {
    const f = {type: '', targets: [] as number[], frequency: 0} as {
      type: string;
      targets: number[];
      frequency: unknown;
    };
    f.frequency = {
      value: 0,
      cancelScheduledValues() {},
      setTargetAtTime(v: number) {
        f.targets.push(v);
      },
    };
    const node = Object.assign(f, {connect() {}, disconnect() {}});
    filters.push(node as never);
    return node;
  };
  let open = fake.pause();
  const voice = out.playVoice('chime', {wait: 1000, filter: {cutoffHz: 2000}})!;
  const plain = out.playVoice('chime', {wait: 1000})!;
  assert.throws(() => plain.setFilter!({cutoffHz: 800}), /no filter stage/);
  plain.stop();
  voice.setFilter!({cutoffHz: 800});
  assert.equal(voice.panning, null);
  open();
  await flush();
  await flush();
  assert.equal(fake.sources.length, 1);
  assert.deepEqual(filters[0]!.targets, [800], 'the latest filter is replayed at start');
  voice.stop();
  out.dispose();
  const second = output();
  open = second.fake.pause();
  const refused = second.out.playVoice('chime', {wait: 1000})!;
  second.fake.ctx.createBufferSource = () => {
    throw Error('refused');
  };
  open();
  await flush();
  await flush();
  assert.equal(refused.ended, true);
  assert.equal(second.out.stats.played, 0);
  second.out.dispose();
});
