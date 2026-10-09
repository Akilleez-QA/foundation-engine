/**
 * platform/assets/decode-image.ts: off-thread image decode for the texture cache ("Decode off the main
 * thread", D12; STD-RUN-35 to STD-RUN-38).
 *
 * A library texture's file is fetched and decoded by `createImageBitmap` in a worker of the one host, as the job kind
 * `job.assets.decode-image`, and the `ImageBitmap` is transferred back. Uploading an `ImageBitmap` costs no decode on the
 * main thread (an `<img>` source is decoded synchronously inside `texImage2D` the first time it is uploaded).
 *
 * Pixels are the ones three.js's `<img>` path uploaded (STD-REN-27, verbatim looks). WebGL ignores the unpack flags
 * for an `ImageBitmap` and WebGPU honours `texture.flipY` for one, so the decode bakes today's defaults into the bitmap
 * and the texture that takes it sets `flipY = false` (see {@link IMAGE_BITMAP_OPTIONS}):
 * - `imageOrientation: 'flipY'`: `Texture.flipY` was true;
 * - `premultiplyAlpha: 'none'`: `Texture.premultiplyAlpha` was false;
 * - `colorSpaceConversion: 'none'`: three.js set `UNPACK_COLORSPACE_CONVERSION_WEBGL` to NONE for both the sRGB and the
 *   linear maps (sRGB primaries are the working primaries).
 *
 * Fallbacks (STD-RUN-38): the job kind declares `unavailable` (a decode is not a resumable slice generator). When the
 * host has no workers, the decoder runs the same `fetch` + `createImageBitmap` on
 * the main thread, which browsers still decode off the main thread; nothing falls back to an `<img>`.
 */
import {AbortError} from './lease-cache';
import {WorkerJobError, type JobKind, type JobOwner, type JobRequest, type JobResult} from '../workers/job.ts';

/** The decode options that reproduce three.js's `<img>` upload with `texture.flipY = false`. */
export const IMAGE_BITMAP_OPTIONS: ImageBitmapOptions = {
  imageOrientation: 'flipY',
  premultiplyAlpha: 'none',
  colorSpaceConversion: 'none',
};

export interface DecodeImageInput {
  /** Absolute URL: a worker resolves relative URLs against its own script, not the page. */
  readonly url: string;
}

export const DECODE_IMAGE_JOB_ID = 'job.assets.decode-image';

/**
 * The job row declares sliced cancellation. Its module checks cancellation after fetch + decode completes and
 * closes a bitmap it will not deliver; it does not pass cancellation into those browser operations. The host owns
 * deadline enforcement and physical cancellation accounting. The deadline is Provisional (ADR 0062).
 */
export const decodeImageJob: JobKind<DecodeImageInput, ImageBitmap> = {
  id: DECODE_IMAGE_JOB_ID,
  cancellation: {mode: 'sliced', deadlineMs: 1000},
  fallback: {mode: 'unavailable'},
  release: bitmap => bitmap.close(),
};

/** Authored dimensions used to reserve declared output bytes before starting a decode. */
export interface DecodeHint {
  readonly width?: number;
  readonly height?: number;
}

/** The part of the worker host the decoder uses; tests pass a fake. */
export interface DecodeHost {
  run<I, O>(request: JobRequest<I, O>, signal: AbortSignal): Promise<JobResult<O>>;
}

export type ImageDecoder = (url: string, signal: AbortSignal, hint?: DecodeHint) => Promise<ImageBitmap>;

/** `fetch` + `createImageBitmap` in the calling thread: the job module's body, and the decoder's fallback. */
export async function fetchImageBitmap(
  url: string,
  signal?: AbortSignal,
  io: {fetch: typeof fetch; createImageBitmap: typeof createImageBitmap} = globalThis,
): Promise<ImageBitmap> {
  const response = await io.fetch(url, signal ? {signal} : undefined);
  if (!response.ok) throw new Error(`[assets] ${url}: HTTP ${response.status}`);
  const blob = await response.blob();
  if (signal?.aborted) throw new AbortError();
  const bitmap = await io.createImageBitmap(blob, IMAGE_BITMAP_OPTIONS);
  if (signal?.aborted) {
    bitmap.close();
    throw new AbortError();
  }
  return bitmap;
}

