import {defineModule,type EngineModule} from '../../core/module';
import type {Services} from '../../core/services';
import type {AssetDef} from '../../core/asset-def';
import {lazyTextureLibrary} from './app-assets';
import {assetOwners} from './app-ownership';
/** Optional texture use shares one lazy library for the app lifetime. */
export function textureModule(resolve:(s:Services,id:string)=>AssetDef|undefined):EngineModule{
  return defineModule({id:'platform.assets',version:'1.0.0',serviceKeys:['assets'],install(s){
    const life=new AbortController();
    const library=lazyTextureLibrary(async()=>{
      const {createTextureLibrary}=await import('./textures');
      if(life.signal.aborted)throw Error('assets: module disposed');
      return createTextureLibrary({def:id=>resolve(s,id)});
    });
    const facade={...library,texture:(id:string,o:Parameters<typeof library.texture>[1])=>library.texture(id,{...o,signal:AbortSignal.any([life.signal,o.signal])})};
    s.provide('assets',facade);const unregister=assetOwners.register(facade);
    return {dispose(){life.abort();unregister();}};
  }});
}
