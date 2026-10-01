#!/usr/bin/env node
/** Local-only, content-addressed delivery of optional data owners. Never publishes. */
import ts from 'typescript';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const kits = ['inventory', 'resources', 'capabilities', 'equipment', 'housing', 'authoring'];
const hash = value => createHash('sha256').update(value).digest('hex');
const entry = kit => `${kit}/${kit === 'authoring' ? 'index' : 'pure'}`;

/** Reject runtime, external, dynamic and ambient dependencies, including type-only leakage. */
export function assertPureGraph(program, sourceRoot) {
  const sources = program.getSourceFiles().filter(file => !program.isSourceFileDefaultLibrary(file));
  for (const source of sources) {
    const path = relative(sourceRoot, source.fileName).replaceAll('\\', '/');
    if (!kits.some(kit => path.startsWith(`${kit}/`)) || source.isDeclarationFile || path.endsWith('.test.ts')) {
      throw Error(`Pure package dependency outside kit source: ${path}`);
    }
    const visit = node => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        const specifier = node.moduleSpecifier;
        if (specifier && (!ts.isStringLiteral(specifier) || !specifier.text.startsWith('.') || !specifier.text.endsWith('.js'))) {
          throw Error(`Pure package requires relative native ESM imports: ${path}`);
        }
      }
      if ((ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) || ts.isImportEqualsDeclaration(node)) {
        throw Error(`Pure package cannot use dynamic dependencies: ${path}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return sources.sort((a, b) => a.fileName.localeCompare(b.fileName));
}

export function buildPurePackage(output = join(root, 'dist/pure')) {
  const staging = mkdtempSync(join(tmpdir(), 'foundation-pure-'));
  try {
    const sourceRoot = join(root, 'src/kits');
    const program = ts.createProgram(kits.map(kit => join(sourceRoot, `${entry(kit)}.ts`)), {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true,
      declaration: true, noEmitOnError: true, types: [], lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
      rootDir: sourceRoot, outDir: join(staging, 'lib'), skipLibCheck: false,
    });
    const sources = assertPureGraph(program, sourceRoot);
    const diagnostics = ts.getPreEmitDiagnostics(program);
    if (diagnostics.length) throw Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCurrentDirectory: () => root, getCanonicalFileName: file => file, getNewLine: () => '\n',
    }));
    if (program.emit().emitSkipped) throw Error('Pure package emit failed');
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const sourceFiles = sources.map(source => relative(root, source.fileName));
    const inputs = [...sourceFiles, 'scripts/package-pure.mjs', 'package.json', 'package-lock.json',
      'LICENSE', 'docs/guides/pure-package.md'].sort();
    const sourceDigest = hash(JSON.stringify(inputs.map(path => [path, readFileSync(join(root, path), 'utf8')])));
    const dirty = execFileSync('git', ['status', '--porcelain', '--', ...inputs], { cwd: root, encoding: 'utf8' }).trim().length > 0;
    const version = `0.1.0-rev.${revision.slice(0, 12)}.source.${sourceDigest.slice(0, 16)}`;
    const npmVersion = execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim();
    const metadata = { schema: 1, revision, sourceDigest, dirty, compiler: ts.version, npm: npmVersion, sourceFiles };
    const manifest = {
      name: '@foundation-engine/pure', version, private: true, type: 'module', license: 'GPL-3.0-only',
      description: 'Optional Foundation data owners without runtime installation or rendering dependencies.',
      sideEffects: false, engines: { node: '>=22' }, files: ['lib', 'metadata.json', 'README.md', 'LICENSE'],
      exports: Object.fromEntries(kits.map(kit => [`./${kit}`, { types: `./lib/${entry(kit)}.d.ts`, import: `./lib/${entry(kit)}.js` }])),
    };
    manifest.exports['./metadata.json'] = './metadata.json';
    writeFileSync(join(staging, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
    writeFileSync(join(staging, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
    copyFileSync(join(root, 'LICENSE'), join(staging, 'LICENSE'));
    copyFileSync(join(root, 'docs/guides/pure-package.md'), join(staging, 'README.md'));
    const packResult = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json'], { cwd: staging, encoding: 'utf8' }));
    const packed = Array.isArray(packResult) ? packResult[0] : packResult[manifest.name];
    if (!packed?.filename || !packed.integrity) throw Error('Unrecognized npm pack receipt');
    const bytes = readFileSync(join(staging, packed.filename));
    const sha256 = hash(bytes);
    mkdirSync(output, { recursive: true });
    const artifact = resolve(output, `foundation-engine-pure-${sha256}.tgz`);
    if (existsSync(artifact)) {
      if (hash(readFileSync(artifact)) !== sha256) throw Error('Existing immutable package is corrupt');
    } else writeFileSync(artifact, bytes, { flag: 'wx', mode: 0o444 });
    const result = { artifact, sha256, integrity: packed.integrity, version, ...metadata };
    const receipt = `${artifact}.json`;
    if (!existsSync(receipt)) writeFileSync(receipt, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o444 });
    return result;
  } finally { rmSync(staging, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(buildPurePackage(process.argv[2] ? resolve(process.argv[2]) : undefined), null, 2));
}
