/**
 * kits/turns/authority.ts: run the same TurnRules under the network kit's durable command authority.
 *
 * The adapter only builds the `validateState`/`validateInput`/`validateResult`/`reduce` policies;
 * the durable authority stays the owner of storage, sequences, receipts and recovery.
 */
import type {DocumentValue} from '../authoring/document';
import type {AuthorityReduction} from '../network/authority-types';
import {createRng, hashSeed} from '../../core/rng';
import type {TurnRules} from './log';

/** Result recorded in every receipt: a domain rejection is a consumed, terminal outcome with unchanged state. */
export type TurnAuthorityResult = {readonly accepted: true} | {readonly accepted: false; readonly reason: string};

/**
 * `lineage` must be the same value given to `createDurableAuthority`; it is mixed into every random stream so
 * matches sharing one server seed still draw independently. Prefer a fresh secret seed per match as well.
 */
export function turnAuthorityPolicies<S extends DocumentValue, C extends DocumentValue>(
  rules: TurnRules<S, C>,
  options: {readonly seed: number; readonly lineage: string},
) {
  const {seed, lineage} = options;
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw Error('turns: invalid authority seed');
  if (typeof lineage !== 'string' || !lineage || lineage.length > 256) throw Error('turns: invalid authority lineage');
  return Object.freeze({
    /** Spread into `createDurableAuthority` so the authority and the random streams share one lineage. */
    lineage,
    validateState: (value: DocumentValue) => rules.validateState(value) === true,
    validateInput: (value: DocumentValue) => rules.validateCommand(value) === true,
    validateResult: (value: DocumentValue) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const r = value as Record<string, DocumentValue>;
      return r.accepted === true
        ? Object.keys(r).length === 1
        : r.accepted === false && typeof r.reason === 'string' && Object.keys(r).length === 2;
    },
    /** Random is keyed by seed, lineage, stream and sequence; the authority makes the last two unique and replay-stable. */
    reduce(context: AuthorityReduction): Readonly<{stateJson: string; resultJson: string}> {
      const random = createRng(hashSeed(JSON.stringify([seed, lineage, context.stream, context.sequence])));
      const out = rules.reduce({state: context.state as S, command: context.input as C, random});
      if (out && out.accept === true)
        return {stateJson: JSON.stringify(out.state), resultJson: JSON.stringify({accepted: true})};
      const reason =
        out && out.accept === false && typeof out.reason === 'string' && out.reason
          ? out.reason.slice(0, 256)
          : 'rejected';
      return {stateJson: JSON.stringify(context.state), resultJson: JSON.stringify({accepted: false, reason})};
    },
  });
}
