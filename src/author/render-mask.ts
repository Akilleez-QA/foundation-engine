import { defineComponent } from './defs';
/** Independent per-view visibility; bit zero is the default render channel. */
export const RenderMask = defineComponent('render-mask', { mask: 1 });
export function validateRenderMask(mask: number): number {
  if (!Number.isSafeInteger(mask) || mask < 0 || mask > 0xffffffff) throw Error('render mask must be an unsigned 32-bit integer');
  return mask;
}
