export interface Capability { id: string; requires: readonly string[]; evidence: readonly string[] }
export interface Grant { capability: string; reason: 'earned' | 'tutorial' | 'migration'; event: string }
export interface CapabilitySnapshot { evidence: string[]; grants: Grant[]; revision?: number }
export interface CapabilityRevocation {
  capabilities: readonly string[];
  dependents: 'reject' | 'cascade';
  privilegedDependents: 'include' | 'retain';
}
export interface CapabilityRevocationPreview {
  readonly revision: number;
  readonly request: Readonly<CapabilityRevocation>;
  readonly removed: readonly string[];
  readonly blocked: readonly string[];
}
function ids(value: readonly string[], maximum: number, normalizeDuplicates = false): string[] {
  if (!Array.isArray(value)) throw Error('capabilities: expected array');
  const length = value.length;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum) throw Error('capabilities: array limit exceeded');
  const result: string[] = [], seen = new Set<string>();
  for (let i = 0; i < length; i++) {
    const id = value[i];
    if (typeof id !== 'string' || !id) throw Error('capabilities: invalid id');
    if (seen.has(id)) {
      if (normalizeDuplicates) continue;
      throw Error('capabilities: duplicate id');
    }
    seen.add(id); result.push(id);
  }
  return result;
}
/** One bounded possession owner; eligibility and explicit grant provenance remain separate. */
export function createCapabilities(definitions: readonly Capability[], saved?: CapabilitySnapshot) {
  if (!Array.isArray(definitions)) throw Error('capabilities: invalid definitions');
  const length = definitions.length;
  if (!Number.isSafeInteger(length) || length < 0 || length > 1024) throw Error('capabilities: definition limit exceeded');
  const nodes = new Map<string, Capability>();
  for (let i = 0; i < length; i++) {
    const d = definitions[i], id = d.id;
    if (typeof id !== 'string' || !id || nodes.has(id)) throw Error('capabilities: invalid definition');
    nodes.set(id, { id, requires: ids(d.requires, 1024, true), evidence: ids(d.evidence, 4096, true) });
  }
  const visited = new Set<string>(), visiting = new Set<string>(), ordered: string[] = [];
  const visit = (id: string) => {
    if (visited.has(id)) return;
    const node = nodes.get(id);
    if (!node || visiting.has(id)) throw Error('capabilities: missing prerequisite or cycle');
    visiting.add(id); for (const p of node.requires) visit(p);
    visiting.delete(id); visited.add(id); ordered.push(id);
  };
  for (const id of nodes.keys()) visit(id);
  const evidence = new Set<string>(), grants = new Map<string, Grant>();
  let revision = 0, busy = false;
  const guarded = <T>(operation: () => T): T => {
    if (busy) throw Error('capabilities: reentrant mutation');
    busy = true;
    try { return operation(); } finally { busy = false; }
  };
  const nextRevision = () => {
    if (revision === Number.MAX_SAFE_INTEGER) throw Error('capabilities: revision exhausted');
    return revision + 1;
  };
  const captureGrant = (value: Grant): Grant => {
    const capability = value.capability, reason = value.reason, event = value.event;
    if (!nodes.has(capability) || typeof event !== 'string' || !event ||
        (reason !== 'earned' && reason !== 'tutorial' && reason !== 'migration')) throw Error('capabilities: invalid grant');
    return { capability, reason, event };
  };
  const eligible = (id: string) => {
    const d = nodes.get(id);
    return Boolean(d && d.requires.every(p => grants.has(p)) && d.evidence.every(e => evidence.has(e)));
  };
  if (saved !== undefined) {
    if (saved === null || typeof saved !== 'object') throw Error('capabilities: invalid snapshot');
    const restoredRevision = saved.revision;
    if (restoredRevision !== undefined && (!Number.isSafeInteger(restoredRevision) || restoredRevision < 0)) throw Error('capabilities: invalid revision');
    revision = restoredRevision ?? 0;
    for (const e of ids(saved.evidence, 4096)) evidence.add(e);
    const restoredGrants = saved.grants;
    if (!Array.isArray(restoredGrants)) throw Error('capabilities: invalid saved grants');
    const count = restoredGrants.length;
    if (!Number.isSafeInteger(count) || count < 0 || count > 1024) throw Error('capabilities: saved limits exceeded');
    for (let i = 0; i < count; i++) {
      const g = captureGrant(restoredGrants[i]);
      if (grants.has(g.capability)) throw Error('capabilities: duplicate saved grant');
      grants.set(g.capability, g);
    }
    for (const g of grants.values()) if (g.reason === 'earned' && !eligible(g.capability)) throw Error('capabilities: invalid saved eligibility');
  }
  const preview = (value: CapabilityRevocation): CapabilityRevocationPreview => {
    const capabilities = ids(value.capabilities, 1024);
    const dependents = value.dependents, privilegedDependents = value.privilegedDependents;
    if ((dependents !== 'reject' && dependents !== 'cascade') ||
        (privilegedDependents !== 'include' && privilegedDependents !== 'retain') ||
        capabilities.some(id => !nodes.has(id))) throw Error('capabilities: invalid revocation');
    const selected = new Set(capabilities.filter(id => grants.has(id))), removed = new Set(selected);
    for (const id of ordered) {
      const g = grants.get(id);
      if (!g || removed.has(id) || (g.reason !== 'earned' && privilegedDependents === 'retain')) continue;
      if (nodes.get(id)!.requires.some(p => removed.has(p))) removed.add(id);
    }
    const blocked = dependents === 'reject' ? [...removed].filter(id => !selected.has(id)).sort() : [];
    return Object.freeze({ revision,
      request: Object.freeze({ capabilities: Object.freeze(capabilities), dependents, privilegedDependents }),
      removed: Object.freeze([...removed].sort()), blocked: Object.freeze(blocked) });
  };
  return {
    get revision() { return revision; },
    record(e: string) { return guarded(() => {
      if (typeof e !== 'string' || !e || (!evidence.has(e) && evidence.size >= 4096)) throw Error('capabilities: invalid evidence');
      if (!evidence.has(e)) { const next = nextRevision(); evidence.add(e); revision = next; }
    }); },
    eligible,
    grant(value: Grant) { return guarded(() => {
      const g = captureGrant(value), old = grants.get(g.capability);
      if (old) return old.reason === g.reason && old.event === g.event ? 'duplicate' as const : 'already-owned' as const;
      if (g.reason === 'earned' && !eligible(g.capability)) return 'ineligible' as const;
      const next = nextRevision(); grants.set(g.capability, g); revision = next; return 'granted' as const;
    }); },
    has: (id: string) => grants.has(id),
    previewRevocation(value: CapabilityRevocation) { return guarded(() => preview(value)); },
    revoke(value: CapabilityRevocation, expectedRevision: number) { return guarded(() => {
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw Error('capabilities: invalid expected revision');
      if (expectedRevision !== revision) return { status: 'stale' as const, revision };
      const plan = preview(value);
      if (plan.blocked.length) return { status: 'blocked' as const, revision, plan };
      if (!plan.removed.length) return { status: 'unchanged' as const, revision, plan };
      const next = nextRevision();
      for (const id of plan.removed) grants.delete(id);
      revision = next;
      return { status: 'revoked' as const, revision, plan };
    }); },
    snapshot: () => ({ revision, evidence: [...evidence], grants: [...grants.values()].map(g => ({ ...g })) }),
  };
}
export * from './modifiers.js';
export { createActionRuns, type ActionRunInput, type ActionRun, type ActionRunState, type ActionAdmission, type ActionTransition } from './action-runs.js';
export * from './timed-effects.js';
export * from './progression.js';
export * from './resource-values.js';
