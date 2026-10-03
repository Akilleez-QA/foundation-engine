/** WebGL context calls the render pool makes by name (its create/delete wrapping records the delete entry point). */

/** Deletes `obj` through the context's delete entry point named `del` (`deleteTexture`, `deleteBuffer`, ...). */
export function glDelete(gl:WebGL2RenderingContext,del:string,obj:object):void{
 // lint:allow-unknown-cast the entry point is chosen by its recorded name, and each delete takes the object its create returned
 (gl as unknown as Record<string,(o:object)=>void>)[del]!(obj);
}
