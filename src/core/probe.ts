// core/probe.ts: read-on-demand state for the test API and dev console (replaces per-frame dataset JSON writes).
// D8, ADR 0026. A feature registers a getter; nothing is computed until a test or the console asks. In
// production without the test API the kernel provides a disabled instance, so registering costs one function call.
//   declare module '../../core/probe' { interface EngineProbes { 'race': { phase: string; lap: number; speed: number } } }
//   s.probes.register('race', () => ({ phase: race.phase, lap: race.lap, speed: race.speed }), activitySignal);

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface EngineProbes {}
export type ProbeName = keyof EngineProbes & string;

export interface Probes {
  register<K extends ProbeName>(name: K, read: () => EngineProbes[K], signal: AbortSignal): void;
}
export interface ProbeReader {
  read<K extends ProbeName>(name: K): EngineProbes[K] | undefined;
  names(): ProbeName[];
}

export function createProbes(enabled: boolean): Probes & ProbeReader {
  const map = new Map<string, () => unknown>();
  return {
    register(name, read, signal) {
      if (!enabled || signal.aborted) return;
      map.set(name, read);
      signal.addEventListener(
        'abort',
        () => {
          if (map.get(name) === read) map.delete(name);
        },
        {once: true},
      );
    },
    read: <K extends ProbeName>(name: K) => map.get(name)?.() as EngineProbes[K] | undefined,
    names: () => [...map.keys()] as ProbeName[],
  };
}
