import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import config from '../vite.config.ts';
import {THREE_GLSL_FILE, stripGlslModule, threeGlsl} from './three-glsl.mjs';

const three = fileURLToPath(new URL('../node_modules/three/', import.meta.url));
const shaderDirs = ['src/renderers/shaders/ShaderChunk', 'src/renderers/shaders/ShaderLib'];
const literal = code => [...code.matchAll(/`([\s\S]*?)`/g)].map(m => m[1]);

test("three glsl: every stripped shader text is the one three's own build ships", () => {
  const dist =
    readFileSync(three + 'build/three.core.js', 'utf8') + readFileSync(three + 'build/three.module.js', 'utf8');
  let checked = 0;
  for (const dir of shaderDirs)
    for (const file of readdirSync(three + dir).filter(f => f.endsWith('.glsl.js'))) {
      const source = readFileSync(`${three}${dir}/${file}`, 'utf8');
      for (const text of literal(stripGlslModule(source, file))) {
        assert.ok(dist.includes(JSON.stringify(text)), `${dir}/${file}: stripped text differs from three's build`);
        checked++;
      }
    }
  assert.ok(checked > 100, `only ${checked} shader texts found`);
});

test("three glsl: only three's shader modules are rewritten, and only in production builds", () => {
  const plugin = threeGlsl();
  assert.equal(plugin.apply, 'build');
  assert.ok(
    config.plugins.some(p => p && p.name === plugin.name),
    'vite.config.ts registers the plugin',
  );
  const tagged = 'export default /* glsl */`\n\t// comment\n\tvoid main() {}\n\n`;\n';
  assert.equal(plugin.transform(tagged, '/x/src/shader.glsl.js'), null);
  assert.equal(plugin.transform(tagged, '/x/node_modules/three/examples/jsm/csm/CSMShader.js'), null);
  assert.ok(
    THREE_GLSL_FILE.test('C:\\x\\node_modules\\three\\src\\renderers\\shaders\\ShaderChunk\\fog_fragment.glsl.js'),
  );
  assert.equal(
    plugin.transform(tagged, '/x/node_modules/three/src/renderers/shaders/ShaderChunk/a.glsl.js').code,
    'export default `\tvoid main() {}`;\n',
  );
});

test('three glsl: a literal whose source text is not its value is refused', () => {
  assert.throws(() => stripGlslModule('x = /* glsl */`${a}`'), /interpolation/);
  assert.throws(() => stripGlslModule('x = /* glsl */`a\\nb`'), /backslash/);
});
