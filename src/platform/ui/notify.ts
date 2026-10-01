/**
 * platform/ui/notify.ts: the notification centre (, APPLICATION "Notifications").
 * The UI shell owns it: one queue, four channels (`celebrate`, `hint`, `story`, `system`), merging, the story inbox
 * and holding back while narration speaks. Features turn their own events into notices (a row in the owning feature);
 * a channel's renderer draws them. Knows no game nouns.
 *
 * - **Bursts.** Notices posted in the same task are released together on a microtask, so a burst of `reward.granted`
 *   events reaches its renderer once: every notice sharing a `merge` key arrives in one `show` call.
 * - **Holds.** `holdWhile(signal)` keeps notices queued until every held signal is aborted, then releases them in
 *   order. `appNotify()` holds while the `narration.speaking` event says the narrator speaks; nothing polls.
 * - **Inbox.** Story notices are kept, 50 newest (a mailbox a game shows). A game persists it with its own save section.
 * - **Renderers** may register late (a lazy channel): notices wait for them. Every pending channel retains only its newest `limit` entries,
 *   including during holds and renderer callbacks. Overflow drops the oldest pending entry, not inbox history.
 * - **Reentrancy.** Renderer callbacks may post, hold, remove or replace renderers. New posts form a later burst;
 *   remaining groups observe current holds and registrations. A delivered group is consumed even if `show` throws.
 */

import { appEvents } from '../../core/app-events';
import type { EventBus } from '../../core/events';

export type NoticeChannel = 'celebrate' | 'hint' | 'story' | 'system';
/** A t() key; checked against the string catalogues by the content test. */
export type NoticeKey = string;
export interface Notice {
  id: string;
  channel: NoticeChannel;
  icon: string;
  titleKey: NoticeKey;
  bodyKey?: NoticeKey;
  params?: Record<string, string | number>;
  /** Merge key: notices with the same key released together become one toast (mergeToasts today). */
  merge?: string;
  /** Read aloud through narration instead of the toast's live region. */
  speech?: boolean;
  /** Renderer metadata; the centre preserves posting order and does not prioritize admission. */
  priority?: 0 | 1 | 2;
  /** Renderer metadata; the centre does not expire queued notices or start timers. */
  ttlMs?: number;
  action?: { labelKey: NoticeKey; route?: string; hub?: string };
}

/** Draws one channel. `show` gets one merged group: every released notice with one merge key (or one unmerged notice). */
export interface NoticeRenderer { show(notices: readonly Notice[]): void }

export interface NotificationCenter {
  post(n: Notice): void;
  /** Story notices are kept (the mailbox); celebrate and hint notices are not. */
  inbox(): readonly Notice[];
  /** Hold notices while narration speaks or a cutscene runs; release in order afterwards. Event-driven, no polling. */
  holdWhile(signal: AbortSignal): void;
  /** The channel's renderer; returns its removal. Queued notices for the channel are released to it. */
  render(channel: NoticeChannel, renderer: NoticeRenderer): () => void;
}

export interface NotificationCenterOptions {
  /** Schedules initial burst release (default `queueMicrotask`); callback-generated follow-ups always use a microtask to bound stack depth. Throws propagate and leave scheduling retryable. */
  defer?: (fn: () => void) => void;
  /** Positive safe integer: story inbox size and newest pending notices per channel, even during holds. */
  limit?: number;
}

/** Copy the public data shape at ownership boundaries; nested fields contain only scalar values. */
function copyNotice(n: Notice): Notice {
  return { ...n, ...(n.params ? { params: { ...n.params } } : {}), ...(n.action ? { action: { ...n.action } } : {}) };
}

export function createNotificationCenter(opts: NotificationCenterOptions = {}): NotificationCenter {
  const defer = opts.defer ?? (fn => queueMicrotask(fn)), limit = opts.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('notification limit must be a positive safe integer');
  // Registration identity is separate from renderer identity: stale removals cannot remove a later registration.
  const renderers = new Map<NoticeChannel, { renderer: NoticeRenderer }>();
  const kept: Notice[] = [];
  type Entry = { notice: Notice };
  let queue: Entry[] = [], scheduled = false, releasing = false;
  const holds = new Set<AbortSignal>();

  function schedule(followup = false) {
    if (scheduled || releasing || holds.size || !queue.some(e => renderers.has(e.notice.channel))) return;
    scheduled = true;
    try { (followup ? queueMicrotask : defer)(() => { scheduled = false; release(); }); }
    catch (error) { scheduled = false; throw error; }
  }
  function release() {
    if (holds.size || releasing) return;
    releasing = true;
    // Entries, rather than Notice object identity, distinguish repeated posts of the same object.
    const burst = new Set(queue);
    try {
      while (!holds.size) {
        const first = queue.find(e => burst.has(e) && renderers.has(e.notice.channel));
        if (!first) break;
        const n = first.notice;
        const group = queue.filter(e => burst.has(e) && (e === first ||
          (n.merge !== undefined && e.notice.channel === n.channel && e.notice.merge === n.merge)));
        const selected = new Set(group);
        queue = queue.filter(e => !selected.has(e));
        const registration = renderers.get(n.channel)!;
        try { registration.renderer.show(group.map(e => copyNotice(e.notice))); }
        catch (e) { console.error('[notify] a renderer failed', e); }
      }
    } finally {
      releasing = false;
      schedule(true);
    }
  }

  return {
    post(n) {
      n = copyNotice(n);
      if (n.channel === 'story') { kept.push(n); if (kept.length > limit) kept.splice(0, kept.length - limit); }
      queue.push({ notice: n });
      let excess = queue.filter(e => e.notice.channel === n.channel).length - limit;
      queue = queue.filter(e => e.notice.channel !== n.channel || excess-- <= 0);
      schedule();
    },
    inbox: () => kept.map(copyNotice),
    holdWhile(signal) {
      if (signal.aborted || holds.has(signal)) return;
      holds.add(signal);
      signal.addEventListener('abort', () => { holds.delete(signal); schedule(); }, { once: true });
    },
    render(channel, renderer) {
      const registration = { renderer };
      renderers.set(channel, registration);
      schedule();
      return () => { if (renderers.get(channel) === registration) renderers.delete(channel); };
    },
  };
}

declare module '../../core/events' {
  interface EngineEvents {
    /** The narrator started or stopped speaking. Sent on changes only. */
    'narration.speaking': { speaking: boolean };
  }
}

/** Holds `center` for as long as `narration.speaking` says the narrator speaks; returns the unwiring. */
export function holdWhileNarrating(bus: EventBus, center: NotificationCenter): () => void {
  let hold: AbortController | null = null, disposed = false;
  const off = bus.on('narration.speaking', ({ speaking }) => {
    if (disposed) return;
    if (speaking && !hold) { hold = new AbortController(); center.holdWhile(hold.signal); }
    else if (!speaking && hold) { const finished = hold; hold = null; finished.abort(); }
  });
  return () => { disposed = true; off(); const finished = hold; hold = null; finished?.abort(); };
}

let shared: NotificationCenter | null = null;
/** The app's one notification centre (the `notify` service until the kernel boot is adopted, as `appShell` is).
 *  It holds while narration speaks. */
export function appNotify(): NotificationCenter {
  if (!shared) { shared = createNotificationCenter(); holdWhileNarrating(appEvents, shared); }
  return shared;
}
