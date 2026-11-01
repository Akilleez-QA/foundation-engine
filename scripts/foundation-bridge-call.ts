import {readFileSync} from 'node:fs';
import {validateRenderMask} from '../src/author/render-mask';
import {validateSceneOutput} from '../src/author/scene-output';

const request: {name: string; arguments: {mask: number; output?: unknown}} = JSON.parse(readFileSync(0, 'utf8'));
let result: unknown;
if (request.name === 'validate_render_mask') result = validateRenderMask(request.arguments.mask);
else if (request.name === 'validate_scene_output') result = validateSceneOutput(request.arguments.output);
else throw Error('Unknown engine tool');
process.stdout.write(JSON.stringify(result));
