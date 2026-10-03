// core/version.ts: semver-lite for module versions and dependency ranges (CKAN .ckan, KSP-AVC .version).
// Supported ranges: exact 'x.y.z', '^x.y.z', '~x.y.z', '>=x.y.z', a bare major '^2', and '*'.
// Pre-release tags and build metadata are not supported: module versions are plain 'x.y.z'.

export type Version = readonly [major: number, minor: number, patch: number];

/** 'x', 'x.y' or 'x.y.z' → [x, y, z]; anything else → null. */
export function parseVersion(v: string): Version | null {
  const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(v.trim());
  return m ? [+m[1]!, +(m[2] ?? 0), +(m[3] ?? 0)] : null; // group 1 is not optional
}

/** Negative when a < b, zero when equal, positive when a > b. */
export function compareVersions(a: Version, b: Version): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** Does `version` fall inside `range`? An unparseable version or range never satisfies. */
export function satisfies(version: string, range: string | undefined): boolean {
  if (!range || range === '*') return true;
  const v = parseVersion(version);
  if (!v) return false;
  const op = /^(\^|~|>=)?(.*)$/.exec(range.trim())!;
  const r = parseVersion(op[2]!); // group 2 `(.*)` always matches
  if (!r) return false;
  if (op[1] === '>=') return compareVersions(v, r) >= 0;
  if (op[1] === '^') return v[0] === r[0] && compareVersions(v, r) >= 0;
  if (op[1] === '~') return v[0] === r[0] && v[1] === r[1] && compareVersions(v, r) >= 0;
  return compareVersions(v, r) === 0;
}

/** 'domain.sim@^2' → { id: 'domain.sim', range: '^2' }; 'domain.sim' → { id: 'domain.sim' }. */
export function splitDep(dep: string): {id: string; range?: string} {
  const at = dep.lastIndexOf('@');
  return at > 0 ? {id: dep.slice(0, at), range: dep.slice(at + 1)} : {id: dep};
}
