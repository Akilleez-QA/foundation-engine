import * as T from 'three';
import { AbortError, type AssetLease, type Lease } from './lease-cache';
import type { TextureLibrary } from './textures';
/** Faces are +X, -X, +Y, -Y, +Z, -Z in the Three cube convention. */
export interface CubeSpec { faces: readonly [string,string,string,string,string,string]; screenPx: number }
/** Aggregate ownership over existing face leases; no second file loader or cache. */
export async function leaseCube(library: TextureLibrary, spec: CubeSpec, signal: AbortSignal, maxBytes = 32*1024*1024, reportCleanup: (error: unknown) => void = () => {}): Promise<Lease<T.CubeTexture>> {
  const faces = [...spec.faces], screenPx = spec.screenPx;
  if(faces.length!==6 || faces.some(id=>typeof id!=='string'||!id||id.length>256) || !Number.isFinite(screenPx)||screenPx<=0 || !Number.isSafeInteger(maxBytes)||maxBytes<=0) throw Error('cube: invalid request');
  const life = new AbortController(), leases: AssetLease<T.Texture>[] = [], copies: ImageBitmap[]=[];
  let cube:T.CubeTexture|undefined, released=false;
  const report=(error:unknown)=>{try{reportCleanup(error);}catch{/* Reporting must not escape abort dispatch. */}};
  const release=()=>{
    if(released)return;released=true;signal.removeEventListener('abort',onAbort);
    const errors:unknown[]=[];
    const attempt=(fn:()=>void)=>{try{fn();}catch(error){errors.push(error);}};
    attempt(()=>cube?.dispose());
    for(const image of copies)attempt(()=>image.close());
    // Release completed leases before aborting the remaining in-flight decode.
    for(const lease of leases)attempt(()=>lease.release());
    attempt(()=>life.abort());
    if(errors.length)throw new AggregateError(errors,'cube cleanup failed');
  };
  const onAbort=()=>{try{release();}catch(error){report(error);}};
  signal.addEventListener('abort',onAbort,{once:true});
  try {
    if(signal.aborted)throw new AbortError();
    const variants=await Promise.all(faces.map(id=>library.variant(id,screenPx)));
    const side=variants[0]?.width;
    if(!side || !Number.isSafeInteger(side) || variants.some(v=>v.width!==side||v.height!==side) || side*side*6*4*(2+4/3)>maxBytes)throw Error('cube: incompatible dimensions or byte budget');
    if(released)throw new AbortError();
    const images: unknown[]=[];
    // Serial face admission bounds in-flight decode and simplifies partial failure ownership.
    for(const id of faces){
      const lease=await library.texture(id,{screenPx,signal:life.signal,colorSpace:'srgb'});
      if(released){lease.release();throw new AbortError();}leases.push(lease);
      let image=lease.value.image as {width:number;height:number};
      if(image.width!==side||image.height!==side)throw Error('cube: decoded dimensions differ from manifest');
      if(typeof ImageBitmap!=='undefined' && image instanceof ImageBitmap){
        // The texture decoder bakes flipY. Cubes use unflipped faces, so normalize this owned copy.
        const copy=await createImageBitmap(image,{imageOrientation:'flipY',premultiplyAlpha:'none',colorSpaceConversion:'none'});
        if(released){copy.close();throw new AbortError();}copies.push(copy);image=copy;
      }
      images.push(image);
    }
    cube=new T.CubeTexture(images);cube.colorSpace=T.SRGBColorSpace;cube.userData.shared=true;cube.needsUpdate=true;
    return {value:cube,key:faces.join('|')+':'+side,release};
  } catch(error){try{release();}catch(cleanup){report(cleanup);}throw error;}
}