export interface ImageDecoderOptions {
  /** The app's worker host, created on first use so it never weighs on the first load. */
  host(): Promise<DecodeHost>;
  /** Bound pending requests across worker and capability-fallback paths.
   * The worker host separately accounts for cancelled work until physical retirement. */
  maxPendingBytes?: number;
  maxConcurrent?: number;
  /** FIFO descriptors waiting for decoder capacity; no decoded allocation. Default 32; zero rejects overflow. */
  maxQueued?: number;
  /** Maximum time waiting for decoder admission, default 5000 ms. */
  admissionTimeoutMs?: number;
  /** Worker saturation/preemption retries, default 40 after the first attempt, spaced 25 ms apart.
   * Retries retain decoder admission; oversized/superseded/cancelled outcomes never retry. */
  maxCapacityRetries?: number;
  capacityRetryDelayMs?: number;
  /** Conservative reservation when authored dimensions are absent. */
  unknownImageBytes?: number;
  /** Resolves a variant URL for the worker. Default: against `document.baseURI` (or `location.href`). */
  resolve?(url: string): string;
  /** The main-thread path. Default {@link fetchImageBitmap}. */
  fallback?(url: string, signal: AbortSignal): Promise<ImageBitmap>;
}

const pageUrl = (url: string): string => {
  const g = globalThis as {document?: {baseURI?: string}; location?: {href?: string}};
  const base = g.document?.baseURI ?? g.location?.href;
  return base ? new URL(url, base).href : url;
};

/** Complete dimensions set the accepted output allowance; incomplete dimensions use the conservative allowance. */
const reservedBytes = (hint: DecodeHint | undefined, unknownBytes: number) => {
  for (const dimension of [hint?.width, hint?.height])
    if (dimension !== undefined && (!Number.isSafeInteger(dimension) || dimension < 1))
      throw Error('[assets] invalid image dimensions');
  // A width-only variant says nothing about its aspect ratio.
  if (hint?.width === undefined || hint.height === undefined) return unknownBytes;
  const bytes = hint.width * hint.height * 4;
  if (!Number.isSafeInteger(bytes)) throw Error('[assets] invalid image dimensions');
  return bytes;
};

/**
 * The texture cache's `loadImage`: decode in a worker of the host, or on the fallback when the host cannot take the
 * job due to unavailable capabilities. Transient capacity refusals wait within explicit queue/retry bounds. Rejects with `AbortError` when `signal` aborts, and with the job's error when the file cannot be loaded.
 * Reservations and post-decode size checks bound accepted output, not fetched blob bytes or browser decoder peak
 * allocations (ADR 0067). The signal-aware local helper checks after fetch and decode; the worker checks after both.
 */
