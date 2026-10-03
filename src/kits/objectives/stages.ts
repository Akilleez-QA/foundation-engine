import {createObjectiveRun, type ObjectiveRequirement, type ObjectiveSnapshot} from './run';

export interface ObjectiveStage {
  id: string;
  requirements: readonly ObjectiveRequirement[];
  choices: readonly {id: string; to: string | null}[];
}
export interface StagedDefinition {
  id: string;
  revision: number;
  start: string;
  stages: readonly ObjectiveStage[];
}
export interface StageTicket {
  runId: string;
  stage: string;
  incarnation: number;
}
export interface StageTransition extends StageTicket {
  id: string;
  choice: string;
}
export interface StagedSnapshot {
  version: 1;
  definition: StagedDefinition;
  runId: string;
  history: {command: StageTransition; objective: ObjectiveSnapshot}[];
  objective: ObjectiveSnapshot;
  cancelled: boolean;
}
export interface StagedOptions {
  definition: StagedDefinition;
  runId: string;
  maxEventsPerStage?: number;
}
const clone = <T>(value: T): T => structuredClone(value);
function id(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.length || raw.length > 96) throw Error('stages: invalid identity');
  return raw;
}
function ordinal(raw: unknown): number {
  if (!Number.isSafeInteger(raw) || Number(raw) < 0) throw Error('stages: invalid revision');
  return Number(raw);
}
function list<T>(raw: readonly T[], max: number, capture: (value: T) => T): T[] {
  if (!Array.isArray(raw)) throw Error('stages: expected array');
  const length = raw.length;
  if (!Number.isSafeInteger(length) || length < 1 || length > max) throw Error('stages: array bound');
  const result: T[] = [];
  for (let i = 0; i < length; i++) result.push(capture(raw[i]!));
  return result;
}
function definition(raw: StagedDefinition): StagedDefinition {
  const result: StagedDefinition = {
    id: id(raw.id),
    revision: ordinal(raw.revision),
    start: id(raw.start),
    stages: list(raw.stages, 64, stage => ({
      id: id(stage.id),
      requirements: list(stage.requirements, 64, r => ({id: id(r.id), event: id(r.event), target: ordinal(r.target)})),
      choices: list(stage.choices, 16, c => {
        const identity = id(c.id),
          to = c.to;
        return {id: identity, to: to === null ? null : id(to)};
      }),
    })),
  };
  const stages = new Map(result.stages.map(s => [s.id, s]));
  if (stages.size !== result.stages.length || !stages.has(result.start))
    throw Error('stages: duplicate or missing stage');
  const visited = new Set<string>(),
    visiting = new Set<string>();
  const visit = (key: string): void => {
    if (visiting.has(key)) throw Error('stages: cyclic definition');
    if (visited.has(key)) return;
    const s = stages.get(key);
    if (!s) throw Error('stages: unknown destination');
    if (new Set(s.choices.map(c => c.id)).size !== s.choices.length) throw Error('stages: duplicate choice');
    // Reuse the existing requirement validator, including positive targets and unique IDs.
    createObjectiveRun({runId: 'validation', requirements: s.requirements});
    visiting.add(key);
    for (const c of s.choices) if (c.to !== null) visit(c.to);
    visiting.delete(key);
    visited.add(key);
  };
  for (const s of result.stages) visit(s.id);
  return result;
}
function transition(raw: StageTransition): StageTransition {
  return {
    runId: id(raw.runId),
    stage: id(raw.stage),
    incarnation: ordinal(raw.incarnation),
    id: id(raw.id),
    choice: id(raw.choice),
  };
}

/** Capture caller snapshots without invoking array overrides or accepting unbounded iteration. */
function captureObjective(raw: ObjectiveSnapshot, maxEvents: number): ObjectiveSnapshot {
  if (!raw || raw.version !== 1) throw Error('stages: invalid objective snapshot');
  const runId = raw.runId,
    cancelled = raw.cancelled,
    reward = raw.reward;
  if (
    typeof runId !== 'string' ||
    !runId.length ||
    runId.length > 256 ||
    typeof cancelled !== 'boolean' ||
    reward !== null
  )
    throw Error('stages: invalid objective state');
  const requirements = list(raw.requirements, 64, r => ({id: id(r.id), event: id(r.event), target: ordinal(r.target)}));
  const source = raw.events;
  if (!Array.isArray(source)) throw Error('stages: invalid event history');
  const length = source.length;
  if (!Number.isSafeInteger(length) || length < 0 || length > maxEvents) throw Error('stages: event history bound');
  const events: ObjectiveSnapshot['events'] = [];
  for (let i = 0; i < length; i++) {
    const e = source[i]!,
      eventRun = e.runId;
    if (eventRun !== runId) throw Error('stages: invalid event identity');
    events.push({runId: eventRun, eventId: id(e.eventId), event: id(e.event), amount: ordinal(e.amount)});
  }
  return {version: 1, runId, requirements, events, cancelled, reward: null};
}

