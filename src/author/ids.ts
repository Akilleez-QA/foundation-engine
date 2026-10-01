/** author/ids.ts: how author ids map to engine ids (shared by compile and the lazy runtime, so neither imports the other). */
import type { SceneId } from '../core/router/resolve';

export const sceneId = (id: string) => `scene.${id}` as SceneId;
export const actionOf = (input: string, side?: 'negative' | 'positive') => `game.${input}${side ? (side === 'negative' ? '.neg' : '.pos') : ''}`;