export function createImageDecoder(options: ImageDecoderOptions): ImageDecoder {
  const maxBytes = options.maxPendingBytes ?? 64 * 1024 * 1024;
  const maxConcurrent = options.maxConcurrent ?? 4;
  const unknownBytes = options.unknownImageBytes ?? 16 * 1024 * 1024;
  for (const limit of [maxBytes, maxConcurrent, unknownBytes])
    if (!Number.isSafeInteger(limit) || limit < 1) throw Error('[assets] invalid decode limit');
  const maxQueued = options.maxQueued ?? 32;
  const admissionTimeoutMs = options.admissionTimeoutMs ?? 5000;
  const maxRetries = options.maxCapacityRetries ?? 40;
  const retryDelay = options.capacityRetryDelayMs ?? 25;
  for (const limit of [maxQueued, maxRetries])
    if (!Number.isSafeInteger(limit) || limit < 0) throw Error('[assets] invalid decode limit');
  for (const delay of [admissionTimeoutMs, retryDelay])
    if (!Number.isSafeInteger(delay) || delay < 1 || delay > 2147483647) throw Error('[assets] invalid decode delay');
  let pendingBytes = 0,
    pendingCount = 0;
  type Waiting = {bytes: number; admit(): void};
  const waiting: Waiting[] = [];
  const fits = (bytes: number) => pendingCount < maxConcurrent && bytes <= maxBytes - pendingBytes;
  const reserve = (bytes: number) => {
    pendingBytes += bytes;
    pendingCount++;
  };
  const pump = () => {
    while (waiting.length && fits(waiting[0]!.bytes)) {
      const next = waiting.shift()!;
      reserve(next.bytes);
      next.admit();
    }
  };
  const admit = (bytes: number, signal: AbortSignal): Promise<void> => {
    if (bytes > maxBytes) return Promise.reject(Error('[assets] image decode admission oversized'));
    if (!waiting.length && fits(bytes)) {
      reserve(bytes);
      return Promise.resolve();
    }
    if (waiting.length >= maxQueued) return Promise.reject(Error('[assets] image decode admission queue exceeded'));
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
      };
      const remove = (error: Error) => {
        const at = waiting.indexOf(entry);
        if (at < 0) return;
        waiting.splice(at, 1);
        cleanup();
        reject(error);
        pump();
      };
      const abort = () => remove(new AbortError());
      const entry: Waiting = {
        bytes,
        admit: () => {
          cleanup();
          resolve();
        },
      };
      const timer = setTimeout(() => remove(Error('[assets] image decode admission timed out')), admissionTimeoutMs);
      waiting.push(entry);
      signal.addEventListener('abort', abort, {once: true});
      if (signal.aborted) abort();
    });
  };
  const waitRetry = (signal: AbortSignal): Promise<void> =>
    new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
      };
      const abort = () => {
        cleanup();
        reject(new AbortError());
      };
      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, retryDelay);
      signal.addEventListener('abort', abort, {once: true});
      if (signal.aborted) abort();
    });
  const resolve = options.resolve ?? pageUrl;
  const fallback = options.fallback ?? ((url: string, signal: AbortSignal) => fetchImageBitmap(url, signal));
  // The texture cache's lifetime: the cache itself aborts each load through `signal`.
  const owner: JobOwner = {id: 'platform.assets.textures', signal: new AbortController().signal};

  return async (url, signal, hint) => {
    if (signal.aborted) throw new AbortError();
    const bytes = reservedBytes(hint, unknownBytes);
    await admit(bytes, signal);
    const validate = (bitmap: ImageBitmap) => {
      if (signal.aborted) {
        bitmap.close();
        throw new AbortError();
      }
      if (
        !Number.isSafeInteger(bitmap.width) ||
        !Number.isSafeInteger(bitmap.height) ||
        bitmap.width < 1 ||
        bitmap.height < 1 ||
        bitmap.width * bitmap.height * 4 > bytes
      ) {
        bitmap.close();
        throw Error('[assets] decoded image exceeds reservation');
      }
      return bitmap;
    };
    try {
      if (signal.aborted) throw new AbortError();
      const absolute = resolve(url);
      for (let attempt = 0; ; attempt++) {
        let result: JobResult<ImageBitmap>;
        try {
          const host = await options.host();
          if (signal.aborted) throw new AbortError();
          result = await host.run(
            {
              kind: decodeImageJob,
              owner,
              version: 0,
              class: 'foreground',
              bytes: {input: 0, output: bytes, scratch: 0},
              materialise: () => ({input: {url: absolute}}),
            },
            signal,
          );
        } catch (error) {
          // A job that ran and failed (a missing file, an undecodable image) is the load's failure. A host that could
          // not run it (no workers, a crashed worker, no host chunk) is not: decode on the fallback instead.
          if (error instanceof WorkerJobError && error.reason === 'threw') throw new Error(error.message);
          if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw new AbortError();
          return validate(await fallback(absolute, signal));
        }
        if (result.status === 'done') {
          if (signal.aborted) {
            result.output.close();
            throw new AbortError();
          }
          return validate(result.output);
        }
        if (result.status === 'cancelled' || signal.aborted) throw new AbortError();
        if ((result.status === 'saturated' || result.status === 'preempted') && attempt < maxRetries) {
          await waitRetry(signal);
          continue;
        }
        // Capacity refusal must not escape the host's limits through another execution path.
        throw Error(`[assets] image decode ${result.status}`);
      }
    } finally {
      pendingBytes -= bytes;
      pendingCount--;
      pump();
    }
  };
}
