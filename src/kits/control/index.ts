import {defineKit, type KitDefinition} from '../../author';
import type {InputActions} from '../../platform/input/actions';
export interface ControlTarget {
  readonly owner: string;
  readonly target: string;
  readonly frame: {readonly id: string; readonly generation: number};
}
export interface ControlState extends ControlTarget {
  readonly revision: number;
}
function target(input: ControlTarget): ControlTarget {
  if (
    ![input.owner, input.target, input.frame.id].every(
      value => typeof value === 'string' && value.length > 0 && value.length <= 256,
    ) ||
    !Number.isSafeInteger(input.frame.generation) ||
    input.frame.generation < 0
  )
    throw Error('invalid control target');
  return Object.freeze({owner: input.owner, target: input.target, frame: Object.freeze({...input.frame})});
}
/** One local actor's simulation owner. Uses the existing input epoch and neutral gate, never global handlers. */
export function createControl(
  initial: ControlTarget,
  ports: {input: Pick<InputActions, 'cancel'>; resetMotion(): void},
) {
  let state: ControlState = Object.freeze({...target(initial), revision: 0}),
    closed = false,
    changing = false;
  return {
    get state() {
      return state;
    },
    owns(owner: string, actor = state.target) {
      return !closed && state.owner === owner && state.target === actor;
    },
    /** Commit must validate before mutation and return false without changing its domain on rejection. */
    transition(next: ControlTarget, commit: () => boolean): boolean {
      const prepared = target(next);
      if (closed || changing) return false;
      if (state.revision === Number.MAX_SAFE_INTEGER) throw Error('control revision exhausted');
      changing = true;
      try {
        if (!commit() || closed) return false;
        // After a successful domain commit, all readers see the new owner before cancellation callbacks run.
        state = Object.freeze({...prepared, revision: state.revision + 1});
        try {
          ports.input.cancel('owner');
        } finally {
          ports.resetMotion();
        }
        return true;
      } finally {
        changing = false;
      }
    },
    dispose() {
      if (closed) return;
      closed = true;
      try {
        ports.input.cancel('owner');
      } finally {
        ports.resetMotion();
      }
    },
  };
}
export function control(): KitDefinition {
  return defineKit({id: 'control', requires: [], defs: [], modules: []});
}
