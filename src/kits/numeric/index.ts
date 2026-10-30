/**
 * Optional numeric kit: strict deterministic number formats for lockstep, rollback and replay across engines and
 * devices. Fixed-point words (number up to 32 bits, bigint up to 128), integer binary-angle trigonometry, and strict
 * reduced-precision floating point (IEEE binary32, or 24-bit significands with the double exponent as an x87 FPU in
 * single precision mode). Composes with the engine's `dmath`; owns no clock, loop, storage or registration. See README.md.
 */
import {defineKit, type KitDefinition} from '../../author';

export {createFixed, createWideFixed} from './fixed';
export type {Fixed, WideFixed, FixedFormat, FixedRounding, FixedOverflow} from './fixed';
export {createFixedTrig} from './angle';
export type {FixedTrig, FixedTrigOptions} from './angle';
export {createPrecision, f32, pc24} from './precision';
export type {Precision, PrecisionFormat} from './precision';

/** Declares the kit in `defineGame({ kits })`; it contributes no definitions or modules. */
export function numeric(): KitDefinition {
  return defineKit({id: 'numeric'});
}
