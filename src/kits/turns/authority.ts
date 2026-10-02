/**
 * kits/turns/authority.ts: run the same TurnRules under the network kit's durable command authority.
 *
 * The adapter only builds the `validateState`/`validateInput`/`validateResult`/`reduce` policies;
 * the durable authority stays the owner of storage, sequences, receipts and recovery.
 */
import type { DocumentValue } from '../authoring/document';
import type { AuthorityReduction } from '../network/authority-types';
import { createRng, hashSeed } from '../../core/rng';
import type { TurnRules } from './log';

/** Result recorded in every receipt: a domain rejection is a consumed, terminal outcome with unchanged state. */
export type TurnAuthorityResult = { readonly accepted: true } | { readonly accepted: false; readonly reason: string };

export function turnAuthorityPolicies<S extends DocumentValue, C extends DocumentValue>(rules: TurnRules<S, C>, options: { readonly seed: number }) {
  const seed = options.seed;
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw Error('turns: invalid authority seed');
  return Object.freeze({
    validateState: (value: DocumentValue) => rules.validateState(value) === true,
    validateInput: (value: DocumentValue) => rules.validateCommand(value) === true,
    validateResult: (value: DocumentValue) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const r = value as Record<string, DocumentValue>;
      return r.accepted === true ? Object.keys(r).length === 1 : r.accepted === false && typeof r.reason === 'string' && Object.keys(r).length === 2;
    },
    /** Random is keyed by stream and sequence, which the authority makes unique and replay-stable. */
    reduce(context: AuthorityReduction): Readonly<{ stateJson: string; resultJson: string }> {
      const random = createRng(hashSeed(JSON.stringify([seed, context.stream, context.sequence])));
      const out = rules.reduce({ state: context.state as S, command: context.input as C, random });
      if (out && out.accept === true) return { stateJson: JSON.stringify(out.state), resultJson: JSON.stringify({ accepted: true }) };
      const reason = out && out.accept === false && typeof out.reason === 'string' && out.reason ? out.reason.slice(0, 256) : 'rejected';
      return { stateJson: JSON.stringify(context.state), resultJson: JSON.stringify({ accepted: false, reason }) };
    },
  });
}
