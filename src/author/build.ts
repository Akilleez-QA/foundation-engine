/**
 * author/build.ts: the build brief, the contract a game is built against (AGENTS.md: "the brief is the contract").
 *
 * The creator chooses requirements; agents implement authorized changes and provide evidence.
 * The engine validates declarations and returns an immutable snapshot; acceptance evidence is
 * separate, and creators can construct a new snapshot when requirements change. See docs/CREATOR-CONTRACT.md.
 *
 * `defineBuild` takes what the author decided up front (goal, audience, genre, devices, quality, targets, modes,
 * constraints, success criteria) and fills every derived number from the minimum device's tier, so the generators,
 * `npm run check` and `npm run gate` read one typed source. Changing a goal, audience or target is an explicit edit
 * here, recorded in GAME.md's changelog, and re-derives the budgets (which still only fall without a Perf-Budget
 * trailer). The audience is neutral by default; `kids: true` (or the learn template) opts in to the kid-safe profile.
 */
type Immutable<T> = T extends object ? {readonly [K in keyof T]: Immutable<T[K]>} : T;
/** Clone only normalized contract data, so freezing never changes creator-owned inputs. */
function snapshot<T>(value: T): Immutable<T> {
  if (Array.isArray(value)) return Object.freeze(value.map(item => snapshot(item))) as Immutable<T>;
  if (value !== null && typeof value === 'object')
    return Object.freeze(
      Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshot(item)])),
    ) as Immutable<T>;
  return value as Immutable<T>;
}

export type DeviceClass = 'desktop' | 'laptop' | 'tablet' | 'phone';
export type InputKind = 'keyboard' | 'pointer' | 'touch' | 'gamepad';

/** Per-scene ceilings a scene's measured budget must stay under (the software-GL gate counts). */
export interface SceneCeiling {
  draws: number;
  triangles: number;
  textureMiB: number;
  heapMiB: number;
}
export interface PerformanceTargets {
  fps: number;
  /** Cold start to the first scene, reference machine. */
  loadMs: number;
  /** First-load JavaScript, KiB. */
  firstLoadKiB: number;
  /** Retained heap after a tour of every scene, MiB. */
  heapMiB: number;
  perScene: SceneCeiling;
}

/** Tier defaults: what a scene may cost on the weakest device the game promises to run on. */
export const TIER: Immutable<Record<DeviceClass, PerformanceTargets>> = snapshot({
  desktop: {
    fps: 60,
    loadMs: 3000,
    firstLoadKiB: 1024,
    heapMiB: 96,
    perScene: {draws: 400, triangles: 1_000_000, textureMiB: 256, heapMiB: 64},
  },
  laptop: {
    fps: 60,
    loadMs: 3000,
    firstLoadKiB: 900,
    heapMiB: 80,
    perScene: {draws: 250, triangles: 500_000, textureMiB: 128, heapMiB: 48},
  },
  tablet: {
    fps: 60,
    loadMs: 4000,
    firstLoadKiB: 800,
    heapMiB: 64,
    perScene: {draws: 150, triangles: 300_000, textureMiB: 96, heapMiB: 40},
  },
  phone: {
    fps: 60,
    loadMs: 5000,
    firstLoadKiB: 704,
    heapMiB: 48,
    perScene: {draws: 100, triangles: 150_000, textureMiB: 64, heapMiB: 32},
  },
});

export interface SuccessCriterion {
  /** Stable id ('S1'), cited by playtest reports and milestones. */
  id: string;
  /** Checkable: says what is observed, where, and the pass condition. */
  check: string;
  /** How it is checked: a scripted playtest (playtest/scripts/<file>), a unit test, the gate, or a person. */
  how: 'playtest' | 'test' | 'gate' | 'manual';
  /** For `playtest` and `test`: the file that checks it. */
  by?: string;
}

export interface BuildInput {
  goal: string;
  pitch: string;
  /** Neutral by default. `kids: true` applies the kid-safe policy profile (docs/policy/KID-SAFE.md). */
  audience?: {ages?: readonly [number, number]; kids?: boolean; flags?: readonly string[]; notes?: string};
  /** The genre picks the template (`npm run new-game`): 'blank', 'arcade', 'explorer', 'learn', or your own. */
  genre: string;
  coreLoop: readonly string[];
  devices: {targets: readonly DeviceClass[]; minimum: DeviceClass; input: readonly InputKind[]};
  quality?: {
    tier?: 'reference' | 'high' | 'medium' | 'low';
    views?: readonly {id: string; scene: string; mode: 'identical' | 'near' | 'reviewed'}[];
  };
  performance?: Partial<Omit<PerformanceTargets, 'perScene'>> & {perScene?: Partial<SceneCeiling>};
  /** Modes the game ships (ids of `defineMode` rows); default ['play']. */
  modes?: readonly string[];
  constraints?: {content?: readonly string[]; ip?: readonly string[]};
  success: readonly SuccessCriterion[];
  /** Learn mode: at most this many passive lesson actions in a row before the learner acts (default 3). */
  pedagogy?: {maxPassiveActions?: number};
  /** Kid-safe tuning: the most repeats any reward may ask for (default 5). */
  kidSafe?: {maxRepeat?: number};
}

