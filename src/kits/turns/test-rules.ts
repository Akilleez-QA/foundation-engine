/** Test rules: a tiny card table. Real games supply their own rules; this is only a fixture. */
import type { DocumentValue } from '../authoring/document';
import type { TurnRules } from './log';

export type Table = { readonly deck: readonly number[]; readonly hand: readonly number[]; readonly score: number; readonly turn: number };
export type Move = { readonly type: 'shuffle' } | { readonly type: 'draw' } | { readonly type: 'play'; readonly card: number };

const ints = (v: unknown): v is number[] => Array.isArray(v) && v.every(n => Number.isSafeInteger(n));
export const isTable = (v: DocumentValue): v is Table => !!v && typeof v === 'object' && !Array.isArray(v)
  && ints((v as Table).deck) && ints((v as Table).hand) && Number.isSafeInteger((v as Table).score) && Number.isSafeInteger((v as Table).turn);
export const isMove = (v: DocumentValue): v is Move => !!v && typeof v === 'object' && !Array.isArray(v)
  && ((v as Move).type === 'shuffle' || (v as Move).type === 'draw' || ((v as Move).type === 'play' && Number.isSafeInteger((v as { card: number }).card)));

export const table: Table = { deck: [1, 2, 3, 4, 5, 6, 7, 8], hand: [], score: 0, turn: 0 };

export function cardRules(id = 'test-cards@1', bonus = 0): TurnRules<Table, Move> {
  return {
    id, validateState: isTable, validateCommand: isMove,
    reduce({ state, command, random }) {
      if (command.type === 'shuffle') {
        const deck = [...state.deck];
        for (let i = deck.length - 1; i > 0; i--) { const j = random.int(0, i); [deck[i], deck[j]] = [deck[j], deck[i]]; }
        return { accept: true, state: { ...state, deck, turn: state.turn + 1 } };
      }
      if (command.type === 'draw') {
        if (!state.deck.length) return { accept: false, reason: 'deck empty' };
        return { accept: true, state: { ...state, deck: state.deck.slice(1), hand: [...state.hand, state.deck[0]], turn: state.turn + 1 } };
      }
      if (!state.hand.includes(command.card)) return { accept: false, reason: 'card not in hand' };
      return { accept: true, state: { ...state, hand: state.hand.filter(c => c !== command.card), score: state.score + command.card + bonus, turn: state.turn + 1 } };
    },
  };
}

export const json = { maxBytes: 4096, maxNodes: 256, maxDepth: 6 };
export const limits = { maxCommands: 8, state: json, command: { maxBytes: 256, maxNodes: 8, maxDepth: 2 } };
