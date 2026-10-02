// scripts/lib/node-version.mjs: the Node.js the repository's own scripts need, checked before anything loads a `.ts`
// file. Plain `node` scripts here (scripts/generate.mjs -> scripts/strings.mjs) import TypeScript directly, which
// relies on Node's built-in type stripping: on by default from Node 22.18 (22.x line) and 23.6 (23.x line). Older
// versions stop with ERR_UNKNOWN_FILE_EXTENSION ".ts", so the entry scripts call requireNode() first and print one
// line instead. package.json `engines`, .nvmrc and .node-version state the same floor.
//
// Import this module before any static import that can reach a `.ts` file: ES modules link every static import
// before running the importer's body, so a guard placed after such an import never runs.

export const MIN_NODE = '22.18.0';

/** The problem with a Node.js version string (`process.versions.node`), or null when it can run these scripts. */
export function nodeVersionProblem(version = process.versions.node) {
  const [major, minor] = String(version).replace(/^v/, '').split('.').map(Number);
  const ok = major >= 24 || (major === 23 && minor >= 6) || (major === 22 && minor >= 18);
  if (ok) return null;
  return `Foundation Engine needs Node.js ${MIN_NODE} or later (22.18+, 23.6+ or 24+); this is Node.js ${version}. ` +
    'Install the latest Node 22 (for example `nvm install 22` or `fnm install 22`) and run the command again.';
}

/** Print one line and exit when this Node.js cannot run the repository's scripts. */
export function requireNode(version = process.versions.node) {
  const problem = nodeVersionProblem(version);
  if (!problem) return;
  console.error(problem);
  process.exit(1);
}

requireNode();
