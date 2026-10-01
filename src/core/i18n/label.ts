import {appI18n} from './app-i18n';
import type {StringKey,StringParams} from './keys.gen';
/** Parameter-free metadata can be read before its lazy owner's catalogue arrives. Keep its English loading
 * caption in the manifest; once the locale catalogue is present, read the translated value. */
export type LabelKey = {[K in StringKey]:[StringParams[K]] extends [never]?K:never}[StringKey];
export interface LocalizedLabel {key:LabelKey;fallback:string}
export function label(text:string|LocalizedLabel):string{return typeof text==='string'?text:appI18n.has(text.key)?appI18n.t(text.key):text.fallback;}
