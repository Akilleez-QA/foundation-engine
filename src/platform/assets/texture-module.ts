import {defineModule,type EngineModule} from '../../core/module';
import type {Services} from '../../core/services';
import type {AssetDef} from '../../core/asset-def';
import {lazyTextureLibrary} from './app-assets';
import {assetOwners} from './app-ownership';
import {bindResidency,type AssetResidencyInput} from './residency';
import type {TextureLibraryStats} from './textures';
declare module '../../core/probe' { interface EngineProbes { textures: TextureLibraryStats } }
/** Optional texture use shares one lazy library for the app lifetime. `residency` is the creator's RES-01 policy. */
export function textureModule(resolve:(s:Services,id:string)=>AssetDef|undefined,residency?:AssetResidencyInput):EngineModule{
  return defineModule({id:'platform.assets',version:'1.0.0',serviceKeys:['assets'],...(residency?{optional:['platform.quality']}:{}),install(s){
    const life=new AbortController();
    const library=lazyTextureLibrary(async()=>{
      const {createTextureLibrary}=await import('./textures');
      if(life.signal.aborted)throw Error('assets: module disposed');
      return createTextureLibrary({def:id=>resolve(s,id)});
    });
    const facade={...library,texture:(id:string,o:Parameters<typeof library.texture>[1])=>library.texture(id,{...o,signal:AbortSignal.any([life.signal,o.signal])})};
    s.provide('assets',facade);const unregister=assetOwners.register(facade);
    if(residency){
      for(const id of residency.pinned??[]){const a=s.registries.assets.get(id);if(!a||(a.type!=='texture'&&a.type!=='model'))s.log.error(`residency: pinned asset ${id} is not a registered texture or model`);}
      bindResidency({kind:'textures',input:residency,quality:s.app.has('platform.quality')?s.quality:undefined,signal:life.signal,log:s.log,apply:p=>library.setResidency(p)});
      s.probes.register('textures',()=>library.stats(),s.signal);
    }
    return {dispose(){life.abort();
      // Teardown retires every retained texture, pinned or not (RES-01).
      try{if(residency)library.setResidency({warmBytes:0});}finally{unregister();}}};
  }});
}
