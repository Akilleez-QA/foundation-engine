/**
 * author/scene-model-chunk.ts: the lazy model-presentation chunk. A scene loads it only when it has a `Model` entity:
 * before its first frame when the scene starts with one, else when a system first spawns one. Everything in it
 * (instances, rig capture, attachments, pose links, material looks, playback) is visit-owned by `scene-model.ts`.
 */
export {createSceneModels} from './scene-model';
export {createModelLooks} from './model-looks';
