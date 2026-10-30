/**
 * Registered job modules, one row per job kind (STD-RUN-35). The worker loads each on first use.
 *
 * Platform-owned kinds are listed here. Domain- and kit-owned kinds are found by file name, so the host names no domain module
 * (platform knows no game, STD-LAY-5): `src/domain/<owner>/workers/<name>.job.ts` is the row `job.<owner>.<name>`.
 * Kit rows use `src/kits/<owner>/workers/<name>.job.ts` and the distinct `job.kits.<owner>.<name>` namespace.
 * A new job is one file.
 */
import type {JobLoaders, JobModule} from './job.ts';

/** The row id of a domain job module's path (`…/domain/sim/workers/pathfind.job.ts` → `job.sim.pathfind`). */
export function domainJobId(path: string): string | null {
  const m = /\/domain\/([\w-]+)\/workers\/([\w-]+)\.job\.ts$/.exec(path);
  return m ? `job.${m[1]}.${m[2]}` : null;
}

export function kitJobId(path: string): string | null {
  const m = /\/kits\/([\w-]+)\/workers\/([\w-]+)\.job\.ts$/.exec(path);
  return m ? `job.kits.${m[1]}.${m[2]}` : null;
}

/** Vite expands the glob; under Node (the tests) there is no glob, and the domain rows are absent. */
function domainRows(): Record<string, () => Promise<JobModule>> {
  let files: Record<string, () => Promise<unknown>>;
  try {
    files = import.meta.glob(['../../domain/*/workers/*.job.ts', '../../kits/*/workers/*.job.ts'], {import: 'default'});
  } catch {
    return {};
  }
  const rows: Record<string, () => Promise<JobModule>> = {};
  for (const [path, load] of Object.entries(files)) {
    const id = kitJobId(path) ?? domainJobId(path);
    if (id) rows[id] = () => load().then(m => m as JobModule);
  }
  return rows;
}

export const jobLoaders: JobLoaders = {
  // the texture cache's off-thread image decode.
  'job.assets.decode-image': () => import('../assets/decode-image.job.ts').then(m => m.default as JobModule),
  ...domainRows(),
};