export type BuildBrief = Immutable<{
  /** Resolved data schema version; application acceptance evidence is recorded separately. */
  contractVersion: 1;
  readonly kind: 'build';
  readonly goal: string;
  readonly pitch: string;
  readonly audience: {ages?: readonly [number, number]; kids: boolean; flags: readonly string[]; notes?: string};
  readonly genre: string;
  readonly coreLoop: readonly string[];
  readonly devices: BuildInput['devices'];
  readonly quality: {
    tier: 'reference' | 'high' | 'medium' | 'low';
    views: readonly {id: string; scene: string; mode: 'identical' | 'near' | 'reviewed'}[];
  };
  readonly performance: PerformanceTargets;
  readonly modes: readonly string[];
  readonly constraints: {content: readonly string[]; ip: readonly string[]};
  readonly success: readonly SuccessCriterion[];
  readonly policy: 'default' | 'kid-safe';
  readonly pedagogy: {maxPassiveActions: number};
  readonly kidSafe: {maxRepeat: number};
}>;

/** Problems in a brief; [] when it is a usable contract. */
export function briefProblems(value: unknown): string[] {
  const out: string[] = [];
  const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
  const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
  if (!record(value)) return ['expected a build brief object'];
  const b = value;
  const list = (v: unknown, name: string, required = false, choices?: readonly string[]) => {
    if (
      !Array.isArray(v) ||
      (required && !v.length) ||
      Array.from(v).some(x => !text(x) || (choices && !choices.includes(x)))
    ) {
      out.push(`${name}: expected ${required ? 'nonempty ' : ''}list of ${choices?.join(', ') ?? 'nonempty strings'}`);
      return [] as string[];
    }
    if (new Set(v).size !== v.length && choices) out.push(`${name}: duplicate declarations`);
    return v as string[];
  };
  const number = (v: unknown, name: string, positive = false, integer = false) => {
    if (
      typeof v !== 'number' ||
      !Number.isFinite(v) ||
      v > Number.MAX_SAFE_INTEGER ||
      v < 0 ||
      (positive && v === 0) ||
      (integer && !Number.isSafeInteger(v))
    )
      out.push(
        `${name}: expected a ${positive ? 'positive' : 'nonnegative'} finite ${integer ? 'integer' : 'number'} no greater than MAX_SAFE_INTEGER`,
      );
  };
  if (!text(b.goal) || !text(b.pitch)) out.push('goal and pitch are required');
  if (!text(b.genre)) out.push('name the genre');
  list(b.coreLoop, 'coreLoop', true);
  if (!record(b.devices)) out.push('devices: expected an object');
  else {
    const targets = list(b.devices.targets, 'devices.targets', true, ['desktop', 'laptop', 'tablet', 'phone']);
    if (!targets.includes(b.devices.minimum as string)) out.push('devices.minimum must be one of the declared targets');
    list(b.devices.input, 'devices.input', true, ['keyboard', 'pointer', 'touch', 'gamepad']);
  }
  for (const key of ['audience', 'quality', 'performance', 'constraints', 'pedagogy', 'kidSafe'])
    if (b[key] !== undefined && !record(b[key])) out.push(`${key}: expected an object`);
  if (record(b.audience)) {
    const audience = b.audience;
    if (audience.kids !== undefined && typeof audience.kids !== 'boolean') out.push('audience.kids: expected boolean');
    if (audience.notes !== undefined && typeof audience.notes !== 'string') out.push('audience.notes: expected string');
    if (audience.flags !== undefined) list(audience.flags, 'audience.flags');
    if (
      audience.ages !== undefined &&
      (!Array.isArray(audience.ages) ||
        audience.ages.length !== 2 ||
        Array.from(audience.ages).some(
          x => typeof x !== 'number' || !Number.isFinite(x) || x > Number.MAX_SAFE_INTEGER,
        ) ||
        audience.ages[0] < 0 ||
        audience.ages[0] > audience.ages[1])
    )
      out.push('audience ages must be a finite ascending nonnegative range');
  }
  if (record(b.quality)) {
    if (b.quality.tier !== undefined && !['reference', 'high', 'medium', 'low'].includes(b.quality.tier as string))
      out.push('quality.tier: unknown tier');
    if (b.quality.views !== undefined) {
      const ids = new Set<string>();
      if (!Array.isArray(b.quality.views)) out.push('quality.views: expected an array');
      else
        for (const view of b.quality.views) {
          if (
            !record(view) ||
            !text(view.id) ||
            ids.has(view.id) ||
            !text(view.scene) ||
            !['identical', 'near', 'reviewed'].includes(view.mode as string)
          )
            out.push('quality.views: require unique IDs, scene names and valid comparison modes');
          if (record(view) && text(view.id)) ids.add(view.id);
        }
    }
  }
  if (record(b.performance)) {
    for (const key of ['fps', 'loadMs', 'firstLoadKiB', 'heapMiB'])
      if (b.performance[key] !== undefined) number(b.performance[key], `performance.${key}`, key !== 'heapMiB');
    if (b.performance.perScene !== undefined && !record(b.performance.perScene))
      out.push('performance.perScene: expected an object');
    if (record(b.performance.perScene))
      for (const key of ['draws', 'triangles', 'textureMiB', 'heapMiB'])
        if (b.performance.perScene[key] !== undefined)
          number(
            b.performance.perScene[key],
            `performance.perScene.${key}`,
            false,
            key === 'draws' || key === 'triangles',
          );
  }
  if (b.modes !== undefined) list(b.modes, 'modes');
  if (record(b.constraints))
    for (const key of ['content', 'ip'])
      if (b.constraints[key] !== undefined) list(b.constraints[key], `constraints.${key}`);
  if (record(b.pedagogy) && b.pedagogy.maxPassiveActions !== undefined)
    number(b.pedagogy.maxPassiveActions, 'pedagogy.maxPassiveActions', false, true);
  if (record(b.kidSafe) && b.kidSafe.maxRepeat !== undefined)
    number(b.kidSafe.maxRepeat, 'kidSafe.maxRepeat', false, true);
  const ids = new Set<string>();
  if (!Array.isArray(b.success) || !b.success.length) out.push('state at least one success criterion');
  else
    for (const criterion of b.success) {
      if (!record(criterion)) {
        out.push('success: expected criterion objects');
        continue;
      }
      const s = criterion,
        label = text(s.id) ? s.id : 'success criterion';
      if (!text(s.id) || !/^[A-Z][A-Z0-9-]*$/.test(s.id) || ids.has(s.id))
        out.push('success criterion ids must be unique UPPER-KEBAB');
      if (text(s.id)) ids.add(s.id);
      if (!text(s.check)) out.push(`${label}: provide nonempty success criterion text`);
      if (!['playtest', 'test', 'gate', 'manual'].includes(s.how as string))
        out.push(`${label}: unknown verification method`);
      if ((s.how === 'playtest' || s.how === 'test' || s.by !== undefined) && !text(s.by))
        out.push(`${label}: name the file that checks it (by)`);
    }
  return out;
}

