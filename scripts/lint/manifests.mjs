// scripts/lint/manifests.mjs: the eager-manifest closure check (ADR 0036, STD-MOD-7). A feature or pack manifest
// (`index.ts`) may statically reach only src/core/, src/content/ and its own `content.ts` / `content/`.
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {join, posix} from 'node:path';
import ts from 'typescript';

/** Check the entire static runtime import closure, including re-exports. Dynamic bodies and erased types do not
 * enter the eager bundle. A content module cannot smuggle scene code through an otherwise clean manifest. */
export function manifestClosureViolations(files) {
  const errors = [];
  const resolve = (from, spec) => {
    if (!spec.startsWith('.')) return spec;
    const base = posix.normalize(posix.join(posix.dirname(from), spec));
    return [base, base + '.ts', base + '/index.ts'].find(p => files.has(p)) ?? base;
  };
  const staticEdges = file => {
    const ast = ts.createSourceFile(file, files.get(file), ts.ScriptTarget.Latest, true);
    return ast.statements.flatMap(n => {
      if ((!ts.isImportDeclaration(n) && !ts.isExportDeclaration(n)) || !n.moduleSpecifier) return [];
      if (n.isTypeOnly || n.importClause?.isTypeOnly) return [];
      const bindings = n.importClause?.namedBindings ?? n.exportClause;
      if (
        bindings &&
        ts.isNamedImports(bindings) &&
        bindings.elements.length &&
        bindings.elements.every(e => e.isTypeOnly) &&
        !n.importClause?.name
      )
        return [];
      if (
        bindings &&
        ts.isNamedExports(bindings) &&
        bindings.elements.length &&
        bindings.elements.every(e => e.isTypeOnly)
      )
        return [];
      return [resolve(file, n.moduleSpecifier.text)];
    });
  };
  for (const root of [...files.keys()].filter(f => /^src\/(features|packs)\/[^/]+\/index\.ts$/.test(f))) {
    const owner = posix.dirname(root),
      seen = new Set(),
      queue = [[root]];
    while (queue.length) {
      const chain = queue.shift(),
        from = chain.at(-1);
      if (seen.has(from)) continue;
      seen.add(from);
      for (const to of staticEdges(from)) {
        const next = [...chain, to];
        if (!(
          to.startsWith('src/core/') ||
          to.startsWith('src/content/') ||
          to === owner + '/content.ts' ||
          to.startsWith(owner + '/content/')
        )) {
          errors.push('eager-manifest: ' + next.join(' → '));
          continue;
        }
        if (files.has(to)) queue.push(next);
      }
    }
  }
  return errors;
}
export function checkManifestClosures(root) {
  const src = join(root, 'src'),
    files = new Map();
  if (existsSync(src))
    for (const name of readdirSync(src, {recursive: true}).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
      files.set('src/' + name, readFileSync(join(src, name), 'utf8'));
    }
  return manifestClosureViolations(files);
}
