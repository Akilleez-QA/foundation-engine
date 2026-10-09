/**
 * platform/audio/sound-files.ts: a game's own sound files for the one audio output (STD-SYS-16).
 *
 * A sound is addressed by id; the output resolves the id to a URL (a `defineAsset({ type: 'audio' })` row under the
 * build's public base). This store fetches each file once, keeps its encoded bytes for the session (so a decode can be
 * repeated after eviction without the network), and decodes it on the output's AudioContext.
 *
 * Memory (the cue cache is separate and keeps its own 16 MiB): encoded bytes kept and decoded PCM kept each have a
 * budget, least recently used first out (a playing voice keeps its own buffer). A decode is admitted only when its
 * ESTIMATED decoded size fits the decoded budget beside what is kept and what other decodes have reserved: a PCM WAV
 * uses header-derived sample bytes, any other format `compressedRatio` × its file size (default 48: a 64 kbps
 * stereo file at 48 kHz). A file whose estimate cannot fit is refused before decoding. The real size is checked
 * before retaining the decoded result. Estimates and retained-byte limits do not cap transient allocations inside
 * the browser's decoder; compressed files can exceed their estimate. `soundBudgets(device)` gives the defaults
 * for the brief's minimum device.
 *
 * Bounds: file size (checked while streaming, with a running cap), retained bytes and decode reservations, logical
 * concurrent fetches and underlying decodes (more wait in order), tracked files (an idle entry, then the least recently used held file, is dropped; a
 * refusal is reported), and a per-load timeout. Cancellation: `dispose()` aborts every fetch and rejects every waiter;
 * a caller's signal only stops its own wait. Recovery: a failed fetch or decode is reported once and remembered, so
 * repeated plays of a broken file do not hit the network again; `retry(id)` (a scene's preload) forgets the failure.
 * Timeout or disposal ends the wait, but an opaque decodeAudioData operation keeps its slot and estimate reserved
 * until settlement. A decoder that never settles prevents queued decodes from starting; disposal rejects that queue.
 * Reservations remain visible after disposal until the underlying work settles; they do not measure native heap use.
 * Pure apart from `fetch`; no AudioContext is created here.
 */

export interface SoundFileOptions {
  /** Fetches one file, refusing more than `limit` bytes. Default: `fetch`, streamed with a running size cap. */
  fetchBytes?(url: string, signal: AbortSignal, limit: number): Promise<ArrayBuffer>;
  report(message: string): void;
  /** Largest file accepted (default 4 MiB; `soundBudgets`). */
  maxFileBytes?: number;
  /** Encoded bytes kept for the session (default 16 MiB). */
  maxEncodedBytes?: number;
  /** Decoded PCM bytes kept and reserved by decodes in flight (default 32 MiB). */
  maxDecodedBytes?: number;
  /** Estimated decoded bytes per encoded byte for formats without an exact header estimate (default 48). */
  compressedRatio?: number;
  /** Fetches in flight at once; more wait in order (default 4). */
  maxLoads?: number;
  /** Decodes in flight at once; more wait in order (default 2). */
  maxDecodes?: number;
  /** Distinct files tracked (default 256). */
  maxFiles?: number;
  /** One fetch, or one decode, in ms (default 10 000). */
  timeoutMs?: number;
}

/** Default memory bounds for the brief's minimum device (the creator may pass their own). */
export function soundBudgets(
  device: 'phone' | 'tablet' | 'laptop' | 'desktop' = 'laptop',
): Required<Pick<SoundFileOptions, 'maxFileBytes' | 'maxEncodedBytes' | 'maxDecodedBytes'>> {
  const MIB = 1024 * 1024;
  if (device === 'phone') return {maxFileBytes: 1 * MIB, maxEncodedBytes: 8 * MIB, maxDecodedBytes: 16 * MIB};
  if (device === 'tablet') return {maxFileBytes: 2 * MIB, maxEncodedBytes: 12 * MIB, maxDecodedBytes: 24 * MIB};
  return {maxFileBytes: 4 * MIB, maxEncodedBytes: 16 * MIB, maxDecodedBytes: 32 * MIB};
}

export interface SoundFileStats {
  readonly files: number;
  readonly encodedBytes: number;
  readonly decodedBytes: number;
  readonly reservedBytes: number;
  readonly fetches: number;
  readonly decodes: number;
  readonly failures: number;
  readonly refusals: number;
}