export function defineBuild(b: BuildInput): BuildBrief {
  const problems = briefProblems(b);
  if (problems.length) throw Error('build brief: ' + problems.join('; '));
  const tier = TIER[b.devices.minimum];
  const childProfile = b.audience?.kids ?? false;
  return snapshot({
    contractVersion: 1 as const,
    kind: 'build' as const,
    goal: b.goal,
    pitch: b.pitch,
    genre: b.genre,
    coreLoop: b.coreLoop,
    devices: {
      targets: b.devices.targets,
      minimum: b.devices.minimum,
      input: b.devices.input,
    },
    success: b.success.map(s => ({
      id: s.id,
      check: s.check,
      how: s.how,
      ...(s.by === undefined ? {} : {by: s.by}),
    })),
    audience: {
      kids: childProfile,
      flags: b.audience?.flags ?? [],
      ...(b.audience?.ages === undefined ? {} : {ages: b.audience.ages}),
      ...(b.audience?.notes === undefined ? {} : {notes: b.audience.notes}),
    },
    quality: {
      tier: b.quality?.tier ?? 'reference',
      views: (b.quality?.views ?? []).map(v => ({id: v.id, scene: v.scene, mode: v.mode})),
    },
    performance: {
      fps: b.performance?.fps ?? tier.fps,
      loadMs: b.performance?.loadMs ?? tier.loadMs,
      firstLoadKiB: b.performance?.firstLoadKiB ?? tier.firstLoadKiB,
      heapMiB: b.performance?.heapMiB ?? tier.heapMiB,
      perScene: {
        draws: b.performance?.perScene?.draws ?? tier.perScene.draws,
        triangles: b.performance?.perScene?.triangles ?? tier.perScene.triangles,
        textureMiB: b.performance?.perScene?.textureMiB ?? tier.perScene.textureMiB,
        heapMiB: b.performance?.perScene?.heapMiB ?? tier.perScene.heapMiB,
      },
    },
    modes: b.modes ?? ['play'],
    constraints: {
      content: b.constraints?.content ?? [],
      ip: b.constraints?.ip ?? [],
    },
    policy: childProfile ? ('kid-safe' as const) : ('default' as const),
    pedagogy: {maxPassiveActions: b.pedagogy?.maxPassiveActions ?? 3},
    kidSafe: {maxRepeat: b.kidSafe?.maxRepeat ?? 5},
  });
}
