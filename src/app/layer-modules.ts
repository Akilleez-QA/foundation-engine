import { qualityModule } from '../platform/render/quality-module';
import type { BuildBrief } from '../author/build';
import { workerModule } from '../platform/workers/module';
import { textureModule } from '../platform/assets/texture-module';
import { modelModule } from '../platform/assets/model-module';
/**
 * app/layer-modules.ts: the core and platform modules (ADR 0036). A short hand-kept list; kits come with the game
 * (`defineGame({ kits })`) and features and packs are discovered by folder (app/modules.ts). Kept free of Vite-only
 * code and CSS so app/registries.test.ts boots it in node. The kernel orders modules by `requires` (then layer, then
 * id), never by list position.
 */
import type { EngineModule } from '../core/module';
import type { GameDefinition } from '../author/defs';
import { sceneId } from '../author/ids';
import { saveModule } from '../core/save/module';
import { settingsModule } from '../core/settings/module';
import features from '../core/settings/features-module';
import { routerModule } from '../core/router/module';
import { inputModule } from '../platform/input/module';
import { audioModule, spatialAudioSettings } from '../platform/audio/module';
import { shellModule } from '../platform/ui/shell-module';

/** The save namespace is the game's id (every stored key starts with it; never renamed). */
export function layerModules(game: GameDefinition, brief?: Pick<BuildBrief, 'quality'>): EngineModule[] {
  return [
    saveModule({ namespace: game.id, build: `${game.id}@${game.version}` }),
    settingsModule({ game: spatialAudioSettings(game.audio) }),
    qualityModule({ initialPreset: brief?.quality.tier ?? 'reference', build: `${game.id}@${game.version}` }),
    features,
    routerModule({ fallbackScene: sceneId(game.firstScene) }),
    inputModule(),
    audioModule(game.audio),
    workerModule(),
    textureModule((s,id)=>{
      const a=s.registries.assets.get(id);if(!a||a.type!=='texture')return undefined;
      const format=a.url.match(/\.(png|jpg|webp)$/)?.[1] as 'png'|'jpg'|'webp'|undefined;
      if(!format||!/^\/?[a-zA-Z0-9_./-]+$/.test(a.url)||a.url.includes('..')||a.url.startsWith('//'))throw Error('assets: expected local texture');
      return {id:a.id,kind:'texture',title:a.id,licence:a.licence==='original'?'original':`other:${a.licence}`,provenance:{author:a.author,credit:a.licence+': '+a.source},colorSpace:'srgb',variants:[{path:a.url.replace(/^\//,''),format,width:a.width,height:a.height}]};
    },game.residency),
    modelModule((s, id) => {
      const a = s.registries.assets.get(id); if (!a || a.type !== 'model') return undefined;
      if (!/^\/?[a-zA-Z0-9_./-]+\.glb$/.test(a.url) || a.url.includes('..') || a.url.startsWith('//')) throw Error('models: expected local GLB');
      return { id: a.id, kind: 'model', title: a.id, licence: a.licence === 'original' ? 'original' : `other:${a.licence}`, provenance: { author: a.author, credit: a.licence + ': ' + a.source }, variants: [{ path: a.url.replace(/^\//, ''), format: 'glb' }] };
    }, game.residency),
    shellModule({ home: sceneId(game.firstScene) }),
  ];
}