/** One finite local run. Transitions are explicit; the creator owns effects and publication. */
export function createStagedObjectives(options: StagedOptions, saved?: unknown) {
  const d = definition(options.definition),
    runId = id(options.runId),
    maxEvents = options.maxEventsPerStage ?? 256;
  if (!Number.isSafeInteger(maxEvents) || maxEvents < 1 || maxEvents > 4096) throw Error('stages: invalid event bound');
  const stages = new Map(d.stages.map(s => [s.id, s]));
  let current = d.start,
    incarnation = 0,
    done = false,
    cancelled = false;
  const history: StagedSnapshot['history'] = [];
  const objectiveId = () => `${runId}:${incarnation}`;
  const make = (snapshot?: unknown) =>
    createObjectiveRun({runId: objectiveId(), requirements: stages.get(current)!.requirements, maxEvents}, snapshot);
  let objective = make();
  const matches = (ticket: StageTicket) =>
    ticket.runId === runId && ticket.stage === current && ticket.incarnation === incarnation;
  const move = (command: StageTransition) => {
    const choice = stages.get(current)!.choices.find(c => c.id === command.choice)!;
    history.push({command, objective: objective.snapshot()});
    if (choice.to === null) done = true;
    else {
      current = choice.to;
      incarnation++;
      objective = make();
    }
  };
  if (saved !== undefined) {
    const s = saved as StagedSnapshot;
    if (!s) throw Error('stages: invalid snapshot');
    const version = s.version,
      savedRun = s.runId,
      savedCancelled = s.cancelled,
      savedDefinition = s.definition,
      savedHistory = s.history,
      savedObjective = s.objective;
    if (
      version !== 1 ||
      savedRun !== runId ||
      typeof savedCancelled !== 'boolean' ||
      JSON.stringify(definition(savedDefinition)) !== JSON.stringify(d) ||
      !Array.isArray(savedHistory)
    )
      throw Error('stages: invalid snapshot');
    const historyLength = savedHistory.length;
    if (!Number.isSafeInteger(historyLength) || historyLength < 0 || historyLength > d.stages.length)
      throw Error('stages: history bound');
    const seen = new Set<string>();
    for (let i = 0; i < historyLength; i++) {
      const entry = savedHistory[i]!,
        command = transition(entry.command),
        historicalObjective = entry.objective;
      if (
        done ||
        !matches(command) ||
        seen.has(command.id) ||
        !stages.get(current)!.choices.some(c => c.id === command.choice)
      )
        throw Error('stages: invalid transition history');
      objective = make(captureObjective(historicalObjective, maxEvents));
      if (!objective.isComplete() || objective.snapshot().reward !== null)
        throw Error('stages: invalid completed objective');
      seen.add(command.id);
      move(command);
    }
    objective = make(captureObjective(savedObjective, maxEvents));
    if (
      objective.snapshot().reward !== null ||
      (done && JSON.stringify(objective.snapshot()) !== JSON.stringify(history[history.length - 1]!.objective))
    )
      throw Error('stages: invalid objective');
    cancelled = savedCancelled;
    if ((cancelled && done) || objective.snapshot().cancelled !== (cancelled && !objective.isComplete()))
      throw Error('stages: invalid cancellation');
  }
  let busy = false;
  const guarded = <T>(operation: () => T): T => {
    if (busy) throw Error('stages: reentrant mutation');
    busy = true;
    try {
      return operation();
    } finally {
      busy = false;
    }
  };
  return {
    ticket: (): StageTicket => ({runId, stage: current, incarnation}),
    view: () => ({
      runId,
      stage: current,
      incarnation,
      status: cancelled ? ('cancelled' as const) : done ? ('complete' as const) : ('active' as const),
      ready: objective.isComplete(),
      progress: objective.progress(),
    }),
    record(raw: StageTicket & {eventId: string; event: string; amount: number}) {
      return guarded(() => {
        const ticket = {runId: id(raw.runId), stage: id(raw.stage), incarnation: ordinal(raw.incarnation)};
        const event = {runId: objectiveId(), eventId: id(raw.eventId), event: id(raw.event), amount: raw.amount};
        if (!matches(ticket)) return 'stale' as const;
        if (cancelled) return 'cancelled' as const;
        if (done) return 'complete' as const;
        return objective.record(event);
      });
    },
    transition(raw: StageTransition) {
      return guarded(() => {
        const command = transition(raw),
          prior = history.find(h => h.command.id === command.id);
        if (prior)
          return JSON.stringify(prior.command) === JSON.stringify(command)
            ? ('duplicate' as const)
            : ('conflict' as const);
        if (!matches(command)) return 'stale' as const;
        if (cancelled) return 'cancelled' as const;
        if (done) return 'complete' as const;
        if (!objective.isComplete()) return 'incomplete' as const;
        if (!stages.get(current)!.choices.some(c => c.id === command.choice)) return 'unavailable' as const;
        move(command);
        return 'accepted' as const;
      });
    },
    cancel() {
      return guarded(() => {
        if (done || cancelled) return false;
        cancelled = true;
        objective.cancel();
        return true;
      });
    },
    snapshot: (): StagedSnapshot =>
      clone({version: 1, definition: d, runId, history, objective: objective.snapshot(), cancelled}),
  };
}
