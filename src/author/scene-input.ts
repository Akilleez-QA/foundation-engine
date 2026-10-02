import {actionOf} from './ids';
import type {InputState} from './defs';
/** Covered previews may update visually, but never read another owner's held controls. */
export function sceneInput(owns:()=>boolean,held:(id:ReturnType<typeof actionOf>)=>boolean,pressed:Pick<ReadonlySet<string>,'has'>,pointer:InputState['pointer'],describe:InputState['describe']=()=>null):InputState{
 return {describe,pressed:id=>owns()&&pressed.has(id),held:id=>owns()&&held(actionOf(id)),axis:id=>owns()?Number(held(actionOf(id,'positive')))-Number(held(actionOf(id,'negative'))):0,pointer};
}
