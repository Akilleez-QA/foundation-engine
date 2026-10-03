import type {SceneActivityFacts} from './defs';

/** One visit, one optional listener. Reentrant changes coalesce; no scheduled work. */
export function createSceneActivity(
  read: () => SceneActivityFacts,
  notify: (facts: SceneActivityFacts) => void,
  report: (error: unknown) => void,
  onOverload: () => void,
) {
  let started = false,
    retired = false,
    busy = false,
    pending = false;
  let last: SceneActivityFacts | undefined;
  const failure = (error: unknown) => {
    try {
      report(error);
    } catch {
      /* Reporting cannot break retirement. */
    }
  };
  const flush = () => {
    if (!started || busy) return;
    busy = true;
    try {
      let count = 0;
      while (pending) {
        pending = false;
        const current = read();
        const facts = Object.freeze({
          phase: retired ? ('retired' as const) : current.phase,
          coverage: current.coverage,
          documentHidden: current.documentHidden,
        });
        if (last?.phase === 'retired') break;
        if (
          last &&
          last.phase === facts.phase &&
          last.coverage === facts.coverage &&
          last.documentHidden === facts.documentHidden
        )
          continue;
        last = facts;
        try {
          notify(facts);
        } catch (error) {
          failure(error);
        }
        if (++count >= 8 && pending && !retired) {
          // The owner must synchronously stop the actual visit, which calls retire().
          // Logging or inventing terminal facts would leave an eligible consumer alive.
          try {
            onOverload();
          } catch (error) {
            failure(error);
          }
          failure(Error('scene activity: reentrant notification limit'));
          // A broken owner callback cannot turn this bounded flush into another loop.
          if (!retired) {
            pending = false;
            break;
          }
        }
      }
    } finally {
      busy = false;
    }
  };
  return {
    start() {
      if (started || retired) return;
      started = true;
      pending = true;
      flush();
    },
    refresh() {
      if (retired) return;
      pending = true;
      flush();
    },
    retire() {
      if (retired) return;
      retired = true;
      pending = true;
      flush();
    },
  };
}
