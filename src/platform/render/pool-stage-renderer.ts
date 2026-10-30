/**
 * platform/render/pool-stage-renderer.ts: a `stage` view's renderer from the app's pool, for an opener that
 * builds its renderer in one call (the minigames, the skies, the galaxy survey).
 */
import type * as T from 'three';
import {appRenderers, type RenderProfile} from './renderer-pool';
import type {StageSurfaceRequest} from './pool-stage';

/**
 * Throws, as `new WebGLRenderer` did, when WebGL cannot start. The pool applies `maxPixelRatio` live (the Graphics
 * screen), and `renderer.dispose()` ends the lease.
 */
export function stageRenderer(req: Omit<StageSurfaceRequest<Partial<RenderProfile>>, 'role'> = {}): T.WebGLRenderer {
  const surface = appRenderers().lease({...req, role: 'stage'});
  if (!surface) throw Error('The picture could not start (WebGL unavailable).');
  return surface.renderer;
}