export interface SoundFiles {
  /** The decoded buffer, if ready. Refreshes its recency. */
  buffer(id: string): AudioBuffer | undefined;
  /** Fetch (once) and keep the encoded file. Resolves true when held, false when it failed or was refused. */
  fetch(id: string, url: string, signal?: AbortSignal): Promise<boolean>;
  /** Fetch if needed and decode on `context`. Rejects on failure, refusal or disposal. */
  decode(id: string, url: string, context: BaseAudioContext): Promise<AudioBuffer>;
  /** Files held encoded but not decoded, `[id, url]` (to decode once a context exists). */
  undecoded(): [id: string, url: string][];
  /** Forget a remembered failure so the next request tries again. */
  retry(id: string): void;
  failed(id: string): boolean;
  readonly stats: SoundFileStats;
  dispose(): void;
}

const MIB = 1024 * 1024;

/** Streams the body with a running cap, so an oversized file is refused before it is all in memory. */
async function defaultFetch(url: string, signal: AbortSignal, limit: number): Promise<ArrayBuffer> {
  const response = await fetch(url, {signal});
  if (!response.ok) throw Error(`HTTP ${response.status}`);
  // Hosts (and dev servers) often answer a missing file with their HTML page: that is not a sound.
  if (/^text\/html\b/i.test(response.headers.get('content-type') ?? '')) {
    await response.body?.cancel();
    throw Error('not a sound file (the server sent an HTML page)');
  }
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw Error('file exceeds the sound size limit');
  }
  if (!response.body) {
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > limit) throw Error('file exceeds the sound size limit');
    return bytes;
  }
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) {
      await reader.cancel();
      throw Error('file exceeds the sound size limit');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out.buffer;
}

/**
 * Decoded bytes (float32 per channel at `contextRate`) estimated before decoding: derived from WAV header fields, else
 * `ratio` × the encoded size.
 */
export function estimateDecodedBytes(bytes: ArrayBuffer, contextRate: number, ratio = 48): number {
  const v = new DataView(bytes),
    tag = (at: number) =>
      at + 4 <= bytes.byteLength
        ? String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3))
        : '';
  if (tag(0) === 'RIFF' && tag(8) === 'WAVE') {
    let at = 12,
      channels = 0,
      rate = 0,
      align = 0;
    while (at + 8 <= bytes.byteLength) {
      const id = tag(at),
        size = v.getUint32(at + 4, true);
      if (id === 'fmt ' && at + 24 <= bytes.byteLength) {
        channels = v.getUint16(at + 10, true);
        rate = v.getUint32(at + 12, true);
        align = v.getUint16(at + 20, true);
      }
      if (id === 'data' && channels > 0 && rate > 0 && align > 0)
        return Math.ceil((Math.floor(Math.min(size, bytes.byteLength) / align) * contextRate) / rate) * channels * 4;
      at += 8 + size + (size & 1);
    }
  }
  return Math.ceil(bytes.byteLength * ratio);
}

/** Bounds the caller's wait; rejecting on abort does not stop underlying work that ignores cancellation. */
const bounded = <T>(work: Promise<T>, signal: AbortSignal): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      work.catch(() => {});
      reject(signal.reason);
      return;
    }
    const abort = () => {
      work.catch(() => {});
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, {once: true});
    work.then(
      v => {
        signal.removeEventListener('abort', abort);
        resolve(v);
      },
      error => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });

interface Entry {
  url: string;
  bytes?: ArrayBuffer | undefined;
  fetching?: Promise<ArrayBuffer> | undefined;
  buffer?: AudioBuffer | undefined;
  decodedBytes: number;
  decoding?: Promise<AudioBuffer> | undefined;
}

/** A first-in, first-out admission gate for `limit` concurrent jobs; `close()` rejects every waiter. */
function gate(limit: number, closed: AbortSignal) {
  let active = 0;
  const queue: (() => void)[] = [];
  closed.addEventListener(
    'abort',
    () => {
      for (const wake of queue.splice(0)) wake();
    },
    {once: true},
  );
  return {
    enter: () =>
      new Promise<void>((resolve, reject) => {
        if (closed.aborted) {
          reject(Error('sounds: disposed'));
          return;
        }
        if (active < limit) {
          active++;
          resolve();
          return;
        }
        queue.push(() => {
          if (closed.aborted) reject(Error('sounds: disposed'));
          else {
            active++;
            resolve();
          }
        });
      }),
    leave: () => {
      active--;
      queue.shift()?.();
    },
  };
}

