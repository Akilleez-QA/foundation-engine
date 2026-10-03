/**
 * Three.js shader text, as three's own distribution build ships it (runtime bundle size).
 *
 * vite.config.ts aliases `three` to `three/src/Three.js` so optional loaders and animation classes stay in lazy chunks.
 * The source files keep every GLSL chunk as a commented, blank-lined template literal tagged `/* glsl *\/`; three's
 * published `build/three.module.js` strips those comments and blank lines when it is built. Bundling the source would
 * ship about 22 kB of shader comments in the scene runtime chunk, so a production build applies the same rewrite to
 * `three/src/renderers/shaders/**\/*.glsl.js`. The strings that reach WebGL are byte-for-byte the ones three's own build
 * ships (scripts/three-glsl.test.mjs compares every chunk with the installed `three/build` files).
 *
 * Rules the rewrite relies on (checked by the test): a tagged literal holds no `${…}` interpolation, no backtick and no
 * backslash, so the rewritten text is the literal's runtime value.
 */

const TAGGED = /\/\* glsl \*\/`(.*?)`/gs;
export const THREE_GLSL_FILE = /[\\/]node_modules[\\/]three[\\/]src[\\/]renderers[\\/]shaders[\\/].*\.glsl\.js$/;

/** One shader text, rewritten exactly as three's build (utils/build/rollup.config.js, `glsl()`) rewrites it. */
export function stripGlsl(text) {
  return text.trim()
    .replace(/\r/g, '')
    .replace(/[ \t]*\/\/.*\n/g, '') // line comments, with their newline
    .replace(/[ \t]*\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/\n{2,}/g, '\n'); // blank lines
}

/** A `.glsl.js` module's source with every tagged literal stripped; a literal the rule cannot hold for is an error. */
export function stripGlslModule(code, where = 'three shader module') {
  return code.replace(TAGGED, (_whole, text) => {
    if (/[`\\]|\$\{/.test(text)) throw new Error(`${where}: a glsl literal holds an interpolation, backtick or backslash`);
    return '`' + stripGlsl(text) + '`';
  });
}

/** Vite plugin: production builds only, so the dev server keeps readable shader source for debugging. */
export function threeGlsl() {
  return {
    name: 'engine-three-glsl', apply: 'build',
    transform(code, id) {
      if (!THREE_GLSL_FILE.test(id)) return null;
      return {code: stripGlslModule(code, id), map: null};
    },
  };
}
