/**
 * Three.js keeps a few module-level geometries (the shared sprite quad, for example)
 * whose GPU-buffer records keep reaching the last WebGL context that drew them, and
 * through it that context's canvas. If the discarded canvas still holds pointer
 * handlers, their closures keep a whole disposed scene alive: about 90 MB each time
 * a scene was left and re-entered. Drop the handlers when tearing a view down.
 */
const handlerProps=['onpointerdown','onlostpointercapture','ongotpointercapture','onpointerup','onpointermove','onpointercancel','onpointerleave','onpointerenter','onpointerover','onpointerout','onclick','ondblclick','oncontextmenu','onwheel','onmousedown','onmouseup','onmousemove','ontouchstart','ontouchmove','ontouchend','onkeydown','onkeyup','onfocus','onblur'] as const;
export function releaseCanvasHandlers(canvas:HTMLElement){for(const p of handlerProps)canvas[p]=null;}

/**
 * Module-lifetime three.js resources (the DFG lookup texture every PBR material uses, the shared sprite
 * quad, and shared geometries and materials) outlive each scene. Every renderer that draws
 * one adds a 'dispose' listener to it, and that listener's closure keeps the renderer, its buffers, its
 * WebGL context and its canvas alive for the rest of the session (two renderers per scene visit).
 * Dispatching dispose on those shared resources makes every renderer drop its copy and its listener;
 * a renderer that is still running simply uploads them again on its next frame. Call it before
 * disposing the scene's own materials, while their renderer properties still exist.
 */
type Disposable={dispose?:()=>void;userData?:Record<string,unknown>;isTexture?:boolean};
export function releaseSharedRendererTextures(renderer:{properties:{get:(o:object)=>unknown}},scene:{traverse:(f:(o:object)=>void)=>void}){
 const shared=new Set<Disposable>();const isShared=(r:Disposable|undefined)=>r?.userData?.shared===true;
 scene.traverse(o=>{
  const obj=o as {material?:unknown;geometry?:Disposable;isSprite?:boolean};
  if(obj.geometry&&(obj.isSprite||isShared(obj.geometry)))shared.add(obj.geometry);
  for(const material of Array.isArray(obj.material)?obj.material:obj.material?[obj.material]:[]){
   const uniforms=(renderer.properties.get(material as object) as {uniforms?:Record<string,{value?:unknown}>}).uniforms;
   const lut=uniforms?.dfgLUT?.value as Disposable|undefined;if(lut?.isTexture)shared.add(lut);
   if(isShared(material as Disposable))shared.add(material as Disposable);
   for(const value of Object.values(material as object))if((value as Disposable)?.isTexture&&isShared(value as Disposable))shared.add(value as Disposable);
  }
 });
 for(const r of shared)r.dispose?.();
}
