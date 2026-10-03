/**
 * dev/session-recording.ts: the dev/test wiring of the sustained-session recorder (PERF-01). Imported only by the
 * dev/test API, so production builds contain neither it nor `platform/perf/session-recorder.ts`.
 *
 * It attaches the recorder to the app's one frame loop and follows the router: `scene.entering` pauses (closing the
 * open window), `scene.entered` starts a segment keyed by scene, visit epoch and the current quality preset, and a
 * quality change re-keys the segment. Export is local only: `evidence()` returns the object, `download()` saves a
 * JSON file through the browser's own download. Nothing is sent anywhere.
 */
import type {EventBus} from '../core/events';
import type {FrameSamplerPort} from '../core/activity/ports';
import {
  recordSession,
  type EvidenceClass,
  type SessionEvidence,
  type SessionRecorder,
  type SessionRecorderOptions,
} from '../platform/perf/session-recorder';

export interface SessionRecording extends SessionRecorder {
  /** Save the evidence as a local JSON file (a browser download). False where there is no document. */
  download(filename?: string): boolean;
  /** The evidence as formatted JSON text, for copying from a remote inspector. */
  json(): string;
}

export interface SessionRecordingDeps {
  loop: {attachSampler(s: FrameSamplerPort): () => void};
  events: Pick<EventBus, 'on'>;
  /** The current scene visit, if any (the `scene` probe). */
  scene(): {scene: string | null; state: string | null; epoch: number} | undefined;
  /** The current quality preset, if the quality module is installed. */
  preset(): string | null;
  /** Subscribe to quality changes; returns an unsubscribe. */
  onQuality?: ((fn: () => void, signal: AbortSignal) => void) | undefined;
  doc?: Document;
}

export function startSessionRecording(
  deps: SessionRecordingDeps,
  options: SessionRecorderOptions = {},
): SessionRecording {
  const recorder = recordSession(deps.loop, options);
  const ac = new AbortController();
  let key: {scene: string; epoch: number} | null = null;
  const apply = () => {
    if (key) recorder.segment({scene: key.scene, epoch: key.epoch, preset: deps.preset()});
  };
  const now = deps.scene();
  if (now?.scene && now.state !== 'entering') {
    key = {scene: now.scene, epoch: now.epoch};
    apply();
  }
  deps.events.on(
    'scene.entering',
    () => {
      key = null;
      recorder.segment(null);
    },
    ac.signal,
  );
  deps.events.on(
    'scene.entered',
    p => {
      key = {scene: p.id, epoch: p.epoch};
      apply();
    },
    ac.signal,
  );
  deps.onQuality?.(apply, ac.signal);
  const evidenceJson = (e: SessionEvidence) => JSON.stringify(e, null, 2) + '\n';
  return {
    get state() {
      return recorder.state;
    },
    frame: r => recorder.frame(r),
    segment: k => recorder.segment(k),
    stop() {
      ac.abort();
      recorder.stop();
    },
    dispose() {
      ac.abort();
      recorder.dispose();
    },
    evidence: () => recorder.evidence(),
    json: () => evidenceJson(recorder.evidence()),
    download(filename = 'session-perf.json') {
      const doc = deps.doc ?? (typeof document === 'undefined' ? undefined : document);
      const view = doc?.defaultView;
      if (!doc || !view?.URL?.createObjectURL) return false;
      const url = view.URL.createObjectURL(
        new view.Blob([evidenceJson(recorder.evidence())], {type: 'application/json'}),
      );
      try {
        const a = doc.createElement('a');
        a.href = url;
        a.download = filename.replace(/[^\w.-]/g, '_').slice(0, 120) || 'session-perf.json';
        doc.body.append(a);
        a.click();
        a.remove();
      } finally {
        view.setTimeout(() => view.URL.revokeObjectURL(url), 1000);
      }
      return true;
    },
  };
}

/**
 * `?session-record` options from an address (dev/test builds only): `session-profile` and `session-evidence` are the
 * operator's labels; `session-window-ms`, `session-max-windows` and `session-overflow` bound the recorder;
 * `session-budget-ms` sets the frame budget. Returns null when `session-record` is absent. Invalid numbers are passed
 * through so the recorder rejects them, rather than silently replaced.
 */
export function sessionOptionsFromSearch(search: string): SessionRecorderOptions | null {
  const q = new URLSearchParams(search);
  if (!q.has('session-record')) return null;
  const num = (k: string) => (q.has(k) ? Number(q.get(k)) : undefined);
  const options: SessionRecorderOptions = {
    meta: {
      profile: q.get('session-profile') ?? undefined,
      evidence: (q.get('session-evidence') ?? undefined) as EvidenceClass | undefined,
      build: q.get('session-build') ?? undefined,
    },
  };
  const windowMs = num('session-window-ms'),
    maxWindows = num('session-max-windows'),
    budgetMs = num('session-budget-ms');
  if (windowMs !== undefined) options.windowMs = windowMs;
  if (maxWindows !== undefined) options.maxWindows = maxWindows;
  if (budgetMs !== undefined) options.budgetMs = budgetMs;
  if (q.has('session-overflow')) options.overflow = q.get('session-overflow') as SessionRecorderOptions['overflow'];
  return options;
}