export function createSoundFiles(o: SoundFileOptions): SoundFiles {
  const defaults = soundBudgets();
  const maxFile = o.maxFileBytes ?? defaults.maxFileBytes,
    maxEncoded = o.maxEncodedBytes ?? defaults.maxEncodedBytes,
    maxDecoded = o.maxDecodedBytes ?? defaults.maxDecodedBytes;
  const ratio = o.compressedRatio ?? 48;
  const maxLoads = o.maxLoads ?? 4,
    maxDecodes = o.maxDecodes ?? 2,
    maxFiles = o.maxFiles ?? 256,
    timeoutMs = o.timeoutMs ?? 10_000;
  if (
    ![maxFile, maxEncoded, maxDecoded, maxLoads, maxDecodes, maxFiles, timeoutMs].every(
      n => Number.isSafeInteger(n) && n > 0,
    ) ||
    !(Number.isFinite(ratio) && ratio >= 1 && ratio <= 1000)
  )
    throw Error('invalid sound file limits');
  const fetchBytes = o.fetchBytes ?? defaultFetch;
  const entries = new Map<string, Entry>(),
    failures = new Set<string>();
  const life = new AbortController();
  const stats = {
    files: 0,
    encodedBytes: 0,
    decodedBytes: 0,
    reservedBytes: 0,
    fetches: 0,
    decodes: 0,
    failures: 0,
    refusals: 0,
  };
  const loads = gate(maxLoads, life.signal),
    decodes = gate(maxDecodes, life.signal);
  const report = (message: string) => {
    try {
      o.report(message);
    } catch {
      /* Diagnostics cannot strand a load. */
    }
  };
  const describe = (why: unknown) => {
    try {
      return String((why as Error)?.message ?? why);
    } catch {
      return 'unprintable error';
    }
  };
  const idle = (e: Entry) => !e.bytes && !e.buffer && !e.fetching && !e.decoding;
  const forget = (id: string, e: Entry) => {
    if (e.bytes) stats.encodedBytes -= e.bytes.byteLength;
    stats.decodedBytes -= e.decodedBytes;
    entries.delete(id);
    stats.files = entries.size;
  };
  const fail = (id: string, why: unknown): never => {
    const e = entries.get(id);
    if (e && idle(e)) forget(id, e);
    if (!failures.has(id) && !life.signal.aborted) {
      failures.add(id);
      stats.failures++;
      report(`sound '${id}' failed: ${describe(why)}`);
    }
    throw why instanceof Error ? why : Error(String(why));
  };
  const touch = (id: string, e: Entry) => {
    entries.delete(id);
    entries.set(id, e);
  };
  /** Drop least recently used encoded bytes / decoded buffers until `extra` more decoded bytes fit (never `keep`). */
  const evict = (keep: string, extra = 0) => {
    for (const [id, e] of entries) {
      if (stats.encodedBytes <= maxEncoded) break;
      if (id !== keep && e.bytes && !e.decoding) {
        stats.encodedBytes -= e.bytes.byteLength;
        e.bytes = undefined;
      }
    }
    for (const [id, e] of entries) {
      if (stats.decodedBytes + stats.reservedBytes + extra <= maxDecoded) break;
      if (id !== keep && e.buffer) {
        stats.decodedBytes -= e.decodedBytes;
        e.buffer = undefined;
        e.decodedBytes = 0;
      }
    }
    for (const [id, e] of [...entries]) if (id !== keep && idle(e)) forget(id, e);
  };
  const entry = (id: string, url: string): Entry => {
    if (life.signal.aborted) throw Error('sounds: disposed');
    let e = entries.get(id);
    if (e && e.url !== url && !e.fetching && !e.decoding) {
      forget(id, e);
      e = undefined;
    }
    if (!e) {
      if (entries.size >= maxFiles) {
        // Admit a new file: drop an idle entry first, then the least recently used held (not in flight) file.
        const victim =
          [...entries].find(([, x]) => idle(x)) ?? [...entries].find(([, x]) => !x.fetching && !x.decoding);
        if (!victim) {
          stats.refusals++;
          throw Error(`too many sound files in flight (${maxFiles})`);
        }
        forget(victim[0], victim[1]);
      }
      e = {url, decodedBytes: 0};
      entries.set(id, e);
      stats.files = entries.size;
    }
    return e;
  };
  const encoded = (id: string, e: Entry): Promise<ArrayBuffer> => {
    if (e.bytes) return Promise.resolve(e.bytes);
    return (e.fetching ??= (async () => {
      await loads.enter();
      try {
        const signal = AbortSignal.any([life.signal, AbortSignal.timeout(timeoutMs)]);
        stats.fetches++;
        const bytes = await bounded(fetchBytes(e.url, signal, maxFile), signal);
        if (life.signal.aborted) throw Error('sounds: disposed');
        if (!(bytes instanceof ArrayBuffer) || bytes.byteLength === 0 || bytes.byteLength > maxFile)
          throw Error('empty or oversized sound file');
        if (bytes.byteLength > maxEncoded) throw Error('sound file exceeds the encoded budget');
        if (entries.get(id) === e) {
          e.bytes = bytes;
          stats.encodedBytes += bytes.byteLength;
          evict(id);
        }
        return bytes;
      } finally {
        loads.leave();
        e.fetching = undefined;
      }
    })());
  };
  const waitFor = <T>(work: Promise<T>, signal?: AbortSignal): Promise<T> => (!signal ? work : bounded(work, signal));

  return {
    stats,
    failed: id => failures.has(id),
    retry: id => {
      failures.delete(id);
    },
    undecoded: () =>
      [...entries]
        .filter(([id, e]) => e.bytes && !e.buffer && !e.decoding && !failures.has(id))
        .map(([id, e]) => [id, e.url]),
    buffer(id) {
      const e = entries.get(id);
      if (!e?.buffer) return undefined;
      touch(id, e);
      return e.buffer;
    },
    async fetch(id, url, signal) {
      if (failures.has(id)) return false;
      let e: Entry;
      try {
        e = entry(id, url);
      } catch (error) {
        if (!life.signal.aborted) report(`sound '${id}' refused: ${describe(error)}`);
        return false;
      }
      if (e.buffer || e.bytes) return true;
      try {
        await waitFor(
          encoded(id, e).catch(error => fail(id, error)),
          signal,
        );
        return true;
      } catch {
        return false;
      }
    },
    decode(id, url, context) {
      if (failures.has(id)) return Promise.reject(Error(`sound '${id}' failed earlier`));
      let e: Entry;
      try {
        e = entry(id, url);
      } catch (error) {
        if (!life.signal.aborted) report(`sound '${id}' refused: ${describe(error)}`);
        return Promise.reject(error);
      }
      if (e.buffer) {
        touch(id, e);
        return Promise.resolve(e.buffer);
      }
      return (e.decoding ??= (async () => {
        try {
          const bytes = await encoded(id, e);
          await decodes.enter();
          let reserved = 0,
            started = false,
            settled = false,
            waiting = true;
          const retire = () => {
            stats.reservedBytes -= reserved;
            reserved = 0;
            decodes.leave();
          };
          try {
            if (life.signal.aborted) throw Error('sounds: disposed');
            const estimate = estimateDecodedBytes(bytes, context.sampleRate, ratio);
            evict(id, estimate);
            if (stats.decodedBytes + stats.reservedBytes + estimate > maxDecoded)
              throw Error(`estimated decoded size ${Math.ceil(estimate / MIB)} MiB does not fit the decoded budget`);
            reserved = estimate;
            stats.reservedBytes += reserved;
            stats.decodes++;
            // decodeAudioData detaches its argument: decode a copy so the kept bytes survive.
            const work = Promise.resolve(context.decodeAudioData(bytes.slice(0)));
            const completed = () => {
              settled = true;
              if (!waiting) retire();
            };
            work.then(completed, completed);
            started = true;
            const buffer = await bounded(work, AbortSignal.any([life.signal, AbortSignal.timeout(timeoutMs)]));
            if (life.signal.aborted) throw Error('sounds: disposed');
            const size = buffer.length * buffer.numberOfChannels * 4;
            stats.reservedBytes -= reserved;
            reserved = 0;
            if (!Number.isSafeInteger(size) || size > maxDecoded)
              throw Error('decoded sound exceeds the decoded budget');
            if (entries.get(id) === e) {
              e.buffer = buffer;
              e.decodedBytes = size;
              stats.decodedBytes += size;
              touch(id, e);
              evict(id);
            }
            return buffer;
          } finally {
            // Successful publication transfers accounting before waking the next decoder.
            // An abandoned wait keeps admission until the opaque operation settles.
            waiting = false;
            if (!started || settled) retire();
          }
        } catch (error) {
          e.decoding = undefined;
          return fail(id, error);
        } finally {
          e.decoding = undefined;
        }
      })());
    },
    dispose() {
      if (life.signal.aborted) return;
      life.abort();
      entries.clear();
      stats.files = 0;
      stats.encodedBytes = 0;
      stats.decodedBytes = 0;
      // Unsettled decoders keep their reservations until their own completion.
    },
  };
}
